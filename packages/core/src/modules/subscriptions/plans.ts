import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, validationFailed } from '../../errors/domain-error.ts';
import {
  type ManagementRequest,
  managementAuditContext,
  requirePermission,
} from '../accounts/management/common.ts';
import { recordAudit } from '../audit/record.ts';
import { isUniqueViolation } from '../catalog/common.ts';
import { findEntitlementProduct } from '../entitlements/index.ts';
import { type EntitlementProductType, isEntitlementProductType } from '../entitlements/types.ts';
import { enqueuePlanRecalculation } from '../jobs/subscriptions.ts';
import type { PaymentProvider } from '../payments/types.ts';
import { isUuid } from '../sales/types.ts';
import {
  planGroupIntervalTaken,
  planInvalidItems,
  planNotFound,
  planSlugTaken,
  planValidationFailed,
} from './errors.ts';
import {
  isPlanInterval,
  type Plan,
  type PlanGroup,
  type PlanInput,
  type PlanInterval,
  type PlanItem,
  type PlanPage,
  type PlanUpdateInput,
  type PublicPlan,
  planPeriodicity,
  toPlan,
  toPublicPlan,
} from './types.ts';

// Planos (spec 012, "Planos"): criação, edição, itens e vitrine. Dono da escrita: admin-api.
// O preço é copiado para a assinatura na criação (spec 012), então alterá-lo aqui só alcança
// assinaturas novas. Mudar a composição (itens, includes_all ou includes_private) enfileira o
// recálculo das assinaturas do plano, que o worker executa em `entitlement.recompute`.

const PLAN_CURSOR_SCOPE = 'plans';
const PLAN_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLAN_TEXT_MAX_LENGTH = 160;
const PLAN_DESCRIPTION_MAX_LENGTH = 20_000;
const PLAN_MAX_ITEMS = 500;
/** Limite do `reason` do plano no provedor: o slug único precisa caber inteiro no fim. */
const PROVIDER_PLAN_TITLE_MAX_LENGTH = 255;

