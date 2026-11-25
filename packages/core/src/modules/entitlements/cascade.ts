import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import type { EntitlementProductType } from './types.ts';

// Expansão da cascata (spec 010, "Algoritmo de concessão", passos 2 a 4), lida direto das
// tabelas do catálogo (0009): `bundle_items` e `product_ebooks`. Só leitura; quem grava é
// `grant.ts` e `recalculate.ts`.

/** Um filho esperado na árvore de uma raiz, com os próprios filhos. */
export interface CascadeNode {
  productType: 'course' | 'ebook';
  productId: string;
  children: CascadeNode[];
}

export function productKey(productType: string, productId: string): string {
  return `${productType}:${productId}`;
}

/**
 * Árvore esperada abaixo de um produto:
 *
 * - pacote → cursos e ebooks de `bundle_items`, mais os ebooks de `product_ebooks` com alvo no
 *   pacote (009: "equivale a incluir o ebook no pacote");
 * - curso → ebooks de `product_ebooks` com alvo no curso ou numa aula dele;
 * - ebook → nada.
 *
 * Profundidade máxima 2. Ebook alcançado por dois caminhos na mesma raiz aparece uma vez, no
 * primeiro caminho em largura: os filhos diretos do pacote vêm antes dos ebooks dos cursos, e os
 * cursos na ordem de `position`. Itens apontando para produto inexistente são ignorados.
 * Custa 1 consulta (curso) ou 2 (pacote).
 */
export async function expandCascade(
  db: Database,
  productType: EntitlementProductType,
  productId: string,
): Promise<CascadeNode[]> {
  if (productType === 'ebook') return [];
  if (productType === 'course') {
    const ebooks = await ebooksOfCourses(db, [productId]);
    return (ebooks.get(productId) ?? []).map(ebookNode);
  }
  const items = await sql<{ productType: 'course' | 'ebook'; productId: string }>`
    SELECT t.product_type, t.product_id FROM (
      SELECT bi.product_type, bi.product_id, 0 AS rank, bi.position, bi.product_id::text AS tie
        FROM bundle_items bi
       WHERE bi.bundle_id = ${productId}
         AND ((bi.product_type = 'course' AND EXISTS (SELECT 1 FROM courses c WHERE c.id = bi.product_id))
           OR (bi.product_type = 'ebook' AND EXISTS (SELECT 1 FROM ebooks k WHERE k.id = bi.product_id)))
      UNION ALL
      SELECT 'ebook', pe.ebook_id, 1, 0, pe.ebook_id::text
        FROM product_ebooks pe
       WHERE pe.target_type = 'bundle' AND pe.target_id = ${productId}
    ) t
    ORDER BY t.rank, t.position, t.tie`.execute(db);

  const seen = new Set<string>();
  const nodes: CascadeNode[] = [];
  const courses: CascadeNode[] = [];
  for (const item of items.rows) {
    const key = productKey(item.productType, item.productId);
    if (seen.has(key)) continue;
    seen.add(key);
    const node: CascadeNode = {
      productType: item.productType,
      productId: item.productId,
      children: [],
    };
    nodes.push(node);
    if (item.productType === 'course') courses.push(node);
  }
  if (courses.length > 0) {
    const ebooks = await ebooksOfCourses(
      db,
      courses.map((course) => course.productId),
    );
    for (const course of courses) {
      for (const ebookId of ebooks.get(course.productId) ?? []) {
        const key = productKey('ebook', ebookId);
        if (seen.has(key)) continue;
        seen.add(key);
        course.children.push(ebookNode(ebookId));
      }
    }
  }
  return nodes;
}

function ebookNode(ebookId: string): CascadeNode {
  return { productType: 'ebook', productId: ebookId, children: [] };
}

