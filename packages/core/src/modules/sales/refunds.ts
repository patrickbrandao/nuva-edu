import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  type DomainError,
  type FieldError,
  isDomainError,
  notFound,
  validationFailed,
} from '../../errors/domain-error.ts';
import {
  type ManagementRequest,
  managementAuditContext,
  requirePermission,
} from '../accounts/management/common.ts';
import { recordAudit } from '../audit/record.ts';
import { revokeOrderEntitlements } from '../entitlements/order.ts';
import type { EntitlementRevokeReason } from '../entitlements/types.ts';
import { enqueueRefundExecute } from '../jobs/sales.ts';
import { notify } from '../notifications/central.ts';
import type { PaymentProvider } from '../payments/types.ts';
import {
  paymentNotRefundable,
  refundNotFound,
  subscriptionPaymentNotFound,
} from '../subscriptions/errors.ts';
import { endSubscription, isCurrentPeriodPayment } from '../subscriptions/lifecycle.ts';
import { orderNotRefundable, refundExceedsPaid, refundNotRetryable } from './errors.ts';
import type { RefundItemAmount, SalesOrderItem } from './types.ts';
import {
  cents,
  REFUNDABLE_ORDER_STATUSES,
  type RefundStatus,
  type RefundView,
  readRefundItems,
  serializeRefundItems,
} from './types.ts';

// Reembolsos de pedido e de cobrança recorrente (spec 011, "Reembolso"; spec 012, "Reembolso de
// cobrança"; spec 013, "Processamento no worker"). Dono da escrita: `admin-api` cria o pedido de
// reembolso; o `worker` executa o estorno e aplica o efeito (revogação, estado do pedido ou da
// assinatura). A leitura é usada pelo detalhe do pedido e da assinatura (tarefas 554/555).

const REFUND_REASON_MAX_LENGTH = 500;
const REFUND_ERROR_MAX_LENGTH = 2_000;
const PROVIDER_REFUND_REASON = 'Estorno no provedor';
const ORDER_ITEM_CHUNK = 100;

export interface RefundItemInput {
  orderItemId: string;
  amountCents: number;
}

export interface RequestOrderRefundInput {
  orderId: string;
  /** Motivo informado pelo admin, 1 a 500 caracteres. */
  reason: string;
  /** `null`/ausente reembolsa o pedido inteiro pelo saldo de cada item. */
  items?: readonly RefundItemInput[] | null;
  now?: Date;
}

export interface RequestSubscriptionRefundInput {
  subscriptionId: string;
  paymentId: string;
  reason: string;
  /** `null`/ausente estorna o saldo não reembolsado da cobrança. */
  amountCents?: number | null;
  now?: Date;
}

interface RefundRow {
  id: string;
  orderId: string | null;
  paymentId: string;
  items: unknown;
  amountCents: string | number | bigint;
  reason: string;
  status: string;
  providerRefundId: string | null;
  error: string | null;
  requestedBy: string;
  createdAt: Date;
  doneAt: Date | null;
}

interface RefundViewRow extends RefundRow {
  requesterName: string;
  requesterDeletedAt: Date | null;
}

/**
 * Pede o reembolso de um pedido inteiro ou de itens (`POST /orders/{id}/refunds`). Só o admin
 * (`order.refund`); o pedido precisa estar `paid` ou `partially_refunded` e cada valor, dentro do
 * pago e ainda não reembolsado do item. Cria uma linha `requested` e enfileira `refund.execute`.
 */
