import type { Database } from '../../db/database.ts';
import { notFound, validationFailed } from '../../errors/domain-error.ts';
import { extendSubscriptionEntitlements } from './extend.ts';
import { findEntitlementProduct, grantEntitlement, revokeEntitlementTree } from './grant.ts';
import { type EntitlementProductType, type EntitlementRevokeReason, isUuid } from './types.ts';

// Direitos de acesso da assinatura (spec 010, "Fontes" e "Algoritmo de concessão"; spec 012,
// "Ativação", "Renovação" e "Planos 'tudo, inclusive futuros'"). A raiz é `source =
// subscription` e `source_id = subscriptions.id`; a cascata é do `grantEntitlement`. Dono da
// escrita: worker.

/** Um produto que o plano cobre agora. */
export interface SubscriptionProduct {
  productType: EntitlementProductType;
  productId: string;
}

/** Plano como a concessão precisa dele (`subscriptions` + `plans`). */
export interface SubscriptionEntitlementContext {
  subscriptionId: string;
  userId: string;
  planId: string;
  status: string;
  includesAll: boolean;
  includesPrivate: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/** Estados que têm direitos concedidos (spec 012, "Ciclo de vida"). */
const ACCESS_STATUSES = ['active', 'past_due', 'canceling'] as const;

/** Produtos de um plano: os itens explícitos ou todo o catálogo elegível do plano "tudo". */
export async function listPlanProducts(
  db: Database,
  planId: string,
): Promise<SubscriptionProduct[]> {
  const plan = await db
    .selectFrom('plans')
    .select(['id', 'includesAll', 'includesPrivate'])
    .where('id', '=', planId)
    .executeTakeFirst();
  if (!plan) return [];
  if (plan.includesAll) return listAllEligibleProducts(db, plan.includesPrivate);
  const rows = await db
    .selectFrom('planItems')
    .select(['productType', 'productId'])
    .where('planId', '=', planId)
    .orderBy('productType')
    .orderBy('productId')
    .execute();
  return rows.map((row) => ({
    productType: row.productType as EntitlementProductType,
    productId: row.productId,
  }));
}

/**
 * Produtos publicados que um plano "tudo, inclusive futuros" cobre no instante: `paid` e `open`,
 * mais os `private` quando `includes_private`. Arquivado não conta como publicado.
 */
async function listAllEligibleProducts(
  db: Database,
  includesPrivate: boolean,
): Promise<SubscriptionProduct[]> {
  const modes = includesPrivate ? ['paid', 'open', 'private'] : ['paid', 'open'];
  const [courses, bundles, ebooks] = await Promise.all([
    db
      .selectFrom('courses')
      .select('id')
      .where('status', '=', 'published')
      .where('archivedAt', 'is', null)
      .where('accessMode', 'in', modes)
      .orderBy('id')
      .execute(),
    db
      .selectFrom('bundles')
      .select('id')
      .where('status', '=', 'published')
      .where('archivedAt', 'is', null)
      .where('accessMode', 'in', modes)
      .orderBy('id')
      .execute(),
    db
      .selectFrom('ebooks')
      .select('id')
      .where('status', '=', 'published')
      .where('archivedAt', 'is', null)
      .where('accessMode', 'in', modes)
      .orderBy('id')
      .execute(),
  ]);
  return [
    ...courses.map((row) => ({ productType: 'course' as const, productId: row.id })),
    ...bundles.map((row) => ({ productType: 'bundle' as const, productId: row.id })),
    ...ebooks.map((row) => ({ productType: 'ebook' as const, productId: row.id })),
  ];
}

/** Assinatura com o plano, ou `404`. */
export async function loadSubscriptionEntitlementContext(
  db: Database,
  subscriptionId: string,
): Promise<SubscriptionEntitlementContext> {
  const row = await db
    .selectFrom('subscriptions')
    .innerJoin('plans', 'plans.id', 'subscriptions.planId')
    .select([
      'subscriptions.id',
      'subscriptions.userId',
      'subscriptions.planId',
      'subscriptions.status',
      'subscriptions.currentPeriodStart',
      'subscriptions.currentPeriodEnd',
      'plans.includesAll',
      'plans.includesPrivate',
    ])
    .where('subscriptions.id', '=', subscriptionId)
    .executeTakeFirst();
  if (!row) throw notFound('Assinatura não encontrada.');
  return {
    subscriptionId: row.id,
    userId: row.userId,
    planId: row.planId,
    status: row.status,
    includesAll: row.includesAll,
    includesPrivate: row.includesPrivate,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
  };
}

export interface SyncSubscriptionEntitlementsOptions {
  /** Início dos direitos que faltam; padrão: `current_period_start`, ou agora. */
  now?: Date;
  /** Fim dos direitos; padrão: `current_period_end` + carência. */
  expiresAt?: Date;
  /** Dias de carência da instalação (`NUVA_SUBSCRIPTION_GRACE_DAYS`). */
  graceDays?: number;
  /** Revoga as raízes que o plano não cobre mais (mudança de itens). Padrão: `true`. */
  revokeRemoved?: boolean;
}

export interface SyncSubscriptionEntitlementsResult {
  /** Raízes criadas. */
  granted: number;
  /** Direitos (raízes e derivados) com `expires_at` atualizado. */
  extended: number;
  /** Raízes revogadas por a assinatura não cobrir mais o produto. */
  revoked: number;
}

/**
 * Reconcilia os direitos da assinatura com a composição atual do plano, numa transação:
 * estende o que já existe, concede o que falta e, quando pedido, revoga com `recalculation` o
 * que o plano não cobre mais. Idempotente. Assinatura fora dos estados com acesso não tem
 * direito: não grava nada.
 */
export async function syncSubscriptionEntitlements(
  db: Database,
  subscriptionId: string,
  options: SyncSubscriptionEntitlementsOptions = {},
): Promise<SyncSubscriptionEntitlementsResult> {
  return db.transaction().execute((trx) => syncInTransaction(trx, subscriptionId, options));
}

/** Variante para quem já está numa transação (ativação e renovação). */
export async function grantSubscriptionEntitlements(
  trx: Database,
  subscriptionId: string,
  options: SyncSubscriptionEntitlementsOptions = {},
): Promise<SyncSubscriptionEntitlementsResult> {
  if (!trx.isTransaction) {
    throw new TypeError('grantSubscriptionEntitlements exige uma transação aberta.');
  }
  return syncInTransaction(trx, subscriptionId, { ...options, revokeRemoved: false });
}

async function syncInTransaction(
  trx: Database,
  subscriptionId: string,
  options: SyncSubscriptionEntitlementsOptions,
): Promise<SyncSubscriptionEntitlementsResult> {
  const context = await loadSubscriptionEntitlementContext(trx, subscriptionId);
  if (!(ACCESS_STATUSES as readonly string[]).includes(context.status)) {
    return { granted: 0, extended: 0, revoked: 0 };
  }
  const startsAt = context.currentPeriodStart ?? options.now ?? new Date();
  const expiresAt =
    options.expiresAt ?? defaultExpiry(context.currentPeriodEnd, startsAt, options.graceDays);

  // Atualiza a árvore inteira de uma vez; a lista de produtos decide o que falta e o que sobra.
  const extended = await extendSubscriptionEntitlements(trx, subscriptionId, expiresAt);

  const desired = await listPlanProducts(trx, context.planId);
  const existing = new Map(
    (
      await trx
        .selectFrom('entitlements')
        .select(['id', 'productType', 'productId'])
        .where('source', '=', 'subscription')
        .where('sourceId', '=', subscriptionId)
        .where('revokedAt', 'is', null)
        .execute()
    ).map((row) => [`${row.productType}:${row.productId}`, row.id]),
  );

  let granted = 0;
  const desiredKeys = new Set<string>();
  for (const product of desired) {
    const key = `${product.productType}:${product.productId}`;
    desiredKeys.add(key);
    if (existing.has(key)) continue;
    if (!(await findEntitlementProduct(trx, product.productType, product.productId))) continue;
    const result = await grantEntitlement(trx, {
      userId: context.userId,
      productType: product.productType,
      productId: product.productId,
      source: 'subscription',
      sourceId: subscriptionId,
      startsAt,
      expiresAt,
      notify: false,
    });
    if (result.created) granted += 1;
  }

  let revoked = 0;
  if (options.revokeRemoved !== false) {
    const removed = [...existing.entries()]
      .filter(([key]) => !desiredKeys.has(key))
      .map(([, id]) => id);
    if (removed.length > 0) revoked = await revokeEntitlementTree(trx, removed, 'recalculation');
  }
  return { granted, extended, revoked };
}

/** Revoga todos os direitos da assinatura (suspensão, encerramento, reembolso, chargeback). */
export async function revokeSubscriptionEntitlements(
  trx: Database,
  subscriptionId: string,
  reason: EntitlementRevokeReason,
): Promise<number> {
  if (!trx.isTransaction) {
    throw new TypeError('revokeSubscriptionEntitlements exige uma transação aberta.');
  }
  const roots = await trx
    .selectFrom('entitlements')
    .select('id')
    .where('source', '=', 'subscription')
    .where('sourceId', '=', subscriptionId)
    .where('revokedAt', 'is', null)
    .execute();
  if (roots.length === 0) return 0;
  return revokeEntitlementTree(
    trx,
    roots.map((row) => row.id),
    reason,
  );
}

/** Assinaturas por transação do recálculo de um plano. */
const PLAN_RECALCULATION_BATCH_SIZE = 100;

export interface RecalculatePlanOptions {
  /** Assinaturas por transação; padrão 100. */
  batchSize?: number;
  /** Início dos direitos das assinaturas que ainda não têm período; padrão: agora. */
  now?: Date;
  /** Dias de carência da instalação (`NUVA_SUBSCRIPTION_GRACE_DAYS`). */
  graceDays?: number;
}

export interface RecalculatePlanResult {
  /** Assinaturas com acesso conferidas. */
  subscriptions: number;
  granted: number;
  extended: number;
  revoked: number;
}

/**
 * Recalcula os direitos de todas as assinaturas com acesso de um plano (worker, payload
 * `entitlement.recompute` com `productType: "plan"`; spec 012, "Planos 'tudo, inclusive
 * futuros'"). Cobre a mudança de `plan_items`/`includes_all`/`includes_private` e a publicação
 * de um produto novo: cada assinatura é reconciliada pela `syncSubscriptionEntitlements`, que
 * concede o que falta e revoga com `recalculation` o que o plano não cobre mais. Assinaturas
 * suspensas, encerradas ou expiradas não têm direito e ficam de fora. Idempotente; um lote por
 * transação, então parar no meio deixa assinaturas inteiras prontas.
 */
export async function recalculatePlanSubscriptions(
  db: Database,
  planId: string,
  options: RecalculatePlanOptions = {},
): Promise<RecalculatePlanResult> {
  if (!isUuid(planId)) {
    throw validationFailed([{ path: 'planId', message: 'deve ser um uuid' }]);
  }
  const plan = planId.toLowerCase();
  const batchSize = options.batchSize ?? PLAN_RECALCULATION_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new TypeError('O lote do recálculo do plano deve ser um inteiro positivo.');
  }
  const result: RecalculatePlanResult = { subscriptions: 0, granted: 0, extended: 0, revoked: 0 };
  let cursor: string | null = null;
  for (;;) {
    let query = db
      .selectFrom('subscriptions')
      .select('id')
      .where('planId', '=', plan)
      .where('status', 'in', [...ACCESS_STATUSES])
      .orderBy('id')
      .limit(batchSize);
    if (cursor !== null) query = query.where('id', '>', cursor);
    const rows = await query.execute();
    for (const row of rows) {
      const synced = await syncSubscriptionEntitlements(db, row.id, {
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.graceDays === undefined ? {} : { graceDays: options.graceDays }),
      });
      result.subscriptions += 1;
      result.granted += synced.granted;
      result.extended += synced.extended;
      result.revoked += synced.revoked;
    }
    if (rows.length < batchSize) break;
    cursor = rows[rows.length - 1]?.id ?? null;
    if (cursor === null) break;
  }
  return result;
}

/** Fim padrão de um direito: o do período pago mais a carência. */
export function defaultExpiry(
  currentPeriodEnd: Date | null,
  fallbackStart: Date,
  graceDays = 0,
): Date {
  const base = currentPeriodEnd ?? fallbackStart;
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + graceDays);
  return result;
}
