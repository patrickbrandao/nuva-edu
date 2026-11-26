import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  type AdminOrdersQuery,
  type CouponAppliesTo,
  type CouponInput,
  type CouponKind,
  type CouponQuery,
  type CouponUpdateInput,
  type CouponView,
  cents,
  couponCodeTaken,
  createCoupon,
  type Database,
  DomainError,
  type FieldError,
  getAdminOrder,
  getCoupon,
  isDomainError,
  listAdminOrders,
  listCoupons,
  managementAuditContext,
  type OrderDetail,
  type OrderStatus,
  type OrderSummary,
  type RefundItemInput,
  recordAudit,
  requestOrderRefund,
  retryRefund,
  SALES_EXPORT_BATCH_SIZE,
  type SalesOrderItem,
  type SalesPayment,
  type SalesProductRef,
  type SalesProductType,
  updateCoupon,
  validationFailed,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';
import { type IdParams, iso, isoOrNull } from './catalog-common.ts';
import { refundBody } from './subscriptions.ts';

// Vendas na admin-api (spec 011; specs 003, 008, 028 e 033): consulta de pedidos com totais do
// filtro, detalhe com documento fiscal, exportação CSV em fluxo contínuo (`sales.export`, só
// admin), solicitação e repetição de reembolso (`order.refund`, só admin, com `Idempotency-Key`
// no pedido de reembolso) e gestão de cupons (`coupon.manage`, só admin). O documento fiscal do
// comprador só sai no detalhe do pedido e no CSV, nunca na listagem nem nos logs.

export interface SalesRoutesOptions {
  db: Database;
  /** Pedidos lidos por consulta na exportação CSV. Padrão: `SALES_EXPORT_BATCH_SIZE` (500). */
  exportBatchSize?: number;
}

const CSV_COLUMNS = [
  'order_id',
  'order_number',
  'created_at',
  'paid_at',
  'status',
  'buyer_name',
  'buyer_email',
  'tax_id_type',
  'tax_id',
  'product_type',
  'product_title',
  'unit_price',
  'discount',
  'paid_amount',
  'refunded_amount',
  'coupon_code',
  'payment_method',
  'provider',
  'provider_payment_id',
] as const;

const CSV_HEADER_LINE = `\uFEFF${CSV_COLUMNS.join(';')}\r\n`;
/** Linhas acumuladas antes de ceder um bloco ao fluxo HTTP (~40 KB). */
const CSV_FLUSH_LINES = 250;

/** `Payment` do contrato; reutilizado em `OrderDetail` e nas rotas de `/payments`. */
export function paymentBody(payment: SalesPayment) {
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
  };
}

/** `OrderItem` do contrato. */
function orderItemBody(item: SalesOrderItem) {
  return {
    id: item.id,
    productType: item.productType,
    productId: item.productId,
    title: item.title,
    accessDays: item.accessDays,
    unitPriceCents: item.unitPriceCents,
    discountCents: item.discountCents,
    paidCents: item.paidCents,
    refundedCents: item.refundedCents,
  };
}

/** `OrderSummary` do contrato, sem o documento fiscal do comprador. */
function orderSummaryBody(order: OrderSummary) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    buyer: {
      id: order.buyer.id,
      name: order.buyer.name,
      email: order.buyer.email,
    },
    itemCount: order.itemCount,
    items: order.items.map((item) => ({
      productType: item.productType,
      productId: item.productId,
      title: item.title,
    })),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    refundedCents: order.refundedCents,
    totalCents: order.totalCents,
    currency: order.currency,
    couponCode: order.couponCode,
    provider: order.provider,
    paymentMethod: order.paymentMethod,
    createdAt: iso(order.createdAt),
    paidAt: isoOrNull(order.paidAt),
    expiresAt: isoOrNull(order.expiresAt),
  };
}

/** `OrderDetail` do contrato, com documento fiscal, cobranças e reembolsos. */
export function orderDetailBody(order: OrderDetail) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    buyer: {
      id: order.buyer.id,
      name: order.buyer.name,
      email: order.buyer.email,
      taxIdType: order.buyer.taxIdType,
      taxId: order.buyer.taxId,
    },
    itemCount: order.itemCount,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    refundedCents: order.refundedCents,
    totalCents: order.totalCents,
    currency: order.currency,
    couponCode: order.couponCode,
    provider: order.provider,
    createdAt: iso(order.createdAt),
    paidAt: isoOrNull(order.paidAt),
    expiresAt: isoOrNull(order.expiresAt),
    items: order.items.map(orderItemBody),
    payments: order.payments.map(paymentBody),
    refunds: order.refunds.map(refundBody),
  };
}

