import type { AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './client';

export type AuditEntry = AdminSchemas['AuditEntry'];
export type AuditEntryDetail = AdminSchemas['AuditEntryDetail'];
export type AuditOrigin = AdminSchemas['AuditOrigin'];
export type AuditOutcome = AdminSchemas['AuditOutcome'];
export type AuditQuery = NonNullable<AdminOperations['listAuditEntries']['parameters']['query']>;

export const AUDIT_ORIGINS: readonly AuditOrigin[] = [
  'admin_panel',
  'mcp',
  'classroom',
  'worker',
  'cli',
];
export const AUDIT_OUTCOMES: readonly AuditOutcome[] = ['ok', 'denied', 'error'];
export const AUDIT_PAGE_SIZE = 50;
/** Ação exata ou prefixo com `.*`, como no contrato. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)*(\.\*)?$/;

/** Registros do mais novo ao mais antigo (`GET /api/v1/audit`; `audit.view`). */
export function useAuditList(query: Omit<AuditQuery, 'cursor' | 'limit'>) {
  const api = useApi();
  const full = { ...query, limit: AUDIT_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: ['audit', 'list', full],
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/audit', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/audit respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Cada consulta grava `audit.search` na própria auditoria: nada de refazer sozinha.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Um registro com `details` (`GET /api/v1/audit/{id}`). */
export function useAuditEntry(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['audit', 'entry', id],
    queryFn: async ({ signal }): Promise<AuditEntryDetail> => {
      const { data } = await api.GET('/api/v1/audit/{id}', { params: { path: { id } }, signal });
      if (!data) throw new Error('GET /api/v1/audit/{id} respondeu sem corpo');
      return data;
    },
  });
}
