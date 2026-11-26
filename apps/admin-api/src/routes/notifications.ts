import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  clearNotifications,
  type Database,
  getNotificationPrefs,
  getUnreadNotificationCount,
  isDomainError,
  isNotificationEmailRequired,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationItem,
  type NotificationPrefs,
  type NotificationPrefsUpdate,
  notFound,
  notificationGroupHasInApp,
  setNotificationPrefs,
  validationFailed,
} from '@nuva-edu/core';
import { requireSession } from '../session.ts';

// Central e preferências da equipe (spec 024, "Central" e "Tipos e grupos"): qualquer papel de
// equipe (`admin.access`, conferida pelo tratador de `sessionCookie`) vê e mexe só no que é do
// usuário da sessão. O worker cria as notificações e publica o SSE; aqui é leitura, marcação e
// limpeza. Não há auditoria: nenhuma ação desta tela está no catálogo da spec 028.

export interface NotificationRoutesOptions {
  db: Database;
}

/** `NotificationItem` do contrato: sem `userId`/`actorId`, datas em ISO 8601. */
function itemBody(item: NotificationItem) {
  return {
    id: item.id,
    type: item.type,
    group: item.group,
    actor: item.actor,
    targetType: item.targetType,
    targetId: item.targetId,
    data: item.data,
    count: item.count,
    readAt: item.readAt === null ? null : item.readAt.toISOString(),
    createdAt: item.createdAt.toISOString(),
  };
}

/** `NotificationPrefs` do contrato: canais efetivos e as regras que a interface desabilita. */
function prefsBody(prefs: NotificationPrefs) {
  return Object.fromEntries(
    NOTIFICATION_GROUPS.map((group: NotificationGroup) => [
      group,
      {
        inApp: prefs[group].inApp,
        email: prefs[group].email,
        emailRequired: isNotificationEmailRequired(group),
        inAppAvailable: notificationGroupHasInApp(group),
      },
    ]),
  );
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  options: NotificationRoutesOptions,
): void {
  const { db } = options;

  app.operation('listNotifications', async (request) => {
    const query = request.query as { limit?: number; cursor?: string };
    const page = await listNotifications(db, requireSession(request).user.id, {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return { items: page.items.map(itemBody), nextCursor: page.nextCursor };
  });

  app.operation('clearNotifications', async (request) => {
    return clearNotifications(db, requireSession(request).user.id);
  });

  app.operation('getNotificationUnreadCount', async (request) => {
    const unreadCount = await getUnreadNotificationCount(db, requireSession(request).user.id);
    return { unreadCount };
  });

  app.operation('markNotificationRead', async (request) => {
    const { id } = request.params as { id: string };
    const result = await markNotificationRead(db, requireSession(request).user.id, id);
    if (result === null) {
      // O núcleo devolve `null` para id inexistente e para notificação de outra pessoa.
      throw notFoundNotification();
    }
    return { notification: itemBody(result.notification), unreadCount: result.unreadCount };
  });

  app.operation('markAllNotificationsRead', async (request) => {
    return markAllNotificationsRead(db, requireSession(request).user.id);
  });

  app.operation('getNotificationPrefs', async (request) => {
    return prefsBody(await getNotificationPrefs(db, requireSession(request).user.id));
  });

  app.operation('updateNotificationPrefs', async (request) => {
    const body = request.body as NotificationPrefsUpdate;
    try {
      const saved = await setNotificationPrefs(db, requireSession(request).user.id, body);
      return prefsBody(saved);
    } catch (error) {
      throw remapPrefsError(error);
    }
  });
}

/** `404` da marcação de leitura: o item não existe ou não é do usuário da sessão. */
function notFoundNotification() {
  return notFound('Notificação não encontrada.');
}

/**
 * O núcleo valida as preferências com caminhos `body.prefs.<grupo>` (é a forma que o classroom
 * usa). Neste contrato o corpo é o próprio mapa de grupos: o caminho vai sem o `prefs`.
 */
function remapPrefsError(error: unknown): unknown {
  if (isDomainError(error) && error.code === 'validation_failed' && error.errors !== undefined) {
    return validationFailed(
      error.errors.map((field) => ({
        ...field,
        path: field.path.replace(/^body\.prefs\./, 'body.'),
      })),
      error.detail,
    );
  }
  return error;
}
