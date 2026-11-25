import type { AdminClient, AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './client';

/*
 * Ebooks e pacotes (spec 009): os dois têm a mesma lista, os mesmos dados de produto e as mesmas
 * ações de publicação; mudam o endereço da API e o que cada um carrega (vínculos ou itens).
 */
export type ProductKind = 'ebook' | 'bundle';

export type EbookSummary = AdminSchemas['EbookSummary'];
export type EbookDetail = AdminSchemas['EbookDetail'];
export type EbookTarget = AdminSchemas['EbookTarget'];
export type BundleSummary = AdminSchemas['BundleSummary'];
export type BundleDetail = AdminSchemas['BundleDetail'];
export type BundleItem = AdminSchemas['BundleItem'];
export type ProductSummary = EbookSummary | BundleSummary;
export type ProductDetail = EbookDetail | BundleDetail;

export type ProductsQuery = NonNullable<AdminOperations['listEbooks']['parameters']['query']>;

/** Alvo de um vínculo de ebook que a interface oferece (spec 009, "Ebooks vinculados"). */
export interface LinkTarget {
  targetType: 'course' | 'lesson';
  targetId: string;
}
/** Item de pacote no formato de `PUT /bundles/{id}/items`. */
export type BundleItemRef = Pick<BundleItem, 'productType' | 'productId'>;

export const PRODUCTS_PAGE_SIZE = 25;
/** Limites da spec 009 ("Casos de erro"), iguais aos do contrato. */
export const BUNDLE_ITEMS_MAX = 200;
export const PAGES_MAX = 100000;

export const EBOOKS_PATH = '/ebooks';
export const BUNDLES_PATH = '/pacotes';
export const PRODUCTS_PATH: Record<ProductKind, string> = {
  ebook: EBOOKS_PATH,
  bundle: BUNDLES_PATH,
};
const SEGMENT = { ebook: 'ebooks', bundle: 'bundles' } as const;

export function productPath(kind: ProductKind, id: string): string {
  return `${PRODUCTS_PATH[kind]}/${encodeURIComponent(id)}`;
}

export function isEbook(product: ProductDetail): product is EbookDetail {
  return 'targets' in product;
}

export const productsKeys = {
  lists: (kind: ProductKind) => ['products', kind, 'list'] as const,
  list: (kind: ProductKind, query: Omit<ProductsQuery, 'cursor'>) =>
    ['products', kind, 'list', query] as const,
  detail: (kind: ProductKind, id: string) => ['products', kind, 'detail', id] as const,
};

/** Lista de ebooks ou de pacotes por cursor (`GET /api/v1/ebooks`, `GET /api/v1/bundles`). */
export function useProductsList(
  kind: ProductKind,
  query: Omit<ProductsQuery, 'cursor' | 'limit'>,
  enabled = true,
) {
  const api = useApi();
  const full = { ...query, limit: PRODUCTS_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: productsKeys.list(kind, full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET(`/api/v1/${SEGMENT[kind]}`, {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error(`GET /api/v1/${SEGMENT[kind]} respondeu sem corpo`);
      return data as { items: ProductSummary[]; nextCursor?: string | null };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}

export async function fetchEbook(
  api: AdminClient,
  id: string,
  signal?: AbortSignal,
): Promise<EbookDetail> {
  const { data } = await api.GET('/api/v1/ebooks/{id}', {
    params: { path: { id } },
    ...(signal ? { signal } : {}),
  });
  if (!data) throw new Error('GET /api/v1/ebooks/{id} respondeu sem corpo');
  return data;
}

/** O ebook com os vínculos (`GET /api/v1/ebooks/{id}`); o instrutor recebe só os vínculos dele. */
export function useEbook(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: productsKeys.detail('ebook', id),
    queryFn: ({ signal }) => fetchEbook(api, id, signal),
  });
}

/** O pacote com os itens na ordem (`GET /api/v1/bundles/{id}`). */
export function useBundle(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: productsKeys.detail('bundle', id),
    queryFn: async ({ signal }): Promise<BundleDetail> => {
      const { data } = await api.GET('/api/v1/bundles/{id}', {
        params: { path: { id } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/bundles/{id} respondeu sem corpo');
      return data;
    },
  });
}

/** Depois de uma escrita que devolve o produto: atualiza o editor e refaz as listas. */
export function productChanged(
  queryClient: QueryClient,
  kind: ProductKind,
  product: ProductDetail,
): void {
  queryClient.setQueryData(productsKeys.detail(kind, product.id), product);
  void queryClient.invalidateQueries({ queryKey: productsKeys.lists(kind) });
}

/** Ação de publicação de um ebook ou pacote (`POST /api/v1/{ebooks|bundles}/{id}/{ação}`). */
export async function postProductAction(
  api: AdminClient,
  kind: ProductKind,
  id: string,
  action: 'publish' | 'unpublish' | 'archive' | 'unarchive',
): Promise<ProductDetail> {
  const { data } = await api.POST(`/api/v1/${SEGMENT[kind]}/{id}/${action}`, {
    params: { path: { id } },
  });
  if (!data) throw new Error(`POST /api/v1/${SEGMENT[kind]}/{id}/${action} respondeu sem corpo`);
  return data;
}

export async function deleteProduct(api: AdminClient, kind: ProductKind, id: string) {
  await api.DELETE(`/api/v1/${SEGMENT[kind]}/{id}`, { params: { path: { id } } });
}

/** Os vínculos que `PUT /ebooks/{id}/targets` aceita: curso e aula (pacote é item do pacote). */
function linkTargets(ebook: EbookDetail): LinkTarget[] {
  return ebook.targets.flatMap((target) =>
    target.targetType === 'bundle'
      ? []
      : [{ targetType: target.targetType, targetId: target.targetId }],
  );
}

const sameTarget = (a: LinkTarget, b: LinkTarget) =>
  a.targetType === b.targetType && a.targetId === b.targetId;

export function isLinkedTo(ebook: EbookDetail, target: LinkTarget): boolean {
  return ebook.targets.some((item) => sameTarget(item as LinkTarget, target));
}

/**
 * Vincula ou desvincula um ebook de um curso ou de uma aula. O contrato substitui a lista
 * inteira de vínculos, então o ebook é lido de novo antes: para o instrutor a API devolve (e
 * substitui) só os vínculos com os próprios cursos e aulas.
 */
export async function setEbookLink(
  api: AdminClient,
  ebookId: string,
  target: LinkTarget,
  linked: boolean,
): Promise<EbookDetail> {
  const current = linkTargets(await fetchEbook(api, ebookId));
  const others = current.filter((item) => !sameTarget(item, target));
  const { data } = await api.PUT('/api/v1/ebooks/{id}/targets', {
    params: { path: { id: ebookId } },
    body: { targets: linked ? [...others, target] : others },
  });
  if (!data) throw new Error('PUT /api/v1/ebooks/{id}/targets respondeu sem corpo');
  return data;
}

/** Grava a lista inteira de itens do pacote, na ordem (`PUT /api/v1/bundles/{id}/items`). */
export async function putBundleItems(
  api: AdminClient,
  bundleId: string,
  items: readonly BundleItemRef[],
): Promise<BundleDetail> {
  const { data } = await api.PUT('/api/v1/bundles/{id}/items', {
    params: { path: { id: bundleId } },
    body: {
      items: items.map(({ productType, productId }) => ({ productType, productId })),
    },
  });
  if (!data) throw new Error('PUT /api/v1/bundles/{id}/items respondeu sem corpo');
  return data;
}
