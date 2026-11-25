import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  ENTITLEMENT_COLUMNS,
  ENTITLEMENT_DELETED_USER_NAME,
  ENTITLEMENT_MISSING_PRODUCT_TITLE,
  type EntitlementProductRef,
  type EntitlementProductType,
  type EntitlementRevokeReason,
  type EntitlementSource,
  type EntitlementState,
  entitlementStateSql,
} from './types.ts';

// Leitura dos direitos como as rotas os devolvem (`EntitlementNode` do contrato do admin).

/** Um direito com os derivados (`EntitlementNode`). */
export interface EntitlementView {
  id: string;
  product: EntitlementProductRef;
  source: EntitlementSource;
  sourceId: string;
  parentEntitlementId: string | null;
  state: EntitlementState;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokeReason: EntitlementRevokeReason | null;
  grantedReason: string | null;
  /** Quem concedeu, só em `grant`. */
  grantedBy: { id: string; name: string } | null;
  createdAt: Date;
  children: EntitlementView[];
}

/** Título do produto pelo tipo, numa expressão (junções à esquerda nas três tabelas). */
export function productTitleSql(alias = 'entitlements') {
  const t = sql.table(alias);
  return sql<string | null>`CASE ${t}.product_type
    WHEN 'course' THEN (SELECT title FROM courses WHERE id = ${t}.product_id)
    WHEN 'bundle' THEN (SELECT title FROM bundles WHERE id = ${t}.product_id)
    WHEN 'ebook' THEN (SELECT title FROM ebooks WHERE id = ${t}.product_id) END`;
}

export function productSlugSql(alias = 'entitlements') {
  const t = sql.table(alias);
  return sql<string | null>`CASE ${t}.product_type
    WHEN 'course' THEN (SELECT slug FROM courses WHERE id = ${t}.product_id)
    WHEN 'bundle' THEN (SELECT slug FROM bundles WHERE id = ${t}.product_id)
    WHEN 'ebook' THEN (SELECT slug FROM ebooks WHERE id = ${t}.product_id) END`;
}

type Filter = { userId: string } | { rootIds: readonly string[] };

/**
 * Os direitos do filtro (todos os de um usuário, ou as árvores das raízes dadas), já em árvore:
 * raízes mais recentes primeiro, filhos na ordem de criação. Uma consulta.
 */
export async function loadEntitlementTrees(
  db: Database,
  filter: Filter,
): Promise<EntitlementView[]> {
  let query = db
    .selectFrom('entitlements')
    .leftJoin('users as granter', (join) =>
      join
        .onRef('granter.id', '=', 'entitlements.sourceId')
        .on('entitlements.source', '=', 'grant'),
    )
    .select([
      ...ENTITLEMENT_COLUMNS,
      'granter.name as granterName',
      'granter.deletedAt as granterDeletedAt',
      entitlementStateSql().as('state'),
      productTitleSql().as('productTitle'),
    ]);
  if ('userId' in filter) {
    query = query.where('entitlements.userId', '=', filter.userId);
  } else {
    const ids = [...filter.rootIds];
    if (ids.length === 0) return [];
    query = query.where((eb) =>
      eb.or([
        eb('entitlements.id', 'in', ids),
        eb('entitlements.parentEntitlementId', 'in', ids),
        eb(
          'entitlements.parentEntitlementId',
          'in',
          eb
            .selectFrom('entitlements as p')
            .select('p.id')
            .where('p.parentEntitlementId', 'in', ids),
        ),
      ]),
    );
  }
  const rows = await query
    .orderBy('entitlements.createdAt', 'asc')
    .orderBy('entitlements.id', 'asc')
    .execute();

  const views = new Map<string, EntitlementView>();
  for (const row of rows) {
    views.set(row.id, {
      id: row.id,
      product: {
        type: row.productType as EntitlementProductType,
        id: row.productId,
        title: row.productTitle ?? ENTITLEMENT_MISSING_PRODUCT_TITLE,
      },
      source: row.source as EntitlementSource,
      sourceId: row.sourceId,
      parentEntitlementId: row.parentEntitlementId,
      state: row.state,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      revokeReason: row.revokeReason as EntitlementRevokeReason | null,
      grantedReason: row.grantedReason,
      grantedBy:
        row.source === 'grant'
          ? {
              id: row.sourceId,
              name:
                row.granterName === null || row.granterDeletedAt !== null
                  ? ENTITLEMENT_DELETED_USER_NAME
                  : row.granterName,
            }
          : null,
      createdAt: row.createdAt,
      children: [],
    });
  }
  const roots: EntitlementView[] = [];
  for (const view of views.values()) {
    const parent = view.parentEntitlementId ? views.get(view.parentEntitlementId) : undefined;
    if (parent) parent.children.push(view);
    else if (view.parentEntitlementId === null) roots.push(view);
  }
  return roots.reverse();
}
