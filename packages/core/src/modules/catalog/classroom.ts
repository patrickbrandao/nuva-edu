// Leituras do catálogo para o usuário logado do classroom (spec 009; tarefa 411): curso com o
// estado de acesso, conteúdo da aula com as vizinhas, aulas amostra e ebook. A decisão de acesso
// é a do módulo de direitos (`canAccess` e `decideAccess`, spec 010), nunca refeita aqui. A URL
// de conteúdo (`videoUrl`, links de apoio, arquivo do ebook) só sai de `getLessonContent` e de
// `getEbookDownload`, depois de o acesso ser confirmado.

import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import {
  type AccessDecision,
  type AccessDenialReason,
  canAccess,
  decideAccess,
  getEntitlementStatuses,
} from '../entitlements/access.ts';
import type { Role } from '../permissions/roles.ts';
import { type AccessMode, type CourseLevel, isCatalogId, type LessonLinkKind } from './fields.ts';
import {
  type CatalogCover,
  type CatalogPage,
  type CatalogProgramLesson,
  type CatalogProgramModule,
  catalogCover,
  contentAccessDenied,
  loadCatalogProgram,
  readCatalogPageParams,
  sqlAnd,
  toCatalogPage,
} from './read-common.ts';
import type { VideoProvider } from './urls.ts';

/** O usuário da sessão do classroom, com o papel lido nesta requisição. */
export interface CatalogViewer {
  readonly id: string;
  readonly role: Role;
}

/** Estado de acesso do usuário a um produto (`AccessState` do contrato). */
export interface CatalogAccessState {
  allowed: boolean;
  /** `null` quando `allowed`. */
  reason: AccessDenialReason | null;
  /** Fim do acesso mais longo; `null` vitalício, `open`, equipe ou sem acesso. */
  expiresAt: Date | null;
}

function accessState(decision: AccessDecision): CatalogAccessState {
  return { allowed: decision.allowed, reason: decision.reason, expiresAt: decision.expiresAt };
}

/** Ebook vinculado a curso ou aula, sem a URL do arquivo (`EbookRef` do contrato). */
export interface CatalogEbookRef {
  id: string;
  slug: string;
  title: string;
  cover: CatalogCover | null;
  /** O usuário baixa o ebook agora. */
  accessible: boolean;
}

interface EbookRefRow {
  id: string;
  slug: string;
  title: string;
  coverImageId: string | null;
  accessMode: AccessMode;
}

/** Decide `accessible` de cada ebook publicado com a regra da 010, numa consulta de direitos. */
async function toEbookRefs(
  db: Database,
  viewer: CatalogViewer,
  suspended: boolean,
  rows: readonly EbookRefRow[],
): Promise<CatalogEbookRef[]> {
  if (rows.length === 0) return [];
  const statuses = await getEntitlementStatuses(db, viewer.id, {
    productType: 'ebook',
    productIds: rows.map((row) => row.id),
  });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    cover: catalogCover(row.coverImageId),
    accessible: decideAccess({
      target: 'ebook',
      user: { id: viewer.id, role: viewer.role, suspended },
      published: true,
      accessMode: row.accessMode,
      ownerId: null,
      entitlement: statuses.get(row.id) ?? { state: 'none' },
    }).allowed,
  }));
}

// Curso com o estado do usuário.

export interface CatalogCourseViewLesson extends CatalogProgramLesson {
  /** O usuário abre a aula agora: tem acesso ao curso, ou a aula é amostra. */
  accessible: boolean;
}

export interface CatalogCourseViewModule extends Omit<CatalogProgramModule, 'lessons'> {
  lessons: CatalogCourseViewLesson[];
}

/**
 * O curso com o estado de acesso do usuário (a parte de catálogo do `CourseView` do contrato;
 * progresso, "continuar" e certificado vêm dos módulos de aprendizado e de certificados). Sem
 * URL de conteúdo.
 */
export interface CatalogCourseView {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  /** Markdown. */
  description: string | null;
  cover: CatalogCover | null;
  level: CourseLevel | null;
  accessMode: AccessMode;
  priceCents: number | null;
  accessDays: number | null;
  certificateEnabled: boolean;
  moduleCount: number;
  lessonCount: number;
  durationSeconds: number;
  instructorName: string | null;
  access: CatalogAccessState;
  modules: CatalogCourseViewModule[];
  /** Ebooks publicados vinculados ao curso. */
  ebooks: CatalogEbookRef[];
  updatedAt: Date;
}

const EBOOK_REF_JSON = sql`json_build_object(
  'id', k.id, 'slug', k.slug, 'title', k.title,
  'coverImageId', k.cover_image_id, 'accessMode', k.access_mode)`;

