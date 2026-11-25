import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useApi } from '../api/client';
import { lessonPath } from '../learning/progress';
import { useSession } from '../session/session';

export type Note = ClassroomSchemas['Note'];
export type NoteSummary = ClassroomSchemas['NoteSummary'];
export type NoteSummaryPage = ClassroomSchemas['NoteSummaryPage'];
export type NoteLesson = ClassroomSchemas['NoteLesson'];
export type NoteKind = 'lesson' | 'standalone';

/** Limites da spec 016 (RNF-02). */
export const NOTE_BODY_MAX = 20_000;
export const NOTE_TITLE_MAX = 160;
export const NOTE_SEARCH_MAX = 200;
/** Notas pedidas de cada vez na página "Anotações". */
export const NOTES_PAGE_SIZE = 30;
/** Espera depois da última tecla antes de gravar (RNF-03). */
export const AUTOSAVE_MS = 2000;

/** Filtros da página "Anotações", como a API os recebe. */
export interface NoteFilters {
  kind?: NoteKind;
  courseId?: string;
  q?: string;
}

const lessonNotesKey = (userId: string | null, lessonId: string) =>
  ['notes', 'lesson', userId, lessonId] as const;
const noteKey = (userId: string | null, id: string) => ['notes', 'one', userId, id] as const;
const pagePrefix = (userId: string | null) => ['notes', 'page', userId] as const;

/** Instante do vídeo legível: `1:23` ou `1:02:03`. */
export function formatInstant(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Título `null` quando só há espaços, como a API guarda. */
export function cleanTitle(title: string): string | null {
  return title.trim() || null;
}

/** Nome curto da nota para confirmações e rótulos: o título ou o começo do texto. */
export function noteName(note: { title: string | null; body?: string; excerpt?: string }): string {
  const text = (note.title ?? note.body ?? note.excerpt ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/**
 * Link de volta para a aula, no instante da nota quando houver. `null` com a aula despublicada
 * ou excluída (`available` falso): a nota fica sem link, com os títulos guardados.
 */
export function noteLessonPath(
  lesson: NoteLesson | null,
  videoSeconds: number | null,
): string | null {
  if (!lesson?.available || !lesson.id || !lesson.courseSlug) return null;
  const path = lessonPath(lesson.courseSlug, lesson.id);
  return videoSeconds === null ? path : `${path}?t=${videoSeconds}`;
}

/** Instante pedido no endereço da aula (`?t=83`); `null` se ausente ou inválido. */
export function readInstant(params: URLSearchParams): number | null {
  const raw = params.get('t');
  if (raw === null || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Notas do aluno na aula (`GET /api/v1/lessons/{id}/notes`): todas, da mais antiga à mais
 * recente, no máximo 100. Não exige acesso à aula; `404` (sem nota e aula indisponível) é lista
 * vazia.
 */
export function useLessonNotes(lessonId: string) {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: lessonNotesKey(session?.user.id ?? null, lessonId),
    enabled: session !== null && lessonId !== '',
    queryFn: async ({ signal }): Promise<Note[]> => {
      try {
        const { data } = await api.GET('/api/v1/lessons/{id}/notes', {
          params: { path: { id: lessonId } },
          signal,
        });
        if (!data) throw new Error('GET /api/v1/lessons/{id}/notes respondeu sem corpo');
        return data.items;
      } catch (error) {
        if (isApiError(error) && error.status === 404 && error.code !== 'unknown_error') return [];
        throw error;
      }
    },
  });
}

/** Página "Anotações" (`GET /api/v1/notes`): da alteração mais recente à mais antiga. */
export function useNotes(filters: NoteFilters) {
  const api = useApi();
  const { session } = useSession();
  return useInfiniteQuery({
    queryKey: [...pagePrefix(session?.user.id ?? null), filters],
    enabled: session !== null,
    queryFn: async ({ pageParam, signal }): Promise<NoteSummaryPage> => {
      const { data } = await api.GET('/api/v1/notes', {
        params: {
          query: {
            limit: NOTES_PAGE_SIZE,
            ...(filters.kind ? { kind: filters.kind } : {}),
            ...(filters.courseId ? { courseId: filters.courseId } : {}),
            ...(filters.q ? { q: filters.q } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/notes respondeu sem corpo');
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** A nota inteira (`GET /api/v1/notes/{id}`), para editar a partir da lista. Sempre a do servidor. */
export function useNote(id: string | null) {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: noteKey(session?.user.id ?? null, id ?? ''),
    enabled: session !== null && id !== null,
    gcTime: 0,
    queryFn: async ({ signal }): Promise<Note> => {
      const { data } = await api.GET('/api/v1/notes/{id}', {
        params: { path: { id: id ?? '' } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/notes/{id} respondeu sem corpo');
      return data;
    },
  });
}

/** Leva uma nota gravada às listas em cache: a da aula na hora, a página "Anotações" por nova consulta. */
export function storeNote(client: QueryClient, userId: string | null, note: Note): void {
  if (note.lesson?.id) {
    client.setQueryData<Note[]>(lessonNotesKey(userId, note.lesson.id), (list) => {
      if (!list) return list;
      return list.some((item) => item.id === note.id)
        ? list.map((item) => (item.id === note.id ? note : item))
        : [...list, note];
    });
  }
  void client.invalidateQueries({ queryKey: pagePrefix(userId) });
}

/** Tira uma nota excluída das listas em cache. */
export function dropNote(client: QueryClient, userId: string | null, id: string): void {
  client.setQueriesData<Note[]>({ queryKey: ['notes', 'lesson', userId] }, (list) =>
    list?.filter((item) => item.id !== id),
  );
  void client.invalidateQueries({ queryKey: pagePrefix(userId) });
}

/** A versão gravada que acompanha o `409 version_conflict` (`NoteConflictProblem.current`). */
export function conflictVersion(error: unknown): Note | null {
  if (!isApiError(error) || error.status !== 409 || error.code !== 'version_conflict') return null;
  const current = (error.problem as { current?: Note }).current;
  return current && typeof current.id === 'string' ? current : null;
}