export interface PlanListQuery {
  q?: unknown;
  active?: unknown;
  interval?: unknown;
  groupKey?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

/** O plano como o admin o vê (`GET /plans/{id}`). */
export async function getPlan(
  db: Database,
  request: ManagementRequest,
  planId: string,
): Promise<Plan> {
  await requirePermission(db, request, 'plan.manage', { action: 'plan.view' });
  const plan = await findPlan(db, planId);
  if (!plan) throw planNotFound();
  return plan;
}

/** Plano pelo id, com os itens; `undefined` quando não existe. */
export async function findPlan(db: Database, planId: string): Promise<Plan | undefined> {
  if (!isUuid(planId)) return undefined;
  const row = await db
    .selectFrom('plans')
    .selectAll()
    .where('id', '=', planId.toLowerCase())
    .executeTakeFirst();
  if (!row) return undefined;
  const [items, counts] = await Promise.all([
    loadPlanItems(db, [row.id]),
    loadSubscriptionCounts(db, [row.id]),
  ]);
  return {
    ...toPlan(row),
    items: items.get(row.id) ?? [],
    subscriptionCount: counts.get(row.id) ?? 0,
  };
}

/** A lista do admin (`GET /plans`), do menor `position` para o maior. */
export async function listPlans(
  db: Database,
  request: ManagementRequest,
  query: PlanListQuery = {},
): Promise<PlanPage> {
  await requirePermission(db, request, 'plan.manage', { action: 'plan.list' });
  const errors: FieldError[] = [];
  let q: string | undefined;
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.trim() === '') {
      errors.push({ path: 'q', message: 'deve ser um texto' });
    } else {
      q = query.q.trim();
    }
  }
  let active: boolean | undefined;
  if (query.active !== undefined) {
    if (typeof query.active === 'boolean') active = query.active;
    else if (query.active === 'true' || query.active === 'false') active = query.active === 'true';
    else errors.push({ path: 'active', message: 'deve ser booleano' });
  }
  let groupKey: string | undefined;
  if (query.groupKey !== undefined) {
    if (typeof query.groupKey !== 'string' || !PLAN_SLUG_PATTERN.test(query.groupKey)) {
      errors.push({ path: 'groupKey', message: 'deve ser um slug' });
    } else {
      groupKey = query.groupKey;
    }
  }
  let interval: PlanInterval | undefined;
  if (query.interval !== undefined) {
    if (isPlanInterval(query.interval)) interval = query.interval;
    else errors.push({ path: 'interval', message: 'deve ser month ou year' });
  }
  let limit = 25;
  if (query.limit !== undefined) {
    const value =
      typeof query.limit === 'number'
        ? query.limit
        : typeof query.limit === 'string' && /^\d+$/.test(query.limit)
          ? Number(query.limit)
          : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      errors.push({ path: 'limit', message: 'deve ser um inteiro de 1 a 100' });
    } else {
      limit = value;
    }
  }
  let after: PlanCursor | undefined;
  if (query.cursor !== undefined) {
    after = decodePlanCursor(query.cursor);
    if (!after) errors.push({ path: 'cursor', message: 'cursor inválido' });
  }
  if (errors.length > 0) throw validationFailed(errors);

  let statement = db.selectFrom('plans').selectAll();
  if (q !== undefined) {
    const pattern = `%${escapeLike(q)}%`;
    statement = statement.where((eb) =>
      eb.or([eb('title', 'ilike', pattern), eb('slug', 'ilike', pattern)]),
    );
  }
  if (active !== undefined) statement = statement.where('active', '=', active);
  if (interval !== undefined) statement = statement.where('interval', '=', interval);
  if (groupKey !== undefined) statement = statement.where('groupKey', '=', groupKey);
  if (after !== undefined) {
    statement = statement.where((eb) =>
      eb.or([
        eb('position', '>', after.position),
        eb.and([
          eb('position', '=', after.position),
          eb.or([
            eb('title', '>', after.title),
            eb.and([eb('title', '=', after.title), eb('id', '>', after.id)]),
          ]),
        ]),
      ]),
    );
  }
  const rows = await statement
    .orderBy('position')
    .orderBy('title')
    .orderBy('id')
    .limit(limit + 1)
    .execute();
  const pageRows = rows.slice(0, limit);
  const [items, counts] = await Promise.all([
    loadPlanItems(
      db,
      pageRows.map((row) => row.id),
    ),
    loadSubscriptionCounts(
      db,
      pageRows.map((row) => row.id),
    ),
  ]);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => ({
      ...toPlan(row),
      items: items.get(row.id) ?? [],
      subscriptionCount: counts.get(row.id) ?? 0,
    })),
    nextCursor:
      rows.length > limit && last
        ? encodePlanCursor({ position: last.position, title: last.title, id: last.id })
        : null,
  };
}

interface PlanCursor {
  position: number;
  title: string;
  id: string;
}

function encodePlanCursor(cursor: PlanCursor): string {
  return Buffer.from(
    `${PLAN_CURSOR_SCOPE}:${cursor.position}:${cursor.id}:${cursor.title}`,
    'utf8',
  ).toString('base64url');
}

function decodePlanCursor(value: unknown): PlanCursor | undefined {
  if (typeof value !== 'string') return undefined;
  const text = Buffer.from(value, 'base64url').toString('utf8');
  const prefix = `${PLAN_CURSOR_SCOPE}:`;
  if (!text.startsWith(prefix)) return undefined;
  const rest = text.slice(prefix.length);
  const [positionText, id, ...titleParts] = rest.split(':');
  const title = titleParts.join(':');
  if (positionText === undefined || id === undefined || title === '') return undefined;
  const position = Number(positionText);
  if (!Number.isInteger(position) || position < 0 || !isUuid(id)) return undefined;
  return { position, title, id };
}

/**
 * Vitrine pública (`GET /plans`, sem login): só planos ativos, ordenados por `position`, e
 * agrupados por `group_key` para a alternância mensal/anual (spec 012, "Planos"). Item não
 * publicado ou `private` é omitido, e plano "tudo" não anuncia `includes_private`.
 */