export async function requestOrderRefund(
  db: Database,
  request: ManagementRequest,
  input: RequestOrderRefundInput,
): Promise<RefundView> {
  await requirePermission(db, request, 'order.refund', { action: 'refund.request' });
  const reason = normalizeReason(input.reason);
  const now = input.now ?? new Date();

  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom('orders')
      .select(['id', 'userId', 'status'])
      .where('id', '=', input.orderId.toLowerCase())
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw notFound('Pedido não encontrado.');
    if (!(REFUNDABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      throw orderNotRefundable();
    }
    const items = await loadOrderItems(trx, order.id);
    const payment = await trx
      .selectFrom('payments')
      .select(['id', 'status'])
      .where('orderId', '=', order.id)
      .where('status', 'in', ['approved', 'partially_refunded'])
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    if (!payment) throw orderNotRefundable();

    const lines = resolveRefundLines(items, input.items ?? null);
    const amountCents = lines.reduce((total, line) => total + line.amountCents, 0);
    if (amountCents <= 0) throw orderNotRefundable('O pedido já foi reembolsado por inteiro.');

    const inserted = await trx
      .insertInto('refunds')
      .values({
        orderId: order.id,
        paymentId: payment.id,
        items: JSON.stringify(serializeRefundItems(lines)),
        amountCents,
        reason,
        status: 'requested',
        requestedBy: request.actor.id,
        createdAt: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await enqueueRefundExecute(trx, inserted.id);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'refund.request',
      targetType: 'order',
      targetId: order.id,
      details: {
        refundId: inserted.id,
        paymentId: payment.id,
        amountCents,
        items: lines,
      },
    });
    return loadRefundView(trx, inserted.id);
  });
}

/**
 * Pede o reembolso de uma cobrança recorrente (`POST /subscriptions/{id}/payments/{paymentId}/refund`).
 * Só o admin (`order.refund`). Cobrança fora de `approved`/`partially_refunded`, ou já estornada
 * por inteiro: `409`; valor acima do saldo: `422`. Reembolso de cobrança recorrente tem
 * `order_id` nulo e `items` vazio.
 */
export async function requestSubscriptionRefund(
  db: Database,
  request: ManagementRequest,
  input: RequestSubscriptionRefundInput,
): Promise<RefundView> {
  await requirePermission(db, request, 'order.refund', { action: 'refund.request' });
  const reason = normalizeReason(input.reason);
  const now = input.now ?? new Date();

  return db.transaction().execute(async (trx) => {
    const subscription = await trx
      .selectFrom('subscriptions')
      .select(['id'])
      .where('id', '=', input.subscriptionId.toLowerCase())
      .forUpdate()
      .executeTakeFirst();
    if (!subscription) throw subscriptionPaymentNotFound();
    const payment = await trx
      .selectFrom('payments')
      .select(['id', 'status', 'amountCents', 'refundedCents'])
      .where('id', '=', input.paymentId.toLowerCase())
      .where('subscriptionId', '=', subscription.id)
      .executeTakeFirst();
    if (!payment) throw subscriptionPaymentNotFound();
    if (payment.status !== 'approved' && payment.status !== 'partially_refunded') {
      throw paymentNotRefundable();
    }
    const balance = cents(payment.amountCents) - cents(payment.refundedCents);
    if (balance <= 0) throw paymentNotRefundable('Esta cobrança já foi reembolsada por inteiro.');
    const amountCents = input.amountCents ?? balance;
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw validationFailed([
        { path: 'amountCents', message: 'deve ser um inteiro positivo em centavos' },
      ]);
    }
    if (amountCents > balance) {
      throw refundExceedsPaid('O valor passa do saldo não reembolsado desta cobrança.');
    }

    const inserted = await trx
      .insertInto('refunds')
      .values({
        orderId: null,
        paymentId: payment.id,
        items: JSON.stringify(serializeRefundItems([])),
        amountCents,
        reason,
        status: 'requested',
        requestedBy: request.actor.id,
        createdAt: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await enqueueRefundExecute(trx, inserted.id);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'refund.request',
      targetType: 'subscription',
      targetId: subscription.id,
      details: { refundId: inserted.id, paymentId: payment.id, amountCents },
    });
    return loadRefundView(trx, inserted.id);
  });
}

