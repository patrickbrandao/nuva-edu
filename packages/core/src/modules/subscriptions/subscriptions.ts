import type { Database } from '../../db/database.ts';
import { type FieldError, validationFailed } from '../../errors/domain-error.ts';
import {
  type ManagementRequest,
  managementAuditContext,
  requirePermission,
} from '../accounts/management/common.ts';
import { recordAudit } from '../audit/record.ts';
import { notify } from '../notifications/central.ts';
import type { PaymentMethod, PaymentProvider, PaymentStatus } from '../payments/types.ts';
import { assertPurchaseAllowed } from '../sales/cart.ts';
import { loadSubscriptionRefunds } from '../sales/refunds.ts';
import {
  cents,
  decodeSalesCursor,
  encodeSalesCursor,
  isUuid,
  SALES_PAGE_DEFAULT_LIMIT,
  SALES_PAGE_MAX_LIMIT,
  SALES_QUERY_MAX_LENGTH,
  type SalesCursorValue,
  type SalesPage,
  type SalesPayment,
} from '../sales/types.ts';
import { subscriptionNotCancelable, subscriptionNotFound } from './errors.ts';
import {
  endSubscription,
  findCurrentPeriodPaymentId,
  loadSubscriptionRecord,
  type SubscriptionRecord,
  suspendSubscription,
} from './lifecycle.ts';
import { findPlan, findPublicPlan } from './plans.ts';
import {
  isSubscriptionLifecycleStatus,
  type MySubscriptionDetail,
  type MySubscriptionSummary,
  type MySubscriptionsQuery,
  nextChargeAt,
  SUBSCRIPTION_CANCEL_REASON_MAX_LENGTH,
  SUBSCRIPTION_PENDING_MINUTES,
  SUBSCRIPTION_SELF_CANCEL_REASON,
  SUBSCRIPTION_SUSPENDED_END_DAYS,
  type SubscriptionCharge,
  type SubscriptionDetail,
  type SubscriptionLifecycleStatus,
  type SubscriptionPaymentDetail,
  type SubscriptionPlanRef,
  type SubscriptionQuery,
  type SubscriptionSummary,
  type SubscriptionUser,
  toMyPlanRef,
  toPlanRef,
} from './types.ts';

// Consultas e ciclo de vida da assinatura (spec 012, "Assinar", "Ciclo de vida" e "Interfaces e
// contratos"). A escrita do estado pelo pagamento é do worker (`payments/subscription-transitions`);
// aqui ficam a criação (classroom-api), o cancelamento do aluno e do admin, a expiração da
// `pending` e as varreduras de carência/suspensão. Nenhuma regra de acesso é reimplementada na API.

const MY_CURSOR = 'my-subscriptions';
const ADMIN_CURSOR = 'admin-subscriptions';

interface SubscriptionRow {
  id: string;
  userId: string;
  planId: string;
  status: string;
  priceCents: string | number | bigint;
  currency: string;
  couponId: string | null;
  provider: string;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  endedAt: Date | null;
  createdAt: Date;
  planTitle: string;
  planSlug: string;
  planInterval: string;
}

interface AdminSubscriptionRow extends SubscriptionRow {
  subscriberName: string;
  subscriberEmail: string;
  subscriberDeletedAt: Date | null;
  couponCode: string | null;
}

interface PaymentRow {
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
}

