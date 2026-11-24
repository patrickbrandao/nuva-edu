import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';

/** Retenção padrão da auditoria (`NUVA_RETENTION_AUDIT_DAYS`, spec 028, RNF-01). */
export const AUDIT_RETENTION_DEFAULT_DAYS = 730;
/** Menor prazo que `audit_log_purge` aceita (migration 0006). */
export const AUDIT_RETENTION_MIN_DAYS = 365;

/**
 * Expurgo diário do worker: `SELECT audit_log_purge($1)`, a única forma de apagar registro
 * (spec 028, "Imutabilidade"). Devolve quantos registros foram apagados. Prazo que não é
 * inteiro ou fica abaixo de 365 dias lança `RangeError` antes de ir ao banco.
 */
export async function purgeAudit(
  trx: Database,
  retentionDays: number = AUDIT_RETENTION_DEFAULT_DAYS,
): Promise<number> {
  if (!Number.isInteger(retentionDays) || retentionDays < AUDIT_RETENTION_MIN_DAYS) {
    throw new RangeError(
      `Retenção da auditoria precisa ser um inteiro de pelo menos ${AUDIT_RETENTION_MIN_DAYS} dias.`,
    );
  }
  const result = await sql<{
    deleted: string;
  }>`SELECT audit_log_purge(${retentionDays}::integer) AS deleted`.execute(trx);
  return Number(result.rows[0]?.deleted ?? 0);
}
