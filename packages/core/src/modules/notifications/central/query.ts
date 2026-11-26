import type { Database } from '../../../db/database.ts';
import type { Json } from '../../../db/generated/database.ts';
import { type FieldError, validationFailed } from '../../../errors/domain-error.ts';
import { avatarUrlFor } from '../../accounts/session-view.ts';
import { AUDIT_DELETED_USER_NAME } from '../../audit/query.ts';
import { asObject, type NotificationRecord } from './create.ts';
import {
  isNotificationType,
  type NotificationGroup,
  type NotificationType,
  notificationTypeGroup,
} from './types.ts';

// Lista da central (spec 024, "Central"): mais recente primeiro, paginada por cursor, com o
// autor. Dono dos dados: as APIs leem; o worker cria.

/** Quantidade padrão e máxima de itens por página. */
export const NOTIFICATION_PAGE_DEFAULT_LIMIT = 20;
export const NOTIFICATION_PAGE_MAX_LIMIT = 50;

const CURSOR_PREFIX = 'notifications:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotificationActor {
  id: string;
  /** `usuário removido` quando a conta foi excluída (a linha de `users` continua). */
  name: string;
  avatarUrl: string | null;
}

/** Item da central: o que a tela precisa para ícone, foto, texto e link. */
export interface NotificationItem extends NotificationRecord {
  group: NotificationGroup;
  actor: NotificationActor | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

export interface ListNotificationsOptions {
  /** Só as não lidas (contador e filtro da central). */
  unreadOnly?: boolean;
  /** Padrão 20, máximo 50. */
  limit?: number;
  /** `nextCursor` da página anterior. */
  cursor?: string;
}

/**
 * Uma página da central do usuário. O cursor é opaco e guarda o id do último item; a data vem
 * da própria linha no banco, para não perder os microssegundos. Entrada inválida:
 * `400 validation_failed`. Nunca devolve item de outro usuário.
 */
export async function listNotifications(
  db: Database,
  userId: string,
  options: ListNotificationsOptions = {},
): Promise<NotificationPage> {
  const errors: FieldError[] = [];
  const limit = options.limit ?? NOTIFICATION_PAGE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > NOTIFICATION_PAGE_MAX_LIMIT) {
    errors.push({
      path: 'query.limit',
      message: `Use de 1 a ${NOTIFICATION_PAGE_MAX_LIMIT}.`,
    });
  }
  const afterId = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  if (options.cursor !== undefined && afterId === undefined) {
    errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  let query = notificationRows(db).where('notifications.userId', '=', userId);
  if (options.unreadOnly) {
    query = query.where('notifications.readAt', 'is', null);
  }
  if (afterId !== undefined) {
    query = query.where((eb) => {
      const cursorAt = eb
        .selectFrom('notifications as c')
        .select('c.createdAt')
        .where('c.id', '=', afterId)
        .where('c.userId', '=', userId);
      return eb.and([
        eb('notifications.createdAt', '<=', cursorAt),
        eb.or([eb('notifications.createdAt', '<', cursorAt), eb('notifications.id', '<', afterId)]),
      ]);
    });
  }
  const rows = await query
    .orderBy('notifications.createdAt', 'desc')
    .orderBy('notifications.id', 'desc')
    .limit(limit + 1)
    .execute();
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}

/** Não lidas do usuário, para `GET /notifications/unread-count`. */
export async function getUnreadNotificationCount(db: Database, userId: string): Promise<number> {
  const result = await db
    .selectFrom('notifications')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('userId', '=', userId)
    .where('readAt', 'is', null)
    .executeTakeFirst();
  return Number(result?.count ?? 0);
}

/**
 * Um item da central do usuário, ou `null` se não existe ou é de outra pessoa. Usado depois de
 * marcar como lida, para devolver o item atualizado.
 */
export async function getNotification(
  db: Database,
  userId: string,
  notificationId: string,
): Promise<NotificationItem | null> {
  if (!UUID_PATTERN.test(notificationId)) {
    return null;
  }
  const row = await notificationRows(db)
    .where('notifications.userId', '=', userId)
    .where('notifications.id', '=', notificationId.toLowerCase())
    .executeTakeFirst();
  return row ? toItem(row) : null;
}

/** Colunas do item da central, com o autor; a lista e a leitura usam a mesma consulta. */
function notificationRows(db: Database) {
  return db
    .selectFrom('notifications')
    .leftJoin('users as actor', 'actor.id', 'notifications.actorId')
    .leftJoin('profiles as actorProfile', 'actorProfile.userId', 'actor.id')
    .select([
      'notifications.id as id',
      'notifications.userId as userId',
      'notifications.type as type',
      'notifications.actorId as actorId',
      'notifications.targetType as targetType',
      'notifications.targetId as targetId',
      'notifications.data as data',
      'notifications.count as count',
      'notifications.readAt as readAt',
      'notifications.createdAt as createdAt',
      'actor.name as actorName',
      'actor.deletedAt as actorDeletedAt',
      'actorProfile.avatarImageId as actorAvatarImageId',
    ]);
}

interface NotificationListRow {
  id: string;
  userId: string;
  type: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  data: Json;
  count: number;
  readAt: Date | null;
  createdAt: Date;
  actorName: string | null;
  actorDeletedAt: Date | null;
  actorAvatarImageId: string | null;
}

function toItem(row: NotificationListRow): NotificationItem {
  const type = row.type as NotificationType;
  return {
    id: row.id,
    userId: row.userId,
    type,
    group: isNotificationType(row.type) ? notificationTypeGroup(row.type) : 'account',
    actorId: row.actorId,
    targetType: row.targetType,
    targetId: row.targetId,
    data: asObject(row.data),
    count: row.count,
    readAt: row.readAt,
    createdAt: row.createdAt,
    actor:
      row.actorId === null
        ? null
        : {
            id: row.actorId,
            name:
              row.actorName === null || row.actorDeletedAt !== null
                ? AUDIT_DELETED_USER_NAME
                : row.actorName,
            avatarUrl: avatarUrlFor(row.actorAvatarImageId),
          },
  };
}

function encodeCursor(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string | undefined {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!text.startsWith(CURSOR_PREFIX)) {
    return undefined;
  }
  const id = text.slice(CURSOR_PREFIX.length);
  return UUID_PATTERN.test(id) ? id.toLowerCase() : undefined;
}
