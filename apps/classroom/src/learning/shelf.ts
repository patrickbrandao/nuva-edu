import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useApi } from '../api/client';
import { browser, isHttpUrl } from '../lib/browser';
import { useSession } from '../session/session';
import type { ShelfFilters } from './shelfFilters';

export type Shelf = ClassroomSchemas['Shelf'];
export type ShelfCourse = ClassroomSchemas['ShelfCourse'];
export type ContinueItem = ClassroomSchemas['ContinueItem'];
export type SampleLesson = ClassroomSchemas['SampleLesson'];
export type SampleLessonPage = ClassroomSchemas['SampleLessonPage'];
export type MyEbook = ClassroomSchemas['MyEbook'];
export type MyProgressCourse = ClassroomSchemas['MyProgressCourse'];
export type ActivityMap = ClassroomSchemas['ActivityMap'];

/** Aulas liberadas pedidas de cada vez. */
export const SAMPLES_PAGE_SIZE = 12;

/*
 * Estas listas mudam quando o aluno assiste a uma aula em outra página: cada visita consulta de
 * novo (o padrão do cache, sem `staleTime`), mostrando o que já tinha enquanto a resposta chega.
 */

/** Estante (`GET /api/v1/me/courses`): os contadores valem para o conjunto todo, sem o filtro. */
export function useShelf(filters: ShelfFilters) {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: ['learning', 'shelf', session?.user.id ?? null, filters],
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<Shelf> => {
      const { data } = await api.GET('/api/v1/me/courses', {
        params: {
          query: {
            ...(filters.filter ? { filter: filters.filter } : {}),
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.sort ? { sort: filters.sort } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/me/courses respondeu sem corpo');
      return data;
    },
    // Trocar um filtro mantém a lista anterior na tela até a nova chegar.
    placeholderData: keepPreviousData,
  });
}

/** "Continue assistindo" (`GET /api/v1/me/continue`): até 3 cursos em andamento. */
export function useContinueWatching() {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: ['learning', 'continue', session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<ContinueItem[]> => {
      const { data } = await api.GET('/api/v1/me/continue', { signal });
      if (!data) throw new Error('GET /api/v1/me/continue respondeu sem corpo');
      return data.items;
    },
  });
}

/** "Aulas liberadas" (`GET /api/v1/samples`): amostras de cursos que o aluno não possui. */
export function useSampleLessons() {
  const api = useApi();
  const { session } = useSession();
  return useInfiniteQuery({
    queryKey: ['learning', 'samples', session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async ({ pageParam, signal }): Promise<SampleLessonPage> => {
      const { data } = await api.GET('/api/v1/samples', {
        params: {
          query: { limit: SAMPLES_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/samples respondeu sem corpo');
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** "Meus ebooks" (`GET /api/v1/me/ebooks`): ebooks com direito ativo. */
export function useMyEbooks() {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: ['learning', 'ebooks', session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<MyEbook[]> => {
      const { data } = await api.GET('/api/v1/me/ebooks', { signal });
      if (!data) throw new Error('GET /api/v1/me/ebooks respondeu sem corpo');
      return data.items;
    },
  });
}

/** "Meu progresso" (`GET /api/v1/me/progress`): um quadrado por aula de cada curso iniciado. */
export function useMyProgress() {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: ['learning', 'my-progress', session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<MyProgressCourse[]> => {
      const { data } = await api.GET('/api/v1/me/progress', { signal });
      if (!data) throw new Error('GET /api/v1/me/progress respondeu sem corpo');
      return data.items;
    },
  });
}

/** Mapa de atividade (`GET /api/v1/me/activity`): os dias já vêm no fuso do aluno. */
export function useMyActivity() {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: ['learning', 'activity', session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<ActivityMap> => {
      const { data } = await api.GET('/api/v1/me/activity', { signal });
      if (!data) throw new Error('GET /api/v1/me/activity respondeu sem corpo');
      return data;
    },
  });
}

/** Por que o download não saiu: sem acesso (`403`), endereço inválido ou outra falha. */
export type DownloadFailure =
  | { ebookId: string; kind: 'denied' | 'bad_link' }
  | { ebookId: string; kind: 'error'; error: unknown };

/**
 * Download do ebook (`GET /api/v1/ebooks/{id}/download`): a API confere o acesso e devolve o
 * endereço externo do arquivo, aberto numa aba nova. A aba é aberta já no clique (depois da
 * resposta o navegador a bloquearia como pop-up) e recebe o endereço em seguida; só `http(s)`.
 */
export function useEbookDownload() {
  const api = useApi();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<DownloadFailure | null>(null);

  const download = useCallback(
    async (ebookId: string) => {
      const tab = browser.openTab();
      setPendingId(ebookId);
      setFailure(null);
      try {
        const { data } = await api.GET('/api/v1/ebooks/{id}/download', {
          params: { path: { id: ebookId } },
        });
        if (!data || !isHttpUrl(data.url)) {
          tab.cancel();
          setFailure({ ebookId, kind: 'bad_link' });
          return;
        }
        tab.go(data.url);
      } catch (error) {
        tab.cancel();
        setFailure(
          isApiError(error) && error.status === 403
            ? { ebookId, kind: 'denied' }
            : { ebookId, kind: 'error', error },
        );
      } finally {
        setPendingId(null);
      }
    },
    [api],
  );

  return { download, pendingId, failure };
}
