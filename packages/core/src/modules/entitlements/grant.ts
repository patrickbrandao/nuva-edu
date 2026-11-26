import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { notify } from '../notifications/central.ts';
import { countCascade, expandCascade, insertCascade } from './cascade.ts';
import {
  ENTITLEMENT_FIELDS,
  type Entitlement,
  type EntitlementProductType,
  type EntitlementRevokeReason,
  type EntitlementRootSource,
  isUuid,
  toEntitlement,
} from './types.ts';

// Concessão e revogação de baixo nível (spec 010, "Algoritmo de concessão" e "Algoritmo de
// revogação"). Sem conferência de permissão: quem chama é o dono da escrita (admin-api na
// concessão manual, por `grantManualEntitlement`; worker nas raízes order e subscription, Fase 3).

/** Produto do catálogo como os direitos precisam dele. */
export interface EntitlementProduct {
  type: EntitlementProductType;
  id: string;
  slug: string;
  title: string;
}

/** Lê curso, pacote ou ebook pelo tipo (`product_id` é polimórfico, sem chave estrangeira). */
export async function findEntitlementProduct(
  db: Database,
  productType: EntitlementProductType,
  productId: string,
): Promise<EntitlementProduct | undefined> {
  if (!isUuid(productId)) return undefined;
  const table =
    productType === 'course' ? 'courses' : productType === 'bundle' ? 'bundles' : 'ebooks';
  const row = await db
    .selectFrom(table)
    .select(['id', 'slug', 'title'])
    .where('id', '=', productId.toLowerCase())
    .executeTakeFirst();
  return row ? { type: productType, id: row.id, slug: row.slug, title: row.title } : undefined;
}

export interface GrantEntitlementInput {
  userId: string;
  productType: EntitlementProductType;
  productId: string;
  source: EntitlementRootSource;
  /** `order_items.id`, `subscriptions.id` ou o `users.id` de quem concedeu (`grant`). */
  sourceId: string;
  /** Padrão: `now()` da transação. */
  startsAt?: Date;
  /** `null` ou ausente: vitalício. */
  expiresAt?: Date | null;
  /** Obrigatório em `grant`, proibido nas demais fontes (restrição da 0010). */
  grantedReason?: string | null;
  /** Enfileira `access.granted` ao criar a raiz. Padrão: `true`. */
  notify?: boolean;
}

export interface GrantEntitlementResult {
  /** A raiz criada, ou a já existente quando a concessão se repete. */
  entitlement: Entitlement;
  /** `false`: a mesma raiz já existia não revogada; nada foi gravado. */
  created: boolean;
  /** Derivados gravados nesta chamada. */
  cascadeCount: number;
}

/**
 * Concede o direito raiz e a cascata dele, na transação recebida (RNF-02). Idempotente por
 * (`user_id`, `source`, `source_id`, `product_type`, `product_id`) entre os não revogados:
 * repetir devolve a raiz existente com `created = false`, sem tocar em nada (mesmo vencida:
 * reativar é decisão de quem chama). Produto inexistente: `404 not_found`. Ao criar, enfileira
 * o e-mail `access.granted` (spec 024), salvo `notify: false`.
 */
export async function grantEntitlement(
  trx: Database,
  input: GrantEntitlementInput,
): Promise<GrantEntitlementResult> {
  if (!trx.isTransaction) {
    throw new TypeError('grantEntitlement exige uma transação aberta (db.transaction()).');
  }
  const product = await findEntitlementProduct(trx, input.productType, input.productId);
  if (!product) throw notFound('Produto não encontrado.');

  const inserted = await trx
    .insertInto('entitlements')
    .values({
      userId: input.userId,
      productType: product.type,
      productId: product.id,
      source: input.source,
      sourceId: input.sourceId,
      parentEntitlementId: null,
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      expiresAt: input.expiresAt ?? null,
      grantedReason: input.grantedReason ?? null,
    })
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
    .returning(ENTITLEMENT_FIELDS)
    .executeTakeFirst();

  if (!inserted) {
    const existing = await trx
      .selectFrom('entitlements')
      .select(ENTITLEMENT_FIELDS)
      .where('userId', '=', input.userId)
      .where('source', '=', input.source)
      .where('sourceId', '=', input.sourceId)
      .where('productType', '=', product.type)
      .where('productId', '=', product.id)
      .where('parentEntitlementId', 'is', null)
      .where('revokedAt', 'is', null)
      .executeTakeFirstOrThrow();
    return { entitlement: toEntitlement(existing), created: false, cascadeCount: 0 };
  }

  const root = toEntitlement(inserted);
  const tree = await expandCascade(trx, product.type, product.id);
  const cascadeCount =
    tree.length === 0
      ? 0
      : await insertCascade(
          trx,
          tree.map((node) => ({ parent: root, node })),
        );
  if (cascadeCount !== countCascade(tree)) {
    // Só acontece se outro processo gravou a mesma raiz no meio: o índice único impediria.
    throw new Error('Cascata gravada pela metade; transação desfeita.');
  }
  if (input.notify !== false) {
    await notify(trx, 'access.granted', input.userId, {
      targetType: product.type,
      targetId: product.id,
      data: {
        productType: product.type,
        productTitle: product.title,
        expiresAt: root.expiresAt?.toISOString() ?? null,
      },
    });
  }
  return { entitlement: root, created: true, cascadeCount };
}

/**
 * Revoga o direito e todos os seus descendentes ainda não revogados (spec 010, "Algoritmo de
 * revogação"), sem tocar em nenhum outro direito. Aceita vários ids. Devolve quantos direitos
 * foram revogados (0 se todos já estavam revogados).
 */
export async function revokeEntitlementTree(
  trx: Database,
  entitlementIds: string | readonly string[],
  reason: EntitlementRevokeReason,
): Promise<number> {
  const ids = (typeof entitlementIds === 'string' ? [entitlementIds] : [...entitlementIds]).filter(
    isUuid,
  );
  if (ids.length === 0) return 0;
  const result = await sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM entitlements WHERE id = ANY(${ids}::uuid[])
      UNION
      SELECT e.id FROM entitlements e JOIN tree t ON e.parent_entitlement_id = t.id
    )
    UPDATE entitlements
       SET revoked_at = now(), revoke_reason = ${reason}, version = version + 1
     WHERE id IN (SELECT id FROM tree) AND revoked_at IS NULL`.execute(trx);
  return Number(result.numAffectedRows ?? 0n);
}
