import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useApi } from '../api/client';
import { useSession } from '../session/session';

/*
 * Central de notificações (spec 024): lista, contador do sino, leitura, limpeza, preferências
 * por grupo e descadastro por token. Tudo pelo cliente gerado do contrato da classroom-api;
 * nenhuma URL escrita à mão. O contador muda por SSE (`notification.created`, em `./stream.ts`),
 * e as mutações também o atualizam sem nova consulta.
 */

export type NotificationItem = ClassroomSchemas['NotificationItem'];
export type NotificationPage = ClassroomSchemas['NotificationPage'];
export type NotificationGroup = ClassroomSchemas['NotificationGroup'];
export type NotificationPrefs = ClassroomSchemas['NotificationPrefs'];
export type NotificationGroupPrefs = ClassroomSchemas['NotificationGroupPrefs'];
export type NotificationPrefsUpdate = ClassroomSchemas['NotificationPrefsUpdate'];
export type UnsubscribeResult = ClassroomSchemas['UnsubscribeResult'];

/** Itens por página da central (o máximo do contrato é 50). */
export const NOTIFICATIONS_PAGE_SIZE = 20;

type ListData = InfiniteData<NotificationPage, string | null>;

const notificationsPrefix = (userId: string | null) => ['notifications', userId] as const;

/** Lista da central do usuário da sessão. */
export const notificationsListKey = (userId: string | null) =>
  [...notificationsPrefix(userId), 'list'] as const;
/** Contador de não lidas do sino. */
export const notificationsUnreadKey = (userId: string | null) =>
  [...notificationsPrefix(userId), 'unread'] as const;
/** Preferências por grupo. */
export const notificationPrefsKey = (userId: string | null) =>
  ['notification-prefs', userId] as const;

/** Contador do sino (`GET /api/v1/notifications/unread-count`). */
export function useUnreadCount() {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: notificationsUnreadKey(userId),
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<ClassroomSchemas['NotificationUnreadCount']> => {
      const { data } = await api.GET('/api/v1/notifications/unread-count', { signal });
      if (!data) throw new Error('GET /api/v1/notifications/unread-count respondeu sem corpo');
      return data;
    },
  });
}

/** Lista da central, da mais nova para a mais antiga, paginada por cursor. */
export function useNotifications({ enabled = true }: { enabled?: boolean } = {}) {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useInfiniteQuery({
    queryKey: notificationsListKey(userId),
    enabled: enabled && session !== null,
    queryFn: async ({ pageParam, signal }): Promise<NotificationPage> => {
      const { data } = await api.GET('/api/v1/notifications', {
        params: {
          query: {
            limit: NOTIFICATIONS_PAGE_SIZE,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/notifications respondeu sem corpo');
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** Troca o contador do sino no cache (SSE, leitura e limpeza). */
export function setUnreadCount(
  client: QueryClient,
  userId: string | null,
  unreadCount: number,
): void {
  client.setQueryData<ClassroomSchemas['NotificationUnreadCount']>(notificationsUnreadKey(userId), {
    unreadCount,
  });
}

/** Muda itens da lista já carregada, sem nova consulta. */
function mapList(
  client: QueryClient,
  userId: string | null,
  change: (item: NotificationItem) => NotificationItem,
): void {
  client.setQueryData<ListData>(notificationsListKey(userId), (current) =>
    current
      ? {
          ...current,
          pages: current.pages.map((page) => ({ ...page, items: page.items.map(change) })),
        }
      : current,
  );
}

/**
 * Abrir o item marca como lido (`POST /api/v1/notifications/{id}/read`). Idempotente na API; a
 * resposta traz o item e o contador, que entram no cache na hora.
 */
export function useMarkNotificationRead() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (id: string): Promise<ClassroomSchemas['NotificationReadResult']> => {
      const { data } = await api.POST('/api/v1/notifications/{id}/read', {
        params: { path: { id } },
      });
      if (!data) throw new Error('POST /api/v1/notifications/{id}/read respondeu sem corpo');
      return data;
    },
    onSuccess: (result) => {
      setUnreadCount(client, userId, result.unreadCount);
      mapList(client, userId, (item) =>
        item.id === result.notification.id ? result.notification : item,
      );
    },
  });
}

/** "Marcar todas como lidas" (`POST /api/v1/notifications/read-all`): o sino fica zerado. */
export function useMarkAllNotificationsRead() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (): Promise<ClassroomSchemas['NotificationsReadAllResult']> => {
      const { data } = await api.POST('/api/v1/notifications/read-all');
      if (!data) throw new Error('POST /api/v1/notifications/read-all respondeu sem corpo');
      return data;
    },
    onSuccess: (result) => {
      setUnreadCount(client, userId, result.unreadCount);
      const now = new Date().toISOString();
      mapList(client, userId, (item) => (item.readAt ? item : { ...item, readAt: now }));
    },
  });
}

/** "Limpar todas" (`DELETE /api/v1/notifications`): lidas e não lidas somem. */
export function useClearNotifications() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (): Promise<ClassroomSchemas['NotificationsCleared']> => {
      const { data } = await api.DELETE('/api/v1/notifications');
      if (!data) throw new Error('DELETE /api/v1/notifications respondeu sem corpo');
      return data;
    },
    onSuccess: () => {
      setUnreadCount(client, userId, 0);
      client.setQueryData<ListData>(notificationsListKey(userId), {
        pages: [{ items: [], nextCursor: null }],
        pageParams: [null],
      });
    },
  });
}

