import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';

// Renovação e extensão (spec 010, "Renovação e extensão"; spec 012, "Ciclo de vida"): a
// assinatura ativa estende o `expires_at` das raízes e de toda a árvore, sem criar direito
// novo. Dono da escrita: worker (renovação, regularização e reconciliação).

/**
 * Atualiza `expires_at` do direito e de todos os descendentes ainda não revogados, na transação
 * recebida. Idempotente: repetir com o mesmo instante não muda nada. Também vale para um direito
 * já vencido (a linha continua na chave única), que é como a renovação reativa o acesso sem
 * duplicar a raiz.
 */
export async function extendEntitlementTree(
  trx: Database,
  entitlementId: string,
  expiresAt: Date,
): Promise<number> {
  if (!trx.isTransaction) {
    throw new TypeError('extendEntitlementTree exige uma transação aberta (db.transaction()).');
  }
  const result = await trx
    .withRecursive('tree', (db) =>
      db
        .selectFrom('entitlements')
        .select('id')
        .where('id', '=', entitlementId)
        .unionAll(
          db
            .selectFrom('entitlements as child')
            .innerJoin('tree', 'tree.id', 'child.parentEntitlementId')
            .select('child.id'),
        ),
    )
    .updateTable('entitlements')
    .set({ expiresAt, version: sql<number>`version + 1` })
    .where('id', 'in', (eb) => eb.selectFrom('tree').select('id'))
    .where('revokedAt', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0n);
}

/**
 * Estende a árvore de todas as raízes da assinatura (fonte `subscription` e os `cascade`
 * derivados dela). É o efeito da renovação: um comando, nenhuma raiz nova. Devolve quantos
 * direitos foram atualizados.
 */
export async function extendSubscriptionEntitlements(
  trx: Database,
  subscriptionId: string,
  expiresAt: Date,
): Promise<number> {
  if (!trx.isTransaction) {
    throw new TypeError(
      'extendSubscriptionEntitlements exige uma transação aberta (db.transaction()).',
    );
  }
  const result = await trx
    .updateTable('entitlements')
    .set({ expiresAt, version: sql<number>`version + 1` })
    .where('sourceId', '=', subscriptionId)
    .where('source', 'in', ['subscription', 'cascade'])
    .where('revokedAt', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0n);
}
