import type { AdminClient, AdminSchemas } from '@nuva-edu/api-client/admin';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../../api/client';
import { NOTIFICATIONS_PAGE_SIZE } from './paths';

/*
 * Dados da central da equipe (spec 024): lista, contador do sino e preferências por grupo.
 * Tudo pelo cliente gerado; nenhuma URL escrita à mão. O evento SSE `notification.created`
 * atualiza o contador direto no cache e invalida a lista (`useNotificationStream`).
 */

export type NotificationItem = AdminSchemas['NotificationItem'];
export type NotificationPage = AdminSchemas['NotificationPage'];
export type NotificationUnreadCount = AdminSchemas['NotificationUnreadCount'];
export type NotificationReadResult = AdminSchemas['NotificationReadResult'];
export type NotificationsReadAllResult = AdminSchemas['NotificationsReadAllResult'];
export type NotificationsCleared = AdminSchemas['NotificationsCleared'];
export type NotificationGroup = AdminSchemas['NotificationGroup'];
export type NotificationGroupPrefs = AdminSchemas['NotificationGroupPrefs'];
export type NotificationPrefs = AdminSchemas['NotificationPrefs'];
export type NotificationPrefsUpdate = AdminSchemas['NotificationPrefsUpdate'];

/**
 * Grupos de preferência na ordem da spec 024, "Tipos e grupos". O contrato devolve todos; a
 * lista fixa aqui só garante a ordem da tela, mesmo que a API mude a ordem das chaves.
 */
export const NOTIFICATION_GROUPS = [
  'account',
  'purchase',
  'courses',
  'forum',
  'messages',
  'community',
  'events',
  'support',
  'announcements',
  'moderation',
  'staff',
] as const satisfies readonly NotificationGroup[];

export const notificationsKeys = {
  list: () => ['notifications', 'list'] as const,
  unread: () => ['notifications', 'unread'] as const,
  prefs: () => ['notifications', 'prefs'] as const,
};

/** Uma página da central do usuário da sessão (`GET /api/v1/notifications`). */
export function useNotifications(enabled = true) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: notificationsKeys.list(),
    queryFn: async ({ pageParam, signal }): Promise<NotificationPage> => {
      const { data } = await api.GET('/api/v1/notifications', {
        params: {
          query: pageParam
            ? { limit: NOTIFICATIONS_PAGE_SIZE, cursor: pageParam }
            : { limit: NOTIFICATIONS_PAGE_SIZE },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/notifications respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}

/**
 * Contador do sino (`GET /api/v1/notifications/unread-count`). O SSE o atualiza sem nova
 * leitura; a reconexão volta ao servidor (`useNotificationStream`).
 */
export function useUnreadCount(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: notificationsKeys.unread(),
    queryFn: async ({ signal }): Promise<NotificationUnreadCount> => {
      const { data } = await api.GET('/api/v1/notifications/unread-count', { signal });
      if (!data) throw new Error('GET /api/v1/notifications/unread-count respondeu sem corpo');
      return data;
    },
    staleTime: 30 * 1000,
    enabled,
  });
}

/** Preferências da equipe por grupo (`GET /api/v1/me/notification-prefs`). */
export function useNotificationPrefs() {
  const api = useApi();
  return useQuery({
    queryKey: notificationsKeys.prefs(),
    queryFn: async ({ signal }): Promise<NotificationPrefs> => {
      const { data } = await api.GET('/api/v1/me/notification-prefs', { signal });
      if (!data) throw new Error('GET /api/v1/me/notification-prefs respondeu sem corpo');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Abrir o item marca como lido (`POST /api/v1/notifications/{id}/read`). */
export async function markNotificationRead(
  api: AdminClient,
  id: string,
): Promise<NotificationReadResult> {
  const { data } = await api.POST('/api/v1/notifications/{id}/read', {
    params: { path: { id } },
  });
  if (!data) throw new Error('POST /api/v1/notifications/{id}/read respondeu sem corpo');
  return data;
}

/** "Marcar todas como lidas" (`POST /api/v1/notifications/read-all`). */
export async function markAllNotificationsRead(
  api: AdminClient,
): Promise<NotificationsReadAllResult> {
  const { data } = await api.POST('/api/v1/notifications/read-all');
  if (!data) throw new Error('POST /api/v1/notifications/read-all respondeu sem corpo');
  return data;
}

/** "Limpar todas" (`DELETE /api/v1/notifications`): some com lidas e não lidas. */
export async function clearNotifications(api: AdminClient): Promise<NotificationsCleared> {
  const { data } = await api.DELETE('/api/v1/notifications');
  if (!data) throw new Error('DELETE /api/v1/notifications respondeu sem corpo');
  return data;
}

/** Grava só os canais enviados (`PUT /api/v1/me/notification-prefs`). */
export async function updateNotificationPrefs(
  api: AdminClient,
  body: NotificationPrefsUpdate,
): Promise<NotificationPrefs> {
  const { data } = await api.PUT('/api/v1/me/notification-prefs', { body });
  if (!data) throw new Error('PUT /api/v1/me/notification-prefs respondeu sem corpo');
  return data;
}