/**
 * `GET /courses/{slug}`: o programa com o estado de acesso do usuário. Três consultas, mesmo com
 * 300 aulas: o curso (com o nome do dono e os ebooks vinculados), a decisão de acesso
 * (`canAccess`) e o programa; curso com ebook vinculado custa mais uma, a dos direitos aos
 * ebooks. Sem acesso, o programa continua visível. Curso `private` sem acesso, em rascunho,
 * arquivado ou inexistente: `404` (rascunho é `404` também para a equipe: o classroom só mostra
 * o publicado).
 */
export async function getCourseView(
  db: Database,
  viewer: CatalogViewer,
  slug: unknown,
): Promise<CatalogCourseView> {
  if (typeof slug !== 'string') throw notFound('Curso não encontrado.');
  const result = await sql<{
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    description: string | null;
    coverImageId: string | null;
    level: CourseLevel | null;
    accessMode: AccessMode;
    priceCents: number | null;
    accessDays: number | null;
    certificateEnabled: boolean;
    updatedAt: Date;
    instructorName: string | null;
    ebooks: EbookRefRow[];
  }>`
    SELECT c.id, c.slug, c.title, c.summary, c.description, c.cover_image_id, c.level,
           c.access_mode, c.price_cents::int AS price_cents, c.access_days,
           c.certificate_enabled, c.updated_at, u.name AS instructor_name,
           COALESCE((
             SELECT json_agg(${EBOOK_REF_JSON} ORDER BY k.title, k.id)
               FROM ebooks k
              WHERE k.status = 'published' AND k.archived_at IS NULL
                AND EXISTS (SELECT 1 FROM product_ebooks pe
                             WHERE pe.ebook_id = k.id AND pe.target_type = 'course'
                               AND pe.target_id = c.id)
           ), '[]'::json) AS ebooks
      FROM courses c
      LEFT JOIN users u ON u.id = c.owner_id AND u.deleted_at IS NULL
     WHERE c.slug = ${slug} AND c.status = 'published' AND c.archived_at IS NULL`.execute(db);
  const course = result.rows[0];
  if (!course) throw notFound('Curso não encontrado.');
  // Para o curso `private`, o programa só aparece a quem acessa o conteúdo (direito ativo ou
  // equipe com alcance): as duas decisões da 010 coincidem, e uma verificação basta.
  const decision = await canAccess(db, viewer, { type: 'course', id: course.id });
  if (course.accessMode === 'private' && !decision.allowed) {
    throw notFound('Curso não encontrado.');
  }
  const program = await loadCatalogProgram(db, course.id);
  const suspended = decision.reason === 'suspended';
  const { coverImageId, ebooks, ...fields } = course;
  return {
    ...fields,
    cover: catalogCover(coverImageId),
    moduleCount: program.moduleCount,
    lessonCount: program.lessonCount,
    durationSeconds: program.durationSeconds,
    access: accessState(decision),
    modules: program.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        accessible: decision.allowed || (lesson.isSample && !suspended),
      })),
    })),
    ebooks: await toEbookRefs(db, viewer, suspended, ebooks),
  };
}

// Aula.

/** Link de apoio de uma aula (`LessonLink` do contrato). */
export interface CatalogLessonContentLink {
  id: string;
  label: string;
  url: string;
  kind: LessonLinkKind;
  position: number;
}

/**
 * O conteúdo da aula para quem tem acesso (a parte de catálogo do `LessonView` do contrato; o
 * estado do usuário vem do módulo de aprendizado).
 */
export interface CatalogLessonContent {
  id: string;
  title: string;
  /** Markdown. */
  description: string | null;
  durationSeconds: number;
  isSample: boolean;
  videoProvider: VideoProvider | null;
  videoUrl: string | null;
  course: { id: string; slug: string; title: string };
  module: { id: string; title: string };
  links: CatalogLessonContentLink[];
  /** Ebooks vinculados à aula; vazio em amostra de curso que o usuário não tem. */
  ebooks: CatalogEbookRef[];
  /** Vizinhas entre as aulas publicadas do curso, na ordem do programa. */
  previousLessonId: string | null;
  nextLessonId: string | null;
  isLastLesson: boolean;
  /** Por que o usuário acessa (`basis`), para o módulo de aprendizado: amostra não conta progresso do curso. */
  access: CatalogAccessState & { basis: AccessDecision['basis'] };
}

/**
 * `GET /lessons/{id}`: vídeo, descrição, links de apoio, ebooks e vizinhas. Aula ou curso em
 * rascunho, arquivado ou inexistente (também para a equipe): `404`. Sem acesso: `403`
 * `access_denied` com `reason`, sem nenhum dado da aula. Aula amostra aberta por quem não tem o
 * curso não libera os ebooks vinculados (spec 009, "Aula amostra").
 */
