import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import { useToast } from '@nuva-edu/ui';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError } from '../api/errors';
import { useSession } from '../session/session';
import {
  applyCompletion,
  applyProgressResult,
  type CourseView,
  type LessonProgressResult,
} from './progress';

export type LessonView = ClassroomSchemas['LessonView'];
export type AccessDenialReason = ClassroomSchemas['AccessDenialReason'];
export type CompletionVia = ClassroomSchemas['CompletionVia'];

const REASONS: readonly AccessDenialReason[] = [
  'not_authenticated',
  'suspended',
  'no_entitlement',
  'expired',
  'unpublished',
];

/** A aula, ou por que ela não abre: sem acesso (`403` com o motivo) ou inexistente (`404`). */
export type LessonResult =
  | { kind: 'ok'; lesson: LessonView }
  | { kind: 'denied'; reason: AccessDenialReason | null }
  | { kind: 'missing' };

const courseKey = (userId: string | null, slug: string) =>
  ['learning', 'course', userId, slug] as const;
const lessonKey = (userId: string | null, id: string) =>
  ['learning', 'lesson', userId, id] as const;

/** Motivo da negativa de acesso num `403 access_denied` (esquema `AccessDeniedProblem`). */
function denialReason(error: unknown): AccessDenialReason | null | undefined {
  if (!isApiError(error) || error.status !== 403 || error.code !== 'access_denied') {
    return undefined;
  }
  const reason = (error.problem as { reason?: unknown }).reason;
  return REASONS.find((known) => known === reason) ?? null;
}

/**
 * O curso com o estado do aluno (`GET /api/v1/courses/{slug}`): acesso, progresso, programa e a
 * aula do "Continuar". `null` é curso inexistente, em rascunho ou privado sem direito (`404`).
 */
export function useCourseView(slug: string) {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: courseKey(session?.user.id ?? null, slug),
    enabled: session !== null && slug !== '',
    queryFn: async ({ signal }): Promise<CourseView | null> => {
      try {
        const { data } = await api.GET('/api/v1/courses/{slug}', {
          params: { path: { slug } },
          signal,
        });
        return data ?? null;
      } catch (error) {
        if (isApiError(error) && error.status === 404 && error.code !== 'unknown_error') {
          return null;
        }
        throw error;
      }
    },
  });
}

/**
 * A aula (`GET /api/v1/lessons/{id}`): conteúdo, vizinhas e estado do aluno. Abrir a aula grava a
 * abertura no servidor ("Continuar de onde parou"), por isso a consulta é refeita a cada visita.
 */
export function useLesson(id: string) {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: lessonKey(session?.user.id ?? null, id),
    enabled: session !== null && id !== '',
    queryFn: async ({ signal }): Promise<LessonResult> => {
      try {
        const { data } = await api.GET('/api/v1/lessons/{id}', {
          params: { path: { id } },
          signal,
        });
        if (!data) throw new Error('GET /api/v1/lessons/{id} respondeu sem corpo');
        return { kind: 'ok', lesson: data };
      } catch (error) {
        const reason = denialReason(error);
        if (reason !== undefined) return { kind: 'denied', reason };
        if (isApiError(error) && error.status === 404 && error.code !== 'unknown_error') {
          return { kind: 'missing' };
        }
        throw error;
      }
    },
  });
}

interface CompletionInput {
  lessonId: string;
  completed: boolean;
  /** Como a aula foi concluída; só vale com `completed: true`. */
  via?: CompletionVia;
}

interface CompletionSnapshot {
  course: CourseView | null | undefined;
  lesson: LessonResult | undefined;
}

function patchLessonState(
  client: QueryClient,
  key: ReturnType<typeof lessonKey>,
  patch: (state: LessonView['userState']) => LessonView['userState'],
): void {
  client.setQueryData<LessonResult>(key, (result) =>
    result?.kind === 'ok'
      ? { ...result, lesson: { ...result.lesson, userState: patch(result.lesson.userState) } }
      : result,
  );
}

/**
 * Marca ou desmarca a conclusão da aula (`PUT /api/v1/lessons/{id}/progress`). A tela muda antes
 * de a API responder (RNF-03): a aula, o progresso do módulo e o do curso; a resposta confirma os
 * números e a falha desfaz a mudança, com um aviso. As gravações saem uma de cada vez, na ordem
 * dos cliques.
 */
export function useLessonCompletion(slug: string) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  return useMutation<LessonProgressResult, unknown, CompletionInput, CompletionSnapshot>({
    scope: { id: 'lesson-progress' },
    mutationFn: async ({ lessonId, completed, via = 'manual' }) => {
      const { data } = await api.PUT('/api/v1/lessons/{id}/progress', {
        params: { path: { id: lessonId } },
        body: completed ? { completed: true, completedVia: via } : { completed: false },
      });
      if (!data) throw new Error('PUT /api/v1/lessons/{id}/progress respondeu sem corpo');
      return data;
    },
    onMutate: ({ lessonId, completed, via = 'manual' }) => {
      const snapshot: CompletionSnapshot = {
        course: client.getQueryData<CourseView | null>(courseKey(userId, slug)),
        lesson: client.getQueryData<LessonResult>(lessonKey(userId, lessonId)),
      };
      client.setQueryData<CourseView | null>(courseKey(userId, slug), (course) =>
        course ? applyCompletion(course, lessonId, completed) : course,
      );
      patchLessonState(client, lessonKey(userId, lessonId), (state) => ({
        ...state,
        completedAt: completed ? (state.completedAt ?? new Date().toISOString()) : null,
        completedVia: completed ? (state.completedVia ?? via) : null,
      }));
      return snapshot;
    },
    onError: (error, { lessonId }, snapshot) => {
      if (snapshot?.course !== undefined) {
        client.setQueryData(courseKey(userId, slug), snapshot.course);
      }
      if (snapshot?.lesson !== undefined) {
        client.setQueryData(lessonKey(userId, lessonId), snapshot.lesson);
      }
      const failure = describeError(t, error, {
        access_denied: t('learning.errors.accessDenied'),
      });
      toast.error(failure.message, { title: t('learning.errors.save') });
    },
    onSuccess: (result, { lessonId }) => {
      client.setQueryData<CourseView | null>(courseKey(userId, slug), (course) =>
        course ? applyProgressResult(course, result) : course,
      );
      patchLessonState(client, lessonKey(userId, lessonId), (state) => ({
        ...result.userState,
        // a posição do vídeo anda por fora desta gravação: vale a mais recente da tela
        positionSeconds: state.positionSeconds ?? result.userState.positionSeconds,
      }));
    },
  });
}

/**
 * Grava a posição do vídeo (`positionSeconds`). O player chama no máximo a cada 15 s e ao sair da
 * página (RNF-04); por isso o envio usa `fetch` com `keepalive`, que sobrevive ao fechamento da
 * aba, e leva o `X-CSRF-Token` como qualquer escrita (o `sendBeacon` não envia cabeçalhos).
 * Falha aqui não incomoda quem está assistindo: a próxima posição tenta de novo.
 */
export function useSavePosition(): (lessonId: string, seconds: number) => void {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useCallback(
    (lessonId: string, seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      // reabrir a aula nesta visita já retoma daqui, sem esperar a nova consulta
      patchLessonState(client, lessonKey(userId, lessonId), (state) => ({
        ...state,
        positionSeconds: seconds,
      }));
      api
        .PUT('/api/v1/lessons/{id}/progress', {
          params: { path: { id: lessonId } },
          body: { positionSeconds: seconds },
          keepalive: true,
        })
        .catch(() => {});
    },
    [api, client, userId],
  );
}
