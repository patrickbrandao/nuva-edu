import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  cancelAdminSubscription,
  createPlan,
  type Database,
  type EntitlementProductType,
  getAdminSubscription,
  getPlan,
  listAdminSubscriptions,
  listPlans,
  type PaymentProvider,
  type Plan,
  type PlanInput,
  type PlanItem,
  type PlanUpdateInput,
  type RefundView,
  requestSubscriptionRefund,
  type SubscriptionDetail,
  type SubscriptionPaymentDetail,
  type SubscriptionQuery,
  type SubscriptionSummary,
  type SubscriptionUser,
  setPlanItems,
  updatePlan,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';
import { type IdParams, iso, isoOrNull, pick } from './catalog-common.ts';

// Planos e assinaturas (spec 012; specs 008, 013 e 028). O tratador de `sessionCookie` confere a
// ação de `x-permission` (planos: `plan.manage`, só admin; consulta: `sales.view`, gerente e
// admin; cancelamento: `subscription.cancel`; reembolso: `order.refund`). As regras do núcleo
// gravam a auditoria de cada escrita na transação da ação; aqui só transporte e resposta no
// formato do contrato.
//
// O preço contratado é o da assinatura (`price_cents`), não o do plano: as leituras devolvem os
// dois, e mudar o plano não altera a assinatura existente. O reembolso de cobrança recorrente é
// o mesmo fluxo de `refunds` do pedido: `202` com o reembolso `requested` e o desfecho no worker.

export interface SubscriptionRoutesOptions {
  db: Database;
  /**
   * Porta de pagamento da instalação. É chamada só nas rotas que falam com o provedor (o
   * cancelamento administrativo); resolvida sob demanda para a API subir sem o provedor.
   */
  provider: () => PaymentProvider;
}

/** `PlanItem` do contrato. */
function planItemBody(item: PlanItem) {
  return { productType: item.productType, productId: item.productId, title: item.title };
}

/** `Plan` do contrato. */
export function planBody(plan: Plan) {
  return {
    id: plan.id,
    slug: plan.slug,
    groupKey: plan.groupKey,
    title: plan.title,
    description: plan.description,
    interval: plan.interval,
    priceCents: plan.priceCents,
    includesAll: plan.includesAll,
    includesPrivate: plan.includesPrivate,
    active: plan.active,
    position: plan.position,
    providerPlanId: plan.providerPlanId,
    subscriptionCount: plan.subscriptionCount,
    items: plan.items.map(planItemBody),
    createdAt: iso(plan.createdAt),
    updatedAt: iso(plan.updatedAt),
  };
}

/** `Subscriber` do contrato. */
function subscriberBody(user: SubscriptionUser) {
  return { id: user.id, name: user.name, email: user.email };
}

/** `AdminSubscriptionSummary` do contrato. */
function subscriptionSummaryBody(subscription: SubscriptionSummary) {
  return {
    id: subscription.id,
    subscriber: subscriberBody(subscription.subscriber),
    plan: {
      id: subscription.plan.id,
      title: subscription.plan.title,
      interval: subscription.plan.interval,
    },
    status: subscription.status,
    priceCents: subscription.priceCents,
    currency: subscription.currency,
    currentPeriodStart: isoOrNull(subscription.currentPeriodStart),
    currentPeriodEnd: isoOrNull(subscription.currentPeriodEnd),
    graceUntil: isoOrNull(subscription.graceUntil),
    nextChargeAt: isoOrNull(subscription.nextChargeAt),
    canceledAt: isoOrNull(subscription.canceledAt),
    cancelReason: subscription.cancelReason,
    endedAt: isoOrNull(subscription.endedAt),
    createdAt: iso(subscription.createdAt),
  };
}

/** `Refund` do contrato; o de cobrança recorrente tem `orderId` nulo e `items` vazio. */
export function refundBody(refund: RefundView) {
  return {
    id: refund.id,
    orderId: refund.orderId,
    paymentId: refund.paymentId,
    items: refund.items.map((item) => ({
      orderItemId: item.orderItemId,
      title: item.title,
      amountCents: item.amountCents,
    })),
    amountCents: refund.amountCents,
    reason: refund.reason,
    status: refund.status,
    providerRefundId: refund.providerRefundId,
    error: refund.error,
    requestedBy: { id: refund.requestedBy.id, name: refund.requestedBy.name },
    createdAt: iso(refund.createdAt),
    doneAt: isoOrNull(refund.doneAt),
  };
}

/** `PaymentDetail` do contrato, com os reembolsos da cobrança. */
function paymentDetailBody(payment: SubscriptionPaymentDetail) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    orderNumber: payment.orderNumber,
    subscriptionId: payment.subscriptionId,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    status: payment.status,
    method: payment.method,
    amountCents: payment.amountCents,
    refundedCents: payment.refundedCents,
    currency: payment.currency,
    rawStatus: payment.rawStatus,
    paidAt: isoOrNull(payment.paidAt),
    createdAt: iso(payment.createdAt),
    updatedAt: iso(payment.updatedAt),
    refunds: payment.refunds.map(refundBody),
  };
}

/** `AdminSubscriptionDetail` do contrato. */
export function subscriptionDetailBody(subscription: SubscriptionDetail) {
  return {
    ...subscriptionSummaryBody(subscription),
    plan: planBody(subscription.plan),
    provider: subscription.provider,
    providerSubscriptionId: subscription.providerSubscriptionId,
    couponCode: subscription.couponCode,
    currentPeriodPaymentId: subscription.currentPeriodPaymentId,
    payments: subscription.payments.map(paymentDetailBody),
  };
}

