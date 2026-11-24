import type { AdminSession } from '@nuva-edu/api-client/admin';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { useApi } from '../api/client';
import { setCsrfToken } from '../api/csrf';

export const SESSION_KEY = ['session'] as const;

/** Grava a sessão no cache e o token CSRF na memória (login e `GET /api/v1/session`). */
export function storeSession(queryClient: QueryClient, session: AdminSession): void {
  setCsrfToken(session.csrfToken);
  queryClient.setQueryData(SESSION_KEY, session);
}

/** Esquece a sessão: cache inteiro (dados de quem saiu) e token CSRF. */
export function forgetSession(queryClient: QueryClient): void {
  setCsrfToken(null);
  queryClient.removeQueries();
}

/** `GET /api/v1/session` (spec 006, "Sessão"): dono, token CSRF e ações permitidas. */
export function useSessionQuery() {
  const api = useApi();
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }): Promise<AdminSession> => {
      const { data } = await api.GET('/api/v1/session', { signal });
      if (!data) throw new Error('GET /api/v1/session respondeu sem corpo');
      setCsrfToken(data.csrfToken);
      return data;
    },
    staleTime: 60 * 1000,
  });
}

const SessionContext = createContext<AdminSession | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: AdminSession;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Sessão aberta; só dentro da guarda (`SessionGate`), que garante que ela existe. */
export function useSession(): AdminSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession fora do SessionGate');
  return session;
}

/**
 * Se o papel tem a ação (spec 008, "Identificadores das ações"). Serve só para esconder o que
 * não se pode usar (spec 006, RF-10): quem autoriza é a API, e o `403` dela é tratado na tela.
 */
export function useCan(): (action: string) => boolean {
  const session = useContext(SessionContext);
  return (action) => session?.permissions.includes(action) ?? false;
}
