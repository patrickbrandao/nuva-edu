import type {
  Billing,
  Cart,
  CartApiItem,
  MyOrderDetail,
  MyOrderPage,
  MyOrderSummary,
} from '../sales/queries';

/*
 * Dados de vendas no formato do contrato da classroom-api (spec 011), para os testes do site.
 * Os valores são pequenos e explícitos: cada teste muda só o que precisa e o resto continua
 * válido para o esquema.
 */

export const CART_URL = 'GET /api/v1/cart';
export const ITEMS_URL = 'POST /api/v1/cart/items';
export const COUPON_URL = 'PUT /api/v1/cart/coupon';
export const CLEAR_COUPON_URL = 'DELETE /api/v1/cart/coupon';
export const BILLING_URL = 'GET /api/v1/me/billing';
export const SAVE_BILLING_URL = 'PUT /api/v1/me/billing';
export const ORDERS_URL = 'GET /api/v1/orders';
export const CREATE_ORDER_URL = 'POST /api/v1/orders';

export const itemUrl = (id: string) => `DELETE /api/v1/cart/items/${id}`;
export const orderUrl = (id: string) => `GET /api/v1/orders/${id}`;
export const cancelUrl = (id: string) => `POST /api/v1/orders/${id}/cancel`;

/** Identificador no formato do esquema `Uuid`, com o número no fim para variar. */
export const uuid = (n: number) =>
  `0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f${String(n).padStart(2, '0')}`;

const COVER = {
  imageId: uuid(90),
  url: '/api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f90/480',
  largeUrl: '/api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f90/1280',
};

/** Um item da cesta (esquema `CartItem`). */
export function cartItem(overrides: Partial<CartApiItem> = {}): CartApiItem {
  return {
    id: uuid(1),
    productType: 'course',
    productId: uuid(11),
    title: 'React do zero',
    cover: COVER,
    accessMode: 'paid',
    accessDays: 365,
    unitPriceCents: 19_700,
    discountCents: 0,
    couponEligible: true,
    sellable: true,
    unsellableReason: null,
    warnings: [],
    unlocks: [],
    addedAt: '2026-11-20T12:00:00Z',
    ...overrides,
  };
}

/** A cesta (esquema `Cart`), com os totais somando só os itens vendáveis, como a API faz. */
export function cart(overrides: Partial<Cart> = {}): Cart {
  const items = overrides.items ?? [cartItem()];
  const sellable = items.filter((item) => item.sellable);
  const subtotalCents = sellable.reduce((sum, item) => sum + (item.unitPriceCents ?? 0), 0);
  const discountCents = sellable.reduce((sum, item) => sum + item.discountCents, 0);
  return {
    items,
    coupon: null,
    itemCount: sellable.length,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    currency: 'BRL',
    updatedAt: '2026-11-20T12:00:00Z',
    ...overrides,
  };
}

/** Um pedido na lista (esquema `MyOrderSummary`). */
export function orderSummary(overrides: Partial<MyOrderSummary> = {}): MyOrderSummary {
  return {
    id: uuid(31),
    number: 1042,
    status: 'pending',
    itemCount: 1,
    items: [{ productType: 'course', productId: uuid(11), title: 'React do zero' }],
    subtotalCents: 19_700,
    discountCents: 0,
    totalCents: 19_700,
    currency: 'BRL',
    createdAt: '2026-11-20T12:00:00Z',
    paidAt: null,
    expiresAt: '2026-11-20T12:30:00Z',
    paymentMethod: null,
    ...overrides,
  };
}

/** A lista de pedidos (esquema `MyOrderPage`). */
export function orderPage(items: MyOrderSummary[], nextCursor: string | null = null): MyOrderPage {
  return { items, nextCursor };
}

/** Um pedido do aluno (esquema `MyOrderDetail`), `pending` no provedor por padrão. */
export function orderDetail(overrides: Partial<MyOrderDetail> = {}): MyOrderDetail {
  return {
    id: uuid(31),
    number: 1042,
    status: 'pending',
    subtotalCents: 19_700,
    discountCents: 0,
    totalCents: 19_700,
    currency: 'BRL',
    couponCode: null,
    buyerName: 'Ana Souza',
    buyerTaxIdType: 'cpf',
    buyerTaxId: '39053344705',
    provider: 'mercadopago',
    checkoutUrl: 'https://mp.test/checkout/abc',
    createdAt: '2026-11-20T12:00:00Z',
    paidAt: null,
    expiresAt: '2026-11-20T12:30:00Z',
    items: [
      {
        id: uuid(41),
        productType: 'course',
        productId: uuid(11),
        title: 'React do zero',
        accessDays: 365,
        unitPriceCents: 19_700,
        discountCents: 0,
        paidCents: 19_700,
        refundedCents: 0,
      },
    ],
    payment: null,
    ...overrides,
  };
}

/** Dados de comprador guardados (esquema `Billing`). */
export function billing(overrides: Partial<Billing> = {}): Billing {
  return {
    fullName: 'Ana Souza',
    taxIdType: 'cpf',
    taxId: '39053344705',
    complete: true,
    ...overrides,
  };
}
