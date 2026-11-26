import { openAdminStream } from '@nuva-edu/api-client/admin';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { notificationsKeys } from './queries';

/*
 * Sino da equipe em tempo real (spec 024, "Central"; ADR 0028): uma conexão por aba, com a
 * sessão do próprio host, no fluxo `GET /api/v1/stream` da admin-api via `openAdminStream`.
 *
 * `notification.created` chega com o contador de não lidas: o número vai direto para o cache e a
 * lista é invalidada, sem recarregar a página. Na reconexão (o navegador repete o `Last-Event-ID`
 * sozinho, mas eventos podem ter se perdido) o contador e a lista voltam ao servidor. Sem
 * `EventSource` no ambiente (jsdom nos testes) a conexão não é aberta.
 */
export function useNotificationStream(): void {
  const queryClient = useQueryClient();
  const openedBefore = useRef(false);

  useEffect(() => {
    if (typeof globalThis.EventSource !== 'function') return undefined;
    const stream = openAdminStream({
      onEvent: (event) => {
        if (event.event !== 'notification.created') return;
        queryClient.setQueryData(notificationsKeys.unread(), {
          unreadCount: event.data.unreadCount,
        });
        void queryClient.invalidateQueries({ queryKey: notificationsKeys.list() });
      },
      onOpen: () => {
        // A primeira abertura acompanha a leitura inicial das consultas; da segunda em diante é
        // uma reconexão, e listas e contadores são conferidos de novo no servidor.
        if (openedBefore.current) {
          void queryClient.invalidateQueries({ queryKey: notificationsKeys.unread() });
          void queryClient.invalidateQueries({ queryKey: notificationsKeys.list() });
        }
        openedBefore.current = true;
      },
      // Sessão encerrada ou recusada termina o fluxo (`closed`); queda comum o navegador repete
      // sozinho. Em nenhum dos casos a central deixa de funcionar com o que já está em tela.
      onError: () => {},
    });
    return () => {
      openedBefore.current = false;
      stream.close();
    };
  }, [queryClient]);
}
