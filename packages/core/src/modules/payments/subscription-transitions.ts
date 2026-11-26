import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { recordAudit } from '../audit/record.ts';
import { grantSubscriptionEntitlements } from '../entitlements/subscription.ts';
import { notify } from '../notifications/central.ts';
import { incrementCouponUse } from '../sales/coupons.ts';
import { applyChargeback, applyProviderPaymentRefund } from '../sales/refunds.ts';
import { endSubscription, periodForApprovedPayment } from '../subscriptions/lifecycle.ts';
import {
  addDays,
  SUBSCRIPTION_GRACE_DAYS_DEFAULT,
  type SubscriptionLifecycleStatus,
} from '../subscriptions/types.ts';
import { invalidPaymentTransition } from './errors.ts';
import { parsePaymentExternalReference } from './references.ts';
import type { PaymentProviderName, ProviderPayment, ProviderSubscription } from './types.ts';

// Transição de uma assinatura a partir do estado real da cobrança no provedor (spec 013,
// "Processamento no worker"; spec 012, "Ciclo de vida"). Consumida pelo webhook e pela
// reconciliação (tarefa 532). A transação trava a linha da assinatura: a ordem de chegada entre
// webhook e reconciliação não importa, e a mesma cobrança repetida não estende os direitos nem
// conta o cupom duas vezes. Os efeitos de reembolso e contestação delegam ao módulo de reembolsos.

export interface ApplySubscriptionPaymentOptions {
  /** Instante da transição; padrão: agora. */
  now?: Date;
  /** Dias de carência da instalação (`NUVA_SUBSCRIPTION_GRACE_DAYS`). */
  graceDays?: number;
}

export interface AppliedSubscriptionPayment {
  subscriptionId: string;
  previousStatus: SubscriptionLifecycleStatus;
  status: SubscriptionLifecycleStatus;
  /** `true` quando o estado da assinatura mudou nesta chamada. */
  changed: boolean;
  /** Raízes de direito criadas nesta chamada (0 na repetição). */
  granted: number;
  /** Direitos (raízes e derivados) com `expires_at` atualizado nesta chamada. */
  extended: number;
}

/**
 * Grava ou atualiza a linha de `payments` da cobrança recorrente, idempotente por
 * (`provider`, `provider_payment_id`). Não aplica transição; o chamador usa
 * `applySubscriptionPayment`.
 */
