// Leituras do catálogo para o site admin (spec 009; 008, "Regra do instrutor"; tarefa 411):
// listas com filtros e cursor, e o detalhe de curso, aula, ebook e pacote para os editores. O
// instrutor só alcança os cursos de que é dono (os demais respondem `404`), lê os ebooks para
// vinculá-los e não lê pacotes. Aqui a equipe vê rascunhos, arquivados e as URLs de conteúdo.

import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, notFound, permissionDenied } from '../../errors/domain-error.ts';
import { recordDenied } from '../audit/record.ts';
import type { PermissionAction } from '../permissions/actions.ts';
import { type PermissionScope, permissionScope } from '../permissions/matrix.ts';
import {
  type CatalogProductType,
  type CatalogRequest,
  catalogAuditContext,
  countActiveEntitlementHolders,
} from './common.ts';
import {
  ACCESS_MODES,
  type AccessMode,
  type CourseLevel,
  isCatalogId,
  type PublicationStatus,
} from './fields.ts';
import type { EbookTargetType } from './products.ts';
import {
  type CatalogCover,
  type CatalogPage,
  type CatalogPageInput,
  type CatalogPageParams,
  catalogCover,
  readCatalogPageParams,
  sqlAnd,
  toCatalogPage,
} from './read-common.ts';
import { type CatalogLessonLink, listCatalogLessonLinks } from './structure.ts';
import type { VideoProvider } from './urls.ts';

export const ADMIN_CATALOG_SORTS = ['title', '-createdAt', '-updatedAt'] as const;
export type AdminCatalogSort = (typeof ADMIN_CATALOG_SORTS)[number];

/** `archived` lista só os arquivados; os outros dois, só os não arquivados. */
export const ADMIN_CATALOG_STATUSES = ['draft', 'published', 'archived'] as const;
export type AdminCatalogStatus = (typeof ADMIN_CATALOG_STATUSES)[number];

export interface AdminCatalogQuery extends CatalogPageInput {
  status?: unknown;
  accessMode?: unknown;
}

export interface AdminCoursesQuery extends AdminCatalogQuery {
  /** Só os cursos deste dono. */
  ownerId?: unknown;
  /** `true`: só os cursos com pedido de publicação ("aguardando publicação"). */
  awaitingReview?: unknown;
}

interface AdminProductSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover: CatalogCover | null;
  accessMode: AccessMode;
  priceCents: number | null;
  accessDays: number | null;
  status: PublicationStatus;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Um curso na lista do admin (`CourseSummary` do contrato). */
export interface AdminCourseSummary extends AdminProductSummary {
  level: CourseLevel | null;
  owner: { id: string; name: string } | null;
  reviewRequestedAt: Date | null;
  /** Todos os módulos do curso. */
  moduleCount: number;
  /** Aulas publicadas e a soma das durações delas. */
  lessonCount: number;
  durationSeconds: number;
}

/** Um ebook na lista do admin (`EbookSummary` do contrato). */
export interface AdminEbookSummary extends AdminProductSummary {
  authorName: string | null;
  pages: number | null;
}

/** Um pacote na lista do admin (`BundleSummary` do contrato). */
export interface AdminBundleSummary extends AdminProductSummary {
  itemCount: number;
}

export interface AdminLessonSummary {
  id: string;
  moduleId: string;
  title: string;
  status: PublicationStatus;
  isSample: boolean;
  durationSeconds: number;
  videoProvider: VideoProvider | null;
  position: number;
}

export interface AdminCourseModule {
  id: string;
  courseId: string;
  title: string;
  position: number;
  version: number;
  /** Todas as aulas, publicadas ou não, na ordem. */
  lessons: AdminLessonSummary[];
  createdAt: Date;
  updatedAt: Date;
}

/** O curso para o editor (`CourseDetail` do contrato), com a `version` da edição. */
export interface AdminCourseDetail extends AdminCourseSummary {
  description: string | null;
  certificateEnabled: boolean;
  certificateHours: number | null;
  version: number;
  /** Alunos com direito ativo ao curso. */
  studentCount: number;
  modules: AdminCourseModule[];
}

export interface AdminEbookRef {
  id: string;
  slug: string;
  title: string;
  status: PublicationStatus;
}

