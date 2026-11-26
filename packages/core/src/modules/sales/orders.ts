import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, notFound, validationFailed } from '../../errors/domain-error.ts';
import { type ManagementRequest, requirePermission } from '../accounts/management/common.ts';
import type { PaymentMethod, PaymentStatus } from '../payments/types.ts';
import { assertPurchaseAllowed } from './cart.ts';
import { orderNotCancelable } from './errors.ts';
import {
  cents,
  decodeSalesCursor,
  encodeSalesCursor,
  isOrderStatus,
  isSalesProductType,
  isUuid,
  type MyOrderDetail,
  type MyOrderSummary,
  type OrderBuyerDetail,
  type OrderDetail,
  type OrderProductRef,
  type OrderProviderName,
  type OrderStatus,
  type OrderSummary,
  type OrderTotals,
  PAID_ORDER_STATUSES,
  type RefundItemView,
  type RefundStatus,
  type RefundView,
  readRefundItems,
  SALES_PAGE_DEFAULT_LIMIT,
  SALES_PAGE_MAX_LIMIT,
  SALES_QUERY_MAX_LENGTH,
  type SalesCursorValue,
  type SalesOrderItem,
  type SalesPage,
  type SalesPayment,
  type TaxIdType,
} from './types.ts';

// Consultas de pedidos (spec 011, "Consulta e exportação"; RF-08): a lista e o detalhe do aluno,
// a lista e o detalhe do admin, o cancelamento antes do pagamento e o vencimento do `pending`.
// A escrita do pedido é do fechamento (`checkout.ts`) e do worker (`payments/order-transitions`).

const MY_ORDERS_CURSOR = 'my-orders';
const ADMIN_ORDERS_CURSOR = 'admin-orders';

export interface MyOrdersQuery {
  status?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface AdminOrdersQuery extends MyOrdersQuery {
  from?: unknown;
  to?: unknown;
  productType?: unknown;
  productId?: unknown;
  couponId?: unknown;
  q?: unknown;
}

export interface AdminOrderPage extends SalesPage<OrderSummary> {
  totals: OrderTotals;
}

interface PageParams {
  status?: OrderStatus;
  limit: number;
  after?: SalesCursorValue;
}

function readPageParams(query: MyOrdersQuery, scope: string): PageParams {
  const errors: FieldError[] = [];
  let status: OrderStatus | undefined;
  if (query.status !== undefined) {
    if (isOrderStatus(query.status)) {
      status = query.status;
    } else {
      errors.push({ path: 'status', message: 'valor inválido' });
    }
  }
  let limit = SALES_PAGE_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const value =
      typeof query.limit === 'number'
        ? query.limit
        : typeof query.limit === 'string' && /^\d+$/.test(query.limit)
          ? Number(query.limit)
          : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > SALES_PAGE_MAX_LIMIT) {
      errors.push({ path: 'limit', message: 'deve ser um inteiro de 1 a 100' });
    } else {
      limit = value;
    }
  }
  let after: SalesCursorValue | undefined;
  if (query.cursor !== undefined) {
    after = decodeSalesCursor(query.cursor, scope);
    if (!after) errors.push({ path: 'cursor', message: 'cursor inválido' });
  }
  if (errors.length > 0) throw validationFailed(errors);
  return {
    ...(status !== undefined ? { status } : {}),
    limit,
    ...(after !== undefined ? { after } : {}),
  };
}

/** Item do pedido com a chave de agrupamento da listagem (o contrato não a expõe). */
interface OrderItemWithOrder extends SalesOrderItem {
  orderId: string;
}

function mapOrderItem(row: {
  id: string;
  orderId: string;
  productType: string;
  productId: string;
  titleSnapshot: string;
  accessDaysSnapshot: number | null;
  unitPriceCents: string | number | bigint;
  discountCents: string | number | bigint;
  paidCents: string | number | bigint;
  refundedCents: string | number | bigint;
}): OrderItemWithOrder {
  return {
    id: row.id,
    orderId: row.orderId,
    productType: row.productType as SalesOrderItem['productType'],
    productId: row.productId,
    title: row.titleSnapshot,
    accessDays: row.accessDaysSnapshot,
    unitPriceCents: cents(row.unitPriceCents),
    discountCents: cents(row.discountCents),
    paidCents: cents(row.paidCents),
    refundedCents: cents(row.refundedCents),
  };
}

