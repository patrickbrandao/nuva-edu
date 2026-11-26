import type { AdminClient, AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './client';

export type CourseSummary = AdminSchemas['CourseSummary'];
export type CourseDetail = AdminSchemas['CourseDetail'];
export type CourseModule = AdminSchemas['CourseModule'];
export type LessonSummary = AdminSchemas['LessonSummary'];
export type LessonDetail = AdminSchemas['LessonDetail'];
export type AccessMode = AdminSchemas['AccessMode'];
export type CourseLevel = AdminSchemas['CourseLevel'];
export type LessonLinkKind = AdminSchemas['LessonLinkKind'];

export type CoursesQuery = NonNullable<AdminOperations['listCourses']['parameters']['query']>;
export type CourseStatusFilter = NonNullable<CoursesQuery['status']>;
export type CoursesSort = NonNullable<CoursesQuery['sort']>;

export const COURSE_STATUSES: readonly CourseStatusFilter[] = ['draft', 'published', 'archived'];
export const ACCESS_MODES: readonly AccessMode[] = ['open', 'paid', 'private'];
export const COURSE_LEVELS: readonly CourseLevel[] = ['beginner', 'intermediate', 'advanced'];
export const LINK_KINDS: readonly LessonLinkKind[] = ['file', 'page'];
export const COURSES_SORTS: readonly CoursesSort[] = ['-updatedAt', '-createdAt', 'title'];
export const DEFAULT_COURSES_SORT: CoursesSort = '-updatedAt';
export const COURSES_PAGE_SIZE = 25;

/** Limites da spec 009, RNF-03, iguais aos do contrato. */
export const TITLE_MAX = 160;
export const SUMMARY_MAX = 300;
export const DESCRIPTION_MAX = 20000;
export const URL_MAX = 2000;
export const LESSON_LINKS_MAX = 20;
export const DURATION_MAX_SECONDS = 86400;

export const COURSES_PATH = '/cursos';

export function coursePath(id: string): string {
  return `${COURSES_PATH}/${encodeURIComponent(id)}`;
}

export const coursesKeys = {
  all: ['courses'] as const,
  lists: () => ['courses', 'list'] as const,
  list: (query: Omit<CoursesQuery, 'cursor'>) => ['courses', 'list', query] as const,
  detail: (id: string) => ['courses', 'detail', id] as const,
  lesson: (id: string) => ['courses', 'lesson', id] as const,
};

/** Lista de cursos por cursor (`GET /api/v1/courses`); o instrutor recebe só os dele. */
export function useCoursesList(query: Omit<CoursesQuery, 'cursor' | 'limit'>) {
  const api = useApi();
  const full = { ...query, limit: COURSES_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: coursesKeys.list(full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/courses', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/courses respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** O curso para o editor, com módulos e aulas na ordem (`GET /api/v1/courses/{id}`). */
export function useCourse(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: coursesKeys.detail(id),
    queryFn: async ({ signal }): Promise<CourseDetail> => {
      const { data } = await api.GET('/api/v1/courses/{id}', {
        params: { path: { id } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/courses/{id} respondeu sem corpo');
      return data;
    },
  });
}

export async function fetchLesson(
  api: AdminClient,
  id: string,
  signal?: AbortSignal,
): Promise<LessonDetail> {
  const { data } = await api.GET('/api/v1/lessons/{id}', {
    params: { path: { id } },
    ...(signal ? { signal } : {}),
  });
  if (!data) throw new Error('GET /api/v1/lessons/{id} respondeu sem corpo');
  return data;
}

/** A aula para edição, com vídeo e links de apoio (`GET /api/v1/lessons/{id}`). */
export function useLesson(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: coursesKeys.lesson(id ?? ''),
    queryFn: ({ signal }) => fetchLesson(api, id ?? '', signal),
    enabled: id !== null,
  });
}

/**
 * A aula lida agora, para uma escrita que precisa do `version` dela (o resumo da aula, no curso,
 * não o traz). A resposta fica no cache da aula.
 */
export function freshLesson(
  api: AdminClient,
  queryClient: QueryClient,
  id: string,
): Promise<LessonDetail> {
  return queryClient.fetchQuery({
    queryKey: coursesKeys.lesson(id),
    queryFn: ({ signal }) => fetchLesson(api, id, signal),
    staleTime: 0,
  });
}

/** Depois de uma escrita que devolve a aula: o diálogo dela passa a ter o `version` novo. */
export function lessonChanged(queryClient: QueryClient, lesson: LessonDetail): void {
  queryClient.setQueryData(coursesKeys.lesson(lesson.id), lesson);
}

/** Depois de uma escrita que devolve o curso: atualiza o editor e refaz as listas. */
export function courseChanged(queryClient: QueryClient, course: CourseDetail): void {
  queryClient.setQueryData(coursesKeys.detail(course.id), course);
  void queryClient.invalidateQueries({ queryKey: coursesKeys.lists() });
}

/** Depois de uma escrita em módulo ou aula (que não devolve o curso): busca o curso de novo. */
export function refreshCourse(queryClient: QueryClient, courseId: string): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: coursesKeys.lists() });
  return queryClient.invalidateQueries({ queryKey: coursesKeys.detail(courseId) });
}

/** Troca a ordem dos módulos no cache, antes de a API confirmar. */
export function setModulesOrder(
  queryClient: QueryClient,
  courseId: string,
  modules: CourseModule[],
): void {
  queryClient.setQueryData<CourseDetail>(coursesKeys.detail(courseId), (current) =>
    current ? { ...current, modules } : current,
  );
}