/** Campos do `PATCH /plans/{id}`; `slug`, `groupKey` e `interval` não mudam depois da criação. */
const PLAN_UPDATE_FIELDS = [
  'title',
  'description',
  'priceCents',
  'includesAll',
  'includesPrivate',
  'active',
  'position',
] as const;

interface PlanItemRequestBody {
  productType: EntitlementProductType;
  productId: string;
}

interface PlanCreateBody extends PlanUpdateInput {
  slug?: string;
  groupKey: string;
  title: string;
  interval: PlanInput['interval'];
  priceCents: number;
  items?: PlanItemRequestBody[];
}

export function registerSubscriptionRoutes(
  app: FastifyInstance,
  options: SubscriptionRoutesOptions,
): void {
  const { db, provider } = options;

  /** O corpo e a consulta já passaram pelo contrato; os extras vão ao núcleo como vieram. */
  const request = (raw: FastifyRequest) => managementRequest(raw);

  // `GET /api/v1/plans`: planos por `position` e título, com filtros e cursor.
  app.operation('listPlans', async (raw) => {
    const query = raw.query as {
      q?: string;
      active?: boolean;
      interval?: PlanInput['interval'];
      groupKey?: string;
      limit?: number;
      cursor?: string;
    };
    const page = await listPlans(db, request(raw), query);
    return { items: page.items.map(planBody), nextCursor: page.nextCursor };
  });

  // `POST /api/v1/plans`: `201`; o provedor não entra na criação (contrato de `POST /plans`).
  app.operation('createPlan', async (raw, reply) => {
    const body = raw.body as PlanCreateBody;
    const input: PlanInput = {
      groupKey: body.groupKey,
      title: body.title,
      interval: body.interval,
      priceCents: body.priceCents,
      ...(body.slug === undefined ? {} : { slug: body.slug }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.includesAll === undefined ? {} : { includesAll: body.includesAll }),
      ...(body.includesPrivate === undefined ? {} : { includesPrivate: body.includesPrivate }),
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.position === undefined ? {} : { position: body.position }),
      ...(body.items === undefined ? {} : { items: body.items }),
    };
    return reply.status(201).send(planBody(await createPlan(db, request(raw), input)));
  });

  // `GET /api/v1/plans/{id}`: com itens e `subscriptionCount`.
  app.operation('getPlan', async (raw) => {
    const { id } = raw.params as IdParams;
    return planBody(await getPlan(db, request(raw), id));
  });

  // `PATCH /api/v1/plans/{id}`: só os campos enviados mudam; desativar é `active: false`.
  app.operation('updatePlan', async (raw) => {
    const { id } = raw.params as IdParams;
    const body = raw.body as Record<string, unknown>;
    const update = pick(body, PLAN_UPDATE_FIELDS) as PlanUpdateInput;
    return planBody(await updatePlan(db, request(raw), id, update));
  });

  // `PUT /api/v1/plans/{id}/items`: substitui a lista; plano "tudo" não tem itens.
  app.operation('replacePlanItems', async (raw) => {
    const { id } = raw.params as IdParams;
    const { items } = raw.body as { items: PlanItemRequestBody[] };
    return planBody(await setPlanItems(db, request(raw), id, items));
  });

  // `GET /api/v1/subscriptions`: gerente e admin consultam; instrutor recebe `403`.
  app.operation('listSubscriptions', async (raw) => {
    const query = raw.query as SubscriptionQuery;
    const page = await listAdminSubscriptions(db, request(raw), query);
    return { items: page.items.map(subscriptionSummaryBody), nextCursor: page.nextCursor };
  });

  // `GET /api/v1/subscriptions/{id}`: com o plano atual, cobranças e reembolsos.
  app.operation('getSubscription', async (raw) => {
    const { id } = raw.params as IdParams;
    return subscriptionDetailBody(await getAdminSubscription(db, request(raw), id));
  });

  // `POST /api/v1/subscriptions/{id}/cancel`: `active`/`past_due` → `canceling`, `suspended` →
  // `ended`; `pending` e os terminais: `409 subscription_not_cancelable`. Provedor que não
  // confirma: `503 payment_provider_unavailable` e nada muda (spec 012; spec 013).
  app.operation('cancelSubscription', async (raw) => {
    const { id } = raw.params as IdParams;
    const { reason } = raw.body as { reason: string };
    const detail = await cancelAdminSubscription(db, provider(), request(raw), id, reason);
    return subscriptionDetailBody(detail);
  });

  // `POST /api/v1/subscriptions/{id}/payments/{paymentId}/refund`: cria o reembolso em
  // `requested` e enfileira `refund.execute` (`202`); o efeito no estado da assinatura vem do
  // worker, pelo mesmo código do reembolso de pedido (specs 011 e 012).
  app.operation('requestSubscriptionRefund', async (raw, reply) => {
    const { id, paymentId } = raw.params as { id: string; paymentId: string };
    const body = raw.body as { reason: string; amountCents?: number | null };
    const key = raw.headers['idempotency-key'];
    const refund = await requestSubscriptionRefund(db, request(raw), {
      subscriptionId: id,
      paymentId,
      reason: body.reason,
      amountCents: body.amountCents === undefined ? null : body.amountCents,
      idempotencyKey: typeof key === 'string' ? key : null,
    });
    return reply.status(202).send(refundBody(refund));
  });
}