/**
 * Executa o estorno no provedor (`refund.execute`). `approved` conclui na hora; `pending` guarda
 * o `provider_refund_id` e espera a reconciliação; falha do provedor deixa o reembolso `failed`
 * com a mensagem, sem revogar nada. Repetir sobre um reembolso já concluído não faz nada.
 */
export async function executeRefund(
  db: Database,
  provider: PaymentProvider,
  refundId: string,
  options: { now?: Date } = {},
): Promise<RefundView> {
  const now = options.now ?? new Date();
  const refund = await db
    .selectFrom('refunds')
    .selectAll()
    .where('id', '=', refundId.toLowerCase())
    .executeTakeFirst();
  if (!refund) throw refundNotFound();
  if (refund.status !== 'requested') return loadRefundView(db, refund.id);
  const payment = await db
    .selectFrom('payments')
    .select(['id', 'providerPaymentId'])
    .where('id', '=', refund.paymentId)
    .executeTakeFirst();
  if (!payment) throw refundNotFound();

  let result: Awaited<ReturnType<PaymentProvider['refund']>>;
  try {
    result = await provider.refund(payment.providerPaymentId, cents(refund.amountCents));
  } catch (error) {
    await markFailed(db, refund.id, describeError(error), now);
    return loadRefundView(db, refund.id);
  }
  if (result.status === 'rejected') {
    await markFailed(db, refund.id, 'O provedor recusou o estorno.', now);
    return loadRefundView(db, refund.id);
  }
  if (result.status === 'pending') {
    await db
      .updateTable('refunds')
      .set({ providerRefundId: result.providerRefundId })
      .where('id', '=', refund.id)
      .where('status', '=', 'requested')
      .execute();
    return loadRefundView(db, refund.id);
  }
  return db
    .transaction()
    .execute((trx) =>
      completeRefundInTransaction(trx, refund.id, result.providerRefundId, result.amountCents, now),
    );
}

/** Volta um reembolso `failed` para a fila (`POST /refunds/{id}/retry`), com os mesmos itens. */
export async function retryRefund(
  db: Database,
  request: ManagementRequest,
  refundId: string,
): Promise<RefundView> {
  await requirePermission(db, request, 'order.refund', { action: 'refund.retry' });
  if (!isUuidLike(refundId)) throw refundNotFound();
  return db.transaction().execute(async (trx) => {
    const refund = await trx
      .selectFrom('refunds')
      .selectAll()
      .where('id', '=', refundId.toLowerCase())
      .forUpdate()
      .executeTakeFirst();
    if (!refund) throw refundNotFound();
    if (refund.status !== 'failed') throw refundNotRetryable();
    await trx
      .updateTable('refunds')
      .set({ status: 'requested', error: null, doneAt: null, providerRefundId: null })
      .where('id', '=', refund.id)
      .execute();
    await enqueueRefundExecute(trx, refund.id);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'refund.retry',
      targetType: 'refund',
      targetId: refund.id,
      details: { orderId: refund.orderId, paymentId: refund.paymentId },
    });
    return loadRefundView(trx, refund.id);
  });
}

/**
 * Conclui o reembolso a partir do estado do provedor (`refunded`/`partially_refunded` no
 * webhook ou na reconciliação). Cobre o estorno feito direto no painel do provedor: o que o
 * `payments.refunded_cents` mostra além dos reembolsos já concluídos vira uma linha `done` com
 * motivo `Estorno no provedor`; pedidos pendentes cobertos pelo valor são concluídos primeiro.
 */
