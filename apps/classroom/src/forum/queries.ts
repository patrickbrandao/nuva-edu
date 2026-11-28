import type { ClassroomClient, ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useApi } from '../api/client';
import { describeError } from '../api/errors';
import { useSession } from '../session/session';

export type Topic = ClassroomSchemas['ForumTopicSummary'];
export type Post = ClassroomSchemas['ForumPost'];
export type Filter = 'all' | 'unanswered' | 'solved' | 'unsolved' | 'following';
export type Kind = 'all' | 'lessons' | 'discussions';

export const forumKey = (userId: string | null) => ['forum', userId] as const;
export const topicKey = (userId: string | null, topicId: string) =>
  [...forumKey(userId), 'topic', topicId] as const;
const firstPage = null as string | null;

/** Mensagem dos erros próprios do fórum (spec 017, "Casos de erro"); o resto é o texto geral. */
export function forumError(t: TFunction, error: unknown): string {
  return describeError(t, error, {
    forum_forbidden: t('forum.errors.forbidden'),
    topic_closed: t('forum.errors.closed'),
  }).message;
}

function useForumContext() {
  return { api: useApi(), userId: useSession().session?.user.id ?? null };
}

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new Error('Resposta do fórum sem corpo.');
  return data;
}

function pageQuery(pageParam: string | null) {
  return { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) };
}

export function useCategories() {
  const { api, userId } = useForumContext();
  return useInfiniteQuery({
    queryKey: [...forumKey(userId), 'categories'],
    enabled: userId !== null,
    initialPageParam: firstPage,
    queryFn: async ({ pageParam, signal }): Promise<ClassroomSchemas['ForumCategoryPage']> =>
      required(
        (
          await api.GET('/api/v1/forum/categories', {
            params: { query: pageQuery(pageParam) },
            signal,
          })
        ).data,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTopics(categoryId: string, q: string, kind: Kind, filter: Filter) {
  const { api, userId } = useForumContext();
  return useInfiniteQuery({
    queryKey: [...forumKey(userId), 'topics', categoryId, q, kind, filter],
    enabled: userId !== null && (!!categoryId || !!q),
    initialPageParam: firstPage,
    queryFn: async ({ pageParam, signal }): Promise<ClassroomSchemas['ForumTopicPage']> =>
      q
        ? required(
            (
              await api.GET('/api/v1/forum/search', {
                params: {
                  query: { ...pageQuery(pageParam), q, ...(categoryId ? { categoryId } : {}) },
                },
                signal,
              })
            ).data,
          )
        : required(
            (
              await api.GET('/api/v1/forum/categories/{id}/topics', {
                params: {
                  path: { id: categoryId },
                  query: { ...pageQuery(pageParam), kind, filter },
                },
                signal,
              })
            ).data,
          ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTopic(topicId: string) {
  const { api, userId } = useForumContext();
  return useQuery({
    queryKey: topicKey(userId, topicId),
    enabled: userId !== null && Boolean(topicId),
    queryFn: async ({ signal }) =>
      required(
        (await api.GET('/api/v1/forum/topics/{id}', { params: { path: { id: topicId } }, signal }))
          .data,
      ),
  });
}

export function usePosts(topicId: string, enabled: boolean) {
  const { api, userId } = useForumContext();
  return useInfiniteQuery({
    queryKey: [...topicKey(userId, topicId), 'posts'],
    enabled: enabled && userId !== null,
    initialPageParam: firstPage,
    queryFn: async ({ pageParam, signal }): Promise<ClassroomSchemas['ForumPostPage']> =>
      required(
        (
          await api.GET('/api/v1/forum/topics/{id}/posts', {
            params: { path: { id: topicId }, query: pageQuery(pageParam) },
            signal,
          })
        ).data,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useLessonTopic(lessonId: string) {
  const { api, userId } = useForumContext();
  return useQuery({
    queryKey: [...forumKey(userId), 'lesson', lessonId],
    enabled: userId !== null,
    queryFn: async ({ signal }) =>
      required(
        (
          await api.GET('/api/v1/lessons/{id}/topic', {
            params: { path: { id: lessonId } },
            signal,
          })
        ).data,
      ),
  });
}

export function useMentions(categoryId: string, q: string) {
  const { api, userId } = useForumContext();
  return useQuery({
    queryKey: [...forumKey(userId), 'mentions', categoryId, q],
    enabled: userId !== null && q.length > 0,
    queryFn: async ({ signal }) =>
      required(
        (
          await api.GET('/api/v1/forum/categories/{id}/mentions', {
            params: { path: { id: categoryId }, query: { q, limit: 6 } },
            signal,
          })
        ).data,
      ),
  });
}

export function useMyReports() {
  const { api, userId } = useForumContext();
  return useInfiniteQuery({
    queryKey: [...forumKey(userId), 'reports'],
    enabled: userId !== null,
    initialPageParam: firstPage,
    queryFn: async ({ pageParam, signal }): Promise<ClassroomSchemas['MyForumReportPage']> =>
      required(
        (
          await api.GET('/api/v1/me/reports', {
            params: { query: pageQuery(pageParam) },
            signal,
          })
        ).data,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useForumMutation<T = unknown>() {
  const { api, userId } = useForumContext();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (action: (client: ClassroomClient) => Promise<T>) => action(api),
    onSuccess: () => cache.invalidateQueries({ queryKey: forumKey(userId) }),
  });
}