export async function getLessonContent(
  db: Database,
  viewer: CatalogViewer,
  lessonId: unknown,
): Promise<CatalogLessonContent> {
  if (!isCatalogId(lessonId)) throw notFound('Aula não encontrada.');
  const id = lessonId.toLowerCase();
  const lesson = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .innerJoin('courses', 'courses.id', 'modules.courseId')
    .select([
      'lessons.id',
      'lessons.title',
      'lessons.description',
      'lessons.durationSeconds',
      'lessons.isSample',
      'lessons.videoProvider',
      'lessons.videoUrl',
      'modules.id as moduleId',
      'modules.title as moduleTitle',
      'courses.id as courseId',
      'courses.slug as courseSlug',
      'courses.title as courseTitle',
    ])
    .where('lessons.id', '=', id)
    .where('lessons.status', '=', 'published')
    .where('courses.status', '=', 'published')
    .where('courses.archivedAt', 'is', null)
    .executeTakeFirst();
  if (!lesson) throw notFound('Aula não encontrada.');
  const decision = await canAccess(db, viewer, { type: 'lesson', id });
  if (!decision.allowed) throw contentAccessDenied(decision.reason);

  const order = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select('lessons.id')
    .where('modules.courseId', '=', lesson.courseId)
    .where('lessons.status', '=', 'published')
    .orderBy('modules.position')
    .orderBy('lessons.position')
    .execute();
  const index = order.findIndex((row) => row.id === id);
  const links = await db
    .selectFrom('lessonLinks')
    .select(['id', 'label', 'url', 'kind', 'position'])
    .where('lessonId', '=', id)
    .orderBy('position')
    .execute();

  // `basis = sample` também sai para quem tem o curso (a amostra é avaliada antes do direito):
  // os ebooks dependem do acesso ao curso.
  const hasCourse =
    decision.basis !== 'sample' ||
    (await canAccess(db, viewer, { type: 'course', id: lesson.courseId })).allowed;
  const ebookRows = hasCourse
    ? await sql<EbookRefRow>`
        SELECT k.id, k.slug, k.title, k.cover_image_id, k.access_mode
          FROM ebooks k
         WHERE k.status = 'published' AND k.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM product_ebooks pe
                        WHERE pe.ebook_id = k.id AND pe.target_type = 'lesson'
                          AND pe.target_id = ${id}::uuid)
         ORDER BY k.title, k.id`.execute(db)
    : { rows: [] };

  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    durationSeconds: lesson.durationSeconds,
    isSample: lesson.isSample,
    videoProvider: lesson.videoProvider as VideoProvider | null,
    videoUrl: lesson.videoUrl,
    course: { id: lesson.courseId, slug: lesson.courseSlug, title: lesson.courseTitle },
    module: { id: lesson.moduleId, title: lesson.moduleTitle },
    links: links.map((link) => ({ ...link, kind: link.kind as LessonLinkKind })),
    ebooks: await toEbookRefs(db, viewer, false, ebookRows.rows),
    previousLessonId: order[index - 1]?.id ?? null,
    nextLessonId: order[index + 1]?.id ?? null,
    isLastLesson: index === order.length - 1,
    access: { ...accessState(decision), basis: decision.basis },
  };
}

// Aulas amostra.

/** Uma aula amostra em "Aulas liberadas" (`SampleLesson` do contrato), sem URL. */
export interface CatalogSampleLesson {
  id: string;
  title: string;
  durationSeconds: number;
  course: { id: string; slug: string; title: string; cover: CatalogCover | null };
}

export interface SampleLessonsQuery {
  /** Padrão `true`: só as de cursos a que o usuário não tem acesso. */
  excludeOwned?: boolean | undefined;
  limit?: unknown;
  cursor?: unknown;
}

/**
 * `GET /samples`: aulas amostra publicadas de cursos publicados e não privados, das mais novas
 * para as mais antigas, numa consulta. Com `excludeOwned` (padrão), ficam de fora as de cursos
 * que o usuário já abre: curso `open`, curso de que é o dono e curso com direito ativo (lido de
 * `entitlements` na própria consulta, com a regra de "direito ativo" da 010). Admin e gerente
 * não têm tratamento à parte: veem as amostras como um aluno sem direitos.
 */
