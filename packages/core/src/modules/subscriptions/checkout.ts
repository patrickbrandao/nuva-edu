import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { isUniqueViolation } from '../catalog/common.ts';
import { subscriptionExternalReference } from '../payments/references.ts';
import type { PaymentBuyer, PaymentProvider, PaymentReturnUrls } from '../payments/types.ts';
import { requireBilling } from '../sales/billing.ts';
import { assertPurchaseAllowed } from '../sales/cart.ts';
import type { CouponWithProducts } from '../sales/coupons.ts';
import { findCouponByCode } from '../sales/coupons.ts';
import { planNotFound, subscriptionAlreadyActive, subscriptionCouponInvalid } from './errors.ts';
import { findPlan, providerPlanTitle } from './plans.ts';
import { getMySubscription } from './subscriptions.ts';
import {
  type PlanInterval,
  planPeriodicity,
  SUBSCRIPTION_OPEN_STATUSES,
  type SubscriptionCheckout,
} from './types.ts';

// Assinatura em checkout próprio (spec 012, "Assinar"; spec 013, "Implementação Mercado Pago").
// Dono da escrita: classroom-api. A assinatura nasce `pending` com o preço do plano copiado; o
// worker a ativa quando a primeira cobrança chega aprovada. O cupom vale só na primeira
// cobrança e é contabilizado na ativação, não aqui.

export interface CreateSubscriptionCheckoutInput {
  userId: string;
  planId: string;
  /** Código do cupom; comparação sem diferenciar maiúsculas. */
  couponCode?: string | null;
  provider: PaymentProvider;
  /** Moeda da instalação (`NUVA_CURRENCY`). */
  currency: string;
  returnUrls: PaymentReturnUrls;
  /** Instante da criação; padrão: agora. */
  now?: Date;
}

/**
 * Assina um plano (`POST /subscriptions`). Recusas, pelo `code`: `email_not_verified`,
 * `billing_required`, `not_found` (plano inexistente ou inativo), `coupon_invalid`,
 * `subscription_already_exists` e `payment_provider_unavailable` (nada é criado). Uma
 * assinatura em `canceling` não ocupa a chave: o aluno assina de novo para desfazer o
 * cancelamento, como manda a spec.
 */
