// Base da escrita do catálogo (spec 009; dono dos dados: admin-api): quem pede, auditoria na
// mesma transação (spec 028), negação gravada fora dela, versão da edição (spec 003), regras de
// modo de acesso e preço (008, P3 da tarefa 400), vínculos que impedem a exclusão (P2), contagem
// de alunos afetados e tarefas da fila (recálculo da cascata e conferência de conclusão).

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  conflict,
  DomainError,
  type FieldError,
  notFound,
  permissionDenied,
} from '../../errors/domain-error.ts';
import { type ManagementRequest, managementAuditContext } from '../accounts/management/common.ts';
import { type AuditContext, recordAudit, recordDenied } from '../audit/record.ts';
import { enqueue } from '../jobs/queue.ts';
import type { EntitlementRecomputeProductType } from '../jobs/registry.ts';
import type { PermissionAction } from '../permissions/actions.ts';
import { can, permissionScope } from '../permissions/matrix.ts';
import {
  ACCESS_MODES,
  type AccessMode,
  CATALOG_LIMITS,
  catalogRule,
  type FieldErrors,
  isCatalogId,
  readEnum,
  readNullableInteger,
} from './fields.ts';

/** Quem pede: a sessão do site admin ou, na Fase 5, uma chave MCP (mesma forma da gestão). */
export type CatalogRequest = ManagementRequest;

/** Os três produtos do catálogo (`entitlements.product_type`). */
export const CATALOG_PRODUCT_TYPES = ['course', 'ebook', 'bundle'] as const;
export type CatalogProductType = (typeof CATALOG_PRODUCT_TYPES)[number];

/** `target_type` da auditoria do catálogo. */
export type CatalogTargetType = CatalogProductType | 'module' | 'lesson';

export function catalogAuditContext(request: CatalogRequest): AuditContext {
  return managementAuditContext(request);
}

/**
 * Negação por permissão que depende do recurso (curso `paid` publicado pelo instrutor, preço
 * pelo gerente...). É lançada em qualquer ponto da operação; `catalogWrite` desfaz a transação,
 * grava `outcome = denied` fora dela e responde `403` `permission_denied`.
 */
export class CatalogDenied extends DomainError {
  readonly permission: PermissionAction;
  readonly auditAction: string;
  readonly targetType: CatalogTargetType | null;
  readonly targetId: string | null;

  constructor(
    permission: PermissionAction,
    auditAction: string,
    target: { type: CatalogTargetType; id: string | null } | null,
    detail?: string,
  ) {
    super({ code: 'permission_denied', status: 403, title: 'Sem permissão', detail });
    this.permission = permission;
    this.auditAction = auditAction;
    this.targetType = target?.id ? target.type : null;
    this.targetId = target?.id ?? null;
  }
}

/**
 * Executa a escrita numa transação. `CatalogDenied` vira o registro `denied` na auditoria (fora
 * da transação, que não chegou a existir) e `403` `permission_denied`.
 */
export async function catalogWrite<T>(
  db: Database,
  request: CatalogRequest,
  work: (trx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction().execute(work);
  } catch (error) {
    if (!(error instanceof CatalogDenied)) throw error;
    await recordDenied(db, {
      context: catalogAuditContext(request),
      permission: error.permission,
      action: error.auditAction,
      targetType: error.targetType,
      targetId: error.targetId,
    });
    throw permissionDenied(error.detail);
  }
}

/**
 * Exige a ação para o recurso. Sem a ação no papel: `CatalogDenied` (`403`, auditado). Ação ◐ do
 * instrutor sobre curso alheio ou sem dono: `404` `not_found`, sem registro (não revela o curso).
 */
export function requireCatalogAction(
  request: CatalogRequest,
  action: PermissionAction,
  audit: { action: string; target: { type: CatalogTargetType; id: string | null } | null },
  courseOwnerId?: string | null,
): void {
  const resource = courseOwnerId === undefined ? undefined : { courseOwnerId };
  if (can(request.actor, action, resource)) return;
  if (permissionScope(request.actor, action) === 'own') throw notFound();
  throw new CatalogDenied(action, audit.action, audit.target);
}

