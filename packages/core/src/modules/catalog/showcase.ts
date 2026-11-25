// Vitrine pública (spec 009, "Vitrine pública"; tarefa 411): lista e página de produto para
// `GET /catalog` e `GET /catalog/{type}/{slug}` da classroom-api, sem login. Só produto
// `published`, não arquivado, `open` ou `paid`; o `private` nunca aparece, nem na busca, e o
// slug dele responde `404`. Nenhuma resposta daqui traz URL de conteúdo.

import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, notFound } from '../../errors/domain-error.ts';
import { CATALOG_PRODUCT_TYPES, type CatalogProductType } from './common.ts';
import { type AccessMode, COURSE_LEVELS, type CourseLevel } from './fields.ts';
import {
  type CatalogCover,
  type CatalogPage,
  type CatalogPageInput,
  type CatalogProgramModule,
  catalogCover,
  loadCatalogProgram,
  readCatalogPageParams,
  sqlAnd,
  toCatalogPage,
} from './read-common.ts';

export const SHOWCASE_SORTS = ['-publishedAt', 'title', 'priceCents', '-priceCents'] as const;
export type ShowcaseSort = (typeof SHOWCASE_SORTS)[number];

export const SHOWCASE_PRICE_FILTERS = ['free', 'paid'] as const;
export type ShowcasePriceFilter = (typeof SHOWCASE_PRICE_FILTERS)[number];

/** Modo de acesso de quem aparece na vitrine. */
export type ShowcaseAccessMode = Exclude<AccessMode, 'private'>;

export interface ShowcaseQuery extends CatalogPageInput {
  type?: unknown;
  level?: unknown;
  /** `free`: modo `open` ou preço 0; `paid`: preço acima de 0. */
  price?: unknown;
}

/** Um produto na vitrine (`CatalogItem` do contrato). */
export interface ShowcaseItem {
  type: CatalogProductType;
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover: CatalogCover | null;
  /** Só em curso. */
  level: CourseLevel | null;
  accessMode: ShowcaseAccessMode;
  priceCents: number | null;
  accessDays: number | null;
  /** Só em curso: módulos com aula publicada, aulas publicadas e a soma das durações delas. */
  moduleCount: number | null;
  lessonCount: number | null;
  durationSeconds: number | null;
  /** Só em pacote: itens publicados. */
  itemCount: number | null;
  /** Só em ebook. */
  pages: number | null;
  publishedAt: Date;
  updatedAt: Date;
}

interface ShowcaseRow {
  type: CatalogProductType;
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverImageId: string | null;
  level: CourseLevel | null;
  accessMode: ShowcaseAccessMode;
  priceCents: number | null;
  accessDays: number | null;
  pages: number | null;
  publishedAt: Date;
  updatedAt: Date;
  moduleCount: number | null;
  lessonCount: number | null;
  durationSeconds: number | null;
  itemCount: number | null;
}

const VISIBLE = sql`status = 'published' AND archived_at IS NULL AND access_mode IN ('open', 'paid')`;

// As três tabelas com as colunas comuns da vitrine. `published_at` existe em todo produto
// publicado; o COALESCE só protege a ordenação de um dado antigo sem a data.
const SHOWCASE_ITEMS = sql`
  SELECT 'course'::text AS type, id, slug, title, summary, cover_image_id, level, access_mode,
         price_cents::int AS price_cents, access_days, NULL::int AS pages,
         COALESCE(published_at, updated_at) AS published_at, updated_at
    FROM courses WHERE ${VISIBLE}
  UNION ALL
  SELECT 'bundle', id, slug, title, summary, cover_image_id, NULL, access_mode,
         price_cents::int, access_days, NULL::int,
         COALESCE(published_at, updated_at), updated_at
    FROM bundles WHERE ${VISIBLE}
  UNION ALL
  SELECT 'ebook', id, slug, title, summary, cover_image_id, NULL, access_mode,
         price_cents::int, access_days, pages,
         COALESCE(published_at, updated_at), updated_at
    FROM ebooks WHERE ${VISIBLE}`;