export async function listPublicPlans(db: Database): Promise<PlanGroup[]> {
  const rows = await db
    .selectFrom('plans')
    .selectAll()
    .where('active', '=', true)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const items = await loadPlanItems(
    db,
    rows.map((row) => row.id),
  );
  const visibility = await loadPublicItemVisibility(db);
  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    const planItems = (items.get(row.id) ?? []).filter((item) =>
      visibility.has(`${item.productType}:${item.productId}`),
    );
    const plan = toPublicPlan(toPlan(row), planItems);
    const group = groups.get(row.groupKey);
    if (group) {
      group.plans.push(plan);
    } else {
      groups.set(row.groupKey, { groupKey: row.groupKey, plans: [plan] });
    }
  }
  for (const group of groups.values()) {
    group.plans.sort((left, right) => intervalOrder(left.interval) - intervalOrder(right.interval));
  }
  return [...groups.values()];
}

function intervalOrder(interval: PlanInterval): number {
  return interval === 'month' ? 0 : 1;
}

/**
 * Produtos que podem aparecer na vitrine: publicados, não arquivados e `paid`/`open`. Plano
 * "tudo" com `includes_private` continua sem anunciar os `private` (spec 009).
 */
async function loadPublicItemVisibility(db: Database): Promise<Set<string>> {
  const visible = new Set<string>();
  const [courses, bundles, ebooks] = await Promise.all([
    db
      .selectFrom('courses')
      .select('id')
      .where('status', '=', 'published')
      .where('archivedAt', 'is', null)
      .where('accessMode', 'in', ['paid', 'open'])
      .execute(),
    db
      .selectFrom('bundles')
      .select('id')
      .where('status', '=', 'published')
      .where('archivedAt', 'is', null)
      .where('accessMode', 'in', ['paid', 'open'])
      .execute(),
    db
      .selectFrom('ebooks')
      .select('id')
      .where('status', '=', 'published')
      .where('archivedAt', 'is', null)
      .where('accessMode', 'in', ['paid', 'open'])
      .execute(),
  ]);
  for (const row of courses) visible.add(`course:${row.id}`);
  for (const row of bundles) visible.add(`bundle:${row.id}`);
  for (const row of ebooks) visible.add(`ebook:${row.id}`);
  return visible;
}

/** Plano público pelo id, com os itens visíveis (detalhe da assinatura do aluno). */
export async function findPublicPlan(
  db: Database,
  planId: string,
): Promise<PublicPlan | undefined> {
  const plan = await findPlan(db, planId);
  if (!plan) return undefined;
  const visibility = await loadPublicItemVisibility(db);
  const items = plan.items.filter((item) =>
    visibility.has(`${item.productType}:${item.productId}`),
  );
  return toPublicPlan(toPlan(plan), items);
}

export interface PlanWriteOptions {
  /**
   * Porta de pagamento: quando presente, `ensurePlan` cria ou reaproveita o plano no provedor
   * (spec 013) e grava `provider_plan_id`. A moeda da instalação é exigida junto.
   */
  provider?: PaymentProvider;
  currency?: string;
}

/**
 * Cria um plano (`POST /plans`), auditado na mesma transação. Com `provider`, cria o plano no
 * provedor: provedor fora do ar devolve `503` e nada é gravado.
 */
export async function createPlan(
  db: Database,
  request: ManagementRequest,
  input: PlanInput,
  options: PlanWriteOptions = {},
): Promise<Plan> {
  await requirePermission(db, request, 'plan.manage', { action: 'plan.create' });
  const normalized = normalizePlanInput(input);
  await assertPlanUnique(db, normalized.slug, normalized.groupKey, normalized.interval);

  try {
    return await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('plans')
        .values({
          slug: normalized.slug,
          groupKey: normalized.groupKey,
          title: normalized.title,
          description: normalized.description,
          interval: normalized.interval,
          priceCents: normalized.priceCents,
          includesAll: normalized.includesAll,
          includesPrivate: normalized.includesPrivate,
          active: normalized.active,
          position: normalized.position,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const items = await normalizePlanItems(trx, input.items, normalized.includesAll);
      if (items.length > 0) await replacePlanItems(trx, inserted.id, items);
      const providerPlanId = await ensureProviderPlan(trx, inserted.id, normalized, options);
      await recordAudit(trx, {
        context: managementAuditContext(request),
        action: 'plan.create',
        targetType: 'plan',
        targetId: inserted.id,
        details: {
          slug: normalized.slug,
          groupKey: normalized.groupKey,
          interval: normalized.interval,
          priceCents: normalized.priceCents,
          includesAll: normalized.includesAll,
          includesPrivate: normalized.includesPrivate,
          items: items.map((item) => ({
            productType: item.productType,
            productId: item.productId,
          })),
          providerPlanId,
        },
      });
      const plan = await findPlan(trx, inserted.id);
      if (!plan) throw planNotFound();
      return plan;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'plans_slug_unique')) throw planSlugTaken();
    if (isUniqueViolation(error, 'plans_group_interval_unique')) throw planGroupIntervalTaken();
    throw error;
  }
}

