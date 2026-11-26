import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { plan } from './plans';

export const SUBSCRIPTION_ID = '0193a5b2-0000-7000-8000-0000000000f1';
export const SUBSCRIBER_ID = '0193a5b2-0000-7000-8000-0000000000f2';
export const SUBSCRIPTION_PAYMENT_ID = '0193a5b2-0000-7000-8000-0000000000f3';
export const SUBSCRIPTION_REFUND_ID = '0193a5b2-0000-7000-8000-0000000000f4';

/** O assinante na lista e no detalhe. */
export function subscriber(
  overrides: Partial<AdminSchemas['Subscriber']> = {},
): AdminSchemas['Subscriber'] {
  return {
    id: SUBSCRIBER_ID,
    name: 'Bia Aluna',
    email: 'bia@aluna.test',
    ...overrides,
  };
}

/** Uma assinatura na lista do admin. */
export function subscriptionSummary(
  overrides: Partial<AdminSchemas['AdminSubscriptionSummary']> = {},
): AdminSchemas['AdminSubscriptionSummary'] {
  return {
    id: SUBSCRIPTION_ID,
    subscriber: subscriber(),
    plan: { id: plan().id, title: plan().title, interval: 'month' },
    status: 'active',
    priceCents: 9700,
    currency: 'BRL',
    currentPeriodStart: '2026-11-01T12:00:00Z',
    currentPeriodEnd: '2026-12-01T12:00:00Z',
    graceUntil: null,
    nextChargeAt: '2026-12-01T12:00:00Z',
    canceledAt: null,
    cancelReason: null,
    endedAt: null,
    createdAt: '2026-11-01T12:00:00Z',
    ...overrides,
  };
}

/** Página de assinaturas por cursor. */
export function subscriptionPage(
  items: AdminSchemas['AdminSubscriptionSummary'][] = [subscriptionSummary()],
  nextCursor: string | null = null,
): AdminSchemas['AdminSubscriptionPage'] {
  return { items, nextCursor };
}

/** Uma cobrança da assinatura, com os reembolsos. */
export function subscriptionPayment(
  overrides: Partial<AdminSchemas['PaymentDetail']> = {},
): AdminSchemas['PaymentDetail'] {
  return {
    id: SUBSCRIPTION_PAYMENT_ID,
    orderId: null,
    orderNumber: null,
    subscriptionId: SUBSCRIPTION_ID,
    provider: 'mercadopago',
    providerPaymentId: 'mp-sub-123',
    status: 'approved',
    method: 'card',
    amountCents: 9700,
    refundedCents: 0,
    currency: 'BRL',
    rawStatus: 'approved',
    paidAt: '2026-11-01T12:05:00Z',
    createdAt: '2026-11-01T12:01:00Z',
    updatedAt: '2026-11-01T12:05:00Z',
    refunds: [],
    ...overrides,
  };
}

/** Um reembolso de cobrança recorrente. */
export function subscriptionRefund(
  overrides: Partial<AdminSchemas['Refund']> = {},
): AdminSchemas['Refund'] {
  return {
    id: SUBSCRIPTION_REFUND_ID,
    orderId: null,
    paymentId: SUBSCRIPTION_PAYMENT_ID,
    items: [],
    amountCents: 9700,
    reason: 'Aluno pediu o cancelamento',
    status: 'requested',
    providerRefundId: null,
    error: null,
    requestedBy: { id: '0193a5b2-0000-7000-8000-000000000001', name: 'Ana Admin' },
    createdAt: '2026-11-21T10:00:00Z',
    doneAt: null,
    ...overrides,
  };
}

/** O detalhe completo da assinatura, com plano, período e cobranças. */
export function subscriptionDetail(
  overrides: Partial<AdminSchemas['AdminSubscriptionDetail']> = {},
): AdminSchemas['AdminSubscriptionDetail'] {
  const summary = subscriptionSummary();
  return {
    id: summary.id,
    subscriber: summary.subscriber,
    plan: plan(),
    status: summary.status,
    priceCents: summary.priceCents,
    currency: summary.currency,
    currentPeriodStart: summary.currentPeriodStart,
    currentPeriodEnd: summary.currentPeriodEnd,
    graceUntil: summary.graceUntil,
    nextChargeAt: summary.nextChargeAt,
    canceledAt: summary.canceledAt,
    cancelReason: summary.cancelReason,
    endedAt: summary.endedAt,
    createdAt: summary.createdAt,
    provider: 'mercadopago',
    providerSubscriptionId: 'mp-sub-123',
    couponCode: null,
    currentPeriodPaymentId: SUBSCRIPTION_PAYMENT_ID,
    payments: [subscriptionPayment()],
    ...overrides,
  };
}
