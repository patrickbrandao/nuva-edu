import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '../api/client';
import { setCsrfToken } from '../api/csrf';
import { SESSION_KEY, type SessionData, storeSession } from '../api/query';

/** Papéis do cadastro único de usuários (spec 008, RF-01). */
export type UserRole = ClassroomSchemas['UserRole'];

/** Equipe: todo papel diferente de `student` (spec 008). */
export function isStaff(role: UserRole | null | undefined): boolean {
  return role === 'instructor' || role === 'manager' || role === 'admin';
}

/**
 * Sessão do classroom (`GET /api/v1/session`), lida ao carregar o site. `401` é visitante. Erro de
 * outro tipo (rota ainda inexistente, API fora do ar) também deixa o site como visitante: a vitrine
 * e as telas públicas continuam de pé, e as telas que exigem login levam a `/entrar`.
 */
export function useSession() {
  const api = useApi();
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }): Promise<SessionData> => {
      try {
        const { data } = await api.GET('/api/v1/session', { signal });
        setCsrfToken(data?.csrfToken ?? null);
        return data ?? null;
      } catch (error) {
        setCsrfToken(null);
        if (isApiError(error) && error.status < 500) return null;
        throw error;
      }
    },
    staleTime: 60 * 1000,
  });
  return {
    session: query.data ?? null,
    /** Verdadeiro até a primeira resposta (ou falha) da consulta. */
    pending: query.isPending,
    refetch: query.refetch,
  };
}

/** Papel do usuário da sessão; `null` para visitante. */
export function useSessionRole(): UserRole | null {
  return useSession().session?.user.role ?? null;
}

/** Troca a sessão guardada (login, cadastro, saída) sem nova consulta. */
export function useStoreSession(): (session: SessionData) => void {
  const client = useQueryClient();
  return useCallback((session: SessionData) => storeSession(client, session), [client]);
}

/** Pede a sessão de novo ao servidor (ex.: depois de aceitar os termos ou confirmar o e-mail). */
export function useRefreshSession(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: SESSION_KEY }), [client]);
}