/** `Coupon` do contrato. */
export function couponBody(coupon: CouponView) {
  return {
    id: coupon.id,
    code: coupon.code,
    kind: coupon.kind,
    percentOff: coupon.percentOff,
    amountOffCents: coupon.amountOffCents,
    startsAt: isoOrNull(coupon.startsAt),
    endsAt: isoOrNull(coupon.endsAt),
    maxUses: coupon.maxUses,
    maxUsesPerUser: coupon.maxUsesPerUser,
    usesCount: coupon.usesCount,
    appliesTo: coupon.appliesTo,
    products: coupon.products.map((product) => ({
      productType: product.productType,
      productId: product.productId,
      title: product.title,
    })),
    active: coupon.active,
    createdBy: { id: coupon.createdBy.id, name: coupon.createdBy.name },
    createdAt: iso(coupon.createdAt),
    updatedAt: iso(coupon.updatedAt),
  };
}

/** Centavos inteiros em decimal com duas casas e vírgula (`19990` → `199,90`). */
export function formatCsvMoney(amountCents: number): string {
  const negative = amountCents < 0;
  const abs = Math.abs(Math.trunc(amountCents));
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole},${fraction}`;
}

/** Célula CSV separada por `;` (RFC 4180): escapa `;`, `"`, `\r` e `\n`. */
export function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (/[;"\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

interface ExportFilters {
  from?: Date;
  to?: Date;
  status?: OrderStatus;
  productType?: SalesProductType;
  productId?: string;
  couponId?: string;
  q?: string;
}

interface RawExportQuery {
  from?: string;
  to?: string;
  status?: OrderStatus;
  productType?: SalesProductType;
  productId?: string;
  couponId?: string;
  q?: string;
}

function parseExportFilters(query: RawExportQuery): {
  filters: ExportFilters;
  filterNames: string[];
} {
  const errors: FieldError[] = [];
  const filters: ExportFilters = {};
  const filterNames: string[] = [];

  if (query.from !== undefined) {
    const parsed = new Date(query.from);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ path: 'query.from', message: 'Data inválida.' });
    } else {
      filters.from = parsed;
      filterNames.push('from');
    }
  }
  if (query.to !== undefined) {
    const parsed = new Date(query.to);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ path: 'query.to', message: 'Data inválida.' });
    } else {
      filters.to = parsed;
      filterNames.push('to');
    }
  }
  if (query.status !== undefined) {
    filters.status = query.status;
    filterNames.push('status');
  }
  const hasProductType = query.productType !== undefined;
  const hasProductId = query.productId !== undefined;
  if (hasProductType !== hasProductId) {
    errors.push({
      path: hasProductType ? 'query.productId' : 'query.productType',
      message: 'Exige o outro campo para filtrar por produto.',
    });
  } else if (query.productType !== undefined && query.productId !== undefined) {
    filters.productType = query.productType;
    filters.productId = query.productId.toLowerCase();
    filterNames.push('product');
  }
  if (query.couponId !== undefined) {
    filters.couponId = query.couponId.toLowerCase();
    filterNames.push('couponId');
  }
  if (query.q !== undefined) {
    if (query.q.trim() === '') {
      errors.push({ path: 'query.q', message: 'Deve ter de 1 a 200 caracteres.' });
    } else {
      filters.q = query.q;
      filterNames.push('q');
    }
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  return { filters, filterNames };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

interface ExportOrderRow {
  id: string;
  number: string | number | bigint;
  createdAt: Date;
  paidAt: Date | null;
  status: string;
  buyerName: string;
  buyerEmail: string;
  buyerTaxIdType: string;
  buyerTaxId: string;
  couponCode: string | null;
  provider: string;
}

interface ExportOrderItemRow {
  id: string;
  orderId: string;
  productType: string;
  titleSnapshot: string;
  unitPriceCents: string | number | bigint;
  discountCents: string | number | bigint;
  paidCents: string | number | bigint;
  refundedCents: string | number | bigint;
}

interface LatestPaymentRow {
  orderId: string | null;
  method: string;
  providerPaymentId: string;
}

/**
 * Gera o CSV em lotes por cursor sobre `(orders.created_at DESC, orders.id DESC)`, sem carregar
 * todos os pedidos ou itens em memória (spec 011, RNF-04). O cabeçalho sai no primeiro bloco;
 * cada lote busca até `batchSize` pedidos e seus itens e cede blocos curtos ao consumidor HTTP.
 */
export async function* streamOrdersCsv(
  db: Database,
  filters: ExportFilters,
  batchSize: number = SALES_EXPORT_BATCH_SIZE,
): AsyncGenerator<string, void, undefined> {
  yield CSV_HEADER_LINE;

  let cursorCreatedAt: Date | null = null;
  let cursorOrderId: string | null = null;

  while (true) {
    let query = db
      .selectFrom('orders')
      .innerJoin('users', 'users.id', 'orders.userId')
      .select([
        'orders.id',
        'orders.number',
        'orders.createdAt',
        'orders.paidAt',
        'orders.status',
        'orders.buyerName',
        'users.email as buyerEmail',
        'orders.buyerTaxIdType',
        'orders.buyerTaxId',
        'orders.couponCode',
        'orders.provider',
      ])
      .orderBy('orders.createdAt', 'desc')
      .orderBy('orders.id', 'desc')
      .limit(batchSize);

    if (filters.from !== undefined) {
      query = query.where('orders.createdAt', '>=', filters.from);
    }
    if (filters.to !== undefined) {
      query = query.where('orders.createdAt', '<', filters.to);
    }
    if (filters.status !== undefined) {
      query = query.where('orders.status', '=', filters.status);
    }
    if (filters.productType !== undefined && filters.productId !== undefined) {
      const productType = filters.productType;
      const productId = filters.productId;
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('orderItems as oi')
            .select('oi.id')
            .whereRef('oi.orderId', '=', 'orders.id')
            .where('oi.productType', '=', productType)
            .where('oi.productId', '=', productId),
        ),
      );
    }
    if (filters.couponId !== undefined) {
      query = query.where('orders.couponId', '=', filters.couponId);
    }
    if (filters.q !== undefined) {
      const pattern = `%${escapeLike(filters.q)}%`;
      query = query.where((eb) =>
        eb.or([eb('orders.buyerName', 'ilike', pattern), eb('users.email', 'ilike', pattern)]),
      );
    }
    if (cursorCreatedAt !== null && cursorOrderId !== null) {
      const afterAt = cursorCreatedAt;
      const afterId = cursorOrderId;
      query = query.where((eb) =>
        eb.or([
          eb('orders.createdAt', '<', afterAt),
          eb.and([eb('orders.createdAt', '=', afterAt), eb('orders.id', '<', afterId)]),
        ]),
      );
    }

    const orders = (await query.execute()) as ExportOrderRow[];
    if (orders.length === 0) {
      return;
    }

    const orderIds = orders.map((order) => order.id);
    const [items, payments] = await Promise.all([
      db
        .selectFrom('orderItems')
        .select([
          'id',
          'orderId',
          'productType',
          'titleSnapshot',
          'unitPriceCents',
          'discountCents',
          'paidCents',
          'refundedCents',
        ])
        .where('orderId', 'in', orderIds)
        .orderBy('orderId')
        .orderBy('id')
        .execute() as Promise<ExportOrderItemRow[]>,
      db
        .selectFrom('payments')
        .select(['orderId', 'method', 'providerPaymentId'])
        .where('orderId', 'in', orderIds)
        .orderBy('orderId')
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .execute() as Promise<LatestPaymentRow[]>,
    ]);

    const itemsByOrder = new Map<string, ExportOrderItemRow[]>();
    for (const item of items) {
      let group = itemsByOrder.get(item.orderId);
      if (!group) {
        group = [];
        itemsByOrder.set(item.orderId, group);
      }
      group.push(item);
    }

    const latestPaymentByOrder = new Map<string, LatestPaymentRow>();
    for (const payment of payments) {
      if (payment.orderId !== null && !latestPaymentByOrder.has(payment.orderId)) {
        latestPaymentByOrder.set(payment.orderId, payment);
      }
    }

    let buffer = '';
    let bufferedLines = 0;
    for (const order of orders) {
      const orderItems = itemsByOrder.get(order.id);
      if (!orderItems || orderItems.length === 0) continue;
      const latestPayment = latestPaymentByOrder.get(order.id);
      const orderNumber = String(cents(order.number));
      const createdAt = order.createdAt.toISOString();
      const paidAt = order.paidAt === null ? '' : order.paidAt.toISOString();
      const buyerName = escapeCsvCell(order.buyerName);
      const buyerEmail = escapeCsvCell(order.buyerEmail);
      const taxIdType = escapeCsvCell(order.buyerTaxIdType);
      const taxId = escapeCsvCell(order.buyerTaxId);
      const couponCode = escapeCsvCell(order.couponCode);
      const paymentMethod = escapeCsvCell(latestPayment?.method ?? null);
      const provider = escapeCsvCell(order.provider);
      const providerPaymentId = escapeCsvCell(latestPayment?.providerPaymentId ?? null);

      for (const item of orderItems) {
        const line = [
          order.id,
          orderNumber,
          createdAt,
          paidAt,
          order.status,
          buyerName,
          buyerEmail,
          taxIdType,
          taxId,
          item.productType,
          escapeCsvCell(item.titleSnapshot),
          formatCsvMoney(cents(item.unitPriceCents)),
          formatCsvMoney(cents(item.discountCents)),
          formatCsvMoney(cents(item.paidCents)),
          formatCsvMoney(cents(item.refundedCents)),
          couponCode,
          paymentMethod,
          provider,
          providerPaymentId,
        ].join(';');
        buffer += `${line}\r\n`;
        bufferedLines += 1;
        if (bufferedLines >= CSV_FLUSH_LINES) {
          yield buffer;
          buffer = '';
          bufferedLines = 0;
        }
      }
    }
    if (buffer !== '') {
      yield buffer;
    }

    const last = orders.at(-1);
    if (!last || orders.length < batchSize) {
      return;
    }
    cursorCreatedAt = last.createdAt;
    cursorOrderId = last.id;
  }
}

