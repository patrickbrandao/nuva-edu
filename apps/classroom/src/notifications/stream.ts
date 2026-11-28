import { openClassroomStream } from '@nuva-edu/api-client/classroom';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { forumKey, topicKey } from '../forum/queries';
import { useSession } from '../session/session';
import { notificationsListKey, notificationsUnreadKey, setUnreadCount } from './queries';

export interface NotificationStreamOptions {
  /** Substitui o `EventSource` global (testes). */
  EventSource?: typeof EventSource | undefined;
}

/**
 * Fluxo SSE da classroom-api para o sino (spec 024, "Central"): uma conexão por aba, com o
 * cookie de sessão. `notification.created` traz o contador já somado e invalida a lista; a
 * reconexão (o navegador repete o `Last-Event-ID`) recarrega contador e lista. Nada aqui depende
 * de ter recebido todos os eventos: a API é a fonte do estado.
 */
export function useNotificationStream({
  EventSource: Implementation,
}: NotificationStreamOptions = {}) {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (userId === null) return undefined;
    const EventSourceImpl = Implementation ?? globalThis.EventSource;
    if (typeof EventSourceImpl !== 'function') return undefined;

    let firstOpen = true;
    const reload = () => {
      void client.invalidateQueries({ queryKey: notificationsUnreadKey(userId) });
      void client.invalidateQueries({ queryKey: notificationsListKey(userId) });
    };
    const stream = openClassroomStream({
      ...(Implementation ? { EventSource: Implementation } : {}),
      onOpen: () => {
        // A primeira abertura acompanha a carga da página; só a volta depois de cair recarrega.
        if (firstOpen) {
          firstOpen = false;
          return;
        }
        reload();
        void client.invalidateQueries({ queryKey: forumKey(userId) });
      },
      onEvent: (event) => {
        if (event.event === 'forum.post.created') {
          void client.invalidateQueries({ queryKey: topicKey(userId, event.data.topicId) });
          return;
        }
        if (event.event !== 'notification.created') return;
        setUnreadCount(client, userId, event.data.unreadCount);
        void client.invalidateQueries({ queryKey: notificationsListKey(userId) });
      },
      // O `EventSource` reconecta sozinho; a recarga acontece no próximo `open`.
      onError: () => {},
    });
    return () => stream.close();
  }, [client, userId, Implementation]);
}