export async function applyProviderPaymentRefund(
  db: Database,
  paymentId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', paymentId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) return;
    const target = cents(payment.refundedCents);
    if (target <= 0) return;
    const refunds = await trx
      .selectFrom('refunds')
      .selectAll()
      .where('paymentId', '=', payment.id)
      .orderBy('createdAt')
      .orderBy('id')
      .execute();
    let done = refunds
      .filter((row) => row.status === 'done')
      .reduce((total, row) => total + cents(row.amountCents), 0);
    for (const row of refunds) {
      if (row.status !== 'requested') continue;
      if (done + cents(row.amountCents) > target) continue;
      await completeRefundInTransaction(
        trx,
        row.id,
        row.providerRefundId,
        cents(row.amountCents),
        now,
        { recomputePayment: false },
      );
      done += cents(row.amountCents);
    }
    if (target <= done) return;
    const amountCents = target - done;
    const owner = await loadPaymentOwner(trx, payment);
    const inserted = await trx
      .insertInto('refunds')
      .values({
        orderId: payment.orderId,
        paymentId: payment.id,
        items: JSON.stringify(
          serializeRefundItems(await allocateProviderRefund(trx, payment, amountCents)),
        ),
        amountCents,
        reason: PROVIDER_REFUND_REASON,
        status: 'requested',
        requestedBy: owner.userId,
        createdAt: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await completeRefundInTransaction(trx, inserted.id, null, amountCents, now, {
      recomputePayment: false,
    });
  });
}

/**
 * Contestação (`charged_back`): o pedido vira `chargeback` e todas as raízes do pedido são
 * revogadas; a assinatura encerra na hora e tem os direitos revogados. O valor é do provedor:
 * não há linha em `refunds`.
 */
export async function applyChargeback(
  db: Database,
  paymentId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', paymentId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) return;
    if (payment.subscriptionId !== null) {
      const subscription = await trx
        .selectFrom('subscriptions')
        .select(['id', 'userId'])
        .where('id', '=', payment.subscriptionId)
        .executeTakeFirst();
      if (!subscription) return;
      const result = await endSubscription(trx, subscription.id, 'chargeback', now);
      if (result.ended) {
        await recordAudit(trx, {
          context: { origin: 'worker' },
          action: 'subscription.chargeback',
          targetType: 'subscription',
          targetId: subscription.id,
          details: { paymentId: payment.id },
        });
      }
      return;
    }
    if (payment.orderId === null) return;
    const order = await trx
      .selectFrom('orders')
      .select(['id', 'userId', 'status'])
      .where('id', '=', payment.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) return;
    await trx
      .updateTable('orders')
      .set({ status: 'chargeback' })
      .where('id', '=', order.id)
      .execute();
    const revoked = await revokeOrderEntitlements(trx, order.id, 'chargeback');
    await notify(trx, 'order.refunded', order.userId, {
      targetType: 'order',
      targetId: order.id,
      data: { reason: 'chargeback', amountCents: cents(payment.amountCents) },
    });
    await recordAudit(trx, {
      context: { origin: 'worker' },
      action: 'order.chargeback',
      targetType: 'order',
      targetId: order.id,
      details: { paymentId: payment.id, revoked },
    });
  });
}

interface CompleteRefundOptions {
  /** Recalcula `payments.refunded_cents` a partir das linhas concluídas. Padrão: `true`. */
  recomputePayment?: boolean;
}