/** A aula para o editor (`LessonDetail` do contrato), com a `version` da edição. */
export interface AdminLessonDetail {
  id: string;
  courseId: string;
  moduleId: string;
  title: string;
  description: string | null;
  type: 'video';
  status: PublicationStatus;
  isSample: boolean;
  videoUrl: string | null;
  videoProvider: VideoProvider | null;
  durationSeconds: number;
  position: number;
  version: number;
  links: CatalogLessonLink[];
  ebooks: AdminEbookRef[];
  createdAt: Date;
  updatedAt: Date;
}

/** Um vínculo do ebook, com o título do alvo (`EbookTarget` do contrato). */
export interface AdminEbookTarget {
  targetType: EbookTargetType;
  targetId: string;
  title: string;
  /** O curso da aula, em vínculo `lesson`; `null` nos demais. */
  course: { type: 'course'; id: string; title: string } | null;
}

/** O ebook para o editor (`EbookDetail` do contrato), com a `version` da edição. */
export interface AdminEbookDetail extends AdminEbookSummary {
  description: string | null;
  fileUrl: string | null;
  version: number;
  /** Os vínculos que quem pede alcança (o instrutor: só os dos próprios cursos e aulas). */
  targets: AdminEbookTarget[];
  studentCount: number;
}

/** Um item do pacote no editor (`BundleItem` do contrato). */
export interface AdminBundleItem {
  productType: 'course' | 'ebook';
  productId: string;
  title: string;
  accessMode: AccessMode;
  priceCents: number | null;
  status: PublicationStatus;
  archived: boolean;
  position: number;
}

/** O pacote para o editor (`BundleDetail` do contrato), com a `version` da edição. */
export interface AdminBundleDetail extends AdminBundleSummary {
  description: string | null;
  version: number;
  items: AdminBundleItem[];
  /** Soma dos preços avulsos dos itens `paid`. */
  itemsPriceCents: number;
  studentCount: number;
}

/**
 * Exige a ação de leitura e devolve o alcance (`own`: o instrutor). Sem a ação no papel: `403`
 * `permission_denied`, com a recusa gravada na auditoria.
 */
async function requireCatalogRead(
  db: Database,
  request: CatalogRequest,
  action: PermissionAction,
): Promise<PermissionScope> {
  const scope = permissionScope(request.actor, action);
  if (scope !== null) return scope;
  await recordDenied(db, {
    context: catalogAuditContext(request),
    permission: action,
    targetType: null,
    targetId: null,
  });
  throw permissionDenied();
}

const TABLE = { course: 'courses', ebook: 'ebooks', bundle: 'bundles' } as const;
const LABEL = { course: 'Curso', ebook: 'Ebook', bundle: 'Pacote' } as const;

interface ProductRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverImageId: string | null;
  accessMode: AccessMode;
  priceCents: number | null;
  accessDays: number | null;
  status: PublicationStatus;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Só no detalhe.
  description: string | null;
  version: number;
}

interface CourseRow extends ProductRow {
  level: CourseLevel | null;
  ownerId: string | null;
  ownerName: string | null;
  reviewRequestedAt: Date | null;
  moduleCount: number;
  lessonCount: number;
  durationSeconds: number;
  certificateEnabled: boolean;
  certificateHours: number | null;
}

interface EbookRow extends ProductRow {
  authorName: string | null;
  pages: number | null;
  fileUrl: string | null;
}

interface BundleRow extends ProductRow {
  itemCount: number;
}

const COMMON_COLUMNS = sql`p.id, p.slug, p.title, p.summary, p.cover_image_id, p.access_mode,
  p.price_cents::int AS price_cents, p.access_days, p.status, p.published_at, p.archived_at,
  p.created_at, p.updated_at`;

// Colunas e junções próprias de cada produto; `detail` acrescenta o que só o editor usa.
const KIND_SQL: Readonly<
  Record<
    CatalogProductType,
    { columns: RawBuilder<unknown>; detail: RawBuilder<unknown>; joins: RawBuilder<unknown> }
  >