const SHOWCASE_ORDER: Readonly<
  Record<ShowcaseSort, { order: RawBuilder<unknown>; after: RawBuilder<unknown> }>
> = {
  '-publishedAt': {
    order: sql`i.published_at DESC, i.id DESC`,
    after: sql`(i.published_at, i.id) < (c.published_at, c.id)`,
  },
  title: {
    order: sql`i.title ASC, i.id ASC`,
    after: sql`(i.title, i.id) > (c.title, c.id)`,
  },
  priceCents: {
    order: sql`COALESCE(i.price_cents, 0) ASC, i.id ASC`,
    after: sql`(COALESCE(i.price_cents, 0), i.id) > (COALESCE(c.price_cents, 0), c.id)`,
  },
  '-priceCents': {
    order: sql`COALESCE(i.price_cents, 0) DESC, i.id DESC`,
    after: sql`(COALESCE(i.price_cents, 0), i.id) < (COALESCE(c.price_cents, 0), c.id)`,
  },
};

const PUBLISHED_ITEM = sql`(
  (b.product_type = 'course' AND EXISTS (
     SELECT 1 FROM courses p
      WHERE p.id = b.product_id AND p.status = 'published' AND p.archived_at IS NULL))
  OR (b.product_type = 'ebook' AND EXISTS (
     SELECT 1 FROM ebooks p
      WHERE p.id = b.product_id AND p.status = 'published' AND p.archived_at IS NULL)))`;

/**
 * `GET /catalog`: uma página da vitrine, numa consulta. Filtros por tipo, nível (só cursos têm
 * nível) e gratuito × pago; busca por trecho do título ou do resumo; ordem por mais recentes
 * (padrão), título ou preço (produto `open` conta como preço 0). Os totais do curso contam só
 * aulas publicadas. Parâmetro fora do formato: `400` `validation_failed`.
 */
export async function listShowcase(
  db: Database,
  query: ShowcaseQuery = {},
): Promise<CatalogPage<ShowcaseItem>> {
  const errors: FieldError[] = [];
  const includes = (list: readonly string[], value: unknown) =>
    typeof value === 'string' && list.includes(value);
  if (query.type !== undefined && !includes(CATALOG_PRODUCT_TYPES, query.type)) {
    errors.push({ path: 'query.type', message: 'Use course, bundle ou ebook.' });
  }
  if (query.level !== undefined && !includes(COURSE_LEVELS, query.level)) {
    errors.push({ path: 'query.level', message: 'Nível desconhecido.' });
  }
  if (query.price !== undefined && !includes(SHOWCASE_PRICE_FILTERS, query.price)) {
    errors.push({ path: 'query.price', message: 'Use free ou paid.' });
  }
  const params = readCatalogPageParams(query, 'showcase', SHOWCASE_SORTS, '-publishedAt', errors);
  const { order, after } = SHOWCASE_ORDER[params.sort];

  const conditions: RawBuilder<unknown>[] = [];
  if (query.type !== undefined) conditions.push(sql`i.type = ${query.type}`);
  if (query.level !== undefined) conditions.push(sql`i.level = ${query.level}`);
  if (query.price === 'free') {
    conditions.push(sql`(i.access_mode = 'open' OR i.price_cents = 0)`);
  } else if (query.price === 'paid') {
    conditions.push(sql`i.price_cents > 0`);
  }
  if (params.pattern !== undefined) {
    conditions.push(sql`(i.title ILIKE ${params.pattern} OR i.summary ILIKE ${params.pattern})`);
  }
  if (params.afterId !== undefined) {
    // O valor de ordenação vem da própria linha do cursor.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM items c WHERE c.id = ${params.afterId}::uuid AND ${after})`,
    );
  }

  const result = await sql<ShowcaseRow>`
    WITH items AS (${SHOWCASE_ITEMS})
    SELECT i.*, t.module_count, t.lesson_count, t.duration_seconds,
           CASE WHEN i.type = 'bundle' THEN (
             SELECT count(*)::int FROM bundle_items b
              WHERE b.bundle_id = i.id AND ${PUBLISHED_ITEM}) END AS item_count
      FROM (
        SELECT * FROM items i WHERE ${sqlAnd(conditions)}
         ORDER BY ${order} LIMIT ${params.limit + 1}
      ) i
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT m.id)::int AS module_count, count(l.id)::int AS lesson_count,
               COALESCE(sum(l.duration_seconds), 0)::int AS duration_seconds
          FROM modules m
          JOIN lessons l ON l.module_id = m.id AND l.status = 'published'
         WHERE m.course_id = i.id
      ) t ON i.type = 'course'
     ORDER BY ${order}`.execute(db);

  return toCatalogPage(result.rows, params, 'showcase', (row) => {
    const { coverImageId, ...item } = row;
    return { ...item, cover: catalogCover(coverImageId) };
  });
}

