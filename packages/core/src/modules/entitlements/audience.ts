import { type RawBuilder, type SqlBool, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { businessRule } from '../../errors/domain-error.ts';

// Público de eventos e novidades (specs 018 e 025): `all`, `active` ou `product`. A regra é uma
// só para os dois recursos, escrita em SQL para servir às leituras (o que o usuário vê) e à
// busca de destinatários (quem é avisado), sempre a partir de `entitlements` (spec 010).

export const AUDIENCES = ['all', 'active', 'product'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_PRODUCT_TYPES = ['course', 'bundle', 'ebook'] as const;
export type AudienceProductType = (typeof AUDIENCE_PRODUCT_TYPES)[number];

export interface AudienceProduct {
  productType: AudienceProductType;
  productId: string;
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

/** Tabela dos produtos do público `product` e a coluna que aponta para o dono. */
export interface AudienceSource {
  /** Coluna `audience` do recurso, já qualificada. */
  audience: RawBuilder<string>;
  /** `event_products` ou `announcement_products`. */
  productsTable: 'event_products' | 'announcement_products';
  /** `event_id` ou `announcement_id`. */
  ownerColumn: 'event_id' | 'announcement_id';
  /** Id do recurso, já qualificado. */
  ownerId: RawBuilder<string>;
}

const ACTIVE_ENTITLEMENT = sql`e.revoked_at IS NULL AND e.starts_at <= now()
  AND (e.expires_at IS NULL OR e.expires_at > now())`;

/**
 * O usuário pertence ao público: `all`, qualquer cadastrado; `active`, quem tem direito ativo
 * a produto não `open`; `product`, quem tem direito ativo a um dos produtos listados. Não
 * inclui a equipe: é a regra de quem é avisado.
 */
export function audienceMember(
  source: AudienceSource,
  userId: RawBuilder<string>,
): RawBuilder<SqlBool> {
  return sql<SqlBool>`(
    ${source.audience} = 'all'
    OR (${source.audience} = 'active' AND EXISTS (
      SELECT 1 FROM entitlements e
        LEFT JOIN courses c ON e.product_type = 'course' AND c.id = e.product_id
        LEFT JOIN ebooks k ON e.product_type = 'ebook' AND k.id = e.product_id
        LEFT JOIN bundles b ON e.product_type = 'bundle' AND b.id = e.product_id
      WHERE e.user_id = ${userId} AND ${ACTIVE_ENTITLEMENT}
        AND coalesce(c.access_mode, k.access_mode, b.access_mode) <> 'open'
    ))
    OR (${source.audience} = 'product' AND EXISTS (
      SELECT 1 FROM entitlements e
        JOIN ${sql.table(source.productsTable)} ap
          ON ap.product_type = e.product_type AND ap.product_id = e.product_id
      WHERE ap.${sql.ref(source.ownerColumn)} = ${source.ownerId}
        AND e.user_id = ${userId} AND ${ACTIVE_ENTITLEMENT}
    ))
  )`;
}

/** Quem acessa o conteúdo restrito: o público, mais a equipe (que sempre vê). */
export function audienceAccess(
  source: AudienceSource,
  user: { id: RawBuilder<string>; role: RawBuilder<string> },
): RawBuilder<SqlBool> {
  return sql<SqlBool>`(${user.role} IN ('instructor', 'manager', 'admin')
    OR ${audienceMember(source, user.id)})`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AUDIENCE_PRODUCTS_MAX = 50;

/**
 * Confere a lista de produtos do público `product`: tipo conhecido, id existente, sem
 * repetição. Fora do formato ou inexistente: `422` com o `code` recebido.
 */
export async function resolveAudienceProducts(
  db: Database,
  value: unknown,
  code: string,
): Promise<AudienceProduct[]> {
  const invalid = () => businessRule(code, 'A lista de produtos do público é inválida.');
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > AUDIENCE_PRODUCTS_MAX) throw invalid();
  const unique = new Map<string, AudienceProduct>();
  for (const item of value as unknown[]) {
    const { productType, productId } = (item ?? {}) as Record<string, unknown>;
    if (
      typeof productType !== 'string' ||
      !(AUDIENCE_PRODUCT_TYPES as readonly string[]).includes(productType) ||
      typeof productId !== 'string' ||
      !UUID_PATTERN.test(productId)
    ) {
      throw invalid();
    }
    const id = productId.toLowerCase();
    unique.set(`${productType}:${id}`, {
      productType: productType as AudienceProductType,
      productId: id,
    });
  }
  const products = [...unique.values()];
  for (const type of AUDIENCE_PRODUCT_TYPES) {
    const ids = products.filter((item) => item.productType === type).map((item) => item.productId);
    if (ids.length === 0) continue;
    const table = type === 'course' ? 'courses' : type === 'bundle' ? 'bundles' : 'ebooks';
    const found = await db.selectFrom(table).select('id').where('id', 'in', ids).execute();
    if (found.length !== ids.length) throw invalid();
  }
  return products;
}

/** Produtos do público com título e slug, para o bloqueio mostrar o caminho de acesso. */
export interface AudienceProductRef extends AudienceProduct {
  title: string;
  slug: string;
}

export async function readAudienceProducts(
  db: Database,
  source: Pick<AudienceSource, 'productsTable' | 'ownerColumn'>,
  ownerIds: readonly string[],
): Promise<Map<string, AudienceProductRef[]>> {
  const byOwner = new Map<string, AudienceProductRef[]>();
  if (ownerIds.length === 0) return byOwner;
  const result = await sql<AudienceProductRef & { ownerId: string }>`
    SELECT ap.${sql.ref(source.ownerColumn)} AS owner_id, ap.product_type, ap.product_id,
      coalesce(c.title, k.title, b.title) AS title, coalesce(c.slug, k.slug, b.slug) AS slug
    FROM ${sql.table(source.productsTable)} ap
      LEFT JOIN courses c ON ap.product_type = 'course' AND c.id = ap.product_id
      LEFT JOIN ebooks k ON ap.product_type = 'ebook' AND k.id = ap.product_id
      LEFT JOIN bundles b ON ap.product_type = 'bundle' AND b.id = ap.product_id
    WHERE ap.${sql.ref(source.ownerColumn)} IN (${sql.join(ownerIds)})
      AND coalesce(c.id, k.id, b.id) IS NOT NULL
    ORDER BY title
  `.execute(db);
  for (const { ownerId, ...product } of result.rows) {
    byOwner.set(ownerId, [...(byOwner.get(ownerId) ?? []), product]);
  }
  return byOwner;
}

export interface AudienceViewer {
  id: string;
  role: string;
  createdAt: Date;
}

/**
 * O usuário logado que lê eventos e novidades. Conta inexistente, removida ou com suspensão
 * `full`: `null` (quem chama responde `401`, como toda rota privada).
 */
export async function getAudienceViewer(
  db: Database,
  userId: string,
): Promise<AudienceViewer | null> {
  if (!UUID_PATTERN.test(userId)) return null;
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'createdAt', 'suspendedKind'])
    .where('id', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!user || user.suspendedKind === 'full') return null;
  return { id: user.id, role: user.role, createdAt: user.createdAt };
}

/** Ids dos usuários ativos (sem suspensão) que pertencem ao público do recurso. */
export async function listAudienceMembers(
  db: Database,
  source: Pick<AudienceSource, 'productsTable' | 'ownerColumn'>,
  resource: { table: 'events' | 'announcements'; id: string },
): Promise<string[]> {
  const full: AudienceSource = {
    ...source,
    audience: sql.ref('r.audience'),
    ownerId: sql.ref('r.id'),
  };
  const result = await sql<{ id: string }>`
    SELECT u.id FROM users u CROSS JOIN ${sql.table(resource.table)} r
    WHERE r.id = ${resource.id} AND u.deleted_at IS NULL AND u.suspended_kind IS NULL
      AND ${audienceMember(full, sql.ref('u.id'))}
  `.execute(db);
  return result.rows.map(({ id }) => id);
}