function mapPayment(
  row: {
    id: string;
    orderId: string | null;
    subscriptionId: string | null;
    provider: string;
    providerPaymentId: string;
    status: string;
    method: string;
    amountCents: string | number | bigint;
    refundedCents: string | number | bigint;
    currency: string;
    rawStatus: string;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  orderNumber: number | null,
): SalesPayment {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber,
    subscriptionId: row.subscriptionId,
    provider: row.provider as SalesPayment['provider'],
    providerPaymentId: row.providerPaymentId,
    status: row.status as PaymentStatus,
    method: row.method as PaymentMethod,
    amountCents: cents(row.amountCents),
    refundedCents: cents(row.refundedCents),
    currency: row.currency,
    rawStatus: row.rawStatus,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadOrderItems(
  db: Database,
  orderIds: readonly string[],
): Promise<OrderItemWithOrder[]> {
  if (orderIds.length === 0) return [];
  const rows = await db
    .selectFrom('orderItems')
    .selectAll()
    .where('orderId', 'in', orderIds)
    .orderBy('orderId')
    .orderBy('id')
    .execute();
  return rows.map(mapOrderItem);
}

async function loadPayments(
  db: Database,
  orderIds: readonly string[],
): Promise<Map<string, SalesPayment[]>> {
  const map = new Map<string, SalesPayment[]>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .selectFrom('payments')
    .selectAll()
    .where('orderId', 'in', orderIds)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  for (const row of rows) {
    const list = map.get(row.orderId as string) ?? [];
    list.push(mapPayment(row, null));
    map.set(row.orderId as string, list);
  }
  return map;
}

function productRefs(items: readonly SalesOrderItem[]): OrderProductRef[] {
  return items.map((item) => ({
    productType: item.productType,
    productId: item.productId,
    title: item.title,
  }));
}

/** A lista do aluno (`GET /orders`), sem os `draft`, do mais novo ao mais antigo. */
export async function listMyOrders(
  db: Database,
  userId: string,
  query: MyOrdersQuery,
): Promise<SalesPage<MyOrderSummary>> {
  await assertPurchaseAllowed(db, userId);
  const params = readPageParams(query, MY_ORDERS_CURSOR);
  if (params.status === 'draft') return { items: [], nextCursor: null };

  let statement = db
    .selectFrom('orders')
    .selectAll()
    .where('userId', '=', userId)
    .where('status', '!=', 'draft');
  if (params.status !== undefined) statement = statement.where('status', '=', params.status);
  if (params.after !== undefined) {
    const after = params.after;
    statement = statement.where((eb) =>
      eb.or([
        eb('createdAt', '<', after.createdAt),
        eb.and([eb('createdAt', '=', after.createdAt), eb('id', '<', after.id)]),
      ]),
    );
  }
  const rows = await statement
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(params.limit + 1)
    .execute();
  const pageRows = rows.slice(0, params.limit);
  const items = await loadOrderItems(
    db,
    pageRows.map((row) => row.id),
  );
  const payments = await loadPayments(
    db,
    pageRows.map((row) => row.id),
  );
  const byOrder = new Map<string, SalesOrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(item);
    byOrder.set(item.orderId, list);
  }
  const summaries: MyOrderSummary[] = pageRows.map((row) => {
    const orderItems = byOrder.get(row.id) ?? [];
    const latest = payments.get(row.id)?.[0];
    return {
      id: row.id,
      number: cents(row.number),
      status: row.status as OrderStatus,
      itemCount: orderItems.length,
      items: productRefs(orderItems),
      subtotalCents: cents(row.subtotalCents),
      discountCents: cents(row.discountCents),
      totalCents: cents(row.totalCents),
      currency: row.currency,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      expiresAt: row.expiresAt,
      paymentMethod: latest?.method ?? null,
    };
  });
  const last = pageRows.at(-1);
  return {
    items: summaries,
    nextCursor:
      rows.length > params.limit && last
        ? encodeSalesCursor(MY_ORDERS_CURSOR, last.createdAt, last.id)
        : null,
  };
}

function orderProvider(value: string): OrderProviderName {
  return value === 'mercadopago' || value === 'fake' ? value : 'none';
}

/** O pedido do aluno (`GET /orders/{id}`); de outra pessoa ou `draft` é `404`. */
export async function getMyOrder(
  db: Database,
  userId: string,
  orderId: string,
): Promise<MyOrderDetail> {
  await assertPurchaseAllowed(db, userId);
  if (!isUuid(orderId)) throw notFound('Pedido não encontrado.');
  const order = await db
    .selectFrom('orders')
    .selectAll()
    .where('id', '=', orderId.toLowerCase())
    .where('userId', '=', userId)
    .where('status', '!=', 'draft')
    .executeTakeFirst();
  if (!order) throw notFound('Pedido não encontrado.');
  const items = await loadOrderItems(db, [order.id]);
  const latest = (await loadPayments(db, [order.id])).get(order.id)?.[0] ?? null;
  return {
    id: order.id,
    number: cents(order.number),
    status: order.status as OrderStatus,
    subtotalCents: cents(order.subtotalCents),
    discountCents: cents(order.discountCents),
    totalCents: cents(order.totalCents),
    currency: order.currency,
    couponCode: order.couponCode,
    buyerName: order.buyerName,
    buyerTaxIdType: order.buyerTaxIdType as TaxIdType,
    buyerTaxId: order.buyerTaxId,
    provider: orderProvider(order.provider),
    // Enquanto o pedido espera pagamento, a página mostra a URL que o provedor devolveu no
    // fechamento. Depois da decisão ela não serve mais para pagar.
    checkoutUrl: order.status === 'pending' ? order.checkoutUrl : null,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    expiresAt: order.expiresAt,
    items,
    payment:
      latest === null
        ? null
        : {
            method: latest.method,
            status: latest.status,
            amountCents: latest.amountCents,
            refundedCents: latest.refundedCents,
            currency: latest.currency,
            provider: latest.provider,
            providerPaymentId: latest.providerPaymentId,
            paidAt: latest.paidAt,
          },
  };
}

/** Cancela um pedido `pending` do aluno (`POST /orders/{id}/cancel`). */
export async function cancelMyOrder(
  db: Database,
  userId: string,
  orderId: string,
): Promise<MyOrderDetail> {
  await assertPurchaseAllowed(db, userId);
  if (!isUuid(orderId)) throw notFound('Pedido não encontrado.');
  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom('orders')
      .select(['id', 'status'])
      .where('id', '=', orderId.toLowerCase())
      .where('userId', '=', userId)
      .where('status', '!=', 'draft')
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw notFound('Pedido não encontrado.');
    if (order.status !== 'pending') throw orderNotCancelable();
    await trx
      .updateTable('orders')
      .set({ status: 'canceled', expiresAt: null })
      .where('id', '=', order.id)
      .execute();
  });
  return getMyOrder(db, userId, orderId);
}