export async function recordSubscriptionPayment(
  db: Database,
  provider: PaymentProviderName,
  payment: ProviderPayment,
  options: ApplySubscriptionPaymentOptions = {},
): Promise<string> {
  const reference = parsePaymentExternalReference(payment.externalReference);
  if (reference.kind !== 'subscription') {
    throw invalidPaymentTransition('A cobrança não pertence a uma assinatura.');
  }
  const now = options.now ?? new Date();
  const paidAt = settledAt(payment, now);
  const row = await db
    .insertInto('payments')
    .values({
      orderId: null,
      subscriptionId: reference.id,
      provider,
      providerPaymentId: payment.providerPaymentId,
      status: payment.status,
      method: payment.method,
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      currency: payment.currency,
      rawStatus: payment.rawStatus,
      paidAt,
    })
    .onConflict((oc) =>
      oc.columns(['provider', 'providerPaymentId']).doUpdateSet({
        orderId: null,
        subscriptionId: reference.id,
        status: payment.status,
        method: payment.method,
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        currency: payment.currency,
        rawStatus: payment.rawStatus,
        paidAt,
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Estados de `payments.status` em que o dinheiro entrou (têm `paid_at`). */
const SETTLED_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  'approved',
  'refunded',
  'partially_refunded',
  'charged_back',
]);

function settledAt(payment: ProviderPayment, now: Date): Date | null {
  return SETTLED_PAYMENT_STATUSES.has(payment.status) ? (payment.paidAt ?? now) : null;
}

interface SubscriptionTransitionRow {
  id: string;
  userId: string;
  status: string;
  couponId: string | null;
  canceledAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  planTitle: string;
  planInterval: string;
}

/**
 * Aplica a transição da assinatura a partir da cobrança: grava `payments` e, na transação com
 * trava na assinatura, decide o novo estado. `approved` ativa (`pending`, `suspended` e `expired`
 * vencida por prazo) ou renova (`active`/`past_due`), estendendo os direitos e, na ativação,
 * contando o cupom uma única vez. `expired` cancelada pelo aluno antes da primeira cobrança não
 * reativa. `rejected` leva a `active` para `past_due` com a carência; `canceled` não tem efeito;
 * `refunded`/`partially_refunded` e `charged_back` delegam ao módulo de reembolsos. Assinatura
 * inexistente é `404` (o webhook marca o evento como `ignored`).
 */
export async function applySubscriptionPayment(
  db: Database,
  provider: PaymentProviderName,
  payment: ProviderPayment,
  options: ApplySubscriptionPaymentOptions = {},
): Promise<AppliedSubscriptionPayment> {
  const reference = parsePaymentExternalReference(payment.externalReference);
  if (reference.kind !== 'subscription') {
    throw invalidPaymentTransition('A cobrança não pertence a uma assinatura.');
  }
  const exists = await db
    .selectFrom('subscriptions')
    .select(['id', 'status'])
    .where('id', '=', reference.id)
    .executeTakeFirst();
  if (!exists) throw notFound('Assinatura não encontrada.');

  const now = options.now ?? new Date();
  const graceDays = options.graceDays ?? SUBSCRIPTION_GRACE_DAYS_DEFAULT;
  const paymentId = await recordSubscriptionPayment(db, provider, payment, { now });

  // Reembolso e contestação são do módulo de reembolsos, que abre a própria transação e já tem o
  // estado atualizado da cobrança em `payments`.
  if (payment.status === 'refunded' || payment.status === 'partially_refunded') {
    await applyProviderPaymentRefund(db, paymentId, { now });
    return summarize(db, reference.id, exists.status as SubscriptionLifecycleStatus);
  }
  if (payment.status === 'charged_back') {
    await applyChargeback(db, paymentId, { now });
    return summarize(db, reference.id, exists.status as SubscriptionLifecycleStatus);
  }

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('subscriptions')
      .innerJoin('plans', 'plans.id', 'subscriptions.planId')
      .select([
        'subscriptions.id as id',
        'subscriptions.userId as userId',
        'subscriptions.status as status',
        'subscriptions.couponId as couponId',
        'subscriptions.canceledAt as canceledAt',
        'subscriptions.currentPeriodStart as currentPeriodStart',
        'subscriptions.currentPeriodEnd as currentPeriodEnd',
        'plans.title as planTitle',
        'plans.interval as planInterval',
      ])
      .where('subscriptions.id', '=', reference.id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound('Assinatura não encontrada.');
    const subscription = row as SubscriptionTransitionRow;
    const previousStatus = subscription.status as SubscriptionLifecycleStatus;
    let status = previousStatus;
    let granted = 0;
    let extended = 0;

    if (payment.status === 'approved') {
      // `expired` só reativa quando veio do prazo de `pending`; o aluno que cancelou antes da
      // primeira cobrança deixou `canceledAt`, e uma aprovação tardia não desfaz a decisão dele.
      const activation =
        previousStatus === 'pending' ||
        previousStatus === 'suspended' ||
        (previousStatus === 'expired' && subscription.canceledAt === null);
      const renewal = previousStatus === 'active' || previousStatus === 'past_due';
      if (activation || renewal) {
        const paidAt = payment.paidAt ?? now;
        const period = periodForApprovedPayment(
          previousStatus,
          subscription.currentPeriodEnd,
          paidAt,
          subscription.planInterval as 'month' | 'year',
        );
        await trx
          .updateTable('subscriptions')
          .set({
            status: 'active',
            currentPeriodStart: period.start,
            currentPeriodEnd: period.end,
            graceUntil: null,
            endedAt: null,
          })
          .where('id', '=', subscription.id)
          .execute();
        // O cupom vale só na primeira cobrança: conta uma vez, na ativação.
        if (activation && subscription.couponId !== null) {
          await incrementCouponUse(trx, subscription.couponId);
        }
        const result = await grantSubscriptionEntitlements(trx, subscription.id, { graceDays });
        granted = result.granted;
        extended = result.extended;
        await notify(trx, 'subscription.renewed', subscription.userId, {
          targetType: 'subscription',
          targetId: subscription.id,
          data: {
            planTitle: subscription.planTitle,
            periodEnd: period.end.toISOString(),
            amountCents: payment.amountCents,
          },
        });
        await recordAudit(trx, {
          context: { origin: 'worker' },
          action: activation ? 'subscription.activated' : 'subscription.renewed',
          targetType: 'subscription',
          targetId: subscription.id,
          details: {
            previousStatus,
            provider,
            providerPaymentId: payment.providerPaymentId,
            amountCents: payment.amountCents,
            currentPeriodStart: period.start.toISOString(),
            currentPeriodEnd: period.end.toISOString(),
            granted,
            extended,
          },
        });
        status = 'active';
      }
    } else if (payment.status === 'rejected') {
      if (previousStatus === 'active') {
        // Cobrança recusada numa renovação: mantém o acesso pela carência da instalação.
        const graceUntil = addDays(now, graceDays);
        await trx
          .updateTable('subscriptions')
          .set({ status: 'past_due', graceUntil })
          .where('id', '=', subscription.id)
          .execute();
        await notify(trx, 'subscription.payment_failed', subscription.userId, {
          targetType: 'subscription',
          targetId: subscription.id,
          data: {
            planTitle: subscription.planTitle,
            graceUntil: graceUntil.toISOString(),
            graceDays,
          },
        });
        await recordAudit(trx, {
          context: { origin: 'worker' },
          action: 'subscription.past_due',
          targetType: 'subscription',
          targetId: subscription.id,
          details: {
            provider,
            providerPaymentId: payment.providerPaymentId,
            graceUntil: graceUntil.toISOString(),
          },
        });
        status = 'past_due';
      }
    }

    return {
      subscriptionId: subscription.id,
      previousStatus,
      status,
      changed: status !== previousStatus,
      granted,
      extended,
    };
  });
}

async function summarize(
  db: Database,
  subscriptionId: string,
  previousStatus: SubscriptionLifecycleStatus,
): Promise<AppliedSubscriptionPayment> {
  const row = await db
    .selectFrom('subscriptions')
    .select('status')
    .where('id', '=', subscriptionId)
    .executeTakeFirst();
  const status = (row?.status as SubscriptionLifecycleStatus | undefined) ?? previousStatus;
  return {
    subscriptionId,
    previousStatus,
    status,
    changed: status !== previousStatus,
    granted: 0,
    extended: 0,
  };
}

export interface ReconcileSubscriptionOptions {
  now?: Date;
  graceDays?: number;
}

export interface ReconciledSubscription {
  subscriptionId: string;
  previousStatus: SubscriptionLifecycleStatus;
  status: SubscriptionLifecycleStatus;
  changed: boolean;
  extended: number;
}

/**
 * Corrige o estado e o período de uma assinatura a partir do estado do provedor (spec 013,
 * "Reconciliação"). Provedor `canceled` encerra a assinatura e revoga os direitos; `paused`
 * (cobrança recusada) leva `active` a `past_due` com a carência, como o webhook faria;
 * `authorized` só avança o período quando o provedor está à frente, estendendo os direitos.
 * A ativação continua vindo da cobrança aprovada, não daqui.
 */
export async function applyProviderSubscriptionState(
  db: Database,
  providerSubscription: ProviderSubscription,
  options: ReconcileSubscriptionOptions = {},
): Promise<ReconciledSubscription> {
  const reference = parsePaymentExternalReference(providerSubscription.externalReference);
  if (reference.kind !== 'subscription') {
    throw invalidPaymentTransition('A assinatura do provedor não é de uma assinatura local.');
  }
  const now = options.now ?? new Date();
  const graceDays = options.graceDays ?? SUBSCRIPTION_GRACE_DAYS_DEFAULT;

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('subscriptions')
      .innerJoin('plans', 'plans.id', 'subscriptions.planId')
      .select([
        'subscriptions.id as id',
        'subscriptions.userId as userId',
        'subscriptions.status as status',
        'subscriptions.currentPeriodStart as currentPeriodStart',
        'subscriptions.currentPeriodEnd as currentPeriodEnd',
        'plans.title as planTitle',
      ])
      .where('subscriptions.id', '=', reference.id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound('Assinatura não encontrada.');
    const subscription = row as SubscriptionTransitionRow;
    const previousStatus = subscription.status as SubscriptionLifecycleStatus;
    let status = previousStatus;
    let extended = 0;

    if (providerSubscription.status === 'canceled') {
      if (
        previousStatus === 'active' ||
        previousStatus === 'past_due' ||
        previousStatus === 'canceling' ||
        previousStatus === 'suspended'
      ) {
        const result = await endSubscription(trx, subscription.id, 'subscription_ended', now);
        if (result.ended) {
          status = 'ended';
          await notify(trx, 'subscription.expired', subscription.userId, {
            targetType: 'subscription',
            targetId: subscription.id,
            data: { planTitle: subscription.planTitle, reason: 'provider_canceled' },
          });
        }
      }
    } else if (providerSubscription.status === 'paused') {
      if (previousStatus === 'active') {
        const graceUntil = addDays(now, graceDays);
        await trx
          .updateTable('subscriptions')
          .set({ status: 'past_due', graceUntil })
          .where('id', '=', subscription.id)
          .execute();
        status = 'past_due';
      }
    } else if (providerSubscription.status === 'authorized') {
      const providerEnd = providerSubscription.currentPeriodEnd;
      const localEnd = subscription.currentPeriodEnd;
      if (
        providerEnd !== null &&
        (localEnd === null || providerEnd.getTime() > localEnd.getTime())
      ) {
        const start = providerSubscription.currentPeriodStart ?? localEnd ?? now;
        await trx
          .updateTable('subscriptions')
          .set({ currentPeriodStart: start, currentPeriodEnd: providerEnd })
          .where('id', '=', subscription.id)
          .execute();
        if (
          previousStatus === 'active' ||
          previousStatus === 'past_due' ||
          previousStatus === 'canceling'
        ) {
          const result = await grantSubscriptionEntitlements(trx, subscription.id, {
            graceDays,
          });
          extended = result.extended;
        }
      }
    }

    if (status !== previousStatus) {
      await recordAudit(trx, {
        context: { origin: 'worker' },
        action: 'subscription.reconciled',
        targetType: 'subscription',
        targetId: subscription.id,
        details: { previousStatus, status, providerStatus: providerSubscription.status },
      });
    }

    return {
      subscriptionId: subscription.id,
      previousStatus,
      status,
      changed: status !== previousStatus,
      extended,
    };
  });
}
