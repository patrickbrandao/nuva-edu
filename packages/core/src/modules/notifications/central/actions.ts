import { sql } from 'kysely';
import type { Database } from '../../../db/database.ts';
import { getNotification, getUnreadNotificationCount, type NotificationItem } from './query.ts';

// Leitura e limpeza da central (spec 024, RF-02). As APIs do classroom e do admin chamam estas
// funções com o usuário da sessão; nenhuma delas alcança notificação de outra pessoa.

export interface ReadNotificationResult {
  notification: NotificationItem;
  unreadCount: number;
}

export interface MarkAllReadResult {
  /** Quantas linhas passaram de não lidas a lidas nesta chamada. */
  updated: number;
  unreadCount: 0;
}

export interface ClearNotificationsResult {
  deleted: number;
}

/**
 * Marca uma notificação como lida. Idempotente: já lida devolve o item como está. Devolve
 * `null` quando o id não existe ou é de outra pessoa (a API responde `404`).
 */
export async function markNotificationRead(
  db: Database,
  userId: string,
  notificationId: string,
): Promise<ReadNotificationResult | null> {
  return runInTransaction(db, async (trx) => {
    if (!UUID_PATTERN.test(notificationId)) {
      return null;
    }
    await trx
      .updateTable('notifications')
      .set({ readAt: sql<Date>`now()` })
      .where('id', '=', notificationId.toLowerCase())
      .where('userId', '=', userId)
      .where('readAt', 'is', null)
      .execute();
    const notification = await getNotification(trx, userId, notificationId);
    if (notification === null) {
      return null;
    }
    return {
      notification,
      unreadCount: await getUnreadNotificationCount(trx, userId),
    };
  });
}

/** Marca todas as não lidas do usuário como lidas. `unreadCount` fica zero. */
export async function markAllNotificationsRead(
  db: Database,
  userId: string,
): Promise<MarkAllReadResult> {
  const result = await db
    .updateTable('notifications')
    .set({ readAt: sql<Date>`now()` })
    .where('userId', '=', userId)
    .where('readAt', 'is', null)
    .executeTakeFirst();
  return { updated: Number(result.numUpdatedRows), unreadCount: 0 };
}

/**
 * "Limpar todas": apaga lidas e não lidas do usuário (o histórico lido também some). A
 * notificação de outro usuário nunca entra.
 */
export async function clearNotifications(
  db: Database,
  userId: string,
): Promise<ClearNotificationsResult> {
  const result = await db
    .deleteFrom('notifications')
    .where('userId', '=', userId)
    .executeTakeFirst();
  return { deleted: Number(result.numDeletedRows) };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runInTransaction<T>(db: Database, fn: (trx: Database) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(db) : db.transaction().execute(fn);
}