function toMySummary(row: SubscriptionRow): MySubscriptionSummary {
  return {
    id: row.id,
    plan: toMyPlanRef({
      id: row.planId,
      slug: row.planSlug,
      title: row.planTitle,
      interval: row.planInterval,
    }),
    status: row.status as SubscriptionLifecycleStatus,
    priceCents: cents(row.priceCents),
    currency: row.currency,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    graceUntil: row.graceUntil,
    nextChargeAt: nextChargeAt(row.status as SubscriptionLifecycleStatus, row.currentPeriodEnd),
    canceledAt: row.canceledAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

function toPlanLink(row: SubscriptionRow): SubscriptionPlanRef {
  return toPlanRef({ id: row.planId, title: row.planTitle, interval: row.planInterval });
}

function toSubscriber(row: AdminSubscriptionRow): SubscriptionUser {
  return {
    id: row.userId,
    name: row.subscriberDeletedAt === null ? row.subscriberName : 'usuário removido',
    email: row.subscriberEmail,
  };
}

function toAdminSummary(row: AdminSubscriptionRow): SubscriptionSummary {
  return {
    id: row.id,
    subscriber: toSubscriber(row),
    plan: toPlanLink(row),
    status: row.status as SubscriptionLifecycleStatus,
    priceCents: cents(row.priceCents),
    currency: row.currency,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    graceUntil: row.graceUntil,
    nextChargeAt: nextChargeAt(row.status as SubscriptionLifecycleStatus, row.currentPeriodEnd),
    canceledAt: row.canceledAt,
    cancelReason: row.cancelReason,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

function toCharge(row: PaymentRow): SubscriptionCharge {
  return {
    id: row.id,
    status: row.status as PaymentStatus,
    method: row.method as PaymentMethod,
    amountCents: cents(row.amountCents),
    refundedCents: cents(row.refundedCents),
    currency: row.currency,
    provider: row.provider as SalesPayment['provider'],
    providerPaymentId: row.providerPaymentId,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

function toSalesPayment(row: PaymentRow): SalesPayment {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: null,
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

interface PageParams {
  status?: SubscriptionLifecycleStatus;
  limit: number;
  after?: SalesCursorValue;
}

function readPageParams(query: MySubscriptionsQuery, scope: string): PageParams {
  const errors: FieldError[] = [];
  let status: SubscriptionLifecycleStatus | undefined;
  if (query.status !== undefined) {
    if (isSubscriptionLifecycleStatus(query.status)) status = query.status;
    else errors.push({ path: 'status', message: 'valor inválido' });
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
    limit,
    ...(status !== undefined ? { status } : {}),
    ...(after !== undefined ? { after } : {}),
  };
}

const PLAN_COLUMNS = [
  'plans.title as planTitle',
  'plans.slug as planSlug',
  'plans.interval as planInterval',
] as const;

/** As assinaturas do próprio aluno (`GET /me/subscriptions`), da mais nova para a mais antiga. */
export async function listMySubscriptions(
  db: Database,
  userId: string,
  query: MySubscriptionsQuery = {},
): Promise<SalesPage<MySubscriptionSummary>> {
  await assertPurchaseAllowed(db, userId);
  const params = readPageParams(query, MY_CURSOR);
  let statement = db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .selectAll('subscriptions')
    .select(PLAN_COLUMNS)
    .where('subscriptions.userId', '=', userId);
  if (params.status !== undefined) {
    statement = statement.where('subscriptions.status', '=', params.status);
  }
  if (params.after !== undefined) {
    const after = params.after;
    statement = statement.where((eb) =>
      eb.or([
        eb('subscriptions.createdAt', '<', after.createdAt),
        eb.and([
          eb('subscriptions.createdAt', '=', after.createdAt),
          eb('subscriptions.id', '<', after.id),
        ]),
      ]),
    );
  }
  const rows = await statement
    .orderBy('subscriptions.createdAt', 'desc')
    .orderBy('subscriptions.id', 'desc')
    .limit(params.limit + 1)
    .execute();
  const page = rows.slice(0, params.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toMySummary(row as SubscriptionRow)),
    nextCursor:
      rows.length > params.limit && last
        ? encodeSalesCursor(MY_CURSOR, last.createdAt, last.id)
        : null,
  };
}

/** A assinatura do aluno com cobranças (`GET /me/subscriptions/{id}`); de outro aluno é `404`. */
export async function getMySubscription(
  db: Database,
  userId: string,
  subscriptionId: string,
): Promise<MySubscriptionDetail> {
  await assertPurchaseAllowed(db, userId);
  if (!isUuid(subscriptionId)) throw subscriptionNotFound();
  const row = await db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .selectAll('subscriptions')
    .select(PLAN_COLUMNS)
    .where('subscriptions.id', '=', subscriptionId.toLowerCase())
    .where('subscriptions.userId', '=', userId)
    .executeTakeFirst();
  if (!row) throw subscriptionNotFound();
  const subscriptionRow = row as SubscriptionRow;
  const plan = await findPublicPlan(db, subscriptionRow.planId);
  if (!plan) throw subscriptionNotFound();
  const payments = await db
    .selectFrom('payments')
    .selectAll()
    .where('subscriptionId', '=', subscriptionRow.id)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return {
    ...toMySummary(subscriptionRow),
    plan,
    payments: payments.map((payment) => toCharge(payment as PaymentRow)),
  };
}

/** Lista do admin (`GET /subscriptions`); `instructor` recebe `403`. */
export async function listAdminSubscriptions(
  db: Database,
  request: ManagementRequest,
  query: SubscriptionQuery = {},
): Promise<SalesPage<SubscriptionSummary>> {
  await requirePermission(db, request, 'sales.view', { action: 'subscription.list' });
  const params = readPageParams(query, ADMIN_CURSOR);
  const errors: FieldError[] = [];
  const from = readDate(query.from, 'from', errors);
  const to = readDate(query.to, 'to', errors);
  const planId = readUuid(query.planId, 'planId', errors);
  const userId = readUuid(query.userId, 'userId', errors);
  let q: string | undefined;
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.trim() === '') {
      errors.push({ path: 'q', message: 'deve ser um texto' });
    } else if (query.q.trim().length > SALES_QUERY_MAX_LENGTH) {
      errors.push({ path: 'q', message: `deve ter até ${SALES_QUERY_MAX_LENGTH} caracteres` });
    } else {
      q = query.q.trim();
    }
  }
  if (errors.length > 0) throw validationFailed(errors);

  let statement = db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .innerJoin('users', 'users.id', 'subscriptions.userId')
    .leftJoin('coupons', 'coupons.id', 'subscriptions.couponId')
    .selectAll('subscriptions')
    .select(PLAN_COLUMNS)
    .select([
      'users.name as subscriberName',
      'users.email as subscriberEmail',
      'users.deletedAt as subscriberDeletedAt',
      'coupons.code as couponCode',
    ]);
  if (params.status !== undefined) {
    statement = statement.where('subscriptions.status', '=', params.status);
  }
  if (from !== undefined) statement = statement.where('subscriptions.createdAt', '>=', from);
  if (to !== undefined) statement = statement.where('subscriptions.createdAt', '<', to);
  if (planId !== undefined) statement = statement.where('subscriptions.planId', '=', planId);
  if (userId !== undefined) statement = statement.where('subscriptions.userId', '=', userId);
  if (q !== undefined) {
    const pattern = `%${escapeLike(q)}%`;
    statement = statement.where((eb) =>
      eb.or([eb('users.name', 'ilike', pattern), eb('users.email', 'ilike', pattern)]),
    );
  }
  if (params.after !== undefined) {
    const after = params.after;
    statement = statement.where((eb) =>
      eb.or([
        eb('subscriptions.createdAt', '<', after.createdAt),
        eb.and([
          eb('subscriptions.createdAt', '=', after.createdAt),
          eb('subscriptions.id', '<', after.id),
        ]),
      ]),
    );
  }
  const rows = await statement
    .orderBy('subscriptions.createdAt', 'desc')
    .orderBy('subscriptions.id', 'desc')
    .limit(params.limit + 1)
    .execute();
  const page = rows.slice(0, params.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toAdminSummary(row as AdminSubscriptionRow)),
    nextCursor:
      rows.length > params.limit && last
        ? encodeSalesCursor(ADMIN_CURSOR, last.createdAt, last.id)
        : null,
  };
}

/** A assinatura no detalhe do admin (`GET /subscriptions/{id}`), com plano e reembolsos. */
export async function getAdminSubscription(
  db: Database,
  request: ManagementRequest,
  subscriptionId: string,
): Promise<SubscriptionDetail> {
  await requirePermission(db, request, 'sales.view', { action: 'subscription.view' });
  if (!isUuid(subscriptionId)) throw subscriptionNotFound();
  const row = await db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .innerJoin('users', 'users.id', 'subscriptions.userId')
    .leftJoin('coupons', 'coupons.id', 'subscriptions.couponId')
    .selectAll('subscriptions')
    .select(PLAN_COLUMNS)
    .select([
      'users.name as subscriberName',
      'users.email as subscriberEmail',
      'users.deletedAt as subscriberDeletedAt',
      'coupons.code as couponCode',
    ])
    .where('subscriptions.id', '=', subscriptionId.toLowerCase())
    .executeTakeFirst();
  if (!row) throw subscriptionNotFound();
  const subscriptionRow = row as AdminSubscriptionRow;
  const plan = await findPlan(db, subscriptionRow.planId);
  if (!plan) throw subscriptionNotFound();

  const payments = await db
    .selectFrom('payments')
    .selectAll()
    .where('subscriptionId', '=', subscriptionRow.id)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const refunds = await loadSubscriptionRefunds(
    db,
    payments.map((payment) => payment.id),
  );
  const paymentDetails: SubscriptionPaymentDetail[] = payments.map((payment) => ({
    ...toSalesPayment(payment as PaymentRow),
    refunds: refunds.get(payment.id) ?? [],
  }));
  const currentPeriodPaymentId = await findCurrentPeriodPaymentId(
    db,
    subscriptionRow.id,
    subscriptionRow.currentPeriodStart,
  );
  return {
    ...toAdminSummary(subscriptionRow),
    plan,
    provider: subscriptionRow.provider as SalesPayment['provider'],
    providerSubscriptionId: subscriptionRow.providerSubscriptionId,
    couponCode: subscriptionRow.couponCode,
    currentPeriodPaymentId,
    payments: paymentDetails,
  };
}

export interface CancelSubscriptionOptions {
  /** Instante da ação; padrão: agora. */
  now?: Date;
}

/** Estados que o aluno pode cancelar; os demais respondem `409`. */
const SELF_CANCELABLE: ReadonlySet<SubscriptionLifecycleStatus> = new Set([
  'pending',
  'active',
  'past_due',
]);

/**
 * Cancela a assinatura do próprio aluno (`POST /me/subscriptions/{id}/cancel`). `pending` vira
 * `expired` (libera assinar o mesmo plano); `active` e `past_due` viram `canceling`, com acesso
 * até `current_period_end` sem carência adicional. Provedor que não confirma: o erro sobe e nada
 * muda (a API responde `503`). `suspended` e os estados terminais respondem `409`.
 */
export async function cancelMySubscription(
  db: Database,
  provider: PaymentProvider,
  userId: string,
  subscriptionId: string,
  options: CancelSubscriptionOptions = {},
): Promise<MySubscriptionDetail> {
  const now = options.now ?? new Date();
  const current = await loadForCancellation(db, subscriptionId, userId);
  if (!SELF_CANCELABLE.has(current.status)) throw subscriptionNotCancelable();
  await cancelWithProvider(provider, current);
  await db
    .transaction()
    .execute((trx) =>
      cancelInTransaction(trx, current.id, 'self', SUBSCRIPTION_SELF_CANCEL_REASON, now),
    );
  return getMySubscription(db, userId, current.id);
}

/**
 * Cancela a assinatura de um aluno (`POST /subscriptions/{id}/cancel`). Só o admin
 * (`subscription.cancel`). Em `suspended`, encerra na hora e revoga; nos demais estados pagos,
 * vai a `canceling`. O motivo é obrigatório e vai para a assinatura e a auditoria.
 */
export async function cancelAdminSubscription(
  db: Database,
  provider: PaymentProvider,
  request: ManagementRequest,
  subscriptionId: string,
  reason: string,
  options: CancelSubscriptionOptions = {},
): Promise<SubscriptionDetail> {
  await requirePermission(db, request, 'subscription.cancel', {
    action: 'subscription.cancel',
  });
  const now = options.now ?? new Date();
  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (normalizedReason === '' || normalizedReason.length > SUBSCRIPTION_CANCEL_REASON_MAX_LENGTH) {
    throw validationFailed([
      {
        path: 'reason',
        message: `deve ter de 1 a ${SUBSCRIPTION_CANCEL_REASON_MAX_LENGTH} caracteres`,
      },
    ]);
  }
  const current = await loadForCancellation(db, subscriptionId);
  if (!['active', 'past_due', 'suspended'].includes(current.status)) {
    throw subscriptionNotCancelable();
  }
  await cancelWithProvider(provider, current);
  await db.transaction().execute(async (trx) => {
    const result = await cancelInTransaction(trx, current.id, 'admin', normalizedReason, now);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'subscription.cancel',
      targetType: 'subscription',
      targetId: current.id,
      details: {
        reason: normalizedReason,
        previousStatus: result.previousStatus,
        status: result.status,
      },
    });
    await notify(trx, 'subscription.canceled', current.userId, {
      targetType: 'subscription',
      targetId: current.id,
      data: {
        reason: normalizedReason,
        currentPeriodEnd: current.currentPeriodEnd?.toISOString() ?? null,
      },
    });
  });
  return getAdminSubscription(db, request, current.id);
}

async function loadForCancellation(
  db: Database,
  subscriptionId: string,
  userId?: string,
): Promise<SubscriptionRecord> {
  if (!isUuid(subscriptionId)) throw subscriptionNotFound();
  const current = await loadSubscriptionRecord(db, subscriptionId);
  if (!current) throw subscriptionNotFound();
  if (userId !== undefined && current.userId !== userId) throw subscriptionNotFound();
  return current;
}

interface CancelResult {
  previousStatus: SubscriptionLifecycleStatus;
  status: SubscriptionLifecycleStatus;
}

async function cancelInTransaction(
  trx: Database,
  subscriptionId: string,
  by: 'self' | 'admin',
  reason: string,
  now: Date,
): Promise<CancelResult> {
  const current = await loadSubscriptionRecord(trx, subscriptionId, { forUpdate: true });
  if (!current) throw subscriptionNotFound();
  const previousStatus = current.status;
  if (previousStatus === 'pending') {
    if (by === 'admin') throw subscriptionNotCancelable();
    await trx
      .updateTable('subscriptions')
      .set({ status: 'expired', canceledAt: now, cancelReason: reason, graceUntil: null })
      .where('id', '=', current.id)
      .execute();
    return { previousStatus, status: 'expired' };
  }
  if (previousStatus === 'active' || previousStatus === 'past_due') {
    await trx
      .updateTable('subscriptions')
      .set({
        status: 'canceling',
        canceledAt: now,
        cancelReason: reason,
        graceUntil: null,
        endedAt: null,
      })
      .where('id', '=', current.id)
      .execute();
    // O acesso vai só até o fim do período pago: o `expires_at` perde a carência.
    if (current.currentPeriodEnd !== null) {
      await extendEntitlementsTo(trx, current.id, current.currentPeriodEnd);
    }
    return { previousStatus, status: 'canceling' };
  }
  if (previousStatus === 'suspended' && by === 'admin') {
    await endSubscription(trx, current.id, 'subscription_ended', now);
    await trx
      .updateTable('subscriptions')
      .set({ canceledAt: now, cancelReason: reason })
      .where('id', '=', current.id)
      .execute();
    return { previousStatus, status: 'ended' };
  }
  throw subscriptionNotCancelable();
}

async function extendEntitlementsTo(
  trx: Database,
  subscriptionId: string,
  expiresAt: Date,
): Promise<void> {
  const { extendSubscriptionEntitlements } = await import('../entitlements/extend.ts');
  await extendSubscriptionEntitlements(trx, subscriptionId, expiresAt);
}

async function cancelWithProvider(
  provider: PaymentProvider,
  subscription: SubscriptionRecord,
): Promise<void> {
  if (subscription.providerSubscriptionId === null) return;
  await provider.cancelSubscription(subscription.providerSubscriptionId);
}

export interface SubscriptionSweepOptions {
  now?: Date;
  limit?: number;
}

/** `pending` sem pagamento em 30 min vira `expired` (spec 012, "Assinar"). */
export async function expirePendingSubscriptions(
  db: Database,
  provider: PaymentProvider,
  options: SubscriptionSweepOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const cutoff = new Date(now.getTime() - SUBSCRIPTION_PENDING_MINUTES * 60_000);
  const rows = await db
    .selectFrom('subscriptions')
    .select(['id', 'providerSubscriptionId'])
    .where('status', '=', 'pending')
    .where('createdAt', '<=', cutoff)
    .orderBy('createdAt')
    .limit(limit)
    .execute();
  let changed = 0;
  for (const row of rows) {
    if (row.providerSubscriptionId !== null) {
      // Cancelar a adesão é limpeza: a `pending` vence mesmo que o provedor esteja fora.
      await provider.cancelSubscription(row.providerSubscriptionId).catch(() => undefined);
    }
    const result = await db
      .updateTable('subscriptions')
      .set({ status: 'expired', graceUntil: null })
      .where('id', '=', row.id)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    changed += Number(result.numUpdatedRows ?? 0n);
  }
  return changed;
}

/**
 * Fim da carência: `past_due` → `suspended`, revoga os direitos (spec 012, "Ciclo de vida").
 * `graceDays` só aparece na notificação; a linha já traz `grace_until` calculado na recusa.
 */
export async function suspendExpiredSubscriptions(
  db: Database,
  options: SubscriptionSweepOptions & { graceDays?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const graceDays = options.graceDays ?? 3;
  const limit = options.limit ?? 500;
  const rows = await db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .select(['subscriptions.id', 'subscriptions.userId', 'plans.title as planTitle'])
    .where('subscriptions.status', '=', 'past_due')
    .where('subscriptions.graceUntil', '<=', now)
    .orderBy('subscriptions.graceUntil')
    .limit(limit)
    .execute();
  let changed = 0;
  for (const row of rows) {
    const suspended = await db.transaction().execute(async (trx) => {
      const result = await suspendSubscription(trx, row.id);
      if (!result.suspended) return false;
      await notify(trx, 'subscription.expired', row.userId, {
        targetType: 'subscription',
        targetId: row.id,
        data: { planTitle: row.planTitle, reason: 'grace_expired', graceDays },
      });
      return true;
    });
    if (suspended) changed += 1;
  }
  return changed;
}

/** Suspensa há 30 dias: cancela a recorrência no provedor e encerra (spec 012). */
export async function endSuspendedSubscriptions(
  db: Database,
  provider: PaymentProvider,
  options: SubscriptionSweepOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const cutoff = new Date(now.getTime() - SUBSCRIPTION_SUSPENDED_END_DAYS * 86_400_000);
  const rows = await db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .select([
      'subscriptions.id',
      'subscriptions.userId',
      'subscriptions.providerSubscriptionId',
      'plans.title as planTitle',
    ])
    .where('subscriptions.status', '=', 'suspended')
    .where('subscriptions.graceUntil', '<=', cutoff)
    .orderBy('subscriptions.graceUntil')
    .limit(limit)
    .execute();
  let changed = 0;
  for (const row of rows) {
    if (row.providerSubscriptionId !== null) {
      try {
        await provider.cancelSubscription(row.providerSubscriptionId);
      } catch {
        // Sem confirmação do provedor a suspensão continua; a próxima varredura tenta de novo.
        continue;
      }
    }
    const ended = await db.transaction().execute(async (trx) => {
      const result = await endSubscription(trx, row.id, 'subscription_ended', now);
      if (result.ended) {
        await notify(trx, 'subscription.expired', row.userId, {
          targetType: 'subscription',
          targetId: row.id,
          data: { planTitle: row.planTitle, reason: 'suspended_expired' },
        });
      }
      return result.ended;
    });
    if (ended) changed += 1;
  }
  return changed;
}

/** `canceling` cujo período pago acabou vira `ended` (o acesso expira pelo `expires_at`). */
export async function endCancelingSubscriptions(
  db: Database,
  options: SubscriptionSweepOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const rows = await db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .select(['subscriptions.id', 'subscriptions.userId', 'plans.title as planTitle'])
    .where('subscriptions.status', '=', 'canceling')
    .where('subscriptions.currentPeriodEnd', '<=', now)
    .orderBy('subscriptions.currentPeriodEnd')
    .limit(limit)
    .execute();
  let changed = 0;
  for (const row of rows) {
    const ended = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('subscriptions')
        .set({ status: 'ended', endedAt: now, graceUntil: null })
        .where('id', '=', row.id)
        .where('status', '=', 'canceling')
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows ?? 0n) === 0) return false;
      await notify(trx, 'subscription.expired', row.userId, {
        targetType: 'subscription',
        targetId: row.id,
        data: { planTitle: row.planTitle, reason: 'canceled_period_ended' },
      });
      return true;
    });
    if (ended) changed += 1;
  }
  return changed;
}

/** `true` quando o aluno tem acesso por assinatura ativa, em carência ou cancelando. */
export async function hasActiveSubscription(
  db: Database,
  userId: string,
  options: { planId?: string } = {},
): Promise<boolean> {
  let statement = db
    .selectFrom('subscriptions')
    .select('id')
    .where('userId', '=', userId)
    .where('status', 'in', ['active', 'past_due', 'canceling']);
  if (options.planId !== undefined) statement = statement.where('planId', '=', options.planId);
  return (await statement.executeTakeFirst()) !== undefined;
}

function readDate(value: unknown, path: string, errors: FieldError[]): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    errors.push({ path, message: 'data inválida' });
    return undefined;
  }
  return date;
}

function readUuid(value: unknown, path: string, errors: FieldError[]): string | undefined {
  if (value === undefined) return undefined;
  if (!isUuid(value)) {
    errors.push({ path, message: 'deve ser um UUID' });
    return undefined;
  }
  return value.toLowerCase();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