/** Preferências por grupo (`GET /api/v1/me/notification-prefs`). */
export function useNotificationPrefs() {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: notificationPrefsKey(userId),
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<NotificationPrefs> => {
      const { data } = await api.GET('/api/v1/me/notification-prefs', { signal });
      if (!data) throw new Error('GET /api/v1/me/notification-prefs respondeu sem corpo');
      return data;
    },
  });
}

/** Canal mexido em um grupo: `inApp` (plataforma) ou `email`. */
export type NotificationChannel = 'inApp' | 'email';

export interface PreferenceChange {
  group: NotificationGroup;
  channel: NotificationChannel;
  value: boolean;
}

/** Preferências já gravadas na API, para desfazer a mudança otimista quando ela falhar. */
export type PreferencesSnapshot = NotificationPrefs | undefined;

/**
 * Grava o canal de um grupo (`PUT /api/v1/me/notification-prefs`). A tela muda na hora e volta
 * atrás se a API recusar (grupo obrigatório com e-mail desligado, por exemplo).
 */
export function useUpdateNotificationPrefs() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const key = notificationPrefsKey(userId);
  return useMutation({
    mutationFn: async ({ group, channel, value }: PreferenceChange): Promise<NotificationPrefs> => {
      const body = { [group]: { [channel]: value } } as NotificationPrefsUpdate;
      const { data } = await api.PUT('/api/v1/me/notification-prefs', { body });
      if (!data) throw new Error('PUT /api/v1/me/notification-prefs respondeu sem corpo');
      return data;
    },
    onMutate: async ({ group, channel, value }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<NotificationPrefs>(key);
      if (previous) {
        client.setQueryData<NotificationPrefs>(key, {
          ...previous,
          [group]: { ...previous[group], [channel]: value },
        });
      }
      return { previous } satisfies { previous: PreferencesSnapshot };
    },
    onError: (_error, _change, context) => {
      if (context?.previous) client.setQueryData<NotificationPrefs>(key, context.previous);
    },
    onSuccess: (prefs) => client.setQueryData<NotificationPrefs>(key, prefs),
  });
}

/**
 * Descadastro de um grupo pelo token do e-mail (`POST /api/v1/unsubscribe/{token}`). Sem login
 * e sem CSRF: quem abre vem do cliente de e-mail.
 */
export function useUnsubscribe() {
  const api = useApi();
  return useMutation({
    mutationFn: async (token: string): Promise<UnsubscribeResult> => {
      const { data } = await api.POST('/api/v1/unsubscribe/{token}', {
        params: { path: { token } },
      });
      if (!data) throw new Error('POST /api/v1/unsubscribe/{token} respondeu sem corpo');
      return data;
    },
  });
}

/** Os onze grupos de preferência, na ordem da tabela da spec 024. */
export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = [
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
];