/** Exige a ação com alcance total (o modo de acesso, que o instrutor não define). */
export function requireFullScope(
  request: CatalogRequest,
  action: PermissionAction,
  audit: { action: string; target: { type: CatalogTargetType; id: string | null } },
): void {
  if (permissionScope(request.actor, action) !== 'all') {
    throw new CatalogDenied(action, audit.action, audit.target);
  }
}

export async function catalogAudit(
  trx: Database,
  request: CatalogRequest,
  entry: {
    action: string;
    targetType: CatalogTargetType;
    targetId: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await recordAudit(trx, {
    context: catalogAuditContext(request),
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ...(entry.details ? { details: entry.details } : {}),
  });
}

/** Identificador fora do formato: `404`, como o inexistente. */
export function assertCatalogId(id: unknown, what = 'Item'): string {
  if (!isCatalogId(id)) throw notFound(`${what} não encontrado.`);
  return id.toLowerCase();
}

/** `409` `version_conflict` (spec 003). */
export function catalogVersionConflict(): DomainError {
  return conflict('version_conflict', 'O item foi alterado por outra pessoa. Recarregue.');
}

export function assertVersion(current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) throw catalogVersionConflict();
}

/** `409` `slug_taken` (spec 009, "Slug repetido"). */
export function slugTaken(): DomainError {
  return conflict('slug_taken', 'Já existe um produto deste tipo com este slug.');
}

/** `409` `product_has_links` (resposta à P2): o caminho é arquivar. */
export function productHasLinksError(): DomainError {
  return conflict(
    'product_has_links',
    'O produto tem pedido, direito ou progresso associado; arquive em vez de excluir.',
  );
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = error as { code?: unknown; constraint?: unknown } | null;
  return pg?.code === '23505' && pg.constraint === constraint;
}

/** Traduz a violação do único do slug em `409` `slug_taken`. */
export async function withSlugCheck<T>(constraint: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, constraint)) throw slugTaken();
    throw error;
  }
}

/** `422` com os campos (alvo inexistente de item, vínculo, capa, dono). */
export function catalogUnprocessable(
  code: string,
  detail: string,
  errors: readonly FieldError[],
): DomainError {
  return new DomainError({
    code,
    status: 422,
    title: 'Regra de negócio não atendida',
    detail,
    errors,
  });
}