/**
 * Edita um plano (`PATCH /plans/{id}`). Os itens têm rota própria (`setPlanItems`). Mudar preço
 * não toca nas assinaturas existentes. Mudar `includes_all` ou `includes_private` enfileira o
 * recálculo das assinaturas do plano na mesma transação.
 */
export async function updatePlan(
  db: Database,
  request: ManagementRequest,
  planId: string,
  input: PlanUpdateInput,
  options: PlanWriteOptions = {},
): Promise<Plan> {
  await requirePermission(db, request, 'plan.manage', { action: 'plan.update' });
  const current = await findPlan(db, planId);
  if (!current) throw planNotFound();
  const currentInput: PlanInput = {
    slug: current.slug,
    groupKey: current.groupKey,
    title: current.title,
    description: current.description,
    interval: current.interval,
    priceCents: current.priceCents,
    includesAll: current.includesAll,
    includesPrivate: current.includesPrivate,
    active: current.active,
    position: current.position,
    items: current.items,
  };
  const merged: PlanInput = { ...currentInput, ...input };
  const normalized = normalizePlanInput(merged);
  // Passar `includesAll` a verdadeiro limpa os itens (contrato de `PATCH /plans/{id}`).
  const clearItems = normalized.includesAll && current.items.length > 0;
  const providerChanged =
    normalized.priceCents !== current.priceCents || normalized.title !== current.title;

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('plans')
      .set({
        slug: normalized.slug,
        groupKey: normalized.groupKey,
        title: normalized.title,
        description: normalized.description,
        interval: normalized.interval,
        priceCents: normalized.priceCents,
        includesAll: normalized.includesAll,
        includesPrivate: normalized.includesPrivate,
        active: normalized.active,
        position: normalized.position,
      })
      .where('id', '=', current.id)
      .execute();
    if (clearItems) {
      await replacePlanItems(trx, current.id, []);
    }
    const itemsChanged =
      clearItems ||
      current.includesAll !== normalized.includesAll ||
      current.includesPrivate !== normalized.includesPrivate;
    if (itemsChanged) {
      await enqueuePlanRecalculation(trx, current.id);
    }
    const providerPlanId = providerChanged
      ? await ensureProviderPlan(trx, current.id, normalized, options)
      : undefined;
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'plan.update',
      targetType: 'plan',
      targetId: current.id,
      details: {
        priceCents: normalized.priceCents,
        interval: normalized.interval,
        includesAll: normalized.includesAll,
        includesPrivate: normalized.includesPrivate,
        active: normalized.active,
        itemsChanged,
        providerPlanId: providerPlanId ?? null,
      },
    });
    const plan = await findPlan(trx, current.id);
    if (!plan) throw planNotFound();
    return plan;
  });
}

/**
 * Substitui os itens do plano (`PUT /plans/{id}/items`). Plano "tudo" não aceita itens. As
 * assinaturas do plano são recalculadas pelo worker; o acesso não fica no meio do caminho.
 */