/**
 * Marca como `expired` os pedidos `pending` vencidos e devolve os identificadores, para o worker
 * pedir o cancelamento ao provedor (spec 011). Pagamento tardio ainda pode virar `paid`.
 */
export async function expirePendingOrders(
  db: Database,
  options: { now?: Date; limit?: number } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const rows = await db
    .updateTable('orders')
    .set({ status: 'expired', expiresAt: null })
    .where('status', '=', 'pending')
    .where('expiresAt', '<=', now)
    .where(
      sql<boolean>`id IN (
        SELECT id FROM orders
         WHERE status = 'pending' AND expires_at <= ${now}
         ORDER BY expires_at LIMIT ${limit}
      )`,
    )
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

function orderFilterConditions(
  query: AdminOrdersQuery,
  after: SalesCursorValue | undefined,
): RawBuilder<boolean>[] {
  const conditions: RawBuilder<boolean>[] = [];
  if (query.from !== undefined) {
    conditions.push(sql<boolean>`orders.created_at >= ${new Date(query.from as string)}`);
  }
  if (query.to !== undefined) {
    conditions.push(sql<boolean>`orders.created_at < ${new Date(query.to as string)}`);
  }
  if (query.status !== undefined) {
    conditions.push(sql<boolean>`orders.status = ${query.status as string}`);
  }
  if (query.productType !== undefined && query.productId !== undefined) {
    conditions.push(
      sql<boolean>`EXISTS (
        SELECT 1 FROM order_items oi
         WHERE oi.order_id = orders.id
           AND oi.product_type = ${query.productType as string}
           AND oi.product_id = ${query.productId as string}::uuid
      )`,
    );
  }
  if (query.couponId !== undefined) {
    conditions.push(sql<boolean>`orders.coupon_id = ${query.couponId as string}::uuid`);
  }
  if (query.q !== undefined) {
    const pattern = `%${escapeLike(query.q as string)}%`;
    conditions.push(
      sql<boolean>`(orders.buyer_name ILIKE ${pattern}
        OR EXISTS (SELECT 1 FROM users u WHERE u.id = orders.user_id AND u.email ILIKE ${pattern}))`,
    );
  }
  if (after !== undefined) {
    conditions.push(
      sql<boolean>`(orders.created_at, orders.id) < (${after.createdAt}, ${after.id}::uuid)`,
    );
  }
  return conditions;
}

function readAdminFilters(query: AdminOrdersQuery): {
  params: PageParams;
  conditions: RawBuilder<boolean>[];
} {
  const errors: FieldError[] = [];
  const params = readPageParams(query, ADMIN_ORDERS_CURSOR);
  if (query.from !== undefined) {
    if (!isDate(query.from)) errors.push({ path: 'from', message: 'data inválida' });
  }
  if (query.to !== undefined) {
    if (!isDate(query.to)) errors.push({ path: 'to', message: 'data inválida' });
  }
  const hasProductType = query.productType !== undefined;
  const hasProductId = query.productId !== undefined;
  if (hasProductType !== hasProductId) {
    errors.push({
      path: hasProductType ? 'productId' : 'productType',
      message: 'exige o outro campo para filtrar por produto',
    });
  }
  if (hasProductType && !isSalesProductType(query.productType)) {
    errors.push({ path: 'productType', message: 'valor inválido' });
  }
  if (hasProductId && !isUuid(query.productId)) {
    errors.push({ path: 'productId', message: 'UUID inválido' });
  }
  if (query.couponId !== undefined && !isUuid(query.couponId)) {
    errors.push({ path: 'couponId', message: 'UUID inválido' });
  }
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.trim() === '') {
      errors.push({ path: 'q', message: 'deve ter de 1 a 200 caracteres' });
    } else if (query.q.length > SALES_QUERY_MAX_LENGTH) {
      errors.push({ path: 'q', message: 'deve ter de 1 a 200 caracteres' });
    }
  }
  if (errors.length > 0) throw validationFailed(errors);
  return { params, conditions: orderFilterConditions(query, params.after) };
}

