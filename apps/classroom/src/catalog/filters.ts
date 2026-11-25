import type { CourseLevel, ProductType } from './queries';

export type PriceFilter = 'free' | 'paid';
export type CatalogSort = 'title' | 'priceCents' | '-priceCents';

/** Filtros da vitrine como a API os recebe; ausente é "todos" (e "mais recentes" na ordem). */
export interface CatalogFilters {
  type?: ProductType;
  level?: CourseLevel;
  price?: PriceFilter;
  sort?: CatalogSort;
  q?: string;
}

/*
 * Os filtros moram no endereço, em português como as rotas (spec 006): a página filtrada pode
 * ser compartilhada e o "voltar" do navegador desfaz o filtro.
 */
const TYPES: Record<string, ProductType> = { curso: 'course', pacote: 'bundle', ebook: 'ebook' };
const LEVELS: Record<string, CourseLevel> = {
  iniciante: 'beginner',
  intermediario: 'intermediate',
  avancado: 'advanced',
};
const PRICES: Record<string, PriceFilter> = { gratis: 'free', pago: 'paid' };
const SORTS: Record<string, CatalogSort> = {
  titulo: 'title',
  'menor-preco': 'priceCents',
  'maior-preco': '-priceCents',
};

/** Tamanho máximo da busca no contrato (`q`). */
export const SEARCH_MAX_LENGTH = 200;

function keyOf<T extends string>(map: Record<string, T>, value: T | undefined): string | undefined {
  return value ? Object.keys(map).find((key) => map[key] === value) : undefined;
}

/** Lê os filtros do endereço; valor desconhecido é ignorado. */
export function readFilters(params: URLSearchParams): CatalogFilters {
  const filters: CatalogFilters = {};
  const type = TYPES[params.get('tipo') ?? ''];
  const level = LEVELS[params.get('nivel') ?? ''];
  const price = PRICES[params.get('preco') ?? ''];
  const sort = SORTS[params.get('ordem') ?? ''];
  const q = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
  if (type) filters.type = type;
  if (level) filters.level = level;
  if (price) filters.price = price;
  if (sort) filters.sort = sort;
  if (q) filters.q = q;
  return filters;
}

/** Escreve os filtros no endereço, sem os que estão no padrão. */
export function writeFilters(filters: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();
  const entries: [string, string | undefined][] = [
    ['tipo', keyOf(TYPES, filters.type)],
    ['nivel', keyOf(LEVELS, filters.level)],
    ['preco', keyOf(PRICES, filters.price)],
    ['ordem', keyOf(SORTS, filters.sort)],
    ['q', filters.q?.trim() || undefined],
  ];
  for (const [key, value] of entries) if (value) params.set(key, value);
  return params;
}

/** Há filtro ou busca aplicados (a ordenação não conta: ela não esconde produto). */
export function hasActiveFilters(filters: CatalogFilters): boolean {
  return Boolean(filters.type || filters.level || filters.price || filters.q);
}
