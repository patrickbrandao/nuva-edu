import type { ClassroomSession } from '@nuva-edu/api-client/classroom';
import { isApiError } from '@nuva-edu/api-client/classroom';
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { setCsrfToken } from './csrf';

/** Chave da sessão no cache: `ClassroomSession`, ou `null` para visitante. */
export const SESSION_KEY = ['session'] as const;

export type SessionData = ClassroomSession | null;

/** Grava a sessão no cache e o token CSRF que as escritas seguintes enviam. */
export function storeSession(client: QueryClient, session: SessionData): void {
  setCsrfToken(session?.csrfToken ?? null);
  client.setQueryData<SessionData>(SESSION_KEY, session);
}

interface QueryClientOptions {
  /** Repetição das consultas; os testes desligam. */
  retry?: boolean;
}

/**
 * Repete só o que pode melhorar sozinho: falha de rede e erro 5xx, no máximo duas vezes.
 * Escrita que volta com `401 unauthenticated` (sessão vencida ou encerrada em outro lugar) apaga
 * a sessão do cache: as telas que exigem login levam a `/entrar`, guardando o destino.
 */
export function createQueryClient({ retry = true }: QueryClientOptions = {}): QueryClient {
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isApiError(error) && error.status === 401 && error.code === 'unauthenticated') {
          storeSession(client, null);
        }
      },
    }),
    defaultOptions: {
      queries: {
        retry: retry
          ? (failures, error) => failures < 2 && !(isApiError(error) && error.status < 500)
          : false,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}
