import type { Database } from '../../../db/database.ts';

// Expurgo das notificações (spec 024, RNF-04; spec 033, "Retenção"). Lidas contam de `read_at`
// (90 dias), não lidas de `created_at` (180 dias), em lotes curtos como o restante do expurgo
// diário. A fusão reescreve `created_at`: o prazo da não lida conta da última.

/** Prazo padrão das lidas (`NUVA_RETENTION_NOTIFICATION_DAYS`). */
export const NOTIFICATION_READ_RETENTION_DAYS = 90;
/** Prazo padrão das não lidas (`NUVA_RETENTION_NOTIFICATION_UNREAD_DAYS`). */
export const NOTIFICATION_UNREAD_RETENTION_DAYS = 180;
/** Linhas por lote (spec 033, RNF-05). */
export const NOTIFICATION_PURGE_BATCH_SIZE = 5_000;

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface PurgeNotificationsOptions {
  /** Prazo das lidas em dias. Padrão `NOTIFICATION_READ_RETENTION_DAYS`. */
  readDays?: number;
  /** Prazo das não lidas em dias. Padrão `NOTIFICATION_UNREAD_RETENTION_DAYS`. */
  unreadDays?: number;
  batchSize?: number;
  /** Abortado no encerramento: para entre lotes e devolve o problema. */
  signal?: AbortSignal;
  /** Relógio dos testes. */
  now?: Date;
}

export interface PurgedNotifications {
  read: number;
  unread: number;
}

/**
 * Apaga as notificações vencidas, em lotes de até `batchSize`: lidas com `read_at` anterior ao
 * prazo e não lidas com `created_at` anterior ao prazo. Idempotente; o `DELETE` refaz a condição
 * da seleção, então uma linha que ficou lida ou foi fundida entre os dois passos não é apagada
 * por engano.
 */
export async function purgeNotifications(
  db: Database,
  options: PurgeNotificationsOptions = {},
): Promise<PurgedNotifications> {
  const now = options.now ?? new Date();
  const readDays = checkDays('readDays', options.readDays ?? NOTIFICATION_READ_RETENTION_DAYS);
  const unreadDays = checkDays(
    'unreadDays',
    options.unreadDays ?? NOTIFICATION_UNREAD_RETENTION_DAYS,
  );
  const batchSize = options.batchSize ?? NOTIFICATION_PURGE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError('purgeNotifications: batchSize precisa ser um inteiro positivo.');
  }
  const readBefore = new Date(now.getTime() - readDays * DAY_MS);
  const unreadBefore = new Date(now.getTime() - unreadDays * DAY_MS);
  const read = await drain(
    () => deleteBatch(db, batchSize, 'read', readBefore),
    batchSize,
    options.signal,
  );
  const unread = await drain(
    () => deleteBatch(db, batchSize, 'unread', unreadBefore),
    batchSize,
    options.signal,
  );
  return { read, unread };
}

function checkDays(name: string, days: number): number {
  if (!Number.isInteger(days) || days < 1) {
    throw new TypeError(`purgeNotifications: ${name} precisa ser um inteiro de pelo menos 1.`);
  }
  return days;
}

type RetentionKind = 'read' | 'unread';

async function deleteBatch(
  db: Database,
  limit: number,
  kind: RetentionKind,
  before: Date,
): Promise<number> {
  const selection =
    kind === 'read'
      ? db
          .selectFrom('notifications')
          .select('id')
          .where('readAt', 'is not', null)
          .where('readAt', '<', before)
          .limit(limit)
      : db
          .selectFrom('notifications')
          .select('id')
          .where('readAt', 'is', null)
          .where('createdAt', '<', before)
          .limit(limit);
  let deletion = db.deleteFrom('notifications').where('id', 'in', selection);
  deletion =
    kind === 'read'
      ? deletion.where('readAt', '<', before)
      : deletion.where('readAt', 'is', null).where('createdAt', '<', before);
  const result = await deletion.executeTakeFirst();
  return Number(result.numDeletedRows);
}

async function drain(
  batch: () => Promise<number>,
  size: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  let total = 0;
  for (;;) {
    signal?.throwIfAborted();
    const deleted = await batch();
    total += deleted;
    if (deleted < size) {
      return total;
    }
  }
}
