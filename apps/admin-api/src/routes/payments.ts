import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type Config,
  cents,
  configuredPaymentProviderName,
  conflict,
  type Database,
  decodeSalesCursor,
  encodeSalesCursor,
  enqueuePaymentWebhook,
  type FieldError,
  isPaymentTestMode,
  isUuid,
  managementAuditContext,
  notFound,
  type PaymentMethod,
  type PaymentProviderName,
  type PaymentStatus,
  type PaymentWebhookResourceType,
  type PaymentWebhookStatus,
  type RefundItemView,
  type RefundStatus,
  type RefundView,
  readRefundItems,
  recordAudit,
  SALES_PAGE_DEFAULT_LIMIT,
  SALES_PAGE_MAX_LIMIT,
  type SalesCursorValue,
  type SalesPayment,
  validationFailed,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';
import { type IdParams, iso, isoOrNull } from './catalog-common.ts';
import { paymentBody } from './sales.ts';
import { refundBody } from './subscriptions.ts';

// Pagamentos e avisos de webhook na admin-api (spec 013; specs 003, 008, 028 e 033):
// - `/payments` e `/payments/{id}`: cobranças conhecidas de pedidos e assinaturas (`sales.view`,
//   gerente e admin), sem dado de cartão nem corpo devolvido pelo provedor;
// - `/webhook-events` e `/webhook-events/{id}/retry`: fila operacional (`failed`, que aceita
//   reprocessamento auditado) e trilha de segurança (`rejected`, somente leitura, sem corpo ou
//   assinatura e sem reprocessamento), exclusiva do `admin` (`ops.manage`);
// - `/settings/payments`: provedor em uso, indicador de modo de teste, aviso de produção com
//   token de teste e última reconciliação (`settings.manage`, só admin), nunca expondo segredos.

export interface PaymentRoutesOptions {
  db: Database;
  config: Config;
}

const PAYMENTS_CURSOR_SCOPE = 'payments';
const WEBHOOK_EVENTS_CURSOR_SCOPE = 'webhook-events';
const DELETED_USER_NAME = 'usuário removido';

type WebhookListStatus = 'failed' | 'rejected';

interface PaymentRow {
  id: string;
  orderId: string | null;
  orderNumber: string | number | bigint | null;
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
}

interface WebhookEventRow {
  id: string;
  provider: string;
  eventId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  status: string;
  attempts: number;
  error: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

function toSalesPayment(row: PaymentRow): SalesPayment {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber === null ? null : cents(row.orderNumber),
    subscriptionId: row.subscriptionId,
    provider: row.provider as PaymentProviderName,
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

/** `WebhookEvent` do contrato: apenas identificadores e estado, nunca corpo ou assinatura. */
function webhookEventBody(row: WebhookEventRow) {
  return {
    id: row.id,
    provider: row.provider as PaymentProviderName,
    eventId: row.eventId,
    resourceType: row.resourceType as PaymentWebhookResourceType | null,
    resourceId: row.resourceId,
    status: row.status as PaymentWebhookStatus,
    attempts: row.attempts,
    error: row.error,
    receivedAt: iso(row.receivedAt),
    processedAt: isoOrNull(row.processedAt),
  };
}

function readCursorAndLimit(
  query: { limit?: number; cursor?: string },
  scope: string,
): { limit: number; after: SalesCursorValue | null } {
  const limit = query.limit ?? SALES_PAGE_DEFAULT_LIMIT;
  const errors: FieldError[] = [];
  if (!Number.isInteger(limit) || limit < 1 || limit > SALES_PAGE_MAX_LIMIT) {
    errors.push({ path: 'query.limit', message: `Use de 1 a ${SALES_PAGE_MAX_LIMIT}.` });
  }
  let after: SalesCursorValue | null = null;
  if (query.cursor !== undefined) {
    const decoded = decodeSalesCursor(query.cursor, scope);
    if (!decoded) {
      errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
    } else {
      after = decoded;
    }
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  return { limit, after };
}

async function loadPaymentRefunds(
  db: Database,
  paymentId: string,
  orderId: string | null,
): Promise<RefundView[]> {
  const rows = await db
    .selectFrom('refunds')
    .innerJoin('users', 'users.id', 'refunds.requestedBy')
    .selectAll('refunds')
    .select(['users.name as requesterName', 'users.deletedAt as requesterDeletedAt'])
    .where('refunds.paymentId', '=', paymentId)
    .orderBy('refunds.createdAt', 'desc')
    .orderBy('refunds.id', 'desc')
    .execute();
  if (rows.length === 0) return [];

  const titles = new Map<string, string>();
  if (orderId !== null) {
    const items = await db
      .selectFrom('orderItems')
      .select(['id', 'titleSnapshot'])
      .where('orderId', '=', orderId)
      .execute();
    for (const item of items) {
      titles.set(item.id, item.titleSnapshot);
    }
  }

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
        name: row.requesterDeletedAt === null ? row.requesterName : DELETED_USER_NAME,
      },
      createdAt: row.createdAt,
      doneAt: row.doneAt,
    };
  });
}