/** Ebooks vinculados a cada curso, diretamente ou por uma aula dele, em ordem de id. */
async function ebooksOfCourses(db: Database, courseIds: string[]): Promise<Map<string, string[]>> {
  const result = await sql<{ courseId: string; ebookId: string }>`
    SELECT DISTINCT t.course_id, t.ebook_id FROM (
      SELECT pe.target_id AS course_id, pe.ebook_id
        FROM product_ebooks pe
       WHERE pe.target_type = 'course' AND pe.target_id = ANY(${courseIds}::uuid[])
      UNION
      SELECT m.course_id, pe.ebook_id
        FROM product_ebooks pe
        JOIN lessons l ON l.id = pe.target_id
        JOIN modules m ON m.id = l.module_id
       WHERE pe.target_type = 'lesson' AND m.course_id = ANY(${courseIds}::uuid[])
    ) t
    ORDER BY t.course_id, t.ebook_id`.execute(db);
  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const list = map.get(row.courseId) ?? [];
    list.push(row.ebookId);
    map.set(row.courseId, list);
  }
  return map;
}

/** Quantidade de nós de uma árvore esperada (sem a raiz). */
export function countCascade(nodes: readonly CascadeNode[]): number {
  let total = 0;
  for (const node of nodes) total += 1 + countCascade(node.children);
  return total;
}

/** Um direito já gravado que serve de pai para derivados. */
export interface CascadeParent {
  id: string;
  userId: string;
  sourceId: string;
  startsAt: Date;
  expiresAt: Date | null;
}

export interface CascadeInsert {
  parent: CascadeParent;
  node: CascadeNode;
}

/**
 * Grava derivados `cascade` (mesmo dono, `source_id`, `starts_at` e `expires_at` do pai) e, em
 * seguida, os filhos deles, um nível por instrução. Idempotente pelo índice único parcial: o que
 * já existe ativo sob o mesmo pai não é duplicado (e os filhos dele seguem para o próximo
 * nível). Devolve quantos direitos foram criados.
 */
export async function insertCascade(
  trx: Database,
  inserts: readonly CascadeInsert[],
): Promise<number> {
  let level: readonly CascadeInsert[] = inserts;
  let created = 0;
  while (level.length > 0) {
    const values = level.map(({ parent, node }) => ({
      userId: parent.userId,
      productType: node.productType,
      productId: node.productId,
      source: 'cascade',
      sourceId: parent.sourceId,
      parentEntitlementId: parent.id,
      startsAt: parent.startsAt,
      expiresAt: parent.expiresAt,
    }));
    const inserted = await trx
      .insertInto('entitlements')
      .values(values)
      .onConflict((oc) =>
        oc
          .columns([
            'userId',
            'source',
            'sourceId',
            'productType',
            'productId',
            'parentEntitlementId',
          ])
          .where('revokedAt', 'is', null)
          .doNothing(),
      )
      .returning(['id', 'parentEntitlementId', 'productType', 'productId'])
      .execute();
    created += inserted.length;

    const ids = new Map<string, string>();
    for (const row of inserted) {
      ids.set(`${row.parentEntitlementId}|${productKey(row.productType, row.productId)}`, row.id);
    }
    const withChildren = level.filter(({ node }) => node.children.length > 0);
    const missing = withChildren.filter(
      ({ parent, node }) =>
        !ids.has(`${parent.id}|${productKey(node.productType, node.productId)}`),
    );
    if (missing.length > 0) {
      // Já existiam (concorrência ou reconciliação): os filhos penduram no direito existente.
      const existing = await trx
        .selectFrom('entitlements')
        .select(['id', 'parentEntitlementId', 'productType', 'productId'])
        .where(
          'parentEntitlementId',
          'in',
          missing.map(({ parent }) => parent.id),
        )
        .where('revokedAt', 'is', null)
        .execute();
      for (const row of existing) {
        ids.set(`${row.parentEntitlementId}|${productKey(row.productType, row.productId)}`, row.id);
      }
    }

    const next: CascadeInsert[] = [];
    for (const { parent, node } of withChildren) {
      const id = ids.get(`${parent.id}|${productKey(node.productType, node.productId)}`);
      if (id === undefined) continue;
      const child: CascadeParent = { ...parent, id };
      for (const grandchild of node.children) next.push({ parent: child, node: grandchild });
    }
    level = next;
  }
  return created;
}
