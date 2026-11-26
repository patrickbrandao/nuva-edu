import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import type { AccessMode } from '../catalog/fields.ts';
import { type CatalogCover, catalogCover } from '../catalog/read-common.ts';
import { expandCascade } from '../entitlements/cascade.ts';
import {
  type CartItemUnsellableReason,
  type CartUnlock,
  centsOrNull,
  type SalesProductRef,
  type SalesProductType,
} from './types.ts';

// Leitura do produto para a cesta e o fechamento do pedido (spec 011): preço atual, modo de
// acesso, publicação e a cascata que a compra libera. A escrita do catálogo é da tarefa 410;
// aqui só se lê, por cima das tabelas da migration 0009.

/** Produto como a cesta enxerga (curso, pacote ou ebook, pelo tipo). */
export interface SalesProduct {
  type: SalesProductType;
  id: string;
  title: string;
  cover: CatalogCover | null;
  accessMode: AccessMode;
  accessDays: number | null;
  /** Preço atual; `null` quando o produto não tem preço (modo `open` ou `private`). */
  priceCents: number | null;
  status: string;
  publishedAt: Date | null;
  archivedAt: Date | null;
}

export function salesProductKey(productType: SalesProductType, productId: string): string {
  return `${productType}:${productId}`;
}

/** Um produto do catálogo pelo tipo, ou `undefined` se não existe mais. */
export async function loadSalesProduct(
  db: Database,
  productType: SalesProductType,
  productId: string,
): Promise<SalesProduct | undefined> {
  const products = await loadSalesProducts(db, [{ productType, productId }]);
  return products.get(salesProductKey(productType, productId));
}

/**
 * Carrega vários produtos de tipos misturados em uma consulta por tipo usado. Produto
 * inexistente simplesmente não aparece no mapa (sem chave estrangeira, o id pode ter sobrado).
 */
export async function loadSalesProducts(
  db: Database,
  refs: readonly SalesProductRef[],
): Promise<Map<string, SalesProduct>> {
  const ids = new Map<SalesProductType, string[]>();
  for (const ref of refs) {
    const list = ids.get(ref.productType) ?? [];
    if (!list.includes(ref.productId)) list.push(ref.productId);
    ids.set(ref.productType, list);
  }
  const byType = await Promise.all(
    [...ids].map(async ([type, list]) => ({
      type,
      rows: await loadProductsOfType(db, type, list),
    })),
  );
  const products = new Map<string, SalesProduct>();
  for (const { type, rows } of byType) {
    for (const row of rows) {
      products.set(salesProductKey(type, row.id), {
        type,
        id: row.id,
        title: row.title,
        cover: catalogCover(row.coverImageId),
        accessMode: row.accessMode as AccessMode,
        accessDays: row.accessDays,
        priceCents: centsOrNull(row.priceCents),
        status: row.status,
        publishedAt: row.publishedAt,
        archivedAt: row.archivedAt,
      });
    }
  }
  return products;
}

interface ProductRow {
  id: string;
  title: string;
  coverImageId: string | null;
  accessMode: string;
  accessDays: number | null;
  priceCents: string | null;
  status: string;
  publishedAt: Date | null;
  archivedAt: Date | null;
}

function loadProductsOfType(
  db: Database,
  productType: SalesProductType,
  ids: readonly string[],
): Promise<ProductRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  const table =
    productType === 'course' ? 'courses' : productType === 'bundle' ? 'bundles' : 'ebooks';
  return db
    .selectFrom(table)
    .select([
      'id',
      'title',
      'coverImageId',
      'accessMode',
      'accessDays',
      'priceCents',
      'status',
      'publishedAt',
      'archivedAt',
    ])
    .where('id', 'in', ids)
    .execute() as unknown as Promise<ProductRow[]>;
}

/** Motivo de o produto não poder ser vendido agora (spec 011, "Cesta"), ou `null` se pode. */
export function unsellableReason(product: SalesProduct): CartItemUnsellableReason | null {
  if (product.archivedAt !== null) return 'archived';
  if (product.status !== 'published' || product.publishedAt === null) return 'unpublished';
  if (product.accessMode !== 'paid') return 'not_paid';
  return null;
}

export function isSellable(product: SalesProduct | undefined): product is SalesProduct {
  return product !== undefined && unsellableReason(product) === null;
}

/**
 * O que a compra do item libera além dele (contrato `CartUnlock`): os filhos diretos sem `via` e
 * os ebooks sob um curso com `via` = curso. Ebook não libera nada. Produto removido do catálogo
 * é omitido.
 */
export async function loadCartUnlocks(
  db: Database,
  productType: SalesProductType,
  productId: string,
): Promise<CartUnlock[]> {
  if (productType === 'ebook') return [];
  const tree = await expandCascade(db, productType, productId);
  if (tree.length === 0) return [];
  const refs: SalesProductRef[] = [];
  for (const node of tree) {
    refs.push({ productType: node.productType, productId: node.productId });
    for (const child of node.children) {
      refs.push({ productType: child.productType, productId: child.productId });
    }
  }
  // O título do curso que serve de `via` também vem do catálogo.
  refs.push({ productType, productId });
  const products = await loadSalesProducts(db, refs);
  const title = (type: SalesProductType, id: string): string | undefined =>
    products.get(salesProductKey(type, id))?.title;
  const unlocks: CartUnlock[] = [];
  for (const node of tree) {
    const nodeTitle = title(node.productType, node.productId);
    if (nodeTitle === undefined) continue;
    unlocks.push({
      productType: node.productType,
      productId: node.productId,
      title: nodeTitle,
      via: null,
    });
    const courseTitle = node.productType === 'course' ? nodeTitle : undefined;
    for (const child of node.children) {
      const childTitle = title(child.productType, child.productId);
      if (childTitle === undefined || courseTitle === undefined) continue;
      unlocks.push({
        productType: child.productType,
        productId: child.productId,
        title: childTitle,
        via: { productType: 'course', title: courseTitle },
      });
    }
  }
  return unlocks;
}

/** Títulos dos produtos de um pedido (para a exportação e as listagens do admin). */
export async function loadProductTitles(
  db: Database,
  refs: readonly SalesProductRef[],
): Promise<Map<string, string>> {
  const products = await loadSalesProducts(db, refs);
  const titles = new Map<string, string>();
  for (const [key, product] of products) titles.set(key, product.title);
  return titles;
}

/** Cobertura de um pacote: cursos e ebooks de `bundle_items` e ebooks com alvo no pacote. */
export async function bundleChildKeys(db: Database, bundleId: string): Promise<string[]> {
  const rows = await sql<{ productType: SalesProductType; productId: string }>`
    SELECT product_type AS "productType", product_id AS "productId"
      FROM bundle_items WHERE bundle_id = ${bundleId}::uuid
    UNION
    SELECT 'ebook', ebook_id FROM product_ebooks
     WHERE target_type = 'bundle' AND target_id = ${bundleId}::uuid`
    .execute(db)
    .then((result) => result.rows);
  return rows.map((row) => salesProductKey(row.productType, row.productId));
}
