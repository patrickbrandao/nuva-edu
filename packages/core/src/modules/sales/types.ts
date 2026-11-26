// Tipos, constantes e conversões comuns das vendas (spec 011, "Cesta", "Cupons", "Pedido e seus
// estados" e "Dados"). Os valores repetem as restrições das migrations 0014 e 0015. Dinheiro é
// sempre centavo inteiro.

import type { Json } from '../../db/generated/database.ts';
import type { AccessMode } from '../catalog/fields.ts';
import type { CatalogCover } from '../catalog/read-common.ts';
import type { PaymentMethod, PaymentProviderName, PaymentStatus } from '../payments/types.ts';

/** Os três produtos do catálogo (`carts.product_type` e `orders.order_items.product_type`). */
export const SALES_PRODUCT_TYPES = ['course', 'bundle', 'ebook'] as const;
export type SalesProductType = (typeof SALES_PRODUCT_TYPES)[number];

export function isSalesProductType(value: unknown): value is SalesProductType {
  return typeof value === 'string' && (SALES_PRODUCT_TYPES as readonly string[]).includes(value);
}

/** Estados de `orders.status` (spec 011, "Pedido e seus estados"). */
export const ORDER_STATUSES = [
  'draft',
  'pending',
  'paid',
  'partially_refunded',
  'refunded',
  'canceled',
  'expired',
  'chargeback',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Estados que o aluno vê: `draft` é resto de tentativa que não chegou ao provedor. */
export const STUDENT_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status): status is Exclude<OrderStatus, 'draft'> => status !== 'draft',
);

