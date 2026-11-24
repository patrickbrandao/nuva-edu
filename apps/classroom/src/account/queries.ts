import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';

// Chaves começam por "account": o "Sair" apaga todas de uma vez.
export const IDENTITIES_KEY = ['account', 'identities'] as const;
export const ACCOUNT_SESSIONS_KEY = ['account', 'sessions'] as const;

/** Senha definida e provedores vinculados (`GET /api/v1/account/identities`). */
export function useIdentities() {
  const api = useApi();
  return useQuery({
    queryKey: IDENTITIES_KEY,
    queryFn: async ({ signal }): Promise<ClassroomSchemas['IdentityList']> => {
      const { data } = await api.GET('/api/v1/account/identities', { signal });
      return data ?? { hasPassword: false, items: [] };
    },
  });
}

/** Sessões abertas nos dois sites (`GET /api/v1/account/sessions`). */
export function useAccountSessions() {
  const api = useApi();
  return useQuery({
    queryKey: ACCOUNT_SESSIONS_KEY,
    queryFn: async ({ signal }): Promise<ClassroomSchemas['SessionInfo'][]> => {
      const { data } = await api.GET('/api/v1/account/sessions', { signal });
      return data?.items ?? [];
    },
  });
}