export async function setPlanItems(
  db: Database,
  request: ManagementRequest,
  planId: string,
  items: readonly { productType: EntitlementProductType; productId: string }[],
): Promise<Plan> {
  await requirePermission(db, request, 'plan.manage', { action: 'plan.items' });
  const current = await findPlan(db, planId);
  if (!current) throw planNotFound();
  if (current.includesAll) {
    throw planInvalidItems('Plano "tudo, inclusive futuros" não tem lista de itens.');
  }

  return db.transaction().execute(async (trx) => {
    const normalized = await normalizePlanItems(trx, items, false);
    await replacePlanItems(trx, current.id, normalized);
    if (!sameItems(current.items, normalized)) await enqueuePlanRecalculation(trx, current.id);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'plan.items',
      targetType: 'plan',
      targetId: current.id,
      details: {
        items: normalized.map((item) => ({
          productType: item.productType,
          productId: item.productId,
        })),
      },
    });
    const plan = await findPlan(trx, current.id);
    if (!plan) throw planNotFound();
    return plan;
  });
}

/** Assinaturas abertas de um plano; usado pelos testes e pelo recálculo. */
export async function countOpenSubscriptions(db: Database, planId: string): Promise<number> {
  const row = await db
    .selectFrom('subscriptions')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('planId', '=', planId)
    .where('status', 'in', ['pending', 'active', 'past_due', 'suspended'])
    .executeTakeFirstOrThrow();
  return row.count;
}

/** Itens atuais de vários planos, com o título de cada produto. */
export async function loadPlanItems(
  db: Database,
  planIds: readonly string[],
): Promise<Map<string, PlanItem[]>> {
  const map = new Map<string, PlanItem[]>();
  if (planIds.length === 0) return map;
  const rows = await db
    .selectFrom('planItems')
    .select(['planId', 'productType', 'productId'])
    .where('planId', 'in', [...planIds])
    .orderBy('planId')
    .orderBy('productType')
    .orderBy('productId')
    .execute();
  const titles = new Map<string, string>();
  for (const type of ['course', 'bundle', 'ebook'] as const) {
    const ids = [
      ...new Set(rows.filter((row) => row.productType === type).map((row) => row.productId)),
    ];
    if (ids.length === 0) continue;
    const table = type === 'course' ? 'courses' : type === 'bundle' ? 'bundles' : 'ebooks';
    const products = await db
      .selectFrom(table)
      .select(['id', 'title'])
      .where('id', 'in', ids)
      .execute();
    for (const product of products) titles.set(`${type}:${product.id}`, product.title);
  }
  for (const row of rows) {
    const list = map.get(row.planId) ?? [];
    list.push({
      productType: row.productType as EntitlementProductType,
      productId: row.productId,
      title: titles.get(`${row.productType}:${row.productId}`) ?? 'produto removido',
    });
    map.set(row.planId, list);
  }
  return map;
}

/**
 * Título do plano no provedor. O slug entra no fim porque é único: dois planos locais com o
 * mesmo título, preço e periodicidade (`ensurePlan` reaproveita por esses três) não podem
 * apontar para o mesmo plano do provedor (`plans_provider_plan_unique`).
 */
export function providerPlanTitle(plan: { title: string; slug: string }): string {
  const suffix = ` · ${plan.slug}`;
  const room = PROVIDER_PLAN_TITLE_MAX_LENGTH - suffix.length;
  const title =
    plan.title.length > room ? plan.title.slice(0, Math.max(room, 0)).trimEnd() : plan.title;
  return `${title}${suffix}`;
}

interface NormalizedPlan {
  slug: string;
  groupKey: string;
  title: string;
  description: string | null;
  interval: PlanInterval;
  priceCents: number;
  includesAll: boolean;
  includesPrivate: boolean;
  active: boolean;
  position: number;
}

