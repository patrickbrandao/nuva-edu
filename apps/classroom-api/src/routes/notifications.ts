import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  assertCan,
  type CatalogViewer,
  clearNotifications,
  getNotificationPrefs,
  getUnreadNotificationCount,
  isNotificationEmailRequired,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationItem,
  type NotificationPrefs,
  notFound,
  notificationGroupHasInApp,
  setNotificationPrefs,
  type UnsubscribedGroup,
  unsubscribeByToken,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { privateCache, viewerOf } from './catalog.ts';
import { bodyOf, paramsOf, type RouteContext } from './context.ts';

/**
 * O aluno da sessão (ou alguém da equipe na comunidade), com a permissão da operação
 * (`x-permission: account.self_service`) conferida pelo papel.
 */
function ownerOf(request: FastifyRequest): CatalogViewer {
  const viewer = viewerOf(request);
  assertCan(viewer, 'account.self_service');
  return viewer;
}

/**
 * O item da central como o contrato o descreve: o núcleo devolve também `userId` e `actorId`
 * (para quem escreve no banco); o fio leva só o que a tela usa.
 */
function itemToWire({ userId: _userId, actorId: _actorId, ...item }: NotificationItem): unknown {
  return item;
}

/** Uma página da central, cada item no formato do contrato. */
function pageToWire(page: { items: NotificationItem[]; nextCursor: string | null }): unknown {
  return toWire({ items: page.items.map(itemToWire), nextCursor: page.nextCursor });
}

/**
 * Preferências efetivas com as regras que a interface usa para travar os canais: e-mail
 * obrigatório (RF-04) e ausência do canal plataforma no grupo `account`. Os onze grupos saem
 * sempre, na ordem da tabela da spec 024.
 */
function prefsToWire(prefs: NotificationPrefs): unknown {
  return Object.fromEntries(
    NOTIFICATION_GROUPS.map((group) => [
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

/** Canais efetivos de um grupo, como o descadastro os devolve (sem as regras da tela). */
function channelsToWire(unsubscribed: UnsubscribedGroup): unknown {
  return {
    group: unsubscribed.group,
    prefs: { inApp: unsubscribed.prefs.inApp, email: unsubscribed.prefs.email },
  };
}

/**
 * Central de notificações (spec 024): lista, contador do sino, leitura, limpeza, preferências
 * por grupo e o descadastro público por token. As regras (nunca alcançar notificação de outra
 * pessoa, grupos obrigatórios, token que não expira) são do núcleo; a rota só adapta ao
 * contrato. O contador em tempo real é o `notification.created` do fluxo SSE, publicado pelo
 * núcleo na mesma transação da notificação — nenhuma rota daqui o empurra.
 */
export function registerNotificationRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db } = ctx;

  // `GET /notifications`: da mais nova para a mais antiga, paginada por cursor. `limit` e
  // `cursor` chegam validados e com os padrões; cursor fora do formato é `400` do núcleo.
  app.operation('listNotifications', async (request, reply) => {
    const page = await listNotifications(
      db,
      ownerOf(request).id,
      request.query as { limit?: number; cursor?: string },
    );
    privateCache(reply);
    return pageToWire(page);
  });

  // `DELETE /notifications`: "limpar todas", lidas e não lidas do próprio usuário.
  app.operation('clearNotifications', async (request) => {
    const result = await clearNotifications(db, ownerOf(request).id);
    return toWire(result);
  });

  // `GET /notifications/unread-count`: o número do sino.
  app.operation('getNotificationUnreadCount', async (request, reply) => {
    const unreadCount = await getUnreadNotificationCount(db, ownerOf(request).id);
    privateCache(reply);
    return { unreadCount };
  });

  // `POST /notifications/{id}/read`: idempotente; de outra pessoa ou inexistente é `404`.
  app.operation('markNotificationRead', async (request) => {
    const { id } = paramsOf<{ id: string }>(request);
    const result = await markNotificationRead(db, ownerOf(request).id, id);
    if (result === null) {
      throw notFound('Notificação não encontrada.');
    }
    return toWire({
      notification: itemToWire(result.notification),
      unreadCount: result.unreadCount,
    });
  });

  // `POST /notifications/read-all`: todas as não lidas do próprio usuário.
  app.operation('markAllNotificationsRead', async (request) => {
    const result = await markAllNotificationsRead(db, ownerOf(request).id);
    return toWire(result);
  });

  // `GET /me/notification-prefs`: canais efetivos dos onze grupos, com as regras que travam
  // cada um. Grupo sem linha gravada vale o padrão da spec.
  app.operation('getNotificationPrefs', async (request, reply) => {
    const prefs = await getNotificationPrefs(db, ownerOf(request).id);
    privateCache(reply);
    return prefsToWire(prefs);
  });

  // `PUT /me/notification-prefs`: só os canais enviados mudam. E-mail desligado em grupo
  // obrigatório ou canal plataforma no grupo `account`: `400 validation_failed` do núcleo.
  app.operation('updateNotificationPrefs', async (request, reply) => {
    const update =
      bodyOf<Partial<Record<NotificationGroup, { inApp?: boolean; email?: boolean }>>>(request);
    const prefs = await setNotificationPrefs(db, ownerOf(request).id, update);
    privateCache(reply);
    return prefsToWire(prefs);
  });

  // `POST /unsubscribe/{token}`: link de um clique do e-mail, sem login e sem CSRF (a
  // operação é exceção em `CSRF_EXCEPTIONS`). Só o e-mail do grupo do token cai; o canal
  // plataforma fica como estava. Token fora do formato ou desconhecido: `404`.
  app.operation('unsubscribe', async (request, reply) => {
    const { token } = paramsOf<{ token: string }>(request);
    const result = await unsubscribeByToken(db, token);
    if (result === null) {
      throw notFound('Link de descadastro inválido.');
    }
    privateCache(reply);
    return toWire(channelsToWire(result));
  });
}