/** `price_cents` vem do banco como texto (`bigint`). */
export function priceFromDb(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

// Modo de acesso, preço e validade (spec 009, "Modos de acesso"; 008, P3).

export interface CommercialState {
  accessMode: AccessMode;
  priceCents: number | null;
  accessDays: number | null;
}

export interface CommercialInput {
  accessMode?: unknown;
  priceCents?: unknown;
  accessDays?: unknown;
}

export interface CommercialChange {
  next: CommercialState;
  accessChanged: boolean;
  priceChanged: boolean;
  /** O preço foi limpo por a mudança para `open` (produto aberto não tem preço). */
  priceClearedByMode: boolean;
}

/** Lê os campos comerciais da entrada; omitido mantém o atual. */
export function readCommercialInput(
  errors: FieldErrors,
  input: CommercialInput,
): { accessMode?: AccessMode; priceCents?: number | null; accessDays?: number | null } {
  const out: { accessMode?: AccessMode; priceCents?: number | null; accessDays?: number | null } =
    {};
  if (input.accessMode !== undefined) {
    out.accessMode = readEnum(errors, input.accessMode, 'body.accessMode', ACCESS_MODES);
  }
  if (input.priceCents !== undefined) {
    out.priceCents = readNullableInteger(
      errors,
      input.priceCents,
      'body.priceCents',
      0,
      CATALOG_LIMITS.priceMaxCents,
    );
  }
  if (input.accessDays !== undefined) {
    out.accessDays = readNullableInteger(
      errors,
      input.accessDays,
      'body.accessDays',
      1,
      CATALOG_LIMITS.accessDaysMax,
    );
  }
  return out;
}

/**
 * Aplica a mudança comercial com as permissões da 008 (P3 da tarefa 400):
 *
 * - modo de acesso e validade (`access_days`): `product.set_access` com alcance total (gerente e
 *   admin; o instrutor só tem a parte da amostra grátis);
 * - preço: `product.set_price` (admin).
 *
 * Só conta como mudança o valor diferente do atual (o formulário pode reenviar tudo). Produto
 * `open` não tem preço: preço informado em produto aberto é `422` `price_not_allowed`, e passar
 * a `open` limpa o preço como consequência do modo. Na criação, o atual é o padrão do banco
 * (`open`, sem preço, vitalício).
 */
export function applyCommercialChange(
  request: CatalogRequest,
  current: CommercialState,
  wanted: { accessMode?: AccessMode; priceCents?: number | null; accessDays?: number | null },
  target: { type: CatalogProductType; id: string | null },
): CommercialChange {
  const accessMode = wanted.accessMode ?? current.accessMode;
  const accessDays = wanted.accessDays === undefined ? current.accessDays : wanted.accessDays;
  const accessChanged = accessMode !== current.accessMode || accessDays !== current.accessDays;
  if (accessChanged) {
    requireFullScope(request, 'product.set_access', { action: 'product.set_access', target });
  }
  let priceCents = wanted.priceCents === undefined ? current.priceCents : wanted.priceCents;
  let priceClearedByMode = false;
  if (accessMode === 'open' && priceCents !== null) {
    if (wanted.priceCents !== undefined && wanted.priceCents !== null) {
      throw catalogRule('price_not_allowed', 'Produto aberto não tem preço.');
    }
    priceCents = null;
    priceClearedByMode = current.priceCents !== null;
  }
  const priceChanged = !priceClearedByMode && priceCents !== current.priceCents;
  if (priceChanged && !can(request.actor, 'product.set_price')) {
    throw new CatalogDenied('product.set_price', 'product.set_price', target);
  }
  return {
    next: { accessMode, priceCents, accessDays },
    accessChanged,
    priceChanged,
    priceClearedByMode,
  };
}

/** Produto `paid` publicado precisa de preço (spec 009; decisão da tarefa 410: vale na publicação). */
export function assertPublishablePrice(state: CommercialState): void {
  if (state.accessMode === 'paid' && state.priceCents === null) {
    throw catalogRule('price_required', 'Produto pago precisa de preço antes de ser publicado.');
  }
}

/** Grava `product.set_access` e `product.set_price` quando mudaram. */
export async function auditCommercialChange(
  trx: Database,
  request: CatalogRequest,
  before: CommercialState,
  change: CommercialChange,
  target: { type: CatalogProductType; id: string },
): Promise<void> {
  if (change.accessChanged || change.priceClearedByMode) {
    await catalogAudit(trx, request, {
      action: 'product.set_access',
      targetType: target.type,
      targetId: target.id,
      details: {
        productType: target.type,
        accessMode: { from: before.accessMode, to: change.next.accessMode },
        accessDays: { from: before.accessDays, to: change.next.accessDays },
        ...(change.priceClearedByMode ? { priceCleared: { from: before.priceCents } } : {}),
      },
    });
  }
  if (change.priceChanged) {
    await catalogAudit(trx, request, {
      action: 'product.set_price',
      targetType: target.type,
      targetId: target.id,
      details: {
        productType: target.type,
        priceCents: { from: before.priceCents, to: change.next.priceCents },
      },
    });
  }
}

// Capa (spec 029: `product_cover`).

/** A capa precisa ser uma imagem `product_cover` existente e não oculta. */
export async function assertProductCover(
  trx: Database,
  imageId: string | null,
  path = 'body.coverImageId',
): Promise<void> {
  if (imageId === null) return;
  const image = await trx
    .selectFrom('images')
    .select('id')
    .where('id', '=', imageId)
    .where('purpose', '=', 'product_cover')
    .where('hiddenAt', 'is', null)
    .executeTakeFirst();
  if (!image) {
    throw catalogUnprocessable('cover_image_invalid', 'A capa não é uma imagem de produto.', [
      { path, message: 'Envie a capa com a finalidade product_cover.' },
    ]);
  }
}

// Vínculos que impedem a exclusão (direitos e progresso) e alunos afetados (`entitlements`).

/**
 * O produto tem vínculo que impede a exclusão (P2 da tarefa 400; spec 009, "Estados de
 * publicação")? Numa consulta: qualquer direito, vigente ou não, e, no curso, qualquer linha de
 * progresso de aula dele (`lesson_progress`, migration 0011), mesmo de quem nunca teve direito
 * (curso `open`). Os pedidos (`order_items`) entram aqui na Fase 3, na tarefa de vendas do
 * núcleo (spec 011), quando a tabela existir.
 */
export async function productHasLinks(
  trx: Database,
  productType: CatalogProductType,
  productId: string,
): Promise<boolean> {
  const row = await trx
    .selectNoFrom((eb) => {
      const entitlement = eb.exists(
        eb
          .selectFrom('entitlements')
          .select('id')
          .where('productType', '=', productType)
          .where('productId', '=', productId),
      );
      if (productType !== 'course') return entitlement.as('linked');
      return eb
        .or([
          entitlement,
          eb.exists(
            eb.selectFrom('lessonProgress').select('lessonId').where('courseId', '=', productId),
          ),
        ])
        .as('linked');
    })
    .executeTakeFirstOrThrow();
  return row.linked === true;
}

/**
 * Alunos com direito vigente ao produto (não revogado, já iniciado e não vencido): o número do
 * aviso antes de despublicar e de remover item de pacote (spec 009).
 */
export async function countActiveEntitlementHolders(
  db: Database,
  productType: CatalogProductType,
  productId: string,
): Promise<number> {
  const row = await db
    .selectFrom('entitlements')
    .select(sql<number>`count(DISTINCT user_id)::int`.as('count'))
    .where('productType', '=', productType)
    .where('productId', '=', productId)
    .where('revokedAt', 'is', null)
    .where(sql<boolean>`starts_at <= now()`)
    .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', sql<Date>`now()`)]))
    .executeTakeFirstOrThrow();
  return row.count;
}

// Fila (spec 005, 010 e 014), sempre na transação da escrita.

/**
 * Enfileira `entitlement.recompute` para cada produto pai, sem repetir na mesma chamada. Sem
 * `unique_key`: uma tarefa em execução pode ter lido a composição antiga, então a nova precisa
 * rodar depois dela.
 */
export async function enqueueRecomputes(
  trx: Database,
  parents: Iterable<{ productType: EntitlementRecomputeProductType; productId: string }>,
): Promise<void> {
  const seen = new Set<string>();
  for (const parent of parents) {
    const key = `${parent.productType}:${parent.productId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await enqueue(trx, 'entitlement.recompute', parent);
  }
}

/** Aula publicada saiu do curso publicado: quem já tinha as demais pode ter chegado a 100%. */
export async function enqueueCompletionCheck(trx: Database, courseId: string): Promise<void> {
  await enqueue(trx, 'course.completion_check', { courseId });
}

/** Pacotes que contêm o produto (para o recálculo quando o item some). */
export async function bundlesContaining(
  trx: Database,
  productType: 'course' | 'ebook',
  productId: string,
): Promise<string[]> {
  const rows = await trx
    .selectFrom('bundleItems')
    .select('bundleId')
    .where('productType', '=', productType)
    .where('productId', '=', productId)
    .execute();
  return rows.map((row) => row.bundleId);
}

/** Produto pai do recálculo para um vínculo de ebook (aula recalcula o curso da aula). */
export async function recomputeParentOfTarget(
  trx: Database,
  target: { targetType: string; targetId: string },
): Promise<{ productType: EntitlementRecomputeProductType; productId: string } | null> {
  if (target.targetType === 'course' || target.targetType === 'bundle') {
    return { productType: target.targetType, productId: target.targetId };
  }
  const row = await trx
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select('modules.courseId')
    .where('lessons.id', '=', target.targetId)
    .executeTakeFirst();
  return row ? { productType: 'course', productId: row.courseId } : null;
}

/** Antes e depois dos campos que mudaram; descrições longas vão só como "alterado". */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  longFields: readonly string[] = ['description'],
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    const same =
      old instanceof Date && value instanceof Date
        ? old.getTime() === value.getTime()
        : old === value;
    if (same) continue;
    changes[key] = longFields.includes(key) ? { changed: true } : { from: old, to: value };
  }
  return changes;
}