function normalizePlanInput(input: PlanInput): NormalizedPlan {
  const errors: FieldError[] = [];
  const groupKey = typeof input.groupKey === 'string' ? input.groupKey.trim() : '';
  if (!PLAN_SLUG_PATTERN.test(groupKey) || groupKey.length > PLAN_TEXT_MAX_LENGTH) {
    errors.push({ path: 'groupKey', message: 'use minúsculas, números e hífen (até 160)' });
  }
  const interval = isPlanInterval(input.interval) ? input.interval : undefined;
  if (interval === undefined) errors.push({ path: 'interval', message: 'deve ser month ou year' });
  // Sem `slug`, o identificador público é gerado de `group_key` e `interval` (contrato).
  const rawSlug = typeof input.slug === 'string' ? input.slug.trim() : '';
  const slug = rawSlug === '' ? `${groupKey}-${interval ?? ''}`.replace(/-+$/, '') : rawSlug;
  if (!PLAN_SLUG_PATTERN.test(slug) || slug.length > PLAN_TEXT_MAX_LENGTH) {
    errors.push({ path: 'slug', message: 'use minúsculas, números e hífen (até 160)' });
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '' || title.length > PLAN_TEXT_MAX_LENGTH) {
    errors.push({ path: 'title', message: 'deve ter de 1 a 160 caracteres' });
  }
  const description =
    input.description === undefined || input.description === null ? null : input.description;
  if (description !== null && description.length > PLAN_DESCRIPTION_MAX_LENGTH) {
    errors.push({ path: 'description', message: 'deve ter até 20.000 caracteres' });
  }
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0) {
    errors.push({ path: 'priceCents', message: 'deve ser um inteiro positivo em centavos' });
  }
  const includesAll = input.includesAll ?? false;
  const includesPrivate = input.includesPrivate ?? false;
  if (includesPrivate && !includesAll) {
    errors.push({
      path: 'includesPrivate',
      message: 'só vale em plano "tudo, inclusive futuros"',
    });
  }
  const position = input.position ?? 0;
  if (!Number.isInteger(position) || position < 0) {
    errors.push({ path: 'position', message: 'deve ser um inteiro maior ou igual a zero' });
  }
  if (errors.length > 0) throw planValidationFailed(errors);
  return {
    slug,
    groupKey,
    title,
    description,
    interval: input.interval as PlanInterval,
    priceCents: input.priceCents,
    includesAll,
    includesPrivate,
    active: input.active ?? true,
    position,
  };
}

async function normalizePlanItems(
  db: Database,
  items: readonly { productType: EntitlementProductType; productId: string }[] | undefined,
  includesAll: boolean,
): Promise<{ productType: EntitlementProductType; productId: string }[]> {
  if (items === undefined) return [];
  if (includesAll && items.length > 0) {
    throw planInvalidItems('Plano "tudo, inclusive futuros" não tem lista de itens.');
  }
  if (items.length > PLAN_MAX_ITEMS) {
    throw planInvalidItems('A lista de itens passa de 500.');
  }
  const unique = new Map<string, { productType: EntitlementProductType; productId: string }>();
  for (const item of items) {
    if (!isEntitlementProductType(item.productType) || !isUuid(item.productId)) {
      throw planInvalidItems('Item de plano inválido.');
    }
    const ref = { productType: item.productType, productId: item.productId.toLowerCase() };
    unique.set(`${ref.productType}:${ref.productId}`, ref);
  }
  const refs = [...unique.values()];
  for (const ref of refs) {
    const product = await findEntitlementProduct(db, ref.productType, ref.productId);
    if (!product) throw planInvalidItems('Há produto inexistente na lista do plano.');
  }
  return refs;
}

async function replacePlanItems(
  trx: Database,
  planId: string,
  items: readonly { productType: EntitlementProductType; productId: string }[],
): Promise<void> {
  await trx.deleteFrom('planItems').where('planId', '=', planId).execute();
  if (items.length === 0) return;
  await trx
    .insertInto('planItems')
    .values(
      items.map((item) => ({
        planId,
        productType: item.productType,
        productId: item.productId,
      })),
    )
    .execute();
}

function sameItems(
  left: readonly { productType: string; productId: string }[],
  right: readonly { productType: string; productId: string }[],
): boolean {
  if (left.length !== right.length) return false;
  const keys = new Set(left.map((item) => `${item.productType}:${item.productId}`));
  return right.every((item) => keys.has(`${item.productType}:${item.productId}`));
}