/** A lista do admin (`GET /orders`), com os totais de todo o filtro. */
export async function listAdminOrders(
  db: Database,
  request: ManagementRequest,
  query: AdminOrdersQuery,
): Promise<AdminOrderPage> {
  await requirePermission(db, request, 'sales.view', { action: 'order.list' });
  const { params, conditions } = readAdminFilters(query);
  const where: RawBuilder<boolean> =
    conditions.length > 0
      ? (sql.join(conditions, sql` AND `) as RawBuilder<boolean>)
      : sql<boolean>`true`;

  const rows = await db
    .selectFrom('orders')
    .innerJoin('users', 'users.id', 'orders.userId')
    .select([
      'orders.id',
      'orders.number',
      'orders.userId',
      'orders.status',
      'orders.subtotalCents',
      'orders.discountCents',
      'orders.totalCents',
      'orders.currency',
      'orders.couponCode',
      'orders.buyerName',
      'orders.provider',
      'orders.createdAt',
      'orders.paidAt',
      'orders.expiresAt',
      'users.email as buyerEmail',
    ])
    .where(where)
    .orderBy('orders.createdAt', 'desc')
    .orderBy('orders.id', 'desc')
    .limit(params.limit + 1)
    .execute();
  const pageRows = rows.slice(0, params.limit);
  const ids = pageRows.map((row) => row.id);
  const items = await loadOrderItems(db, ids);
  const payments = await loadPayments(db, ids);
  const byOrder = new Map<string, SalesOrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(item);
    byOrder.set(item.orderId, list);
  }
  const summaries: OrderSummary[] = pageRows.map((row) => {
    const orderItems = byOrder.get(row.id) ?? [];
    const latest = payments.get(row.id)?.[0];
    return {
      id: row.id,
      number: cents(row.number),
      status: row.status as OrderStatus,
      buyer: {
        id: row.userId,
        name: row.buyerName,
        email: row.buyerEmail,
      },
      itemCount: orderItems.length,
      items: productRefs(orderItems),
      subtotalCents: cents(row.subtotalCents),
      discountCents: cents(row.discountCents),
      refundedCents: orderItems.reduce((total, item) => total + item.refundedCents, 0),
      totalCents: cents(row.totalCents),
      currency: row.currency,
      couponCode: row.couponCode,
      provider: orderProvider(row.provider),
      paymentMethod: latest?.method ?? null,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      expiresAt: row.expiresAt,
    };
  });

  const totalsRow = await sql<{
    subtotal: string;
    discount: string;
    refunded: string;
    total: string;
  }>`
    SELECT COALESCE(SUM(orders.subtotal_cents), 0)::text AS subtotal,
           COALESCE(SUM(orders.discount_cents), 0)::text AS discount,
           COALESCE(SUM((
             SELECT COALESCE(SUM(oi.refunded_cents), 0)
               FROM order_items oi WHERE oi.order_id = orders.id
           )), 0)::text AS refunded,
           COALESCE(SUM(orders.total_cents), 0)::text AS total
      FROM orders
     WHERE ${where}`.execute(db);
  const totals = totalsRow.rows[0] ?? { subtotal: '0', discount: '0', refunded: '0', total: '0' };
  const last = pageRows.at(-1);
  return {
    items: summaries,
    totals: {
      subtotalCents: Number(totals.subtotal),
      discountCents: Number(totals.discount),
      refundedCents: Number(totals.refunded),
      totalCents: Number(totals.total),
      netCents: Number(totals.total) - Number(totals.refunded),
    },
    nextCursor:
      rows.length > params.limit && last
        ? encodeSalesCursor(ADMIN_ORDERS_CURSOR, last.createdAt, last.id)
        : null,
  };
}

