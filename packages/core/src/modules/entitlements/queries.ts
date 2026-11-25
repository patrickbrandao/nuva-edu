import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, notFound, validationFailed } from '../../errors/domain-error.ts';
import { type ManagementRequest, requirePermission } from '../accounts/management/common.ts';
import { avatarUrlFor } from '../accounts/session-view.ts';
import { findEntitlementProduct } from './grant.ts';
import {
  ENTITLEMENT_DELETED_USER_NAME,
  ENTITLEMENT_MISSING_PRODUCT_TITLE,
  ENTITLEMENT_PAGE_DEFAULT_LIMIT,
  ENTITLEMENT_PAGE_MAX_LIMIT,
  type EntitlementProductRef,
  type EntitlementProductType,
  type EntitlementSource,
  type EntitlementState,
  entitlementStateSql,
  isEntitlementProductType,
  isEntitlementState,
  isUuid,
} from './types.ts';
import { productSlugSql, productTitleSql } from './views.ts';

// Listas de leitura: quem tem acesso a um produto (admin) e o que o aluno tem (classroom).

/** Um direito na lista de um produto (`ProductEntitlement`). */
export interface ProductEntitlementItem {
  id: string;
  user: { id: string; name: string; avatarUrl: string | null };
  source: EntitlementSource;
  /** Produto da raiz, quando o direito é derivado. */
  via: EntitlementProductRef | null;
  state: EntitlementState;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface ProductEntitlementQuery {
  productType: EntitlementProductType;
  productId: string;
  /** Padrão: `active`. */
  state?: EntitlementState;
  limit?: number;
  cursor?: string;
}

export interface ProductEntitlementPage {
  items: ProductEntitlementItem[];
  nextCursor: string | null;
}

const CURSOR_PREFIX = 'entitlements:';

function encodeCursor(state: EntitlementState, id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${state}:${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, state: EntitlementState): string | undefined {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const prefix = `${CURSOR_PREFIX}${state}:`;
  if (!text.startsWith(prefix)) return undefined;
  const id = text.slice(prefix.length);
  return isUuid(id) ? id : undefined;
}

/**
 * `GET /products/{type}/{id}/entitlements`: um item por direito ao produto (raiz ou derivado),
 * mais recente primeiro, filtrado por `state` (padrão `active`), paginado por cursor opaco.
 * Exige `entitlement.manage` (negação na auditoria). Parâmetro fora do formato: `400`;
 * produto inexistente: `404`. Duas consultas.
 */
export async function listProductEntitlements(
  db: Database,
  request: ManagementRequest,
  query: ProductEntitlementQuery,
): Promise<ProductEntitlementPage> {
  await requirePermission(db, request, 'entitlement.manage', { action: 'entitlement.list' });
  const errors: FieldError[] = [];
  if (!isEntitlementProductType(query.productType)) {
    errors.push({ path: 'path.type', message: 'Use course, bundle ou ebook.' });
  }
  const state = query.state ?? 'active';
  if (!isEntitlementState(state)) {
    errors.push({ path: 'query.state', message: 'Estado inválido.' });
  }
  const limit = query.limit ?? ENTITLEMENT_PAGE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > ENTITLEMENT_PAGE_MAX_LIMIT) {
    errors.push({ path: 'query.limit', message: `Use de 1 a ${ENTITLEMENT_PAGE_MAX_LIMIT}.` });
  }
  let afterId: string | undefined;
  if (query.cursor !== undefined && errors.length === 0) {
    afterId = decodeCursor(query.cursor, state);
    if (afterId === undefined) errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
  }
  if (errors.length > 0) throw validationFailed(errors);
  const product = await findEntitlementProduct(db, query.productType, query.productId);
  if (!product) throw notFound('Produto não encontrado.');

  let rows = db
    .selectFrom('entitlements')
    .innerJoin('users', 'users.id', 'entitlements.userId')
    .leftJoin('profiles', 'profiles.userId', 'users.id')
    .leftJoin('entitlements as p', 'p.id', 'entitlements.parentEntitlementId')
    .leftJoin('entitlements as gp', 'gp.id', 'p.parentEntitlementId')
    .select([
      'entitlements.id',
      'entitlements.source',
      'entitlements.startsAt',
      'entitlements.expiresAt',
      'entitlements.revokedAt',
      'users.id as userId',
      'users.name as userName',
      'users.deletedAt as userDeletedAt',
      'profiles.avatarImageId',
      sql<string | null>`coalesce(gp.product_type, p.product_type)`.as('rootProductType'),
      sql<string | null>`coalesce(gp.product_id, p.product_id)`.as('rootProductId'),
      entitlementStateSql().as('state'),
    ])
    .where('entitlements.productType', '=', product.type)
    .where('entitlements.productId', '=', product.id)
    .where(entitlementStateSql(), '=', state);
  if (afterId !== undefined) rows = rows.where('entitlements.id', '<', afterId);
  const page = await rows
    .orderBy('entitlements.id', 'desc')
    .limit(limit + 1)
    .execute();

  const hasMore = page.length > limit;
  const items = page.slice(0, limit);
  const titles = await titlesOf(
    db,
    items
      .filter((row) => row.rootProductType !== null && row.rootProductId !== null)
      .map((row) => ({
        type: row.rootProductType as EntitlementProductType,
        id: row.rootProductId as string,
      })),
  );
  const last = items[items.length - 1];
  return {
    items: items.map((row) => ({
      id: row.id,
      user: {
        id: row.userId,
        name: row.userDeletedAt === null ? row.userName : ENTITLEMENT_DELETED_USER_NAME,
        avatarUrl: avatarUrlFor(row.avatarImageId),
      },
      source: row.source as EntitlementSource,
      via:
        row.rootProductType && row.rootProductId
          ? {
              type: row.rootProductType as EntitlementProductType,
              id: row.rootProductId,
              title:
                titles.get(`${row.rootProductType}:${row.rootProductId}`) ??
                ENTITLEMENT_MISSING_PRODUCT_TITLE,
            }
          : null,
      state: row.state,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    })),
    nextCursor: hasMore && last ? encodeCursor(state, last.id) : null,
  };
}

async function titlesOf(
  db: Database,
  products: readonly { type: EntitlementProductType; id: string }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (products.length === 0) return map;
  const byType = (type: EntitlementProductType) => [
    ...new Set(products.filter((product) => product.type === type).map((product) => product.id)),
  ];
  const courses = byType('course');
  const bundles = byType('bundle');
  const ebooks = byType('ebook');
  const result = await sql<{ type: string; id: string; title: string }>`
    SELECT 'course' AS type, id, title FROM courses WHERE id = ANY(${courses}::uuid[])
    UNION ALL SELECT 'bundle', id, title FROM bundles WHERE id = ANY(${bundles}::uuid[])
    UNION ALL SELECT 'ebook', id, title FROM ebooks WHERE id = ANY(${ebooks}::uuid[])`.execute(db);
  for (const row of result.rows) map.set(`${row.type}:${row.id}`, row.title);
  return map;
}

/** Um direito do aluno (`MyEntitlement` do classroom). */
export interface MyEntitlement {
  id: string;
  productType: EntitlementProductType;
  productId: string;
  productSlug: string;
  productTitle: string;
  source: EntitlementSource;
  /** Produto da raiz, quando o direito vem em cascata. */
  via: { productType: EntitlementProductType; productTitle: string } | null;
  state: 'active' | 'scheduled' | 'expired';
  startsAt: Date;
  expiresAt: Date | null;
}

/**
 * `GET /me/entitlements`: os direitos do próprio usuário, raízes e derivados, inclusive os
 * vencidos e sem os revogados, mais recentes primeiro. Uma consulta. Direito a produto que não
 * existe mais fica de fora.
 */
export async function listMyEntitlements(
  db: Database,
  userId: string,
): Promise<{ items: MyEntitlement[] }> {
  if (!isUuid(userId)) return { items: [] };
  const rows = await db
    .selectFrom('entitlements')
    .leftJoin('entitlements as p', 'p.id', 'entitlements.parentEntitlementId')
    .leftJoin('entitlements as gp', 'gp.id', 'p.parentEntitlementId')
    .select([
      'entitlements.id',
      'entitlements.productType',
      'entitlements.productId',
      'entitlements.source',
      'entitlements.startsAt',
      'entitlements.expiresAt',
      entitlementStateSql().as('state'),
      productTitleSql().as('productTitle'),
      productSlugSql().as('productSlug'),
      sql<string | null>`coalesce(gp.product_type, p.product_type)`.as('viaType'),
      sql<string | null>`CASE WHEN gp.id IS NOT NULL THEN ${productTitleSql('gp')}
        WHEN p.id IS NOT NULL THEN ${productTitleSql('p')} END`.as('viaTitle'),
    ])
    .where('entitlements.userId', '=', userId.toLowerCase())
    .where('entitlements.revokedAt', 'is', null)
    .orderBy('entitlements.createdAt', 'desc')
    .orderBy('entitlements.id', 'desc')
    .execute();
  return {
    items: rows
      .filter((row) => row.productTitle !== null && row.productSlug !== null)
      .map((row) => ({
        id: row.id,
        productType: row.productType as EntitlementProductType,
        productId: row.productId,
        productSlug: row.productSlug as string,
        productTitle: row.productTitle as string,
        source: row.source as EntitlementSource,
        via:
          row.viaType !== null
            ? {
                productType: row.viaType as EntitlementProductType,
                productTitle: row.viaTitle ?? ENTITLEMENT_MISSING_PRODUCT_TITLE,
              }
            : null,
        state: row.state as MyEntitlement['state'],
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
      })),
  };
}
