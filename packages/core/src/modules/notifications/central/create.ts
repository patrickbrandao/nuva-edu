import { sql } from 'kysely';
import type { Database } from '../../../db/database.ts';
import type { Json, JsonObject } from '../../../db/generated/database.ts';
import { publishNotificationCreated } from '../../stream/notifications.ts';
import type { UserEventIdGenerator } from '../../stream/user-events.ts';
import { type NotificationPayload, normalizeNotificationPayload } from './payload.ts';
import { notificationRecipientSkipReason } from './recipients.ts';
import {
  isNotificationType,
  type NotificationType,
  notificationGroupHasInApp,
  notificationTypeGroup,
} from './types.ts';

// Criação da notificação da central (spec 024, "Central"), usada pelo worker da tarefa `notify`.
// Dono dos dados: o worker. A linha e o evento SSE nascem na mesma transação; a fusão das não
// lidas do mesmo tipo e alvo é o upsert do índice parcial da migration 0016.

export interface CreateNotificationInput extends NotificationPayload {
  userId: string;
  type: NotificationType;
}

/** Linha de `notifications` como a central a lê. */
export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  data: JsonObject;
  /** Quantas notificações foram fundidas nesta linha. */
  count: number;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreatedNotification {
  notification: NotificationRecord;
  /** Não lidas do destinatário depois desta (contador do sino). */
  unreadCount: number;
  /** `false`: a linha já existia não lida e foi fundida. */
  created: boolean;
}

export interface CreateNotificationOptions {
  /** Gerador do `id` do evento, para os testes; o padrão lê `user_event_id_seq`. */
  nextEventId?: UserEventIdGenerator;
}

/**
 * Cria a notificação de um destinatário e publica `notification.created` na mesma transação
 * (RNF-01/RNF-02). Notificação do mesmo tipo e alvo ainda não lida é fundida: `count + 1`,
 * autor e dados do último fato, `created_at = now()` (a central ordena pelo fato mais recente).
 *
 * Aplica as mesmas regras de `notify` no momento da gravação (destinatário removido, suspenso,
 * autor da própria ação, equipe no grupo `staff`): devolve `null` quando o destinatário deixou de
 * poder receber. Exige transação aberta; lança `TypeError` para tipo desconhecido ou do grupo
 * `account`, salvo o aviso de endereço indisponível.
 */
export async function createNotification(
  trx: Database,
  input: CreateNotificationInput,
  options: CreateNotificationOptions = {},
): Promise<CreatedNotification | null> {
  if (!trx.isTransaction) {
    throw new TypeError('createNotification exige uma transação aberta (db.transaction()).');
  }
  const type = input.type;
  if (!isNotificationType(type)) {
    throw new TypeError(`Notificação de tipo desconhecido: ${String(type)}.`);
  }
  if (
    type !== 'account.email_undeliverable' &&
    !notificationGroupHasInApp(notificationTypeGroup(type))
  ) {
    throw new TypeError(
      `A notificação "${type}" não tem canal plataforma; use enqueueEmail para o grupo account.`,
    );
  }
  const payload = normalizeNotificationPayload(input);
  const skip = await notificationRecipientSkipReason(trx, {
    userId: input.userId,
    type,
    actorId: payload.actorId,
  });
  if (skip !== null) {
    return null;
  }
  const row = await trx
    .insertInto('notifications')
    .values({
      userId: input.userId,
      type,
      actorId: payload.actorId,
      targetType: payload.targetType,
      targetId: payload.targetId,
      data: JSON.stringify(payload.data),
    })
    .onConflict((oc) =>
      oc
        .columns(['userId', 'groupKey'])
        .where('readAt', 'is', null)
        .doUpdateSet({
          count: sql<number>`notifications.count + 1`,
          actorId: payload.actorId,
          data: JSON.stringify(payload.data),
          createdAt: sql<Date>`now()`,
        }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  const unreadCount = await countUnreadNotifications(trx, input.userId);
  const notification: NotificationRecord = {
    id: row.id,
    userId: row.userId,
    type: row.type as NotificationType,
    actorId: row.actorId,
    targetType: row.targetType,
    targetId: row.targetId,
    data: asObject(row.data),
    count: row.count,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
  await publishNotificationCreated(
    trx,
    { userId: input.userId, notificationId: notification.id, type, unreadCount },
    options.nextEventId === undefined ? {} : { nextId: options.nextEventId },
  );
  return { notification, unreadCount, created: notification.count === 1 };
}

/** Não lidas do destinatário: quantas linhas da central o sino conta. */
export async function countUnreadNotifications(db: Database, userId: string): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT count(*)::int AS count FROM notifications
    WHERE user_id = ${userId} AND read_at IS NULL
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

export function asObject(value: Json | null): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