async function completeRefundInTransaction(
  trx: Database,
  refundId: string,
  providerRefundId: string | null,
  amountCents: number,
  now: Date,
  options: CompleteRefundOptions = {},
): Promise<RefundView> {
  const refund = await trx
    .selectFrom('refunds')
    .selectAll()
    .where('id', '=', refundId)
    .forUpdate()
    .executeTakeFirst();
  if (!refund) throw refundNotFound();
  if (refund.status === 'done') return loadRefundView(trx, refund.id);
  if (refund.status !== 'requested') throw paymentNotRefundable();

  await trx
    .updateTable('refunds')
    .set({
      status: 'done',
      doneAt: now,
      error: null,
      ...(providerRefundId !== null ? { providerRefundId } : {}),
    })
    .where('id', '=', refund.id)
    .execute();

  const payment = await trx
    .selectFrom('payments')
    .selectAll()
    .where('id', '=', refund.paymentId)
    .forUpdate()
    .executeTakeFirst();
  if (!payment) throw refundNotFound();

  if (options.recomputePayment !== false) {
    const done = await trx
      .selectFrom('refunds')
      .select(['amountCents'])
      .where('paymentId', '=', payment.id)
      .where('status', '=', 'done')
      .execute();
    const refunded = Math.min(
      cents(payment.amountCents),
      done.reduce((total, row) => total + cents(row.amountCents), 0),
    );
    await trx
      .updateTable('payments')
      .set({
        refundedCents: refunded,
        status: refunded >= cents(payment.amountCents) ? 'refunded' : 'partially_refunded',
      })
      .where('id', '=', payment.id)
      .execute();
  }

  if (payment.subscriptionId !== null) {
    await applySubscriptionRefundEffect(trx, payment.id, amountCents, now);
  } else if (payment.orderId !== null) {
    await applyOrderRefundEffect(trx, refund, payment.orderId, now);
  }
  await recordAudit(trx, {
    context: { origin: 'worker' },
    action: 'refund.done',
    targetType: 'refund',
    targetId: refund.id,
    details: {
      orderId: refund.orderId,
      paymentId: refund.paymentId,
      amountCents: cents(refund.amountCents),
    },
  });
  return loadRefundView(trx, refund.id);
}

async function applySubscriptionRefundEffect(
  trx: Database,
  paymentId: string,
  _amountCents: number,
  now: Date,
): Promise<void> {
  const payment = await trx
    .selectFrom('payments')
    .select(['id', 'subscriptionId', 'amountCents', 'refundedCents'])
    .where('id', '=', paymentId)
    .executeTakeFirst();
  if (!payment || payment.subscriptionId === null) return;
  // Só o estorno que fecha a cobrança do período em curso encerra a assinatura (spec 012).
  if (cents(payment.refundedCents) < cents(payment.amountCents)) return;
  const subscription = await trx
    .selectFrom('subscriptions')
    .select(['id', 'userId', 'status', 'currentPeriodStart'])
    .where('id', '=', payment.subscriptionId)
    .executeTakeFirst();
  if (!subscription) return;
  if (!(await isCurrentPeriodPayment(trx, subscription, payment.id))) return;
  const result = await endSubscription(trx, subscription.id, 'refund', now);
  if (result.ended) {
    await notify(trx, 'subscription.canceled', subscription.userId, {
      targetType: 'subscription',
      targetId: subscription.id,
      data: { reason: 'refund' },
    });
  }
}

async function applyOrderRefundEffect(
  trx: Database,
  refund: RefundRow,
  orderId: string,
  now: Date,
): Promise<void> {
  const lines = readRefundItems(refund.items as never);
  const itemIds: string[] = [];
  for (const line of lines) {
    const updated = await trx
      .updateTable('orderItems')
      .set({ refundedCents: sql<number>`refunded_cents + ${line.amountCents}` })
      .where('id', '=', line.orderItemId)
      .where('orderId', '=', orderId)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows ?? 0n) > 0) itemIds.push(line.orderItemId);
  }
  await revokeRefundedOrderItems(trx, orderId, itemIds);

  const items = await trx
    .selectFrom('orderItems')
    .select(['paidCents', 'refundedCents'])
    .where('orderId', '=', orderId)
    .execute();
  const fullyRefunded =
    items.length > 0 && items.every((item) => cents(item.refundedCents) >= cents(item.paidCents));
  const order = await trx
    .selectFrom('orders')
    .select(['id', 'userId'])
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (!order) return;
  await trx
    .updateTable('orders')
    .set({ status: fullyRefunded ? 'refunded' : 'partially_refunded' })
    .where('id', '=', order.id)
    .execute();
  await notify(trx, 'order.refunded', order.userId, {
    targetType: 'order',
    targetId: order.id,
    data: {
      amountCents: cents(refund.amountCents),
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      reason: refund.reason,
    },
  });
  void now;
}

