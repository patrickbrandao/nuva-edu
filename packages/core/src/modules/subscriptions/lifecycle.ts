import type { Database } from '../../db/database.ts';
import { revokeSubscriptionEntitlements } from '../entitlements/subscription.ts';
import type { EntitlementRevokeReason } from '../entitlements/types.ts';
import {
  addInterval,
  type PlanInterval,
  type SubscriptionLifecycleStatus,
  toSubscription,
} from './types.ts';

// Peças compartilhadas do ciclo de vida da assinatura (spec 012, "Ciclo de vida"): leitura com
// trava, período seguinte, cobrança do período em curso, suspensão e encerramento. Ficam aqui,
// e não na transição, porque o reembolso e a reconciliação também encerram a assinatura.

/** Uma assinatura com o plano, como o ciclo de vida a lê. */
export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionLifecycleStatus;
  priceCents: number;
  currency: string;
  couponId: string | null;
  provider: string;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  endedAt: Date | null;
  createdAt: Date;
}

/** Assinatura pelo id, com `forUpdate` para a transição; `undefined` quando não existe. */
export async function loadSubscriptionRecord(
  db: Database,
  subscriptionId: string,
  options: { forUpdate?: boolean } = {},
): Promise<SubscriptionRecord | undefined> {
  let query = db
    .selectFrom('subscriptions')
    .selectAll()
    .where('id', '=', subscriptionId.toLowerCase());
  if (options.forUpdate) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  return row ? toSubscription(row) : undefined;
}

export interface SubscriptionPeriod {
  start: Date;
  end: Date;
}

/**
 * Período que a cobrança aprovada abre. Primeira cobrança (inclusive pagamento após `expired` ou
 * `suspended`) começa no pagamento; renovação e regularização avançam a partir do fim do período
 * atual, como o provedor faz ([013], `renewSubscription`). O período termina um `month`/`year`
 * depois do início.
 */
export function periodForApprovedPayment(
  previousStatus: SubscriptionLifecycleStatus,
  currentPeriodEnd: Date | null,
  paidAt: Date,
  interval: PlanInterval,
): SubscriptionPeriod {
  const startsAtPayment =
    previousStatus === 'pending' ||
    previousStatus === 'expired' ||
    previousStatus === 'suspended' ||
    currentPeriodEnd === null;
  const start = startsAtPayment ? paidAt : currentPeriodEnd;
  return { start, end: addInterval(start, interval) };
}

/** Fim dos direitos: o do período mais a carência (spec 012, "Ciclo de vida"). */
export function entitlementExpiry(periodEnd: Date, graceDays: number): Date {
  const result = new Date(periodEnd);
  result.setUTCDate(result.getUTCDate() + graceDays);
  return result;
}

/**
 * A cobrança que abriu o período em curso: entre as cobranças liquidadas, a de `paid_at` mais
 * próximo de `current_period_start` (a renovação acontece no início do período). Sem período ou
 * sem cobrança paga, `null`.
 */
export async function findCurrentPeriodPaymentId(
  db: Database,
  subscriptionId: string,
  currentPeriodStart: Date | null,
): Promise<string | null> {
  if (currentPeriodStart === null) return null;
  const rows = await db
    .selectFrom('payments')
    .select(['id', 'paidAt'])
    .where('subscriptionId', '=', subscriptionId)
    .where('paidAt', 'is not', null)
    .where('status', 'in', ['approved', 'refunded', 'partially_refunded', 'charged_back'])
    .execute();
  if (rows.length === 0) return null;
  const target = currentPeriodStart.getTime();
  let best: { id: string; distance: number; paidAt: number } | undefined;
  for (const row of rows) {
    const paidAt = row.paidAt as Date;
    const distance = Math.abs(paidAt.getTime() - target);
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && paidAt.getTime() > best.paidAt)
    ) {
      best = { id: row.id, distance, paidAt: paidAt.getTime() };
    }
  }
  return best?.id ?? null;
}

/** A cobrança é a do período em curso? Reembolsá-la encerra a assinatura (spec 012). */
export async function isCurrentPeriodPayment(
  db: Database,
  subscription: Pick<SubscriptionRecord, 'id' | 'currentPeriodStart'>,
  paymentId: string,
): Promise<boolean> {
  const current = await findCurrentPeriodPaymentId(
    db,
    subscription.id,
    subscription.currentPeriodStart,
  );
  return current === paymentId;
}

/**
 * Encerra a assinatura e revoga os direitos com o motivo dado (reembolso, chargeback, suspensão
 * vencida). Idempotente: assinatura já `ended` não é tocada. Até aqui só os estados com período
 * chegam; o chamador já garantiu a coerência das colunas da migration 0015.
 */
export async function endSubscription(
  trx: Database,
  subscriptionId: string,
  reason: EntitlementRevokeReason,
  now: Date,
): Promise<{ ended: boolean; revoked: number }> {
  if (!trx.isTransaction) {
    throw new TypeError('endSubscription exige uma transação aberta.');
  }
  const current = await trx
    .selectFrom('subscriptions')
    .select(['id', 'status'])
    .where('id', '=', subscriptionId)
    .forUpdate()
    .executeTakeFirst();
  if (!current || current.status === 'ended') return { ended: false, revoked: 0 };
  await trx
    .updateTable('subscriptions')
    .set({ status: 'ended', endedAt: now, graceUntil: null })
    .where('id', '=', subscriptionId)
    .execute();
  const revoked = await revokeSubscriptionEntitlements(trx, subscriptionId, reason);
  return { ended: true, revoked };
}

/**
 * Suspende a assinatura ao fim da carência (spec 012): perde o acesso, mantém o período e a
 * carência para o histórico e para os 30 dias até `ended`; revoga os direitos.
 */
export async function suspendSubscription(
  trx: Database,
  subscriptionId: string,
): Promise<{ suspended: boolean; revoked: number }> {
  if (!trx.isTransaction) {
    throw new TypeError('suspendSubscription exige uma transação aberta.');
  }
  const current = await trx
    .selectFrom('subscriptions')
    .select(['id', 'status', 'graceUntil'])
    .where('id', '=', subscriptionId)
    .forUpdate()
    .executeTakeFirst();
  if (current?.status !== 'past_due') return { suspended: false, revoked: 0 };
  await trx
    .updateTable('subscriptions')
    .set({ status: 'suspended', endedAt: null })
    .where('id', '=', subscriptionId)
    .execute();
  const revoked = await revokeSubscriptionEntitlements(trx, subscriptionId, 'subscription_ended');
  return { suspended: true, revoked };
}