/** Estados em que o dinheiro entrou (o pedido tem `paid_at`). */
export const PAID_ORDER_STATUSES = [
  'paid',
  'partially_refunded',
  'refunded',
  'chargeback',
] as const satisfies readonly OrderStatus[];
export type PaidOrderStatus = (typeof PAID_ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isPaidOrderStatus(status: OrderStatus): status is PaidOrderStatus {
  return (PAID_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Estados em que o pedido pode ser reembolsado (spec 011, "Reembolso"). */
export const REFUNDABLE_ORDER_STATUSES = ['paid', 'partially_refunded'] as const;

/** Um pedido por aluno em `pending` ao mesmo tempo (spec 011). */
export const ORDER_PENDING_LIMIT = 3;

/** Itens por cesta (spec 011). */
export const CART_MAX_ITEMS = 50;

/** Tipos do documento fiscal do comprador. */
export const TAX_ID_TYPES = ['cpf', 'cnpj'] as const;
export type TaxIdType = (typeof TAX_ID_TYPES)[number];

export function isTaxIdType(value: unknown): value is TaxIdType {
  return typeof value === 'string' && (TAX_ID_TYPES as readonly string[]).includes(value);
}

export const COUPON_KINDS = ['percent', 'fixed'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

export function isCouponKind(value: unknown): value is CouponKind {
  return typeof value === 'string' && (COUPON_KINDS as readonly string[]).includes(value);
}

export const COUPON_APPLIES_TO = ['orders', 'subscriptions', 'both'] as const;
export type CouponAppliesTo = (typeof COUPON_APPLIES_TO)[number];

export function isCouponAppliesTo(value: unknown): value is CouponAppliesTo {
  return typeof value === 'string' && (COUPON_APPLIES_TO as readonly string[]).includes(value);
}

/** Formato do código do cupom (restrição `coupons_code_format`). */
export const COUPON_CODE_PATTERN = /^[A-Za-z0-9-]{3,40}$/;
export const COUPON_MAX_PRODUCTS = 500;

/** Por que o cupom da cesta não vale agora (contrato `CartCoupon.invalidReason`). */
export const COUPON_INVALID_REASONS = ['inactive', 'expired', 'exhausted', 'not_eligible'] as const;
export type CouponInvalidReason = (typeof COUPON_INVALID_REASONS)[number];

/** Avisos da cesta que não bloqueiam a compra (spec 011, "Cesta"). */
export const CART_ITEM_WARNINGS = [
  'bundle_item_owned',
  'subscription_covered',
  'time_limited_access',
] as const;
export type CartItemWarning = (typeof CART_ITEM_WARNINGS)[number];

/** Por que o item da cesta não pode ser comprado agora. */
export const CART_UNSELLABLE_REASONS = ['unpublished', 'archived', 'not_paid'] as const;
export type CartItemUnsellableReason = (typeof CART_UNSELLABLE_REASONS)[number];

export const SALES_PAGE_DEFAULT_LIMIT = 25;
export const SALES_PAGE_MAX_LIMIT = 100;
export const SALES_QUERY_MAX_LENGTH = 200;
export const SALES_SELLER_NAME_MAX_LENGTH = 200;
export const REFUND_REASON_MAX_LENGTH = 500;
/** Lotes da exportação CSV: pedidos por consulta (RNF-04 da 011). */
export const SALES_EXPORT_BATCH_SIZE = 500;

/**
 * Uma linha de `coupons`. `uses_count` pode passar de `max_uses`: o pedido pago é honrado e o
 * excesso fica registrado (spec 011).
 */
export interface Coupon {
  id: string;
  code: string;
  kind: CouponKind;
  percentOff: number | null;
  amountOffCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  maxUsesPerUser: number;
  usesCount: number;
  appliesTo: CouponAppliesTo;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Produto citado por um cupom, um item de cesta ou um pedido. */
export interface SalesProductRef {
  productType: SalesProductType;
  productId: string;
}

/** Um item de `order_items`, com os valores congelados no fechamento (`OrderItem`). */
export interface SalesOrderItem {
  id: string;
  productType: SalesProductType;
  productId: string;
  title: string;
  accessDays: number | null;
  unitPriceCents: number;
  discountCents: number;
  paidCents: number;
  refundedCents: number;
}

/** Um item de `refunds.items` (`[{ orderItemId, amountCents }]`). */
export interface RefundItemAmount {
  orderItemId: string;
  amountCents: number;
}

/** Lê `refunds.items` sem confiar no conteúdo gravado. */
export function readRefundItems(value: Json | null | undefined): RefundItemAmount[] {
  if (!Array.isArray(value)) return [];
  const items: RefundItemAmount[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const orderItemId = record.orderItemId;
    const amountCents = record.amountCents;
    if (
      typeof orderItemId === 'string' &&
      typeof amountCents === 'number' &&
      Number.isInteger(amountCents) &&
      amountCents > 0
    ) {
      items.push({ orderItemId, amountCents });
    }
  }
  return items;
}

export function serializeRefundItems(items: readonly RefundItemAmount[]): Json {
  return items.map((item) => ({ orderItemId: item.orderItemId, amountCents: item.amountCents }));
}

/** `bigint`/texto das colunas `bigint` do PostgreSQL para centavo inteiro. */
export function cents(value: string | number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export function centsOrNull(value: string | number | bigint | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Cursor opaco das listagens de vendas: `createdAt` + `id`, do mais novo ao mais antigo. */
export function encodeSalesCursor(scope: string, createdAt: Date, id: string): string {
  return Buffer.from(`${scope}:${createdAt.toISOString()}:${id}`, 'utf8').toString('base64url');
}

export interface SalesCursorValue {
  createdAt: Date;
  id: string;
}

export function decodeSalesCursor(cursor: unknown, scope: string): SalesCursorValue | undefined {
  if (typeof cursor !== 'string') return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const prefix = `${scope}:`;
  if (!text.startsWith(prefix)) return undefined;
  const rest = text.slice(prefix.length);
  // O instante ISO tem dois-pontos; o id (UUID) não tem. Separa pelo último.
  const separator = rest.lastIndexOf(':');
  if (separator < 0) return undefined;
  const createdAt = new Date(rest.slice(0, separator));
  const id = rest.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !isUuid(id)) return undefined;
  return { createdAt, id };
}

/** De onde vem o direito em cascata mostrado na cesta (`CartUnlockVia`). */
export interface CartUnlockVia {
  productType: SalesProductType;
  title: string;
}

/** Produto que a compra do item libera além dele (`CartUnlock`). */
export interface CartUnlock {
  productType: SalesProductType;
  productId: string;
  title: string;
  via: CartUnlockVia | null;
}

/** Item da cesta como o contrato o mostra (`CartItem`). */
export interface CartItemView {
  id: string;
  productType: SalesProductType;
  productId: string;
  title: string;
  cover: CatalogCover | null;
  accessMode: AccessMode;
  accessDays: number | null;
  unitPriceCents: number | null;
  discountCents: number;
  couponEligible: boolean;
  sellable: boolean;
  unsellableReason: CartItemUnsellableReason | null;
  warnings: CartItemWarning[];
  unlocks: CartUnlock[];
  addedAt: Date;
}

/** Cupom aplicado à cesta, com o estado atual da validade (`CartCoupon`). */
export interface CartCouponView {
  code: string;
  kind: CouponKind;
  percentOff: number | null;
  amountOffCents: number | null;
  valid: boolean;
  invalidReason: CouponInvalidReason | null;
}

/** A cesta aberta (`Cart`). */
export interface CartView {
  items: CartItemView[];
  coupon: CartCouponView | null;
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  updatedAt: Date;
}

/** Dados do comprador guardados no usuário (`Billing`). */
export interface BillingView {
  fullName: string | null;
  taxIdType: TaxIdType | null;
  taxId: string | null;
  complete: boolean;
}

/** Item do pedido só com o necessário para a lista (`OrderProductRef`). */
export interface OrderProductRef {
  productType: SalesProductType;
  productId: string;
  title: string;
}

/** Provedor mostrado no pedido; `none` é o pedido de total zero. */
export type OrderProviderName = PaymentProviderName | 'none';

/** A cobrança conhecida do pedido, como o aluno a vê (`MyPayment`). */
export interface MyPayment {
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  currency: string;
  provider: PaymentProviderName;
  providerPaymentId: string;
  paidAt: Date | null;
}

/** Um pedido do aluno na lista (`MyOrderSummary`). */
export interface MyOrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  itemCount: number;
  items: OrderProductRef[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  paymentMethod: PaymentMethod | null;
}

/** O pedido do aluno, com os valores congelados e a cobrança conhecida (`MyOrderDetail`). */
export interface MyOrderDetail {
  id: string;
  number: number;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  couponCode: string | null;
  buyerName: string;
  buyerTaxIdType: TaxIdType;
  buyerTaxId: string;
  provider: OrderProviderName;
  checkoutUrl: string | null;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  items: SalesOrderItem[];
  payment: MyPayment | null;
}

/** Resultado de fechar a cesta (`OrderCheckout`). */
export interface OrderCheckout {
  order: MyOrderDetail;
  checkoutUrl: string | null;
}

/** O comprador na lista do admin, sem o documento fiscal (`OrderBuyer`). */
export interface OrderBuyer {
  id: string;
  name: string;
  email: string;
}

/** O comprador no detalhe (`OrderBuyerDetail`): o documento só aparece aqui e no CSV. */
export interface OrderBuyerDetail extends OrderBuyer {
  taxIdType: TaxIdType;
  taxId: string;
}

/** Somas de todos os pedidos que casam com o filtro (`OrderTotals`). */
export interface OrderTotals {
  subtotalCents: number;
  discountCents: number;
  refundedCents: number;
  totalCents: number;
  netCents: number;
}

/** Uma cobrança conhecida na tela do admin (`Payment`). */
export interface SalesPayment {
  id: string;
  orderId: string | null;
  orderNumber: number | null;
  subscriptionId: string | null;
  provider: PaymentProviderName;
  providerPaymentId: string;
  status: PaymentStatus;
  method: PaymentMethod;
  amountCents: number;
  refundedCents: number;
  currency: string;
  rawStatus: string;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Um pedido na lista do admin, sem o documento fiscal (`OrderSummary`). */
export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  buyer: OrderBuyer;
  itemCount: number;
  items: OrderProductRef[];
  subtotalCents: number;
  discountCents: number;
  refundedCents: number;
  totalCents: number;
  currency: string;
  couponCode: string | null;
  provider: OrderProviderName;
  paymentMethod: PaymentMethod | null;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
}

export const REFUND_STATUSES = ['requested', 'done', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Item reembolsado, com o título congelado do pedido (`RefundItem`). */
export interface RefundItemView {
  orderItemId: string;
  title: string;
  amountCents: number;
}

/** Um reembolso pedido, em execução ou concluído (`Refund`). O módulo de reembolsos o preenche. */
export interface RefundView {
  id: string;
  orderId: string | null;
  paymentId: string;
  items: RefundItemView[];
  amountCents: number;
  reason: string;
  status: RefundStatus;
  providerRefundId: string | null;
  error: string | null;
  requestedBy: { id: string; name: string };
  createdAt: Date;
  doneAt: Date | null;
}

/** O pedido completo do admin (`OrderDetail`); `refunds` é preenchido pelo módulo de reembolsos. */
export interface OrderDetail {
  id: string;
  number: number;
  status: OrderStatus;
  buyer: OrderBuyerDetail;
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  refundedCents: number;
  totalCents: number;
  currency: string;
  couponCode: string | null;
  provider: OrderProviderName;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  items: SalesOrderItem[];
  payments: SalesPayment[];
  refunds: RefundView[];
}

/** Página de uma listagem de vendas (`Page` do contrato). */
export interface SalesPage<T> {
  items: T[];
  nextCursor: string | null;
}