// Página do produto.

interface ShowcaseProductBase {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  /** Markdown. */
  description: string | null;
  cover: CatalogCover | null;
  accessMode: ShowcaseAccessMode;
  priceCents: number | null;
  accessDays: number | null;
  publishedAt: Date;
  updatedAt: Date;
}

/** Página de curso na vitrine, com o programa (`CatalogCourse` do contrato). */
export interface ShowcaseCourse extends ShowcaseProductBase {
  type: 'course';
  level: CourseLevel | null;
  moduleCount: number;
  lessonCount: number;
  durationSeconds: number;
  /** Nome de exibição do dono; `null` em curso sem dono. */
  instructorName: string | null;
  program: CatalogProgramModule[];
}

/** Um item de pacote na página do pacote (`CatalogBundleItem` do contrato). */
export interface ShowcaseBundleItem {
  type: 'course' | 'ebook';
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover: CatalogCover | null;
  accessMode: AccessMode;
  priceCents: number | null;
  /** Falso em item `private`: só o título, sem resumo, capa, preço nem link. */
  visible: boolean;
}

/** Página de pacote na vitrine (`CatalogBundle` do contrato). */
export interface ShowcaseBundle extends ShowcaseProductBase {
  type: 'bundle';
  items: ShowcaseBundleItem[];
  /** Soma dos preços avulsos dos itens `paid`, para mostrar a economia. */
  itemsPriceCents: number;
}

/** Página de ebook na vitrine, sem a URL do arquivo (`CatalogEbook` do contrato). */
export interface ShowcaseEbook extends ShowcaseProductBase {
  type: 'ebook';
  authorName: string | null;
  pages: number | null;
}

export type ShowcaseProduct = ShowcaseCourse | ShowcaseBundle | ShowcaseEbook;

interface ProductRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  coverImageId: string | null;
  accessMode: string;
  priceCents: string | number | null;
  accessDays: number | null;
  publishedAt: Date | null;
  updatedAt: Date;
}

function productBase(row: ProductRow): ShowcaseProductBase {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    cover: catalogCover(row.coverImageId),
    accessMode: row.accessMode as ShowcaseAccessMode,
    priceCents: row.priceCents === null ? null : Number(row.priceCents),
    accessDays: row.accessDays,
    publishedAt: row.publishedAt ?? row.updatedAt,
    updatedAt: row.updatedAt,
  };
}

const PRODUCT_COLUMNS = [
  'id',
  'slug',
  'title',
  'summary',
  'description',
  'coverImageId',
  'accessMode',
  'priceCents',
  'accessDays',
  'publishedAt',
  'updatedAt',
] as const;