export function registerPaymentRoutes(app: FastifyInstance, options: PaymentRoutesOptions): void {
  const { db, config } = options;

  // `GET /api/v1/payments`: cobranças de pedidos e assinaturas (`sales.view`, gerente e admin).
  app.operation('listPayments', async (request) => {
    const query = request.query as {
      status?: PaymentStatus;
      method?: PaymentMethod;
      provider?: PaymentProviderName;
      from?: string;
      to?: string;
      orderId?: string;
      subscriptionId?: string;
      limit?: number;
      cursor?: string;
    };
    const { limit, after } = readCursorAndLimit(query, PAYMENTS_CURSOR_SCOPE);
    const dateErrors: FieldError[] = [];
    const fromDate = query.from === undefined ? undefined : new Date(query.from);
    if (fromDate !== undefined && Number.isNaN(fromDate.getTime())) {
      dateErrors.push({ path: 'query.from', message: 'Data inválida.' });
    }
    const toDate = query.to === undefined ? undefined : new Date(query.to);
    if (toDate !== undefined && Number.isNaN(toDate.getTime())) {
      dateErrors.push({ path: 'query.to', message: 'Data inválida.' });
    }
    if (dateErrors.length > 0) {
      throw validationFailed(dateErrors);
    }

    let list = db
      .selectFrom('payments')
      .leftJoin('orders', 'orders.id', 'payments.orderId')
      .select([
        'payments.id',
        'payments.orderId',
        'orders.number as orderNumber',
        'payments.subscriptionId',
        'payments.provider',
        'payments.providerPaymentId',
        'payments.status',
        'payments.method',
        'payments.amountCents',
        'payments.refundedCents',
        'payments.currency',
        'payments.rawStatus',
        'payments.paidAt',
        'payments.createdAt',
        'payments.updatedAt',
      ])
      .orderBy('payments.createdAt', 'desc')
      .orderBy('payments.id', 'desc')
      .limit(limit + 1);

    if (query.status !== undefined) {
      list = list.where('payments.status', '=', query.status);
    }
    if (query.method !== undefined) {
      list = list.where('payments.method', '=', query.method);
    }
    if (query.provider !== undefined) {
      list = list.where('payments.provider', '=', query.provider);
    }
    if (fromDate !== undefined) {
      list = list.where('payments.createdAt', '>=', fromDate);
    }
    if (toDate !== undefined) {
      list = list.where('payments.createdAt', '<', toDate);
    }
    if (query.orderId !== undefined) {
      list = list.where('payments.orderId', '=', query.orderId.toLowerCase());
    }
    if (query.subscriptionId !== undefined) {
      list = list.where('payments.subscriptionId', '=', query.subscriptionId.toLowerCase());
    }
    if (after !== null) {
      list = list.where((eb) =>
        eb.or([
          eb('payments.createdAt', '<', after.createdAt),
          eb.and([
            eb('payments.createdAt', '=', after.createdAt),
            eb('payments.id', '<', after.id),
          ]),
        ]),
      );
    }

    const rows = (await list.execute()) as PaymentRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => paymentBody(toSalesPayment(row))),
      nextCursor:
        hasMore && last ? encodeSalesCursor(PAYMENTS_CURSOR_SCOPE, last.createdAt, last.id) : null,
    };
  });

  // `GET /api/v1/payments/{id}`: detalhe da cobrança com os reembolsos (`sales.view`).
  app.operation('getPayment', async (request) => {
    const { id } = request.params as IdParams;
    if (!isUuid(id)) {
      throw notFound('Cobrança não encontrada.');
    }
    const row = (await db
      .selectFrom('payments')
      .leftJoin('orders', 'orders.id', 'payments.orderId')
      .select([
        'payments.id',
        'payments.orderId',
        'orders.number as orderNumber',
        'payments.subscriptionId',
        'payments.provider',
        'payments.providerPaymentId',
        'payments.status',
        'payments.method',
        'payments.amountCents',
        'payments.refundedCents',
        'payments.currency',
        'payments.rawStatus',
        'payments.paidAt',
        'payments.createdAt',
        'payments.updatedAt',
      ])
      .where('payments.id', '=', id.toLowerCase())
      .executeTakeFirst()) as PaymentRow | undefined;
    if (!row) {
      throw notFound('Cobrança não encontrada.');
    }
    const refunds = await loadPaymentRefunds(db, row.id, row.orderId);
    return {
      ...paymentBody(toSalesPayment(row)),
      refunds: refunds.map(refundBody),
    };
  });

  // `GET /api/v1/webhook-events`: `failed` (padrão, fila operacional) ou `rejected` (trilha de
  // segurança, só leitura), sempre sem corpo ou assinatura (`ops.manage`, só admin).
  app.operation('listWebhookEvents', async (request) => {
    const query = request.query as {
      status?: WebhookListStatus;
      limit?: number;
      cursor?: string;
    };
    const status: WebhookListStatus = query.status ?? 'failed';
    const { limit, after } = readCursorAndLimit(query, WEBHOOK_EVENTS_CURSOR_SCOPE);

    let list = db
      .selectFrom('webhookEvents')
      .select([
        'id',
        'provider',
        'eventId',
        'resourceType',
        'resourceId',
        'status',
        'attempts',
        'error',
        'receivedAt',
        'processedAt',
      ])
      .where('status', '=', status)
      .orderBy('receivedAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);

    if (after !== null) {
      list = list.where((eb) =>
        eb.or([
          eb('webhookEvents.receivedAt', '<', after.createdAt),
          eb.and([
            eb('webhookEvents.receivedAt', '=', after.createdAt),
            eb('webhookEvents.id', '<', after.id),
          ]),
        ]),
      );
    }

    const rows = (await list.execute()) as WebhookEventRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(webhookEventBody),
      nextCursor:
        hasMore && last
          ? encodeSalesCursor(WEBHOOK_EVENTS_CURSOR_SCOPE, last.receivedAt, last.id)
          : null,
    };
  });

  // `POST /api/v1/webhook-events/{id}/retry`: só `admin` (`ops.manage`) e somente `failed`.
  // `rejected` (assinatura inválida) e os demais estados respondem `409 webhook_event_not_retryable`.
  app.operation('retryWebhookEvent', async (request, reply) => {
    const { id } = request.params as IdParams;
    if (!isUuid(id)) {
      throw notFound('Evento de webhook não encontrado.');
    }
    const context = managementAuditContext(managementRequest(request));
    const saved = await db.transaction().execute(async (trx) => {
      const row = (await trx
        .selectFrom('webhookEvents')
        .select([
          'id',
          'provider',
          'eventId',
          'resourceType',
          'resourceId',
          'status',
          'attempts',
          'error',
          'receivedAt',
          'processedAt',
        ])
        .where('id', '=', id.toLowerCase())
        .forUpdate()
        .executeTakeFirst()) as WebhookEventRow | undefined;
      if (!row) {
        throw notFound('Evento de webhook não encontrado.');
      }
      if (row.status !== 'failed') {
        throw conflict(
          'webhook_event_not_retryable',
          'Só um aviso de pagamento com falha operacional pode ser reprocessado.',
        );
      }
      const updated = (await trx
        .updateTable('webhookEvents')
        .set({ status: 'received', attempts: 0, error: null, processedAt: null })
        .where('id', '=', row.id)
        .where('status', '=', 'failed')
        .returning([
          'id',
          'provider',
          'eventId',
          'resourceType',
          'resourceId',
          'status',
          'attempts',
          'error',
          'receivedAt',
          'processedAt',
        ])
        .executeTakeFirstOrThrow()) as WebhookEventRow;
      await enqueuePaymentWebhook(trx, row.id);
      await recordAudit(trx, {
        context,
        action: 'webhook_event.retry',
        targetType: 'webhook_event',
        targetId: row.id,
        details: {
          provider: row.provider,
          eventId: row.eventId,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          previousError: row.error,
        },
      });
      return updated;
    });
    return reply.status(202).send(webhookEventBody(saved));
  });

  // `GET /api/v1/settings/payments`: estado da integração, modo de teste, aviso de produção com
  // token de teste e última reconciliação concluída (`settings.manage`, só admin; spec 013).
  app.operation('getPaymentSettings', async () => {
    const provider = configuredPaymentProviderName(config);
    const testMode = isPaymentTestMode(config);
    const productionWarning = config.env === 'production' && testMode;
    const lastReconciliation = await db
      .selectFrom('jobs')
      .select((eb) => eb.fn.max('finishedAt').as('finishedAt'))
      .where('type', '=', 'payment.reconcile_orders')
      .where('status', '=', 'done')
      .executeTakeFirst();
    return {
      provider,
      testMode,
      productionWarning,
      lastReconciliationAt: isoOrNull(lastReconciliation?.finishedAt ?? null),
    };
  });
}