interface CouponRequestBody {
  code?: string;
  kind?: CouponKind;
  percentOff?: number | null;
  amountOffCents?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxUses?: number | null;
  maxUsesPerUser?: number;
  appliesTo?: CouponAppliesTo;
  products?: SalesProductRef[];
  active?: boolean;
}

function optionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === '23505';
}

/**
 * O esquema de `CouponInput`/`CouponUpdate` já validou formato e tipo de cada campo em
 * `preValidation`. Combinação incoerente entre `kind` e o desconto (`percentOff`/`amountOffCents`)
 * é regra de negócio do cupom no contrato (`422 coupon_invalid`), e corrida no índice único de
 * `lower(code)` vira `409 coupon_code_taken`.
 */
async function runCouponMutation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isDomainError(error) && error.code === 'validation_failed') {
      throw new DomainError({
        code: 'coupon_invalid',
        status: 422,
        title: 'Regra de negócio não atendida',
        detail: error.errors?.[0]?.message ?? error.detail,
        errors: error.errors,
      });
    }
    if (isUniqueViolation(error)) {
      throw couponCodeTaken();
    }
    throw error;
  }
}

export function registerSalesRoutes(app: FastifyInstance, options: SalesRoutesOptions): void {
  const { db } = options;
  const exportBatchSize = options.exportBatchSize ?? SALES_EXPORT_BATCH_SIZE;
  const request = (raw: FastifyRequest) => managementRequest(raw);

  // `GET /api/v1/orders`: `sales.view` (`manager` e `admin`); totais do filtro e sem `taxId`.
  app.operation('listOrders', async (raw) => {
    const query = raw.query as AdminOrdersQuery;
    const page = await listAdminOrders(db, request(raw), query);
    return {
      items: page.items.map(orderSummaryBody),
      totals: page.totals,
      nextCursor: page.nextCursor,
    };
  });

  // `GET /api/v1/orders/{id}`: pedido completo com documento fiscal, cobranças e reembolsos.
  app.operation('getOrder', async (raw) => {
    const { id } = raw.params as IdParams;
    return orderDetailBody(await getAdminOrder(db, request(raw), id));
  });

  // `GET /api/v1/orders/export.csv`: só `admin` (`sales.export`); gerente e instrutor recebem
  // `403` auditado pelo `onPermissionDenied` da API. Leitura sensível auditada (`sales.export`),
  // sem conteúdo nem valores de filtro nos logs (specs 011, 028 e 033).
  app.operation(
    'exportOrdersCsv',
    async (raw, reply) => {
      const { filters, filterNames } = parseExportFilters(raw.query as RawExportQuery);
      const context = managementAuditContext(request(raw));
      await recordAudit(db, {
        context,
        action: 'sales.export',
        targetType: 'sales',
        targetId: null,
        details: { filters: filterNames },
      });
      const filename = `vendas-${new Date().toISOString().slice(0, 10)}.csv`;
      return reply
        .status(200)
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .send(Readable.from(streamOrdersCsv(db, filters, exportBatchSize)));
    },
    { noStore: true },
  );

  // `POST /api/v1/orders/{id}/refunds`: só `admin` (`order.refund`), `202` com `Idempotency-Key`
  // repassada ao núcleo (task 711).
  app.operation('requestOrderRefund', async (raw, reply) => {
    const { id } = raw.params as IdParams;
    const body = raw.body as { reason: string; items?: RefundItemInput[] | null };
    const header = raw.headers['idempotency-key'];
    const idempotencyKey = typeof header === 'string' ? header : null;
    const refund = await requestOrderRefund(db, request(raw), {
      orderId: id,
      reason: body.reason,
      items: body.items ?? null,
      idempotencyKey,
    });
    return reply.status(202).send(refundBody(refund));
  });

  // `POST /api/v1/refunds/{id}/retry`: só `admin` (`order.refund`), repete reembolso `failed`.
  app.operation('retryRefund', async (raw, reply) => {
    const { id } = raw.params as IdParams;
    const refund = await retryRefund(db, request(raw), id);
    return reply.status(202).send(refundBody(refund));
  });

  // `GET /api/v1/coupons`: só `admin` (`coupon.manage`).
  app.operation('listCoupons', async (raw) => {
    const query = raw.query as CouponQuery;
    const page = await listCoupons(db, request(raw), query);
    return { items: page.items.map(couponBody), nextCursor: page.nextCursor };
  });

  // `POST /api/v1/coupons`: só `admin` (`coupon.manage`), `201`.
  app.operation('createCoupon', async (raw, reply) => {
    const body = raw.body as Required<Pick<CouponRequestBody, 'code' | 'kind'>> & CouponRequestBody;
    const startsAt = optionalDate(body.startsAt);
    const endsAt = optionalDate(body.endsAt);
    const input: CouponInput = {
      code: body.code,
      kind: body.kind,
      ...(body.percentOff === undefined ? {} : { percentOff: body.percentOff }),
      ...(body.amountOffCents === undefined ? {} : { amountOffCents: body.amountOffCents }),
      ...(startsAt === undefined ? {} : { startsAt }),
      ...(endsAt === undefined ? {} : { endsAt }),
      ...(body.maxUses === undefined ? {} : { maxUses: body.maxUses }),
      ...(body.maxUsesPerUser === undefined ? {} : { maxUsesPerUser: body.maxUsesPerUser }),
      ...(body.appliesTo === undefined ? {} : { appliesTo: body.appliesTo }),
      ...(body.products === undefined ? {} : { products: body.products }),
      ...(body.active === undefined ? {} : { active: body.active }),
    };
    const created = await runCouponMutation(() => createCoupon(db, request(raw), input));
    return reply.status(201).send(couponBody(created));
  });

  // `GET /api/v1/coupons/{id}`: só `admin` (`coupon.manage`).
  app.operation('getCoupon', async (raw) => {
    const { id } = raw.params as IdParams;
    return couponBody(await getCoupon(db, request(raw), id));
  });

  // `PATCH /api/v1/coupons/{id}`: só os campos presentes no corpo mudam; `active: false` desativa.
  app.operation('updateCoupon', async (raw) => {
    const { id } = raw.params as IdParams;
    const body = raw.body as CouponRequestBody;
    const update: CouponUpdateInput = {};
    if ('code' in body && body.code !== undefined) update.code = body.code;
    if ('kind' in body && body.kind !== undefined) update.kind = body.kind;
    if ('percentOff' in body) update.percentOff = body.percentOff ?? null;
    if ('amountOffCents' in body) update.amountOffCents = body.amountOffCents ?? null;
    if ('startsAt' in body) update.startsAt = optionalDate(body.startsAt) ?? null;
    if ('endsAt' in body) update.endsAt = optionalDate(body.endsAt) ?? null;
    if ('maxUses' in body) update.maxUses = body.maxUses ?? null;
    if ('maxUsesPerUser' in body && body.maxUsesPerUser !== undefined) {
      update.maxUsesPerUser = body.maxUsesPerUser;
    }
    if ('appliesTo' in body && body.appliesTo !== undefined) update.appliesTo = body.appliesTo;
    if ('products' in body && body.products !== undefined) update.products = body.products;
    if ('active' in body && body.active !== undefined) update.active = body.active;
    const saved = await runCouponMutation(() => updateCoupon(db, request(raw), id, update));
    return couponBody(saved);
  });
}