> = {
  course: {
    columns: sql`p.level, p.owner_id, u.name AS owner_name, p.review_requested_at,
      (SELECT count(*)::int FROM modules m WHERE m.course_id = p.id) AS module_count,
      t.lesson_count, t.duration_seconds`,
    detail: sql`p.description, p.version, p.certificate_enabled, p.certificate_hours`,
    joins: sql`LEFT JOIN users u ON u.id = p.owner_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS lesson_count,
               COALESCE(sum(l.duration_seconds), 0)::int AS duration_seconds
          FROM modules m
          JOIN lessons l ON l.module_id = m.id AND l.status = 'published'
         WHERE m.course_id = p.id
      ) t ON true`,
  },
  ebook: {
    columns: sql`p.author_name, p.pages`,
    detail: sql`p.description, p.version, p.file_url`,
    joins: sql``,
  },
  bundle: {
    columns: sql`(SELECT count(*)::int FROM bundle_items b WHERE b.bundle_id = p.id) AS item_count`,
    detail: sql`p.description, p.version`,
    joins: sql``,
  },
};

const ADMIN_ORDER: Readonly<
  Record<AdminCatalogSort, { order: RawBuilder<unknown>; after: RawBuilder<unknown> }>
> = {
  title: {
    order: sql`p.title ASC, p.id ASC`,
    after: sql`(p.title, p.id) > (c.title, c.id)`,
  },
  '-createdAt': {
    order: sql`p.created_at DESC, p.id DESC`,
    after: sql`(p.created_at, p.id) < (c.created_at, c.id)`,
  },
  '-updatedAt': {
    order: sql`p.updated_at DESC, p.id DESC`,
    after: sql`(p.updated_at, p.id) < (c.updated_at, c.id)`,
  },
};

async function selectProducts<R extends ProductRow>(
  db: Database,
  kind: CatalogProductType,
  conditions: readonly RawBuilder<unknown>[],
  options: { detail?: boolean; order?: RawBuilder<unknown>; limit?: number } = {},
): Promise<R[]> {
  const parts = KIND_SQL[kind];
  const result = await sql<R>`
    SELECT ${COMMON_COLUMNS}, ${parts.columns}${options.detail ? sql`, ${parts.detail}` : sql``}
      FROM ${sql.table(TABLE[kind])} p
      ${parts.joins}
     WHERE ${sqlAnd(conditions)}
     ${options.order ? sql`ORDER BY ${options.order}` : sql``}
     ${options.limit === undefined ? sql`` : sql`LIMIT ${options.limit}`}`.execute(db);
  return result.rows;
}

