import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { useSession } from '../session/session';
import type { CatalogFilters } from './filters';

export type ProductType = ClassroomSchemas['ProductType'];
export type CourseLevel = ClassroomSchemas['CourseLevel'];
export type CatalogItem = ClassroomSchemas['CatalogItem'];
export type CatalogItemPage = ClassroomSchemas['CatalogItemPage'];
export type CatalogProduct = ClassroomSchemas['CatalogProduct'];
export type CatalogCourse = ClassroomSchemas['CatalogCourse'];
export type CatalogBundle = ClassroomSchemas['CatalogBundle'];
export type CatalogEbook = ClassroomSchemas['CatalogEbook'];
export type AccessState = ClassroomSchemas['AccessState'];

/** Itens por página da vitrine: múltiplo de 2, 3 e 4 colunas. */
export const CATALOG_PAGE_SIZE = 24;

/** Vitrine (`GET /api/v1/catalog`), sem login, paginada por cursor ("Carregar mais"). */
export function useCatalog(filters: CatalogFilters) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['catalog', 'list', filters],
    queryFn: async ({ pageParam, signal }): Promise<CatalogItemPage> => {
      const { data } = await api.GET('/api/v1/catalog', {
        params: {
          query: {
            ...(filters.type ? { type: filters.type } : {}),
            ...(filters.level ? { level: filters.level } : {}),
            ...(filters.price ? { price: filters.price } : {}),
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.sort ? { sort: filters.sort } : {}),
            limit: CATALOG_PAGE_SIZE,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/catalog respondeu sem corpo');
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Trocar um filtro mantém a lista anterior na tela até a nova chegar.
    placeholderData: keepPreviousData,
  });
}

/**
 * Página do produto (`GET /api/v1/catalog/{type}/{slug}`), sem login. `null` é produto que não
 * existe, é privado ou saiu do ar (`404`).
 */
export function useCatalogProduct(type: ProductType, slug: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['catalog', 'product', type, slug],
    queryFn: async ({ signal }): Promise<CatalogProduct | null> => {
      try {
        const { data } = await api.GET('/api/v1/catalog/{type}/{slug}', {
          params: { path: { type, slug } },
          signal,
        });
        return data ?? null;
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/**
 * Estado de acesso de quem está logado a um curso ou ebook (`GET /api/v1/courses/{slug}` e
 * `GET /api/v1/ebooks/{slug}`), para a página do produto não mostrar bloqueio a quem já tem o
 * acesso. Visitante, pacote e falha da consulta ficam sem estado (`null`): vale o que é público.
 */
export function useProductAccess(type: ProductType, slug: string, enabled: boolean) {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: ['catalog', 'access', session?.user.id ?? null, type, slug],
    enabled: enabled && session !== null && type !== 'bundle',
    retry: false,
    queryFn: async ({ signal }): Promise<AccessState | null> => {
      try {
        if (type === 'course') {
          const { data } = await api.GET('/api/v1/courses/{slug}', {
            params: { path: { slug } },
            signal,
          });
          return data?.access ?? null;
        }
        const { data } = await api.GET('/api/v1/ebooks/{slug}', {
          params: { path: { slug } },
          signal,
        });
        return data?.access ?? null;
      } catch {
        return null;
      }
    },
  });
}