async function revokeRefundedOrderItems(
  trx: Database,
  orderId: string,
  itemIds: readonly string[],
): Promise<void> {
  for (let index = 0; index < itemIds.length; index += ORDER_ITEM_CHUNK) {
    const chunk = itemIds.slice(index, index + ORDER_ITEM_CHUNK);
    await revokeOrderEntitlements(trx, orderId, 'refund' as EntitlementRevokeReason, {
      orderItemIds: chunk,
    });
  }
}

async function loadPaymentOwner(
  trx: Database,
  payment: { orderId: string | null; subscriptionId: string | null },
): Promise<{ userId: string }> {
  if (payment.subscriptionId !== null) {
    const row = await trx
      .selectFrom('subscriptions')
      .select('userId')
      .where('id', '=', payment.subscriptionId)
      .executeTakeFirst();
    if (row) return { userId: row.userId };
  }
  if (payment.orderId !== null) {
    const row = await trx
      .selectFrom('orders')
      .select('userId')
      .where('id', '=', payment.orderId)
      .executeTakeFirst();
    if (row) return { userId: row.userId };
  }
  throw refundNotFound();
}

async function allocateProviderRefund(
  trx: Database,
  payment: { orderId: string | null },
  amountCents: number,
): Promise<RefundItemAmount[]> {
  if (payment.orderId === null) return [];
  const items = await loadOrderItems(trx, payment.orderId);
  const lines: RefundItemAmount[] = [];
  let remaining = amountCents;
  for (const item of items) {
    if (remaining <= 0) break;
    const balance = item.paidCents - item.refundedCents;
    if (balance <= 0) continue;
    const amount = Math.min(balance, remaining);
    lines.push({ orderItemId: item.id, amountCents: amount });
    remaining -= amount;
  }
  return lines;
}

async function markFailed(
  db: Database,
  refundId: string,
  message: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('refunds')
    .set({ status: 'failed', error: truncate(message, REFUND_ERROR_MAX_LENGTH), updatedAt: now })
    .where('id', '=', refundId)
    .where('status', '=', 'requested')
    .execute();
  await recordAudit(db, {
    context: { origin: 'worker' },
    action: 'refund.failed',
    targetType: 'refund',
    targetId: refundId,
    details: { error: truncate(message, REFUND_ERROR_MAX_LENGTH) },
  });
}

function resolveRefundLines(
  items: readonly SalesOrderItem[],
  requested: readonly RefundItemInput[] | null,
): RefundItemAmount[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (requested === null) {
    return items
      .map((item) => ({ orderItemId: item.id, amountCents: item.paidCents - item.refundedCents }))
      .filter((line) => line.amountCents > 0);
  }
  if (requested.length === 0) throw refundExceedsPaid('Escolha ao menos um item para reembolsar.');
  const lines: RefundItemAmount[] = [];
  const seen = new Set<string>();
  for (const line of requested) {
    const item = byId.get(line.orderItemId.toLowerCase());
    if (!item) throw refundExceedsPaid('Há item que não pertence a este pedido.');
    if (seen.has(item.id)) throw refundExceedsPaid('O mesmo item aparece mais de uma vez.');
    seen.add(item.id);
    const balance = item.paidCents - item.refundedCents;
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) {
      throw refundExceedsPaid('O valor do item deve ser um inteiro positivo em centavos.');
    }
    if (line.amountCents > balance) throw refundExceedsPaid();
    lines.push({ orderItemId: item.id, amountCents: line.amountCents });
  }
  return lines;
}

async function loadOrderItems(db: Database, orderId: string): Promise<SalesOrderItem[]> {
  const rows = await db
    .selectFrom('orderItems')
    .selectAll()
    .where('orderId', '=', orderId)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    productType: row.productType as SalesOrderItem['productType'],
    productId: row.productId,
    title: row.titleSnapshot,
    accessDays: row.accessDaysSnapshot,
    unitPriceCents: cents(row.unitPriceCents),
    discountCents: cents(row.discountCents),
    paidCents: cents(row.paidCents),
    refundedCents: cents(row.refundedCents),
  }));
}

