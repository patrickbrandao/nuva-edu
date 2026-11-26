import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { IDEMPOTENCY_RETENTION_MS } from './runner.ts';

// Expurgo das chaves de idempotência financeira (spec 003, "Idempotência"; spec 033, "Retenção";
// migration 0021). Apaga tudo com `created_at` anterior à janela fixa de 24 h — respostas
// concluídas e reservas abandonadas (`response_status` nulo) — em lotes curtos de até 5.000
// linhas (spec 033, RNF-05).

/** Linhas por lote do expurgo (spec 033, RNF-05). */
export const IDEMPOTENCY_PURGE_BATCH_SIZE = 5_000;

export interface PurgeIdempotencyKeysOptions {
  /** Linhas por `DELETE`. Padrão: `IDEMPOTENCY_PURGE_BATCH_SIZE` (5.000). */
  batchSize?: number;
  /** Abortado no encerramento: para entre lotes e propaga o motivo. */
  signal?: AbortSignal;
  /** Relógio de referência; padrão: agora. */
  now?: Date;
}

/**
 * Apaga as linhas de `idempotency_keys` com `created_at` anterior a `now - 24 h`, inclusive
 * reservas sem resposta (`response_status` nulo), em lotes de até `batchSize` (uma transação
 * curta por lote). Devolve o total apagado.
 */
export async function purgeIdempotencyKeys(
  db: Database,
  options: PurgeIdempotencyKeysOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? IDEMPOTENCY_PURGE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError('purgeIdempotencyKeys: batchSize precisa ser um inteiro positivo.');
  }

  const cutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS);
  let total = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    const deleted = await deleteExpiredBatch(db, cutoff, batchSize);
    total += deleted;
    if (deleted < batchSize) {
      return total;
    }
  }
}

async function deleteExpiredBatch(db: Database, cutoff: Date, limit: number): Promise<number> {
  // `(scope, user_id, key)` é a chave primária (migration 0021) e `idempotency_keys_created_at_idx`
  // alimenta a seleção ordenada. `FOR UPDATE SKIP LOCKED` não espera transação concorrente que
  // esteja reescrevendo uma chave vencida, e `target.created_at < cutoff` garante que uma linha
  // reescrita com `created_at` novo não seja apagada.
  const result = await sql`
    WITH expired AS (
      SELECT scope, user_id, key
        FROM idempotency_keys
       WHERE created_at < ${cutoff}
       ORDER BY created_at
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    DELETE FROM idempotency_keys AS target
     USING expired
     WHERE target.scope = expired.scope
       AND target.user_id = expired.user_id
       AND target.key = expired.key
       AND target.created_at < ${cutoff}
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}