/** Itens publicados de um pacote, na ordem, com a soma dos preços avulsos dos `paid`. */
export async function loadShowcaseBundleItems(
  db: Database,
  bundleId: string,
): Promise<{ items: ShowcaseBundleItem[]; itemsPriceCents: number }> {
  const result = await sql<{
    type: 'course' | 'ebook';
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    coverImageId: string | null;
    accessMode: AccessMode;
    priceCents: number | null;
  }>`
    SELECT b.product_type AS type, p.id, p.slug, p.title, p.summary, p.cover_image_id,
           p.access_mode, p.price_cents::int AS price_cents
      FROM bundle_items b
      JOIN LATERAL (
        SELECT id, slug, title, summary, cover_image_id, access_mode, price_cents
          FROM courses
         WHERE b.product_type = 'course' AND id = b.product_id
           AND status = 'published' AND archived_at IS NULL
        UNION ALL
        SELECT id, slug, title, summary, cover_image_id, access_mode, price_cents
          FROM ebooks
         WHERE b.product_type = 'ebook' AND id = b.product_id
           AND status = 'published' AND archived_at IS NULL
      ) p ON true
     WHERE b.bundle_id = ${bundleId}::uuid
     ORDER BY b.position`.execute(db);
  let itemsPriceCents = 0;
  const items = result.rows.map((row): ShowcaseBundleItem => {
    const visible = row.accessMode !== 'private';
    if (row.accessMode === 'paid') itemsPriceCents += row.priceCents ?? 0;
    return {
      type: row.type,
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: visible ? row.summary : null,
      cover: visible ? catalogCover(row.coverImageId) : null,
      accessMode: row.accessMode,
      priceCents: visible ? row.priceCents : null,
      visible,
    };
  });
  return { items, itemsPriceCents };
}

/**
 * `GET /catalog/{type}/{slug}`: a página do produto, sem login e sem URL de conteúdo. Curso: 2
 * consultas (o curso com o nome do dono; o programa), mesmo com 300 aulas. Pacote: 2 (o pacote;
 * os itens publicados). Ebook: 1. Produto `private`, em rascunho, arquivado ou inexistente, e
 * tipo ou slug fora do formato: `404`.
 */
export async function getShowcaseProduct(
  db: Database,
  type: unknown,
  slug: unknown,
): Promise<ShowcaseProduct> {
  if (
    typeof slug !== 'string' ||
    typeof type !== 'string' ||
    !(CATALOG_PRODUCT_TYPES as readonly string[]).includes(type)
  ) {
    throw notFound('Produto não encontrado.');
  }
  if (type === 'course') {
    const row = await db
      .selectFrom('courses')
      .leftJoin('users', (join) =>
        join.onRef('users.id', '=', 'courses.ownerId').on('users.deletedAt', 'is', null),
      )
      .select([
        ...PRODUCT_COLUMNS.map((column) => `courses.${column}` as const),
        'courses.level',
        'users.name as instructorName',
      ])
      .where('courses.slug', '=', slug)
      .where('courses.status', '=', 'published')
      .where('courses.archivedAt', 'is', null)
      .where('courses.accessMode', 'in', ['open', 'paid'])
      .executeTakeFirst();
    if (!row) throw notFound('Produto não encontrado.');
    const program = await loadCatalogProgram(db, row.id);
    return {
      type: 'course',
      ...productBase(row),
      level: row.level as CourseLevel | null,
      moduleCount: program.moduleCount,
      lessonCount: program.lessonCount,
      durationSeconds: program.durationSeconds,
      instructorName: row.instructorName,
      program: program.modules,
    };
  }
  if (type === 'bundle') {
    const row = await db
      .selectFrom('bundles')
      .select(PRODUCT_COLUMNS)
      .where('slug', '=', slug)
      .where('status', '=', 'published')
      .where('archivedAt', 'is', null)
      .where('accessMode', 'in', ['open', 'paid'])
      .executeTakeFirst();
    if (!row) throw notFound('Produto não encontrado.');
    return { type: 'bundle', ...productBase(row), ...(await loadShowcaseBundleItems(db, row.id)) };
  }
  const row = await db
    .selectFrom('ebooks')
    .select([...PRODUCT_COLUMNS, 'authorName', 'pages'])
    .where('slug', '=', slug)
    .where('status', '=', 'published')
    .where('archivedAt', 'is', null)
    .where('accessMode', 'in', ['open', 'paid'])
    .executeTakeFirst();
  if (!row) throw notFound('Produto não encontrado.');
  return { type: 'ebook', ...productBase(row), authorName: row.authorName, pages: row.pages };
}
