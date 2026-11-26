import type { Database } from '../../db/database.ts';
import { isNotificationType, type NotificationType } from '../notifications/central/types.ts';
import {
  type PublishedUserEvent,
  type PublishUserEventOptions,
  publishUserEvent,
  type UserEventData,
} from './user-events.ts';

// Evento `notification.created` do sino (specs 004 e 024; ADR 0028). Publicado na mesma
// transação que grava a notificação; o hub de cada API entrega às conexões do destinatário.

export interface NotificationCreatedInput {
  userId: string;
  notificationId: string;
  type: NotificationType;
  /** Não lidas do destinatário depois desta notificação. */
  unreadCount: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Publica `notification.created` com o contador do sino. A carga leva só identificadores e o
 * número (spec 004): a lista é buscada pela rota normal, que confere a permissão. Lança
 * `TypeError` para id, tipo ou contador fora do formato e o erro do `publishUserEvent` quando o
 * evento não cabe no NOTIFY ou a sequência não existe.
 */
export async function publishNotificationCreated(
  db: Database,
  input: NotificationCreatedInput,
  options: PublishUserEventOptions = {},
): Promise<PublishedUserEvent<'notification.created'>> {
  if (typeof input.notificationId !== 'string' || !UUID_PATTERN.test(input.notificationId)) {
    throw new TypeError('publishNotificationCreated: notificationId precisa ser um UUID.');
  }
  if (!isNotificationType(input.type)) {
    throw new TypeError(`publishNotificationCreated: tipo desconhecido "${input.type}".`);
  }
  if (!Number.isSafeInteger(input.unreadCount) || input.unreadCount < 1) {
    throw new TypeError(
      'publishNotificationCreated: unreadCount precisa ser um inteiro de pelo menos 1.',
    );
  }
  const data: UserEventData['notification.created'] = {
    notificationId: input.notificationId.toLowerCase(),
    type: input.type,
    unreadCount: input.unreadCount,
  };
  return publishUserEvent(
    db,
    { userId: input.userId, kind: 'notification.created', data },
    options,
  );
}