export async function listSampleLessons(
  db: Database,
  viewer: CatalogViewer,
  query: SampleLessonsQuery = {},
): Promise<CatalogPage<CatalogSampleLesson>> {
  const params = readCatalogPageParams(query, 'samples', ['-createdAt'] as const, '-createdAt');
  const conditions: RawBuilder<unknown>[] = [
    sql`l.is_sample`,
    sql`l.status = 'published'`,
    sql`c.status = 'published'`,
    sql`c.archived_at IS NULL`,
    sql`c.access_mode <> 'private'`,
  ];
  if (query.excludeOwned !== false) {
    const viewerId = isCatalogId(viewer.id) ? viewer.id.toLowerCase() : null;
    conditions.push(
      sql`c.access_mode <> 'open'`,
      sql`c.owner_id IS DISTINCT FROM ${viewerId}::uuid`,
      sql`NOT EXISTS (
        SELECT 1 FROM entitlements e
         WHERE e.user_id = ${viewerId}::uuid AND e.product_type = 'course'
           AND e.product_id = c.id AND e.revoked_at IS NULL AND e.starts_at <= now()
           AND (e.expires_at IS NULL OR e.expires_at > now()))`,
    );
  }
  if (params.afterId !== undefined) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM lessons x WHERE x.id = ${params.afterId}::uuid
                    AND (l.created_at, l.id) < (x.created_at, x.id))`,
    );
  }
  const result = await sql<{
    id: string;
    title: string;
    durationSeconds: number;
    courseId: string;
    courseSlug: string;
    courseTitle: string;
    coverImageId: string | null;
  }>`
    SELECT l.id, l.title, l.duration_seconds, c.id AS course_id, c.slug AS course_slug,
           c.title AS course_title, c.cover_image_id
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      JOIN courses c ON c.id = m.course_id
     WHERE ${sqlAnd(conditions)}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ${params.limit + 1}`.execute(db);
  return toCatalogPage(result.rows, params, 'samples', (row) => ({
    id: row.id,
    title: row.title,
    durationSeconds: row.durationSeconds,
    course: {
      id: row.courseId,
      slug: row.courseSlug,
      title: row.courseTitle,
      cover: catalogCover(row.coverImageId),
    },
  }));
}

// Ebook.

/** O ebook com o estado do usuário, sem a URL do arquivo (`EbookView` do contrato). */
export interface CatalogEbookView {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  /** Markdown. */
  description: string | null;
  cover: CatalogCover | null;
  accessMode: AccessMode;
  priceCents: number | null;
  accessDays: number | null;
  authorName: string | null;
  pages: number | null;
  access: CatalogAccessState;
  updatedAt: Date;
}

/**
 * `GET /ebooks/{slug}`: o ebook publicado com o estado de acesso, em 2 consultas. `private` sem
 * acesso, rascunho, arquivado ou inexistente: `404`. A URL do arquivo não sai daqui.
 */
export async function getEbookView(
  db: Database,
  viewer: CatalogViewer,
  slug: unknown,
): Promise<CatalogEbookView> {
  if (typeof slug !== 'string') throw notFound('Ebook não encontrado.');
  const row = await db
    .selectFrom('ebooks')
    .select([
      'id',
      'slug',
      'title',
      'summary',
      'description',
      'coverImageId',
      'accessMode',
      'priceCents',
      'accessDays',
      'authorName',
      'pages',
      'updatedAt',
    ])
    .where('slug', '=', slug)
    .where('status', '=', 'published')
    .where('archivedAt', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound('Ebook não encontrado.');
  const decision = await canAccess(db, viewer, { type: 'ebook', id: row.id });
  if (row.accessMode === 'private' && !decision.allowed) throw notFound('Ebook não encontrado.');
  const { coverImageId, ...fields } = row;
  return {
    ...fields,
    accessMode: row.accessMode as AccessMode,
    priceCents: row.priceCents === null ? null : Number(row.priceCents),
    cover: catalogCover(coverImageId),
    access: accessState(decision),
  };
}

/**
 * `GET /ebooks/{id}/download`: a URL externa do arquivo, só a quem tem acesso ao ebook (spec
 * 010). Inexistente, despublicado (para quem não é da equipe) ou sem arquivo: `404`. Sem acesso:
 * `403` `access_denied` com `reason`.
 */
export async function getEbookDownload(
  db: Database,
  viewer: CatalogViewer,
  ebookId: unknown,
): Promise<{ url: string }> {
  if (!isCatalogId(ebookId)) throw notFound('Ebook não encontrado.');
  const id = ebookId.toLowerCase();
  const decision = await canAccess(db, viewer, { type: 'ebook', id });
  if (!decision.allowed) {
    if (decision.reason === 'unpublished') throw notFound('Ebook não encontrado.');
    throw contentAccessDenied(decision.reason);
  }
  const row = await db
    .selectFrom('ebooks')
    .select('fileUrl')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row?.fileUrl) throw notFound('Ebook não encontrado.');
  return { url: row.fileUrl };
}