/** O pedido completo do admin (`GET /orders/{id}`), com documento fiscal, cobranças e reembolsos. */
export async function getAdminOrder(
  db: Database,
  request: ManagementRequest,
  orderId: string,
): Promise<OrderDetail> {
  await requirePermission(db, request, 'sales.view', { action: 'order.view' });
  if (!isUuid(orderId)) throw notFound('Pedido não encontrado.');
  const order = await db
    .selectFrom('orders')
    .innerJoin('users', 'users.id', 'orders.userId')
    .select([
      'orders.id',
      'orders.number',
      'orders.userId',
      'orders.status',
      'orders.subtotalCents',
      'orders.discountCents',
      'orders.totalCents',
      'orders.currency',
      'orders.couponCode',
      'orders.buyerName',
      'orders.buyerTaxIdType',
      'orders.buyerTaxId',
      'orders.provider',
      'orders.createdAt',
      'orders.paidAt',
      'orders.expiresAt',
      'users.email as buyerEmail',
    ])
    .where('orders.id', '=', orderId.toLowerCase())
    .executeTakeFirst();
  if (!order) throw notFound('Pedido não encontrado.');
  const items = await loadOrderItems(db, [order.id]);
  const payments = (await loadPayments(db, [order.id])).get(order.id) ?? [];
  for (const payment of payments) payment.orderNumber = cents(order.number);
  const buyer: OrderBuyerDetail = {
    id: order.userId,
    name: order.buyerName,
    email: order.buyerEmail,
    taxIdType: order.buyerTaxIdType as TaxIdType,
    taxId: order.buyerTaxId,
  };
  return {
    id: order.id,
    number: cents(order.number),
    status: order.status as OrderStatus,
    buyer,
    itemCount: items.length,
    subtotalCents: cents(order.subtotalCents),
    discountCents: cents(order.discountCents),
    refundedCents: items.reduce((total, item) => total + item.refundedCents, 0),
    totalCents: cents(order.totalCents),
    currency: order.currency,
    couponCode: order.couponCode,
    provider: orderProvider(order.provider),
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    expiresAt: order.expiresAt,
    items,
    payments,
    refunds: await loadRefunds(db, order.id, items),
  };
}

/** Leitura dos reembolsos do pedido; a escrita é da tarefa 531. */
async function loadRefunds(
  db: Database,
  orderId: string,
  items: readonly SalesOrderItem[],
): Promise<RefundView[]> {
  const rows = await db
    .selectFrom('refunds')
    .innerJoin('users', 'users.id', 'refunds.requestedBy')
    .selectAll('refunds')
    .select(['users.name as requesterName', 'users.deletedAt as requesterDeletedAt'])
    .where('orderId', '=', orderId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const titles = new Map(items.map((item) => [item.id, item.title]));
  return rows.map((row) => {
    const refundItems: RefundItemView[] = readRefundItems(row.items).map((item) => ({
      orderItemId: item.orderItemId,
      title: titles.get(item.orderItemId) ?? 'item removido',
      amountCents: item.amountCents,
    }));
    return {
      id: row.id,
      orderId: row.orderId,
      paymentId: row.paymentId,
      items: refundItems,
      amountCents: cents(row.amountCents),
      reason: row.reason,
      status: row.status as RefundStatus,
      providerRefundId: row.providerRefundId,
      error: row.error,
      requestedBy: {
        id: row.requestedBy,
        name: row.requesterDeletedAt === null ? row.requesterName : 'usuário removido',
      },
      createdAt: row.createdAt,
      doneAt: row.doneAt,
    };
  });
}

function isDate(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Reexporta a lista de estados pagos para quem confere se o pedido libera acesso. */
export { PAID_ORDER_STATUSES };
