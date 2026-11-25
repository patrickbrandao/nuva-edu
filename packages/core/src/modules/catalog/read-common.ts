// Base das leituras do catálogo (spec 009; tarefa 411): capa, paginação por cursor, busca por
// trecho, programa do curso e o erro `access_denied`. Nenhuma função daqui devolve URL de
// conteúdo: `video_url`, `lesson_links.url` e `file_url` só saem de `classroom.ts` (a quem tem
// acesso) e de `admin-views.ts` (à equipe).

import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { DomainError, type FieldError, validationFailed } from '../../errors/domain-error.ts';
import { imagePath } from '../images/image-url.ts';
import { isCatalogId } from './fields.ts';

/** Capa de produto (`ProductCover` do contrato): variantes de 480 e 1280 px (spec 029). */
export interface CatalogCover {
  imageId: string;
  url: string;
  largeUrl: string;
}

export function catalogCover(imageId: string | null): CatalogCover | null {
  if (imageId === null) return null;
  return { imageId, url: imagePath(imageId, 480), largeUrl: imagePath(imageId, 1280) };
}

export const CATALOG_PAGE_DEFAULT_LIMIT = 25;
export const CATALOG_PAGE_MAX_LIMIT = 100;
export const CATALOG_QUERY_MAX_LENGTH = 200;

/** Página por cursor opaco (`Page` do contrato). */
export interface CatalogPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCatalogCursor(scope: string, sort: string, id: string): string {
  return Buffer.from(`${scope}:${sort}:${id}`, 'utf8').toString('base64url');
}

/** O id do último item da página anterior, ou `undefined` se o cursor não é desta listagem. */
export function decodeCatalogCursor(
  cursor: unknown,
  scope: string,
  sort: string,
): string | undefined {
  if (typeof cursor !== 'string') return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const prefix = `${scope}:${sort}:`;
  if (!text.startsWith(prefix)) return undefined;
  const id = text.slice(prefix.length);
  return isCatalogId(id) ? id.toLowerCase() : undefined;
}

export interface CatalogPageInput {
  q?: unknown;
  sort?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface CatalogPageParams<S extends string> {
  /** Padrão do `ILIKE`, já escapado; `undefined` sem busca. */
  pattern: string | undefined;
  sort: S;
  limit: number;
  afterId: string | undefined;
}

/**
 * Confere `q`, `sort`, `limit` e `cursor` de uma listagem; os erros dos demais filtros entram
 * em `errors` antes da chamada. Fora do formato: `400` `validation_failed` com os campos.
 */
export function readCatalogPageParams<S extends string>(
  input: CatalogPageInput,
  scope: string,
  sorts: readonly S[],
  defaultSort: S,
  errors: FieldError[] = [],
): CatalogPageParams<S> {
  let pattern: string | undefined;
  if (input.q !== undefined) {
    const q = typeof input.q === 'string' ? input.q.trim() : '';
    if (!q || q.length > CATALOG_QUERY_MAX_LENGTH) {
      errors.push({
        path: 'query.q',
        message: `Use de 1 a ${CATALOG_QUERY_MAX_LENGTH} caracteres.`,
      });
    } else {
      pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    }
  }
  const sort = (input.sort ?? defaultSort) as S;
  if (!sorts.includes(sort)) errors.push({ path: 'query.sort', message: 'Ordem desconhecida.' });
  const limit = input.limit ?? CATALOG_PAGE_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > CATALOG_PAGE_MAX_LIMIT
  ) {
    errors.push({ path: 'query.limit', message: `Use de 1 a ${CATALOG_PAGE_MAX_LIMIT}.` });
  }
  let afterId: string | undefined;
  if (input.cursor !== undefined && errors.length === 0) {
    afterId = decodeCatalogCursor(input.cursor, scope, sort);
    if (afterId === undefined) errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
  }
  if (errors.length > 0) throw validationFailed(errors);
  return { pattern, sort, limit: limit as number, afterId };
}

/** Corta a página lida com `limit + 1` linhas e monta o cursor da próxima. */
export function toCatalogPage<R extends { id: string }, T>(
  rows: readonly R[],
  params: { sort: string; limit: number },
  scope: string,
  shape: (row: R) => T,
): CatalogPage<T> {
  const page = rows.slice(0, params.limit);
  const last = page.at(-1);
  return {
    items: page.map(shape),
    nextCursor:
      rows.length > params.limit && last ? encodeCatalogCursor(scope, params.sort, last.id) : null,
  };
}

export function sqlAnd(conditions: readonly RawBuilder<unknown>[]): RawBuilder<unknown> {
  return conditions.length === 0 ? sql`true` : sql.join(conditions, sql` AND `);
}

/**
 * `403` `access_denied` com o motivo da negativa de `canAccess` em `reason`
 * (`AccessDeniedProblem` do contrato). Não traz nenhum dado do conteúdo.
 */
export function contentAccessDenied(reason: string): DomainError {
  return new DomainError({
    code: 'access_denied',
    status: 403,
    title: 'Sem acesso ao conteúdo',
    extras: { reason },
  });
}

// Programa do curso (spec 009: só aulas publicadas; totais são a soma delas).

/** Uma aula publicada no programa: título e duração, sem URL (`ProgramLesson`). */
export interface CatalogProgramLesson {
  id: string;
  title: string;
  durationSeconds: number;
  isSample: boolean;
  position: number;
}

/** Um módulo do programa, com os totais das aulas publicadas (`ProgramModule`). */
export interface CatalogProgramModule {
  id: string;
  title: string;
  position: number;
  lessonCount: number;
  durationSeconds: number;
  lessons: CatalogProgramLesson[];
}

export interface CatalogProgram {
  modules: CatalogProgramModule[];
  moduleCount: number;
  lessonCount: number;
  durationSeconds: number;
}

/**
 * O programa do curso numa consulta: módulos que têm aula publicada e as aulas publicadas, na
 * ordem. Aula `draft` fica fora do programa e dos totais; módulo sem aula publicada não aparece
 * (decisão da tarefa 411: o classroom não mostra módulo vazio, e `moduleCount` o acompanha).
 */
export async function loadCatalogProgram(db: Database, courseId: string): Promise<CatalogProgram> {
  const rows = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select([
      'modules.id as moduleId',
      'modules.title as moduleTitle',
      'modules.position as modulePosition',
      'lessons.id',
      'lessons.title',
      'lessons.durationSeconds',
      'lessons.isSample',
      'lessons.position',
    ])
    .where('modules.courseId', '=', courseId)
    .where('lessons.status', '=', 'published')
    .orderBy('modules.position')
    .orderBy('lessons.position')
    .execute();
  const modules: CatalogProgramModule[] = [];
  let durationSeconds = 0;
  for (const row of rows) {
    let module = modules.at(-1);
    if (!module || module.id !== row.moduleId) {
      module = {
        id: row.moduleId,
        title: row.moduleTitle,
        position: row.modulePosition,
        lessonCount: 0,
        durationSeconds: 0,
        lessons: [],
      };
      modules.push(module);
    }
    module.lessons.push({
      id: row.id,
      title: row.title,
      durationSeconds: row.durationSeconds,
      isSample: row.isSample,
      position: row.position,
    });
    module.lessonCount += 1;
    module.durationSeconds += row.durationSeconds;
    durationSeconds += row.durationSeconds;
  }
  return { modules, moduleCount: modules.length, lessonCount: rows.length, durationSeconds };
}