export async function createSubscriptionCheckout(
  db: Database,
  input: CreateSubscriptionCheckoutInput,
): Promise<SubscriptionCheckout> {
  const now = input.now ?? new Date();
  await assertPurchaseAllowed(db, input.userId);

  const plan = await findPlan(db, input.planId);
  if (!plan?.active) throw planNotFound();

  const billing = await requireBilling(db, input.userId);
  const user = await db
    .selectFrom('users')
    .select(['email'])
    .where('id', '=', input.userId)
    .executeTakeFirstOrThrow();

  const coupon = await loadCheckoutCoupon(db, input.couponCode, input.userId, now);
  const discountCents = coupon === null ? 0 : firstChargeDiscountCents(plan.priceCents, coupon);

  // O plano do provedor é criado/reaproveitado antes da assinatura: `createSubscription` exige
  // `providerPlanId` (spec 013). Provedor fora daqui não deixa assinatura local.
  const providerPlanId = await ensureProviderPlan(db, plan, input.provider, input.currency);

  const subscriptionId = await db.transaction().execute(async (trx) => {
    // Serializa a criação do mesmo aluno: a chave "uma assinatura por plano" e a conferência
    // anterior não escapam numa corrida de dois checkouts.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`.execute(trx);
    const existing = await trx
      .selectFrom('subscriptions')
      .select('id')
      .where('userId', '=', input.userId)
      .where('planId', '=', plan.id)
      .where('status', 'in', [...SUBSCRIPTION_OPEN_STATUSES])
      .executeTakeFirst();
    if (existing) throw subscriptionAlreadyActive();
    try {
      const row = await trx
        .insertInto('subscriptions')
        .values({
          userId: input.userId,
          planId: plan.id,
          status: 'pending',
          priceCents: plan.priceCents,
          currency: input.currency,
          couponId: coupon?.id ?? null,
          provider: input.provider.name,
          providerSubscriptionId: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    } catch (error) {
      // O índice único parcial protege a corrida que o lock não cobriu.
      if (
        isUniqueViolation(error, 'subscriptions_user_plan_open_unique') ||
        isUniqueViolation(error, 'subscriptions_pkey')
      ) {
        throw subscriptionAlreadyActive();
      }
      throw error;
    }
  });

  let providerSubscriptionId: string;
  let checkoutUrl: string;
  try {
    const buyer: PaymentBuyer = {
      name: billing.fullName,
      email: user.email,
      taxId: billing.taxId,
    };
    const checkout = await input.provider.createSubscription({
      providerPlanId,
      buyer,
      // O fake aplica o desconto direto, como os testes do módulo esperam. O Mercado Pago
      // recusa desconto em valor na adesão (`payment_provider_invalid_request`, tarefa 520);
      // o arranjo de primeira cobrança avulsa depende de o adaptador aceitar um checkout com
      // referência `subscription:` e está registrado no relatório da tarefa 531 como pendência
      // do dono de `payments` (a spec 013 não fecha como o valor avulso é vinculado).
      ...(discountCents > 0 ? { firstChargeDiscountCents: discountCents } : {}),
      returnUrls: input.returnUrls,
      externalReference: subscriptionExternalReference(subscriptionId),
    });
    providerSubscriptionId = checkout.providerSubscriptionId;
    checkoutUrl = checkout.checkoutUrl;
  } catch (error) {
    // Provedor fora: nenhuma assinatura é criada nem cobrada (spec 012, "Casos de erro").
    await db.deleteFrom('subscriptions').where('id', '=', subscriptionId).execute();
    throw error;
  }

  await db
    .updateTable('subscriptions')
    .set({ providerSubscriptionId })
    .where('id', '=', subscriptionId)
    .execute();

  return {
    subscription: await getMySubscription(db, input.userId, subscriptionId),
    checkoutUrl,
  };
}

/** Cupom do checkout: só `subscriptions`/`both`, ativo, na janela e com uso disponível. */
async function loadCheckoutCoupon(
  db: Database,
  code: string | null | undefined,
  userId: string,
  now: Date,
): Promise<CouponWithProducts | null> {
  if (code === undefined || code === null) return null;
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (trimmed === '') return null;
  const coupon = await findCouponByCode(db, trimmed);
  if (!coupon) throw subscriptionCouponInvalid();
  if (!coupon.active) throw subscriptionCouponInvalid();
  if (coupon.startsAt !== null && coupon.startsAt > now) throw subscriptionCouponInvalid();
  if (coupon.endsAt !== null && coupon.endsAt <= now) throw subscriptionCouponInvalid();
  if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
    throw subscriptionCouponInvalid();
  }
  if (coupon.maxUsesPerUser > 0) {
    const used = await db
      .selectFrom('subscriptions')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('userId', '=', userId)
      .where('couponId', '=', coupon.id)
      .where('status', 'in', ['active', 'past_due', 'suspended', 'canceling', 'ended'])
      .executeTakeFirstOrThrow();
    if (used.n >= coupon.maxUsesPerUser) throw subscriptionCouponInvalid();
  }
  if (coupon.appliesTo !== 'subscriptions' && coupon.appliesTo !== 'both') {
    throw subscriptionCouponInvalid();
  }
  return coupon;
}

/** Desconto da primeira cobrança: percentual para baixo, fixo limitado ao preço. */
export function firstChargeDiscountCents(
  priceCents: number,
  coupon: Pick<CouponWithProducts, 'kind' | 'percentOff' | 'amountOffCents'>,
): number {
  let discount = 0;
  if (coupon.kind === 'percent') {
    discount = Math.floor((priceCents * (coupon.percentOff ?? 0)) / 100);
  } else {
    discount = coupon.amountOffCents ?? 0;
  }
  if (!Number.isSafeInteger(discount) || discount < 0) return 0;
  return Math.min(discount, priceCents);
}

/** Garante o plano no provedor e grava `provider_plan_id` (spec 013, `ensurePlan`). */
async function ensureProviderPlan(
  db: Database,
  plan: {
    id: string;
    title: string;
    slug: string;
    priceCents: number;
    interval: PlanInterval;
    providerPlanId: string | null;
  },
  provider: PaymentProvider,
  currency: string,
): Promise<string> {
  if (plan.providerPlanId !== null) return plan.providerPlanId;
  const reference = await provider.ensurePlan({
    title: providerPlanTitle(plan),
    amountCents: plan.priceCents,
    currency,
    periodicity: planPeriodicity(plan.interval),
  });
  await db
    .updateTable('plans')
    .set({ providerPlanId: reference.providerPlanId })
    .where('id', '=', plan.id)
    .execute();
  return reference.providerPlanId;
}
