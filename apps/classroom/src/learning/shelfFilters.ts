import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { SEARCH_MAX_LENGTH } from '../catalog/filters';

export type ShelfFilter = ClassroomSchemas['CourseProgressState'];
export type ShelfSort = '-publishedAt' | 'title' | '-percent';

/** Filtros da estante como a API os recebe; ausente é "todos" e "acesso mais recente". */
export interface ShelfFilters {
  filter?: ShelfFilter;
  sort?: ShelfSort;
  q?: string;
}

/*
 * Como na vitrine, os filtros moram no endereço, em português: a estante filtrada pode ser
 * guardada nos favoritos e o "voltar" do navegador desfaz o filtro.
 */
const FILTERS: Record<string, ShelfFilter> = {
  'em-andamento': 'in_progress',
  'nao-iniciados': 'not_started',
  concluidos: 'completed',
};
const SORTS: Record<string, ShelfSort> = {
  catalogo: '-publishedAt',
  titulo: 'title',
  progresso: '-percent',
};

function keyOf<T extends string>(map: Record<string, T>, value: T | undefined): string | undefined {
  return value ? Object.keys(map).find((key) => map[key] === value) : undefined;
}

/** Lê os filtros do endereço; valor desconhecido é ignorado. */
export function readShelfFilters(params: URLSearchParams): ShelfFilters {
  const filters: ShelfFilters = {};
  const filter = FILTERS[params.get('filtro') ?? ''];
  const sort = SORTS[params.get('ordem') ?? ''];
  const q = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
  if (filter) filters.filter = filter;
  if (sort) filters.sort = sort;
  if (q) filters.q = q;
  return filters;
}

/** Escreve os filtros no endereço, sem os que estão no padrão. */
export function writeShelfFilters(filters: ShelfFilters): URLSearchParams {
  const params = new URLSearchParams();
  const entries: [string, string | undefined][] = [
    ['filtro', keyOf(FILTERS, filters.filter)],
    ['ordem', keyOf(SORTS, filters.sort)],
    ['q', filters.q?.trim() || undefined],
  ];
  for (const [key, value] of entries) if (value) params.set(key, value);
  return params;
}

export type ShelfViewMode = 'grid' | 'list';

/** Chave do modo de exibição da estante no navegador (spec 014: "a escolha fica no navegador"). */
export const SHELF_VIEW_STORAGE_KEY = 'nuva-classroom-shelf-view';

/** Modo salvo; grade é o padrão. */
export function readShelfView(): ShelfViewMode {
  try {
    return localStorage.getItem(SHELF_VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function saveShelfView(mode: ShelfViewMode): void {
  try {
    if (mode === 'list') localStorage.setItem(SHELF_VIEW_STORAGE_KEY, 'list');
    else localStorage.removeItem(SHELF_VIEW_STORAGE_KEY);
  } catch {
    /* armazenamento indisponível: a escolha vale só para esta visita */
  }
}
