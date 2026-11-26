import type { AdminSchemas } from '@nuva-edu/api-client/admin';

export const ORDER_ID = '0193a5b2-0000-7000-8000-0000000000c1';
export const ORDER_ITEM_ID = '0193a5b2-0000-7000-8000-0000000000c2';
export const COURSE_ID = '0193a5b2-0000-7000-8000-0000000000c3';
export const COUPON_ID = '0193a5b2-0000-7000-8000-0000000000c4';

/** Item `OrderSummary` da lista de pedidos, como a API devolve. */
export function orderSummary(
  overrides: Partial<AdminSchemas['OrderSummary']> = {},
): AdminSchemas['OrderSummary'] {
  return {
    id: ORDER_ID,
    number: 101,
    status: 'paid',
    buyer: {
      id: '0193a5b2-0000-7000-8000-0000000000b1',
      name: 'Bia Aluna',
      email: 'bia@aluna.test',
    },
    itemCount: 1,
    items: [{ productType: 'course', productId: COURSE_ID, title: 'Curso de Ouro' }],
    subtotalCents: 19900,
    discountCents: 0,
    refundedCents: 0,
    totalCents: 19900,
    currency: 'BRL',
    couponCode: null,
    provider: 'mercadopago',
    paymentMethod: 'pix',
    createdAt: '2026-11-20T12:00:00Z',
    paidAt: '2026-11-20T12:05:00Z',
    expiresAt: null,
    ...overrides,
  };
}

/** Um item `OrderItem` do detalhe do pedido. */
export function orderItem(
  overrides: Partial<AdminSchemas['OrderItem']> = {},
): AdminSchemas['OrderItem'] {
  return {
    id: ORDER_ITEM_ID,
    productType: 'course',
    productId: COURSE_ID,
    title: 'Curso de Ouro',
    accessDays: null,
    unitPriceCents: 19900,
    discountCents: 0,
    paidCents: 19900,
    refundedCents: 0,
    ...overrides,
  };
}

/** Uma cobrança `Payment` do pedido. */
export function payment(overrides: Partial<AdminSchemas['Payment']> = {}): AdminSchemas['Payment'] {
  return {
    id: '0193a5b2-0000-7000-8000-0000000000d1',
    orderId: ORDER_ID,
    orderNumber: 101,
    subscriptionId: null,
    provider: 'mercadopago',
    providerPaymentId: 'mp-123',
    status: 'approved',
    method: 'pix',
    amountCents: 19900,
    refundedCents: 0,
    currency: 'BRL',
    rawStatus: 'approved',
    paidAt: '2026-11-20T12:05:00Z',
    createdAt: '2026-11-20T12:01:00Z',
    updatedAt: '2026-11-20T12:05:00Z',
    ...overrides,
  };
}

/** Um reembolso `Refund` do pedido. */
export function refund(overrides: Partial<AdminSchemas['Refund']> = {}): AdminSchemas['Refund'] {
  return {
    id: '0193a5b2-0000-7000-8000-0000000000d2',
    orderId: ORDER_ID,
    paymentId: '0193a5b2-0000-7000-8000-0000000000d1',
    items: [{ orderItemId: ORDER_ITEM_ID, title: 'Curso de Ouro', amountCents: 19900 }],
    amountCents: 19900,
    reason: 'Pedido duplicado',
    status: 'requested',
    providerRefundId: null,
    error: null,
    requestedBy: { id: '0193a5b2-0000-7000-8000-000000000001', name: 'Ana Admin' },
    createdAt: '2026-11-21T10:00:00Z',
    doneAt: null,
    ...overrides,
  };
}

/** `OrderDetail` completo, com o que a tela de detalhe mostra. */
export function orderDetail(
  overrides: Partial<AdminSchemas['OrderDetail']> = {},
): AdminSchemas['OrderDetail'] {
  const summary = orderSummary();
  return {
    id: summary.id,
    number: summary.number,
    status: summary.status,
    buyer: {
      ...summary.buyer,
      taxIdType: 'cpf',
      taxId: '12345678900',
    },
    itemCount: summary.itemCount,
    subtotalCents: summary.subtotalCents,
    discountCents: summary.discountCents,
    refundedCents: summary.refundedCents,
    totalCents: summary.totalCents,
    currency: summary.currency,
    couponCode: summary.couponCode,
    provider: summary.provider,
    createdAt: summary.createdAt,
    paidAt: summary.paidAt,
    expiresAt: summary.expiresAt,
    items: [orderItem()],
    payments: [payment()],
    refunds: [],
    ...overrides,
  };
}

/** Um cupom da lista, como a API devolve. */
export function coupon(overrides: Partial<AdminSchemas['Coupon']> = {}): AdminSchemas['Coupon'] {
  return {
    id: COUPON_ID,
    code: 'OUTUBRO20',
    kind: 'percent',
    percentOff: 20,
    amountOffCents: null,
    startsAt: '2026-10-01T03:00:00Z',
    endsAt: '2026-10-31T03:00:00Z',
    maxUses: 100,
    maxUsesPerUser: 1,
    usesCount: 12,
    appliesTo: 'orders',
    products: [],
    active: true,
    createdBy: { id: '0193a5b2-0000-7000-8000-000000000001', name: 'Ana Admin' },
    createdAt: '2026-09-30T12:00:00Z',
    updatedAt: '2026-09-30T12:00:00Z',
    ...overrides,
  };
}

/** Página de pedidos com os totais do filtro. */
export function orderPage(
  items: AdminSchemas['OrderSummary'][] = [orderSummary()],
  nextCursor: string | null = null,
): AdminSchemas['OrderSummaryPage'] {
  return {
    items,
    nextCursor,
    totals: {
      subtotalCents: items.reduce((sum, item) => sum + item.subtotalCents, 0),
      discountCents: items.reduce((sum, item) => sum + item.discountCents, 0),
      refundedCents: items.reduce((sum, item) => sum + item.refundedCents, 0),
      totalCents: items.reduce((sum, item) => sum + item.totalCents, 0),
      netCents: items.reduce((sum, item) => sum + item.totalCents - item.refundedCents, 0),
    },
  };
}
