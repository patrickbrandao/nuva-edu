import type {
  MySubscriptionDetail,
  MySubscriptionPage,
  MySubscriptionSummary,
  PlanCatalog,
  PlanGroup,
  PublicPlan,
  SubscriptionCharge,
  SubscriptionCheckout,
} from '../subscriptions/queries';
import { uuid } from './sales';

/*
 * Planos e assinaturas no formato do contrato da classroom-api (spec 012), para os testes do
 * site. Cada teste muda só o que precisa; o resto continua válido para o esquema.
 */

export const PLANS_URL = 'GET /api/v1/plans';
export const SUBSCRIBE_URL = 'POST /api/v1/subscriptions';
export const SUBSCRIPTIONS_URL = 'GET /api/v1/me/subscriptions';

export const subscriptionUrl = (id: string) => `GET /api/v1/me/subscriptions/${id}`;
export const cancelSubscriptionUrl = (id: string) => `POST /api/v1/me/subscriptions/${id}/cancel`;

/** Um plano da vitrine (esquema `PublicPlan`). */
export function plan(overrides: Partial<PublicPlan> = {}): PublicPlan {
  return {
    id: uuid(11),
    slug: 'pro',
    title: 'Plano Pro',
    description: 'Acesso aos cursos da escola enquanto a assinatura estiver em dia.',
    interval: 'month',
    priceCents: 9_900,
    includesAll: false,
    items: [{ productType: 'course', productId: uuid(21), title: 'React do zero' }],
    position: 0,
    ...overrides,
  };
}

/** O plano anual do mesmo conteúdo (`groupKey` igual), com dois meses de desconto. */
export function annualPlan(overrides: Partial<PublicPlan> = {}): PublicPlan {
  return plan({
    id: uuid(12),
    interval: 'year',
    priceCents: 99_000,
    position: 1,
    ...overrides,
  });
}

/** O plano "tudo, inclusive futuros" (sem itens explícitos). */
export function allPlan(overrides: Partial<PublicPlan> = {}): PublicPlan {
  return plan({
    id: uuid(13),
    slug: 'completo',
    title: 'Plano Completo',
    interval: 'month',
    priceCents: 14_900,
    includesAll: true,
    items: [],
    position: 2,
    ...overrides,
  });
}

/** A vitrine agrupada por conteúdo (esquema `PlanCatalog`). */
export function planCatalog(groups?: PlanGroup[]): PlanCatalog {
  return {
    groups: groups ?? [
      { groupKey: 'pro', plans: [plan(), annualPlan()] },
      { groupKey: 'completo', plans: [allPlan()] },
    ],
    currency: 'BRL',
  };
}

/** Uma assinatura na lista (esquema `MySubscriptionSummary`), ativa e em dia. */
export function subscriptionSummary(
  overrides: Partial<MySubscriptionSummary> = {},
): MySubscriptionSummary {
  return {
    id: uuid(31),
    plan: { id: uuid(11), slug: 'pro', title: 'Plano Pro', interval: 'month' },
    status: 'active',
    priceCents: 9_900,
    currency: 'BRL',
    currentPeriodStart: '2026-11-01T12:00:00Z',
    currentPeriodEnd: '2026-12-01T12:00:00Z',
    graceUntil: null,
    nextChargeAt: '2026-12-01T12:00:00Z',
    canceledAt: null,
    endedAt: null,
    createdAt: '2026-11-01T12:00:00Z',
    ...overrides,
  };
}

/** A lista de assinaturas (esquema `MySubscriptionPage`). */
export function subscriptionPage(
  items: MySubscriptionSummary[],
  nextCursor: string | null = null,
): MySubscriptionPage {
  return { items, nextCursor };
}

/** Uma cobrança aprovada da assinatura (esquema `SubscriptionCharge`). */
export function charge(overrides: Partial<SubscriptionCharge> = {}): SubscriptionCharge {
  return {
    id: uuid(41),
    status: 'approved',
    method: 'pix',
    amountCents: 9_900,
    refundedCents: 0,
    currency: 'BRL',
    provider: 'mercadopago',
    providerPaymentId: 'pay_123',
    paidAt: '2026-11-01T12:01:00Z',
    createdAt: '2026-11-01T12:00:00Z',
    ...overrides,
  };
}

/** A assinatura com plano, período e cobranças (esquema `MySubscriptionDetail`). */
export function subscriptionDetail(
  overrides: Partial<MySubscriptionDetail> = {},
): MySubscriptionDetail {
  return {
    id: uuid(31),
    plan: plan(),
    status: 'active',
    priceCents: 9_900,
    currency: 'BRL',
    currentPeriodStart: '2026-11-01T12:00:00Z',
    currentPeriodEnd: '2026-12-01T12:00:00Z',
    graceUntil: null,
    nextChargeAt: '2026-12-01T12:00:00Z',
    canceledAt: null,
    endedAt: null,
    createdAt: '2026-11-01T12:00:00Z',
    payments: [charge()],
    ...overrides,
  };
}

/** O resultado de assinar: a assinatura pendente e a página do provedor. */
export function subscriptionCheckout(
  overrides: Partial<SubscriptionCheckout> = {},
): SubscriptionCheckout {
  return {
    subscription: subscriptionDetail({
      status: 'pending',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextChargeAt: null,
      payments: [],
    }),
    checkoutUrl: 'https://mp.test/assinatura/abc',
    ...overrides,
  };
}