async function ensureProviderPlan(
  trx: Database,
  planId: string,
  plan: NormalizedPlan,
  options: PlanWriteOptions,
): Promise<string | null> {
  if (!options.provider) return null;
  if (options.currency === undefined) {
    throw new TypeError('ensurePlan exige a moeda da instalação em options.currency.');
  }
  // Criar/editar plano não depende do provedor (contrato de `POST /plans`): provedor fora do ar
  // deixa `provider_plan_id` nulo, e o checkout da assinatura tenta de novo (`ensureProviderPlan`).
  try {
    const reference = await options.provider.ensurePlan({
      title: providerPlanTitle(plan),
      amountCents: plan.priceCents,
      currency: options.currency,
      periodicity: planPeriodicity(plan.interval),
    });
    await trx
      .updateTable('plans')
      .set({ providerPlanId: reference.providerPlanId })
      .where('id', '=', planId)
      .execute();
    return reference.providerPlanId;
  } catch {
    return null;
  }
}

async function assertPlanUnique(
  db: Database,
  slug: string,
  groupKey: string,
  interval: PlanInterval,
  exceptId?: string,
): Promise<void> {
  let slugQuery = db.selectFrom('plans').select('id').where('slug', '=', slug);
  if (exceptId) slugQuery = slugQuery.where('id', '!=', exceptId);
  if (await slugQuery.executeTakeFirst()) throw planSlugTaken();
  let groupQuery = db
    .selectFrom('plans')
    .select('id')
    .where('groupKey', '=', groupKey)
    .where('interval', '=', interval);
  if (exceptId) groupQuery = groupQuery.where('id', '!=', exceptId);
  if (await groupQuery.executeTakeFirst()) throw planGroupIntervalTaken();
}

/**
 * Planos que cobrem o produto agora: os "tudo" elegíveis para o tipo de acesso e os que o
 * listam em `plan_items` (spec 012, "Planos 'tudo, inclusive futuros'"). O worker usa ao
 * publicar um produto para recalcular só os planos afetados.
 */
export async function listPlansCoveringProduct(
  db: Database,
  productType: EntitlementProductType,
  productId: string,
): Promise<string[]> {
  const accessMode = await readProductAccessMode(db, productType, productId);
  const conditions: RawBuilder<boolean>[] = [
    sql<boolean>`EXISTS (
      SELECT 1 FROM plan_items pi
       WHERE pi.plan_id = plans.id AND pi.product_type = ${productType}
         AND pi.product_id = ${productId}::uuid
    )`,
  ];
  if (accessMode !== null) {
    conditions.push(
      sql<boolean>`(plans.includes_all AND (${accessMode} <> 'private' OR plans.includes_private))`,
    );
  }
  return (
    await db
      .selectFrom('plans')
      .select('id')
      .where((eb) => eb.or(conditions))
      .orderBy('id')
      .execute()
  ).map((row) => row.id);
}

/**
 * Enfileira o recálculo dos planos que cobrem um produto que acabou de ser publicado (plano
 * "tudo" ou item explícito). Uma tarefa por plano, sem repetir a que já está ativa.
 */
export async function enqueuePlansCoveringProduct(
  db: Database,
  productType: EntitlementProductType,
  productId: string,
): Promise<string[]> {
  const planIds = await listPlansCoveringProduct(db, productType, productId);
  for (const planId of planIds) await enqueuePlanRecalculation(db, planId);
  return planIds;
}

async function readProductAccessMode(
  db: Database,
  productType: EntitlementProductType,
  productId: string,
): Promise<string | null> {
  if (!isUuid(productId)) return null;
  const table =
    productType === 'course' ? 'courses' : productType === 'bundle' ? 'bundles' : 'ebooks';
  const row = await db
    .selectFrom(table)
    .select(['accessMode'])
    .where('id', '=', productId.toLowerCase())
    .executeTakeFirst();
  return row?.accessMode ?? null;
}

/** Quantas assinaturas cada plano tem, inclusive `ended` e `expired` (vínculo que impede excluir). */
export async function loadSubscriptionCounts(
  db: Database,
  planIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (planIds.length === 0) return counts;
  const rows = await db
    .selectFrom('subscriptions')
    .select(['planId', sql<number>`count(*)::int`.as('count')])
    .where('planId', 'in', [...planIds])
    .groupBy('planId')
    .execute();
  for (const row of rows) counts.set(row.planId, row.count);
  return counts;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
