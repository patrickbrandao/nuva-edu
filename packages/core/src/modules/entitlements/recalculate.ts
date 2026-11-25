import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { validationFailed } from '../../errors/domain-error.ts';
import type { EntitlementRecomputeProductType } from '../jobs/registry.ts';
import {
  type CascadeInsert,
  type CascadeNode,
  expandCascade,
  insertCascade,
  productKey,
} from './cascade.ts';
import { revokeEntitlementTree } from './grant.ts';
import {
  ENTITLEMENT_RECALCULATION_BATCH_SIZE,
  type EntitlementProductType,
  isUuid,
} from './types.ts';

// Recálculo da cascata (spec 010, "Recalcular a cascata"), chamado pelo manipulador de
// `entitlement.recompute` no worker (tarefa 434). Dono da escrita: worker.

export interface RecalculateEntitlementsInput {
  /** Produto pai cuja composição mudou (`bundle_items` ou `product_ebooks`). */
  productType: EntitlementRecomputeProductType;
  productId: string;
  /** Raízes por transação. Padrão: 500. */
  batchSize?: number;
}

export interface RecalculateEntitlementsResult {
  /** Raízes conferidas. */
  roots: number;
  /** Derivados criados (itens acrescentados). */
  created: number;
  /** Direitos revogados com `recalculation` (itens removidos, com os descendentes). */
  revoked: number;
  /** Transações executadas. */
  batches: number;
}

interface TreeRow {
  id: string;
  userId: string;
  productType: string;
  productId: string;
  sourceId: string;
  parentEntitlementId: string | null;
  startsAt: Date;
  expiresAt: Date | null;
}

/**
 * Reconcilia as árvores das raízes que contêm o produto (ele mesmo como raiz, ou como curso
 * derivado de um pacote) com a composição atual do catálogo:
 *
 * - filho esperado que falta: criado como `cascade` (com os filhos dele);
 * - filho que não deveria estar ali: revogado com `recalculation`, com os descendentes. Isso
 *   inclui o ebook que mudou de caminho dentro da mesma raiz (o direito é recriado no caminho
 *   novo na mesma transação, sem intervalo sem acesso).
 *
 * Só raízes não revogadas e não vencidas (ativas ou agendadas) são conferidas. Idempotente:
 * rodar de novo sem mudança no catálogo não grava nada. Processa em lotes de `batchSize`
 * raízes, cada lote numa transação, com as raízes travadas (`FOR UPDATE`).
 */
export async function recalculateEntitlements(
  db: Database,
  input: RecalculateEntitlementsInput,
): Promise<RecalculateEntitlementsResult> {
  if (input.productType !== 'course' && input.productType !== 'bundle') {
    throw validationFailed([{ path: 'productType', message: 'Use course ou bundle.' }]);
  }
  if (!isUuid(input.productId)) {
    throw validationFailed([{ path: 'productId', message: 'Identificador inválido.' }]);
  }
  const productId = input.productId.toLowerCase();
  const batchSize = input.batchSize ?? ENTITLEMENT_RECALCULATION_BATCH_SIZE;
  const expected = new Map<string, CascadeNode[]>();
  const result: RecalculateEntitlementsResult = { roots: 0, created: 0, revoked: 0, batches: 0 };

  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const page = await sql<{ rootId: string }>`
      SELECT DISTINCT coalesce(gp.id, p.id, e.id) AS root_id
        FROM entitlements e
        LEFT JOIN entitlements p ON p.id = e.parent_entitlement_id
        LEFT JOIN entitlements gp ON gp.id = p.parent_entitlement_id
       WHERE e.product_type = ${input.productType} AND e.product_id = ${productId}::uuid
         AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at > now())
         AND coalesce(gp.id, p.id, e.id) > ${after}::uuid
       ORDER BY root_id
       LIMIT ${batchSize}`.execute(db);
    const rootIds = page.rows.map((row) => row.rootId);
    if (rootIds.length === 0) break;
    after = rootIds[rootIds.length - 1] as string;

    const batch = await db.transaction().execute((trx) => reconcileRoots(trx, rootIds, expected));
    result.roots += batch.roots;
    result.created += batch.created;
    result.revoked += batch.revoked;
    result.batches += 1;
    if (rootIds.length < batchSize) break;
  }
  return result;
}

async function reconcileRoots(
  trx: Database,
  rootIds: readonly string[],
  expected: Map<string, CascadeNode[]>,
): Promise<{ roots: number; created: number; revoked: number }> {
  const roots = await sql<TreeRow>`
    SELECT id, user_id, product_type, product_id, source_id, parent_entitlement_id, starts_at, expires_at
      FROM entitlements
     WHERE id = ANY(${rootIds}::uuid[]) AND parent_entitlement_id IS NULL
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
     ORDER BY id
       FOR UPDATE`.execute(trx);
  if (roots.rows.length === 0) return { roots: 0, created: 0, revoked: 0 };
  const ids = roots.rows.map((row) => row.id);
  const descendants = await sql<TreeRow>`
    WITH RECURSIVE tree AS (
      SELECT e.* FROM entitlements e
       WHERE e.parent_entitlement_id = ANY(${ids}::uuid[]) AND e.revoked_at IS NULL
      UNION ALL
      SELECT e.* FROM entitlements e JOIN tree t ON e.parent_entitlement_id = t.id
       WHERE e.revoked_at IS NULL
    )
    SELECT id, user_id, product_type, product_id, source_id, parent_entitlement_id, starts_at, expires_at
      FROM tree`.execute(trx);
  const childrenOf = new Map<string, TreeRow[]>();
  for (const row of descendants.rows) {
    const list = childrenOf.get(row.parentEntitlementId as string) ?? [];
    list.push(row);
    childrenOf.set(row.parentEntitlementId as string, list);
  }

  const toRevoke: string[] = [];
  const toInsert: CascadeInsert[] = [];
  const reconcile = (node: TreeRow, wanted: readonly CascadeNode[]) => {
    const actual = new Map<string, TreeRow>();
    for (const child of childrenOf.get(node.id) ?? []) {
      const key = productKey(child.productType, child.productId);
      // Duplicado não deveria existir (índice único); se houver, sobra um.
      if (actual.has(key)) toRevoke.push(child.id);
      else actual.set(key, child);
    }
    const wantedKeys = new Set<string>();
    for (const want of wanted) {
      const key = productKey(want.productType, want.productId);
      wantedKeys.add(key);
      const existing = actual.get(key);
      if (existing) reconcile(existing, want.children);
      else toInsert.push({ parent: node, node: want });
    }
    for (const [key, child] of actual) {
      if (!wantedKeys.has(key)) toRevoke.push(child.id);
    }
  };

  for (const root of roots.rows) {
    const key = productKey(root.productType, root.productId);
    let tree = expected.get(key);
    if (!tree) {
      tree = await expandCascade(trx, root.productType as EntitlementProductType, root.productId);
      expected.set(key, tree);
    }
    reconcile(root, tree);
  }

  // Revoga antes de criar: o ebook que muda de caminho na mesma raiz libera o índice único.
  const revoked =
    toRevoke.length > 0 ? await revokeEntitlementTree(trx, toRevoke, 'recalculation') : 0;
  const created = toInsert.length > 0 ? await insertCascade(trx, toInsert) : 0;
  return { roots: roots.rows.length, created, revoked };
}