/** Filtros comuns às três listas e a condição do cursor. */
function listConditions(
  kind: CatalogProductType,
  query: AdminCatalogQuery,
  errors: FieldError[],
): { conditions: RawBuilder<unknown>[]; params: CatalogPageParams<AdminCatalogSort> } {
  const conditions: RawBuilder<unknown>[] = [];
  if (query.status !== undefined) {
    if (!(ADMIN_CATALOG_STATUSES as readonly unknown[]).includes(query.status)) {
      errors.push({ path: 'query.status', message: 'Use draft, published ou archived.' });
    } else if (query.status === 'archived') {
      conditions.push(sql`p.archived_at IS NOT NULL`);
    } else {
      conditions.push(sql`p.archived_at IS NULL`, sql`p.status = ${query.status}`);
    }
  }
  if (query.accessMode !== undefined) {
    if (!(ACCESS_MODES as readonly unknown[]).includes(query.accessMode)) {
      errors.push({ path: 'query.accessMode', message: 'Use open, paid ou private.' });
    } else {
      conditions.push(sql`p.access_mode = ${query.accessMode}`);
    }
  }
  const scope = `admin-${kind}`;
  const params = readCatalogPageParams(query, scope, ADMIN_CATALOG_SORTS, '-updatedAt', errors);
  if (params.pattern !== undefined) {
    conditions.push(sql`(p.title ILIKE ${params.pattern} OR p.summary ILIKE ${params.pattern})`);
  }
  if (params.afterId !== undefined) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${sql.table(TABLE[kind])} c
                   WHERE c.id = ${params.afterId}::uuid AND ${ADMIN_ORDER[params.sort].after})`,
    );
  }
  return { conditions, params };
}

function toProductSummary(row: ProductRow): AdminProductSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    cover: catalogCover(row.coverImageId),
    accessMode: row.accessMode,
    priceCents: row.priceCents,
    accessDays: row.accessDays,
    status: row.status,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCourseSummary(row: CourseRow): AdminCourseSummary {
  return {
    ...toProductSummary(row),
    level: row.level,
    owner: row.ownerId === null ? null : { id: row.ownerId, name: row.ownerName ?? '' },
    reviewRequestedAt: row.reviewRequestedAt,
    moduleCount: row.moduleCount,
    lessonCount: row.lessonCount,
    durationSeconds: row.durationSeconds,
  };
}

function toEbookSummary(row: EbookRow): AdminEbookSummary {
  return { ...toProductSummary(row), authorName: row.authorName, pages: row.pages };
}

// Cursos.

/**
 * `GET /courses` (`course.edit`): uma página de cursos, numa consulta. Busca por trecho do
 * título ou do resumo; filtros por situação, modo de acesso, dono e "aguardando publicação"
 * (`awaitingReview`); ordem por título, criação ou alteração (padrão). O instrutor vê só os
 * cursos de que é dono, qualquer que seja o `ownerId` pedido. Parâmetro fora do formato: `400`.
 */
export async function listAdminCourses(
  db: Database,
  request: CatalogRequest,
  query: AdminCoursesQuery = {},
): Promise<CatalogPage<AdminCourseSummary>> {
  const scope = await requireCatalogRead(db, request, 'course.edit');
  const errors: FieldError[] = [];
  const extra: RawBuilder<unknown>[] = [];
  if (query.ownerId !== undefined) {
    if (!isCatalogId(query.ownerId)) {
      errors.push({ path: 'query.ownerId', message: 'Identificador inválido.' });
    } else {
      extra.push(sql`p.owner_id = ${query.ownerId.toLowerCase()}::uuid`);
    }
  }
  if (query.awaitingReview !== undefined) {
    if (typeof query.awaitingReview !== 'boolean') {
      errors.push({ path: 'query.awaitingReview', message: 'Use true ou false.' });
    } else if (query.awaitingReview) {
      extra.push(sql`p.review_requested_at IS NOT NULL`);
    }
  }
  if (scope === 'own') extra.push(sql`p.owner_id = ${request.actor.id}::uuid`);
  const { conditions, params } = listConditions('course', query, errors);
  const rows = await selectProducts<CourseRow>(db, 'course', [...conditions, ...extra], {
    order: ADMIN_ORDER[params.sort].order,
    limit: params.limit + 1,
  });
  return toCatalogPage(rows, params, 'admin-course', toCourseSummary);
}

/** O curso que quem pede alcança com `course.edit`; fora do alcance ou inexistente: `404`. */
async function readCourseRow(
  db: Database,
  request: CatalogRequest,
  courseId: string,
): Promise<CourseRow> {
  const scope = await requireCatalogRead(db, request, 'course.edit');
  const conditions = [sql`p.id = ${courseId}::uuid`];
  if (scope === 'own') conditions.push(sql`p.owner_id = ${request.actor.id}::uuid`);
  const [row] = await selectProducts<CourseRow>(db, 'course', conditions, { detail: true });
  if (!row) throw notFound('Curso não encontrado.');
  return row;
}

/**
 * `GET /courses/{id}` (`course.edit`): o curso para o editor, com todos os módulos e aulas na
 * ordem (publicadas ou não) e o número de alunos com direito ativo. Curso alheio ao instrutor,
 * ou inexistente: `404`.
 */
export async function getAdminCourse(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<AdminCourseDetail> {
  if (!isCatalogId(courseId)) throw notFound('Curso não encontrado.');
  const row = await readCourseRow(db, request, courseId.toLowerCase());
  const modules = await db
    .selectFrom('modules')
    .select(['id', 'courseId', 'title', 'position', 'version', 'createdAt', 'updatedAt'])
    .where('courseId', '=', row.id)
    .orderBy('position')
    .execute();
  const lessons = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select([
      'lessons.id',
      'lessons.moduleId',
      'lessons.title',
      'lessons.status',
      'lessons.isSample',
      'lessons.durationSeconds',
      'lessons.videoProvider',
      'lessons.position',
    ])
    .where('modules.courseId', '=', row.id)
    .orderBy('lessons.position')
    .execute();
  const byModule = new Map<string, AdminLessonSummary[]>();
  for (const lesson of lessons) {
    const list = byModule.get(lesson.moduleId) ?? [];
    list.push({
      ...lesson,
      status: lesson.status as PublicationStatus,
      videoProvider: lesson.videoProvider as VideoProvider | null,
    });
    byModule.set(lesson.moduleId, list);
  }
  return {
    ...toCourseSummary(row),
    description: row.description,
    certificateEnabled: row.certificateEnabled,
    certificateHours: row.certificateHours,
    version: row.version,
    studentCount: await countActiveEntitlementHolders(db, 'course', row.id),
    modules: modules.map((module) => ({ ...module, lessons: byModule.get(module.id) ?? [] })),
  };
}

/**
 * `GET /lessons/{id}` (`course.edit`): a aula para o editor, com o vídeo, os links de apoio e
 * os ebooks vinculados a ela (em qualquer estado). Aula de curso alheio ao instrutor, ou
 * inexistente: `404`.
 */
export async function getAdminLesson(
  db: Database,
  request: CatalogRequest,
  lessonId: unknown,
): Promise<AdminLessonDetail> {
  const scope = await requireCatalogRead(db, request, 'course.edit');
  if (!isCatalogId(lessonId)) throw notFound('Aula não encontrada.');
  const id = lessonId.toLowerCase();
  const row = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .innerJoin('courses', 'courses.id', 'modules.courseId')
    .select([
      'lessons.id',
      'modules.courseId',
      'lessons.moduleId',
      'lessons.title',
      'lessons.description',
      'lessons.status',
      'lessons.isSample',
      'lessons.videoUrl',
      'lessons.videoProvider',
      'lessons.durationSeconds',
      'lessons.position',
      'lessons.version',
      'lessons.createdAt',
      'lessons.updatedAt',
      'courses.ownerId',
    ])
    .where('lessons.id', '=', id)
    .executeTakeFirst();
  if (!row || (scope === 'own' && row.ownerId !== request.actor.id)) {
    throw notFound('Aula não encontrada.');
  }
  const ebooks = await db
    .selectFrom('productEbooks')
    .innerJoin('ebooks', 'ebooks.id', 'productEbooks.ebookId')
    .select(['ebooks.id', 'ebooks.slug', 'ebooks.title', 'ebooks.status'])
    .where('productEbooks.targetType', '=', 'lesson')
    .where('productEbooks.targetId', '=', id)
    .orderBy('ebooks.title')
    .orderBy('ebooks.id')
    .execute();
  const { ownerId: _ownerId, ...lesson } = row;
  return {
    ...lesson,
    type: 'video',
    status: row.status as PublicationStatus,
    videoProvider: row.videoProvider as VideoProvider | null,
    links: await listCatalogLessonLinks(db, id),
    ebooks: ebooks.map((ebook) => ({ ...ebook, status: ebook.status as PublicationStatus })),
  };
}

// Ebooks.

/**
 * `GET /ebooks` (`ebook.link`): uma página de ebooks, numa consulta, com os filtros comuns. O
 * instrutor lê a lista inteira para vincular ebooks aos próprios cursos e aulas.
 */
export async function listAdminEbooks(
  db: Database,
  request: CatalogRequest,
  query: AdminCatalogQuery = {},
): Promise<CatalogPage<AdminEbookSummary>> {
  await requireCatalogRead(db, request, 'ebook.link');
  const { conditions, params } = listConditions('ebook', query, []);
  const rows = await selectProducts<EbookRow>(db, 'ebook', conditions, {
    order: ADMIN_ORDER[params.sort].order,
    limit: params.limit + 1,
  });
  return toCatalogPage(rows, params, 'admin-ebook', toEbookSummary);
}

/**
 * `GET /ebooks/{id}` (`ebook.link`): o ebook com o link do arquivo, os vínculos (com o título
 * do alvo) e o número de alunos com direito ativo. O instrutor vê só os vínculos com os
 * próprios cursos e aulas. Inexistente: `404`.
 */
export async function getAdminEbook(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
): Promise<AdminEbookDetail> {
  const scope = await requireCatalogRead(db, request, 'ebook.link');
  if (!isCatalogId(ebookId)) throw notFound(`${LABEL.ebook} não encontrado.`);
  const id = ebookId.toLowerCase();
  const [row] = await selectProducts<EbookRow>(db, 'ebook', [sql`p.id = ${id}::uuid`], {
    detail: true,
  });
  if (!row) throw notFound(`${LABEL.ebook} não encontrado.`);
  const targets = await sql<{
    targetType: EbookTargetType;
    targetId: string;
    title: string;
    courseId: string | null;
    courseTitle: string | null;
    ownerId: string | null;
  }>`
    SELECT pe.target_type, pe.target_id,
           COALESCE(tc.title, tl.title, tb.title) AS title,
           lc.id AS course_id, lc.title AS course_title,
           COALESCE(tc.owner_id, lc.owner_id) AS owner_id
      FROM product_ebooks pe
      LEFT JOIN courses tc ON pe.target_type = 'course' AND tc.id = pe.target_id
      LEFT JOIN bundles tb ON pe.target_type = 'bundle' AND tb.id = pe.target_id
      LEFT JOIN lessons tl ON pe.target_type = 'lesson' AND tl.id = pe.target_id
      LEFT JOIN modules lm ON lm.id = tl.module_id
      LEFT JOIN courses lc ON lc.id = lm.course_id
     WHERE pe.ebook_id = ${id}::uuid AND COALESCE(tc.id, tl.id, tb.id) IS NOT NULL
     ORDER BY pe.target_type, title, pe.target_id`.execute(db);
  return {
    ...toEbookSummary(row),
    description: row.description,
    fileUrl: row.fileUrl,
    version: row.version,
    targets: targets.rows
      .filter(
        (target) =>
          scope !== 'own' ||
          (target.targetType !== 'bundle' && target.ownerId === request.actor.id),
      )
      .map((target) => ({
        targetType: target.targetType,
        targetId: target.targetId,
        title: target.title,
        course:
          target.courseId === null
            ? null
            : { type: 'course', id: target.courseId, title: target.courseTitle ?? '' },
      })),
    studentCount: await countActiveEntitlementHolders(db, 'ebook', id),
  };
}

// Pacotes.

function toBundleSummary(row: BundleRow): AdminBundleSummary {
  return { ...toProductSummary(row), itemCount: row.itemCount };
}

/** `GET /bundles` (`ebook_bundle.manage`): uma página de pacotes, numa consulta. */
export async function listAdminBundles(
  db: Database,
  request: CatalogRequest,
  query: AdminCatalogQuery = {},
): Promise<CatalogPage<AdminBundleSummary>> {
  await requireCatalogRead(db, request, 'ebook_bundle.manage');
  const { conditions, params } = listConditions('bundle', query, []);
  const rows = await selectProducts<BundleRow>(db, 'bundle', conditions, {
    order: ADMIN_ORDER[params.sort].order,
    limit: params.limit + 1,
  });
  return toCatalogPage(rows, params, 'admin-bundle', toBundleSummary);
}

/**
 * `GET /bundles/{id}` (`ebook_bundle.manage`): o pacote, os itens na ordem (em qualquer
 * estado), a soma dos preços avulsos dos itens `paid` e o número de alunos com direito ativo.
 */
export async function getAdminBundle(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
): Promise<AdminBundleDetail> {
  await requireCatalogRead(db, request, 'ebook_bundle.manage');
  if (!isCatalogId(bundleId)) throw notFound(`${LABEL.bundle} não encontrado.`);
  const id = bundleId.toLowerCase();
  const [row] = await selectProducts<BundleRow>(db, 'bundle', [sql`p.id = ${id}::uuid`], {
    detail: true,
  });
  if (!row) throw notFound(`${LABEL.bundle} não encontrado.`);
  const items = await sql<{
    productType: 'course' | 'ebook';
    productId: string;
    title: string;
    accessMode: AccessMode;
    priceCents: number | null;
    status: PublicationStatus;
    archived: boolean;
    position: number;
  }>`
    SELECT b.product_type, b.product_id, p.title, p.access_mode,
           p.price_cents::int AS price_cents, p.status, p.archived, b.position
      FROM bundle_items b
      JOIN LATERAL (
        SELECT title, access_mode, price_cents, status, archived_at IS NOT NULL AS archived
          FROM courses WHERE b.product_type = 'course' AND id = b.product_id
        UNION ALL
        SELECT title, access_mode, price_cents, status, archived_at IS NOT NULL
          FROM ebooks WHERE b.product_type = 'ebook' AND id = b.product_id
      ) p ON true
     WHERE b.bundle_id = ${id}::uuid
     ORDER BY b.position`.execute(db);
  return {
    ...toBundleSummary(row),
    description: row.description,
    version: row.version,
    items: items.rows,
    itemsPriceCents: items.rows.reduce(
      (sum, item) => sum + (item.accessMode === 'paid' ? (item.priceCents ?? 0) : 0),
      0,
    ),
    studentCount: await countActiveEntitlementHolders(db, 'bundle', id),
  };
}
