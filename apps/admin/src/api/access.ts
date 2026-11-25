import type { AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './client';

/*
 * Direitos de acesso (spec 010) e progresso (spec 014) vistos pelo admin: a árvore de direitos
 * e o progresso de um usuário, e os alunos e o resumo de progresso de um curso.
 */
export type EntitlementNode = AdminSchemas['EntitlementNode'];
export type EntitlementState = AdminSchemas['EntitlementState'];
export type ProductType = AdminSchemas['ProductType'];
export type UserCourseProgress = AdminSchemas['UserCourseProgress'];
export type CourseProgressSummary = AdminSchemas['CourseProgressSummary'];
export type CourseProgressState = AdminSchemas['CourseProgressState'];
export type CourseStudent = AdminSchemas['CourseStudent'];

export type StudentsQuery = NonNullable<
  AdminOperations['listCourseStudents']['parameters']['query']
>;
export type StudentsSort = NonNullable<StudentsQuery['sort']>;

export const PRODUCT_TYPES: readonly ProductType[] = ['course', 'ebook', 'bundle'];
export const PROGRESS_STATES: readonly CourseProgressState[] = [
  'not_started',
  'in_progress',
  'completed',
];
export const STUDENTS_SORTS: readonly StudentsSort[] = ['-lastActivityAt', 'name', '-percent'];
export const DEFAULT_STUDENTS_SORT: StudentsSort = '-lastActivityAt';
export const STUDENTS_PAGE_SIZE = 25;
/** Limite do motivo de concessão e de revogação, igual ao do contrato. */
export const REASON_MAX = 500;

export const accessKeys = {
  entitlements: (userId: string) => ['access', 'entitlements', userId] as const,
  progress: (userId: string) => ['access', 'progress', userId] as const,
  summary: (courseId: string) => ['access', 'summary', courseId] as const,
  students: (courseId: string) => ['access', 'students', courseId] as const,
  studentsList: (courseId: string, query: Omit<StudentsQuery, 'cursor'>) =>
    ['access', 'students', courseId, query] as const,
};

/** Raízes dos direitos do usuário, com a cascata em `children` (`GET /users/{id}/entitlements`). */
export function useUserEntitlements(userId: string) {
  const api = useApi();
  return useQuery({
    queryKey: accessKeys.entitlements(userId),
    queryFn: async ({ signal }): Promise<EntitlementNode[]> => {
      const { data } = await api.GET('/api/v1/users/{id}/entitlements', {
        params: { path: { id: userId } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/users/{id}/entitlements respondeu sem corpo');
      return data.items;
    },
  });
}

/** Progresso do usuário por curso (`GET /users/{id}/progress`). */
export function useUserProgress(userId: string) {
  const api = useApi();
  return useQuery({
    queryKey: accessKeys.progress(userId),
    queryFn: async ({ signal }): Promise<UserCourseProgress[]> => {
      const { data } = await api.GET('/api/v1/users/{id}/progress', {
        params: { path: { id: userId } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/users/{id}/progress respondeu sem corpo');
      return data.items;
    },
  });
}

/** Resumo de progresso do curso (`GET /courses/{id}/progress-summary`). */
export function useCourseProgressSummary(courseId: string) {
  const api = useApi();
  return useQuery({
    queryKey: accessKeys.summary(courseId),
    queryFn: async ({ signal }): Promise<CourseProgressSummary> => {
      const { data } = await api.GET('/api/v1/courses/{id}/progress-summary', {
        params: { path: { id: courseId } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/courses/{id}/progress-summary respondeu sem corpo');
      return data;
    },
  });
}

/** Alunos do curso por cursor (`GET /courses/{id}/students`), sem e-mail nem compras. */
export function useCourseStudents(
  courseId: string,
  query: Omit<StudentsQuery, 'cursor' | 'limit'>,
) {
  const api = useApi();
  const full = { ...query, limit: STUDENTS_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: accessKeys.studentsList(courseId, full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/courses/{id}/students', {
        params: {
          path: { id: courseId },
          query: pageParam ? { ...full, cursor: pageParam } : full,
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/courses/{id}/students respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Depois de conceder ou revogar: a árvore e o progresso do usuário são lidos de novo. */
export function accessChanged(queryClient: QueryClient, userId: string): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: accessKeys.progress(userId) });
  return queryClient.invalidateQueries({ queryKey: accessKeys.entitlements(userId) });
}

/** Revogação manual só atinge raiz `grant` ainda não revogada nem vencida (spec 010). */
export function isRevocable(node: EntitlementNode): boolean {
  return (
    node.source === 'grant' &&
    node.parentEntitlementId === null &&
    (node.state === 'active' || node.state === 'scheduled')
  );
}

/** Fim do dia escolhido (`AAAA-MM-DD`), no fuso do navegador, como instante ISO. */
export function endOfDay(date: string): Date | undefined {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const end = new Date(year, month - 1, day, 23, 59, 59);
  // 31/02 vira março: data que não existe é recusada
  return end.getMonth() === month - 1 && end.getDate() === day ? end : undefined;
}

/** Um produto na busca da concessão: o bastante para escolher. */
export interface ProductOption {
  id: string;
  title: string;
  status: 'draft' | 'published';
  archivedAt: string | null;
}

export const PRODUCT_SEARCH_SIZE = 10;

/**
 * Busca de produto para a concessão: os primeiros por título, do tipo escolhido
 * (`GET /courses`, `/ebooks` ou `/bundles`). Quem não acha refina a busca.
 */
export function useProductSearch(type: ProductType, q: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['access', 'product-search', type, q ?? ''] as const,
    queryFn: async ({ signal }): Promise<ProductOption[]> => {
      const options = {
        params: {
          query: { ...(q ? { q } : {}), sort: 'title' as const, limit: PRODUCT_SEARCH_SIZE },
        },
        signal,
      };
      const { data } =
        type === 'course'
          ? await api.GET('/api/v1/courses', options)
          : type === 'ebook'
            ? await api.GET('/api/v1/ebooks', options)
            : await api.GET('/api/v1/bundles', options);
      if (!data) throw new Error(`a busca de ${type} respondeu sem corpo`);
      return data.items.map(({ id, title, status, archivedAt }) => ({
        id,
        title,
        status,
        archivedAt,
      }));
    },
  });
}
