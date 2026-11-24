import { type Config, type Database, purgeAudit } from '@nuva-edu/core';

/** Linhas por lote do expurgo (spec 033, RNF-05): cada `DELETE` é uma transação curta. */
export const RETENTION_BATCH_SIZE = 5_000;
/** Dispositivos conhecidos sem uso há 1 ano (prazo fixo, spec 033). */
export const DEVICE_RETENTION_DAYS = 365;

export type RetentionSettings = Pick<
  Config['retention'],
  | 'sessionDays'
  | 'emailTokenHours'
  | 'loginAttemptDays'
  | 'emailSentDays'
  | 'emailFailedDays'
  | 'auditDays'
>;

/** Quantas linhas cada regra apagou, para o log (só contagens, nenhum dado pessoal). */
export interface RetentionReport {
  sessions: number;
  emailTokens: number;
  loginAttempts: number;
  userDevices: number;
  emailOutboxSent: number;
  emailOutboxFailed: number;
  auditLog: number;
}

export interface RetentionOptions {
  /** Abortado no encerramento: o expurgo para entre lotes e a tarefa volta à fila. */
  signal?: AbortSignal;
  batchSize?: number;
  /** Relógio, para testes. */
  now?: () => Date;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Um lote de uma regra: apaga até `limit` linhas e devolve quantas apagou. */
type BatchRule = (db: Database, limit: number) => Promise<number>;

type BatchRuleName = Exclude<keyof RetentionReport, 'auditLog'>;

function rules(settings: RetentionSettings, now: Date): Record<BatchRuleName, BatchRule> {
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  return {
    // Sessão sem uso há mais do prazo, ou já vencida (`expires_at` = último uso + prazo).
    sessions: async (db, limit) => {
      const result = await db
        .deleteFrom('sessions')
        .where(
          'id',
          'in',
          db
            .selectFrom('sessions')
            .select('id')
            .where((eb) =>
              eb.or([
                eb('expiresAt', '<', now),
                eb('lastUsedAt', '<', ago(settings.sessionDays * DAY_MS)),
              ]),
            )
            .limit(limit),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
    // Link de confirmação ou de redefinição vencido, usado ou não; também o criado há mais do
    // prazo, caso o prazo tenha sido encurtado depois da emissão.
    emailTokens: async (db, limit) => {
      const result = await db
        .deleteFrom('emailTokens')
        .where(
          'id',
          'in',
          db
            .selectFrom('emailTokens')
            .select('id')
            .where((eb) =>
              eb.or([
                eb('expiresAt', '<', now),
                eb('createdAt', '<', ago(settings.emailTokenHours * HOUR_MS)),
              ]),
            )
            .limit(limit),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
    loginAttempts: async (db, limit) => {
      const result = await db
        .deleteFrom('loginAttempts')
        .where(
          'id',
          'in',
          db
            .selectFrom('loginAttempts')
            .select('id')
            .where('createdAt', '<', ago(settings.loginAttemptDays * DAY_MS))
            .limit(limit),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
    userDevices: async (db, limit) => {
      const result = await db
        .deleteFrom('userDevices')
        .where(
          'id',
          'in',
          db
            .selectFrom('userDevices')
            .select('id')
            .where('lastSeenAt', '<', ago(DEVICE_RETENTION_DAYS * DAY_MS))
            .limit(limit),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
    // Enviados contam de `sent_at`; os com falha, de `created_at` (a tabela não guarda a data
    // da falha, migration 0007). Os da fila (`queued`) nunca são apagados.
    emailOutboxSent: async (db, limit) => {
      const result = await db
        .deleteFrom('emailOutbox')
        .where(
          'id',
          'in',
          db
            .selectFrom('emailOutbox')
            .select('id')
            .where('status', '=', 'sent')
            .where('sentAt', '<', ago(settings.emailSentDays * DAY_MS))
            .limit(limit),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
    emailOutboxFailed: async (db, limit) => {
      const result = await db
        .deleteFrom('emailOutbox')
        .where(
          'id',
          'in',
          db
            .selectFrom('emailOutbox')
            .select('id')
            .where('status', '=', 'failed')
            .where('createdAt', '<', ago(settings.emailFailedDays * DAY_MS))
            .limit(limit),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason;
  }
}

/**
 * Repete `batch` até ele devolver menos que `size`: cada chamada é curta e o total sai no fim.
 * Para entre os lotes se o sinal for abortado.
 */
export async function drainBatches(
  batch: () => Promise<number>,
  size: number,
  signal?: AbortSignal,
): Promise<number> {
  let total = 0;
  for (;;) {
    throwIfAborted(signal);
    const done = await batch();
    total += done;
    if (done < size) {
      return total;
    }
  }
}

/**
 * Expurgo diário (`retention.purge`, spec 033): apaga o que passou do prazo, em lotes de 5.000,
 * cada um no próprio `DELETE`, sem transação longa (RNF-05). Apagar por prazo é idempotente:
 * repetir não apaga nada além do vencido. A auditoria vai por último, por `audit_log_purge`
 * com `NUVA_RETENTION_AUDIT_DAYS`.
 */
export async function purgeRetention(
  db: Database,
  settings: RetentionSettings,
  options: RetentionOptions = {},
): Promise<RetentionReport> {
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE;
  const now = (options.now ?? (() => new Date()))();
  const counts = {} as Record<BatchRuleName, number>;
  for (const [name, rule] of Object.entries(rules(settings, now)) as [BatchRuleName, BatchRule][]) {
    counts[name] = await drainBatches(() => rule(db, batchSize), batchSize, options.signal);
  }
  throwIfAborted(options.signal);
  const auditLog = await purgeAudit(db, settings.auditDays);
  return { ...counts, auditLog };
}
