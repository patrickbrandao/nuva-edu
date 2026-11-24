import type { AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './client';

export type UserSummary = AdminSchemas['UserSummary'];
export type UserDetail = AdminSchemas['UserDetail'];
export type UserRole = AdminSchemas['UserRole'];
export type SessionInfo = AdminSchemas['SessionInfo'];
export type SuspensionKind = AdminSchemas['SuspensionKind'];

export type UsersQuery = NonNullable<AdminOperations['listUsers']['parameters']['query']>;
export type UserStatusFilter = NonNullable<UsersQuery['status']>;
export type UsersSort = NonNullable<UsersQuery['sort']>;

export const USER_ROLES: readonly UserRole[] = ['student', 'instructor', 'manager', 'admin'];
export const STAFF_ROLES: readonly UserRole[] = ['instructor', 'manager', 'admin'];
export const USER_STATUSES: readonly UserStatusFilter[] = ['active', 'suspended', 'unverified'];
export const USERS_SORTS: readonly UsersSort[] = ['-createdAt', 'name', '-lastLoginAt'];
export const DEFAULT_SORT: UsersSort = '-createdAt';
export const PAGE_SIZE = 25;

export const usersKeys = {
  all: ['users'] as const,
  lists: () => ['users', 'list'] as const,
  list: (query: Omit<UsersQuery, 'cursor'>) => ['users', 'list', query] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
  sessions: (id: string) => ['users', 'sessions', id] as const,
};

/** Lista paginada por cursor (`GET /api/v1/users`); "carregar mais" busca a página seguinte. */
export function useUsersList(query: Omit<UsersQuery, 'cursor' | 'limit'>, enabled = true) {
  const api = useApi();
  const full = { ...query, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: usersKeys.list(full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/users', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/users respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}

/** Ficha de um usuário (`GET /api/v1/users/{id}`). */
export function useUser(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: usersKeys.detail(id),
    queryFn: async ({ signal }): Promise<UserDetail> => {
      const { data } = await api.GET('/api/v1/users/{id}', {
        params: { path: { id } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/users/{id} respondeu sem corpo');
      return data;
    },
  });
}

/** Sessões abertas do usuário, nos dois sites. */
export function useUserSessions(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: usersKeys.sessions(id),
    queryFn: async ({ signal }): Promise<SessionInfo[]> => {
      const { data } = await api.GET('/api/v1/users/{id}/sessions', {
        params: { path: { id } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/users/{id}/sessions respondeu sem corpo');
      return data.items;
    },
    enabled,
  });
}

/** Depois de uma escrita que devolve a ficha: atualiza a ficha e refaz as listas. */
export function userChanged(queryClient: QueryClient, user: UserDetail): void {
  queryClient.setQueryData(usersKeys.detail(user.id), user);
  void queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
}

export function isStaff(role: UserRole): boolean {
  return role !== 'student';
}

/**
 * Se a sessão pode fazer a ação sobre esse usuário (spec 008): conta da equipe exige
 * `staff.manage`, mesmo que sobre aluno a ação seja outra.
 */
export function canActOn(
  can: (action: string) => boolean,
  target: { role: UserRole },
  studentAction: string,
): boolean {
  return isStaff(target.role) ? can('staff.manage') : can(studentAction);
}