function normalizeReason(reason: unknown): string {
  const value = typeof reason === 'string' ? reason.trim() : '';
  const errors: FieldError[] = [];
  if (value === '' || value.length > REFUND_REASON_MAX_LENGTH) {
    errors.push({
      path: 'reason',
      message: `deve ter de 1 a ${REFUND_REASON_MAX_LENGTH} caracteres`,
    });
  }
  if (errors.length > 0) throw validationFailed(errors);
  return value;
}

/** Reembolsos de um pedido, do mais novo para o mais antigo. */
export async function loadOrderRefunds(db: Database, orderId: string): Promise<RefundView[]> {
  const rows = await db
    .selectFrom('refunds')
    .innerJoin('users', 'users.id', 'refunds.requestedBy')
    .selectAll('refunds')
    .select(['users.name as requesterName', 'users.deletedAt as requesterDeletedAt'])
    .where('orderId', '=', orderId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const titles = await loadOrderItemTitles(db, orderId);
  return rows.map((row) => mapRefundView(row as RefundViewRow, titles));
}

/** Reembolsos de várias cobranças recorrentes, agrupados por `paymentId`. */
export async function loadSubscriptionRefunds(
  db: Database,
  paymentIds: readonly string[],
): Promise<Map<string, RefundView[]>> {
  const map = new Map<string, RefundView[]>();
  if (paymentIds.length === 0) return map;
  const rows = await db
    .selectFrom('refunds')
    .innerJoin('users', 'users.id', 'refunds.requestedBy')
    .selectAll('refunds')
    .select(['users.name as requesterName', 'users.deletedAt as requesterDeletedAt'])
    .where('paymentId', 'in', [...paymentIds])
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  for (const row of rows) {
    const list = map.get(row.paymentId) ?? [];
    list.push(mapRefundView(row as RefundViewRow, new Map()));
    map.set(row.paymentId, list);
  }
  return map;
}

async function loadRefundView(db: Database, refundId: string): Promise<RefundView> {
  const row = await db
    .selectFrom('refunds')
    .innerJoin('users', 'users.id', 'refunds.requestedBy')
    .selectAll('refunds')
    .select(['users.name as requesterName', 'users.deletedAt as requesterDeletedAt'])
    .where('refunds.id', '=', refundId)
    .executeTakeFirst();
  if (!row) throw refundNotFound();
  const titles =
    row.orderId === null ? new Map<string, string>() : await loadOrderItemTitles(db, row.orderId);
  return mapRefundView(row as RefundViewRow, titles);
}

async function loadOrderItemTitles(db: Database, orderId: string): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom('orderItems')
    .select(['id', 'titleSnapshot'])
    .where('orderId', '=', orderId)
    .execute();
  return new Map(rows.map((row) => [row.id, row.titleSnapshot]));
}

function mapRefundView(row: RefundViewRow, titles: Map<string, string>): RefundView {
  return {
    id: row.id,
    orderId: row.orderId,
    paymentId: row.paymentId,
    items: readRefundItems(row.items as never).map((item) => ({
      orderItemId: item.orderItemId,
      title: titles.get(item.orderItemId) ?? 'item removido',
      amountCents: item.amountCents,
    })),
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
}

function describeError(error: unknown): string {
  if (isDomainError(error)) {
    return truncate((error as DomainError).detail ?? error.message, REFUND_ERROR_MAX_LENGTH);
  }
  if (error instanceof Error) return truncate(error.message, REFUND_ERROR_MAX_LENGTH);
  return 'Falha ao estornar no provedor.';
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim() === '' ? 'Falha ao estornar no provedor.' : value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
