// Estante "Meus cursos", "Continue assistindo", "Meu progresso", mapa de atividade e "Meus
// ebooks" (spec 014; tarefa 413). Leituras do próprio usuário, sem paginação (até 200 cursos).

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, validationFailed } from '../../errors/domain-error.ts';
import type { CourseLevel } from '../catalog/fields.ts';
import {
  CATALOG_QUERY_MAX_LENGTH,
  type CatalogCover,
  catalogCover,
} from '../catalog/read-common.ts';
import { decideAccess, toEntitlementStatus } from '../entitlements/access.ts';
import { isUuid } from '../entitlements/types.ts';
import {
  ACTIVE_ENTITLEMENT,
  type CourseStats,
  countsOfLessons,
  countsOfStats,
  type LearningViewer,
  loadCourseStats,
  loadLessonProgress,
  type ProgressCounts,
  type ProgressModule,
  resolveUserTimezone,
  toProgressModules,
} from './common.ts';

export const SHELF_FILTERS = ['all', 'in_progress', 'not_started', 'completed'] as const;
export type ShelfFilter = (typeof SHELF_FILTERS)[number];

export const SHELF_SORTS = ['-lastAccessedAt', '-publishedAt', 'title', '-percent'] as const;
export type ShelfSort = (typeof SHELF_SORTS)[number];

/** `open`: curso aberto, sem direito; `expired`: selo "acesso vencido". */
export type ShelfAccessState = 'active' | 'expired' | 'open';

/** "Começar", "Continuar", "Rever" ou "Renovar acesso". */
export type ShelfAction = 'start' | 'continue' | 'review' | 'renew';

/**
 * Um curso da estante (`ShelfCourse` do contrato, menos `certificate`, que vem do módulo de
 * certificados; `certificateEnabled` fica para ele decidir).
 */
export interface ShelfCourse {
  id: string;
  slug: string;
  title: string;
  level: CourseLevel | null;
  cover: CatalogCover | null;
  progress: ProgressCounts;
  access: { state: ShelfAccessState; expiresAt: Date | null };
  action: ShelfAction;
  /** Aula de "Começar", "Continuar" ou "Rever"; `null` com acesso vencido. */
  continueLessonId: string | null;
  lastAccessedAt: Date | null;
  /** Início do direito mais recente; `null` em curso aberto e para a equipe. */
  acquiredAt: Date | null;
  publishedAt: Date;
  certificateEnabled: boolean;
}

export interface ShelfCounts {
  all: number;
  inProgress: number;
  notStarted: number;
  completed: number;
  /** Soma da duração das aulas concluídas, em segundos. */
  completedLessonSeconds: number;
}

export interface Shelf {
  counts: ShelfCounts;
  /** "Comece por aqui": com cursos e nenhum iniciado, o de aquisição mais recente. */
  startHereCourseId: string | null;
  items: ShelfCourse[];
}

export interface ShelfQuery {
  filter?: unknown;
  q?: unknown;
  sort?: unknown;
}

interface ShelfRow {
  id: string;
  slug: string;
  title: string;
  level: string | null;
  coverImageId: string | null;
  accessMode: 'open' | 'paid' | 'private';
  ownerId: string | null;
  certificateEnabled: boolean;
  publishedAt: Date;
  hasActive: boolean | null;
  hasLifetime: boolean | null;
  activeUntil: Date | null;
  hasExpired: boolean | null;
  acquiredAt: Date | null;
}

interface ShelfEntry {
  course: ShelfCourse;
  stats: CourseStats;
}

/**
 * Os cursos da estante com o progresso, em 2 consultas (RNF-02): os cursos publicados a que o
 * usuário tem ou já teve direito (não revogado e já iniciado), mais os que ele abriu e acessa
 * sem direito (curso `open`; admin e gerente; instrutor dono); depois, os agregados de
 * progresso de todos. Curso despublicado ou arquivado some da estante até voltar (spec 009).
 */
async function loadShelf(db: Database, viewer: LearningViewer): Promise<ShelfEntry[]> {
  if (!isUuid(viewer.id)) return [];
  const userId = viewer.id.toLowerCase();
  const staff = viewer.role === 'admin' || viewer.role === 'manager';
  const instructor = viewer.role === 'instructor';
  const result = await sql<ShelfRow>`
    SELECT c.id, c.slug, c.title, c.level, c.cover_image_id, c.access_mode, c.owner_id,
           c.certificate_enabled, COALESCE(c.published_at, c.created_at) AS published_at,
           ent.has_active, ent.has_lifetime, ent.active_until, ent.has_expired, ent.acquired_at
      FROM courses c
      LEFT JOIN LATERAL (
        SELECT bool_or(${ACTIVE_ENTITLEMENT}) AS has_active,
               bool_or(e.starts_at <= now() AND e.expires_at IS NULL) AS has_lifetime,
               max(e.expires_at) FILTER (WHERE ${ACTIVE_ENTITLEMENT}) AS active_until,
               bool_or(e.expires_at <= now()) AS has_expired,
               max(e.starts_at) FILTER (WHERE e.starts_at <= now()) AS acquired_at
          FROM entitlements e
         WHERE e.user_id = ${userId}::uuid AND e.product_type = 'course'
           AND e.product_id = c.id AND e.revoked_at IS NULL
      ) ent ON true
     WHERE c.status = 'published' AND c.archived_at IS NULL
       AND (ent.has_active OR ent.has_expired
            OR ((c.access_mode = 'open' OR ${staff}::boolean
                 OR (${instructor}::boolean AND c.owner_id = ${userId}::uuid))
                AND EXISTS (SELECT 1 FROM lesson_progress lp
                             WHERE lp.user_id = ${userId}::uuid AND lp.course_id = c.id)))
     ORDER BY c.id`.execute(db);
  const stats = await loadCourseStats(
    db,
    userId,
    result.rows.map((row) => row.id),
  );
  return result.rows.map((row) => {
    const courseStats = stats.get(row.id) as CourseStats;
    const decision = decideAccess({
      target: 'course',
      user: { id: userId, role: viewer.role, suspended: false },
      published: true,
      accessMode: row.accessMode,
      ownerId: row.ownerId,
      entitlement: toEntitlementStatus(row),
    });
    const progress = countsOfStats(courseStats);
    const action: ShelfAction = !decision.allowed
      ? 'renew'
      : progress.state === 'completed'
        ? 'review'
        : progress.state === 'in_progress'
          ? 'continue'
          : 'start';
    return {
      stats: courseStats,
      course: {
        id: row.id,
        slug: row.slug,
        title: row.title,
        level: row.level as CourseLevel | null,
        cover: catalogCover(row.coverImageId),
        progress,
        access: decision.allowed
          ? { state: decision.basis === 'open' ? 'open' : 'active', expiresAt: decision.expiresAt }
          : { state: 'expired', expiresAt: null },
        action,
        continueLessonId: decision.allowed ? courseStats.continueLessonId : null,
        lastAccessedAt: courseStats.lastOpenedAt,
        acquiredAt: row.acquiredAt,
        publishedAt: row.publishedAt,
        certificateEnabled: row.certificateEnabled,
      },
    };
  });
}

const time = (date: Date | null): number => date?.getTime() ?? Number.NEGATIVE_INFINITY;
const byTitle = (a: ShelfCourse, b: ShelfCourse): number =>
  a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id);

const SHELF_ORDER: Record<ShelfSort, (a: ShelfCourse, b: ShelfCourse) => number> = {
  '-lastAccessedAt': (a, b) =>
    time(b.lastAccessedAt) - time(a.lastAccessedAt) ||
    time(b.acquiredAt) - time(a.acquiredAt) ||
    byTitle(a, b),
  '-publishedAt': (a, b) => time(b.publishedAt) - time(a.publishedAt) || byTitle(a, b),
  title: byTitle,
  '-percent': (a, b) => b.progress.percent - a.progress.percent || byTitle(a, b),
};

/**
 * `GET /me/courses`: a estante, em 2 consultas mesmo com 200 cursos. Os contadores e o "Comece
 * por aqui" valem para o conjunto todo, antes do filtro e da busca (trecho do título, sem
 * diferenciar maiúsculas). Parâmetro fora do formato: `400` `validation_failed`.
 */
export async function listMyCourses(
  db: Database,
  viewer: LearningViewer,
  query: ShelfQuery = {},
): Promise<Shelf> {
  const errors: FieldError[] = [];
  const filter = (query.filter ?? 'all') as ShelfFilter;
  if (!SHELF_FILTERS.includes(filter)) {
    errors.push({ path: 'query.filter', message: 'Filtro desconhecido.' });
  }
  const sort = (query.sort ?? '-lastAccessedAt') as ShelfSort;
  if (!SHELF_SORTS.includes(sort)) {
    errors.push({ path: 'query.sort', message: 'Ordem desconhecida.' });
  }
  let needle: string | undefined;
  if (query.q !== undefined) {
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    if (!q || q.length > CATALOG_QUERY_MAX_LENGTH) {
      errors.push({
        path: 'query.q',
        message: `Use de 1 a ${CATALOG_QUERY_MAX_LENGTH} caracteres.`,
      });
    } else {
      needle = q.toLocaleLowerCase('pt-BR');
    }
  }
  if (errors.length > 0) throw validationFailed(errors);

  const entries = await loadShelf(db, viewer);
  const counts: ShelfCounts = {
    all: entries.length,
    inProgress: 0,
    notStarted: 0,
    completed: 0,
    completedLessonSeconds: 0,
  };
  for (const { course, stats } of entries) {
    if (course.progress.state === 'in_progress') counts.inProgress += 1;
    else if (course.progress.state === 'completed') counts.completed += 1;
    else counts.notStarted += 1;
    counts.completedLessonSeconds += stats.completedSeconds;
  }
  let startHereCourseId: string | null = null;
  if (entries.length > 0 && counts.notStarted === entries.length) {
    const candidates = entries
      .map((entry) => entry.course)
      .filter((course) => course.action === 'start' && course.acquiredAt !== null)
      .sort((a, b) => time(b.acquiredAt) - time(a.acquiredAt) || byTitle(a, b));
    startHereCourseId = candidates[0]?.id ?? null;
  }
  const items = entries
    .map((entry) => entry.course)
    .filter((course) => filter === 'all' || course.progress.state === filter)
    .filter(
      (course) => needle === undefined || course.title.toLocaleLowerCase('pt-BR').includes(needle),
    )
    .sort(SHELF_ORDER[sort]);
  return { counts, startHereCourseId, items };
}

/** Um curso de "Continue assistindo" (`ContinueItem` do contrato). */
export interface ContinueItem {
  course: { id: string; slug: string; title: string; cover: CatalogCover | null };
  lesson: { id: string; title: string; positionSeconds: number | null };
  progress: ProgressCounts;
  lastOpenedAt: Date;
}

export const CONTINUE_WATCHING_LIMIT = 3;

/**
 * `GET /me/continue`: até 3 cursos em andamento a que o usuário tem acesso agora, do aberto mais
 * recentemente ao mais antigo, com a aula de "Continuar" e a posição gravada nela. 3 consultas.
 */
export async function listContinueWatching(
  db: Database,
  viewer: LearningViewer,
): Promise<{ items: ContinueItem[] }> {
  const courses = (await loadShelf(db, viewer))
    .map((entry) => entry.course)
    .filter(
      (course) =>
        course.action === 'continue' &&
        course.continueLessonId !== null &&
        course.lastAccessedAt !== null,
    )
    .sort(SHELF_ORDER['-lastAccessedAt'])
    .slice(0, CONTINUE_WATCHING_LIMIT);
  if (courses.length === 0) return { items: [] };
  const lessons = await sql<{ id: string; title: string; positionSeconds: number | null }>`
    SELECT l.id, l.title, lp.position_seconds
      FROM lessons l
      LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ${viewer.id}::uuid
     WHERE l.id = ANY(${courses.map((course) => course.continueLessonId)}::uuid[])`.execute(db);
  const byId = new Map(lessons.rows.map((row) => [row.id, row]));
  const items: ContinueItem[] = [];
  for (const course of courses) {
    const lesson = byId.get(course.continueLessonId as string);
    if (!lesson) continue;
    items.push({
      course: { id: course.id, slug: course.slug, title: course.title, cover: course.cover },
      lesson,
      progress: course.progress,
      lastOpenedAt: course.lastAccessedAt as Date,
    });
  }
  return { items };
}

/** Um curso de "Meu progresso" (`MyProgressCourse` do contrato). */
export interface MyProgressCourse {
  course: { id: string; slug: string; title: string };
  progress: ProgressCounts;
  modules: ProgressModule[];
}

/**
 * `GET /me/progress`: para cada curso iniciado da estante (em andamento ou concluído, inclusive
 * com acesso vencido), um quadrado por aula publicada, agrupado por módulo, e o percentual; do
 * aberto mais recentemente ao mais antigo. 3 consultas.
 */
export async function getMyProgress(
  db: Database,
  viewer: LearningViewer,
): Promise<{ items: MyProgressCourse[] }> {
  const started = (await loadShelf(db, viewer))
    .map((entry) => entry.course)
    .filter((course) => course.progress.state !== 'not_started')
    .sort(SHELF_ORDER['-lastAccessedAt']);
  const lessons = await loadLessonProgress(
    db,
    viewer.id,
    started.map((course) => course.id),
  );
  return {
    items: started.map((course) => {
      const rows = lessons.get(course.id) ?? [];
      return {
        course: { id: course.id, slug: course.slug, title: course.title },
        progress: countsOfLessons(rows),
        modules: toProgressModules(rows, true),
      };
    }),
  };
}

// Mapa de atividade.

/** Um dia com atividade (`ActivityDay` do contrato). */
export interface ActivityDay {
  /** `AAAA-MM-DD`, no fuso do usuário. */
  date: string;
  total: number;
  lessonsCompleted: number;
  forumPosts: number;
  communityActions: number;
  /** Intensidade de 1 a 4 (0 é o dia sem atividade, fora da lista). */
  level: 1 | 2 | 3 | 4;
}

export interface ActivityMap {
  /** Fuso IANA usado no cálculo dos dias. */
  timezone: string;
  from: string;
  to: string;
  days: ActivityDay[];
}

/** Semanas do mapa: 53 colunas de 7 dias, a última com a semana corrente. */
export const ACTIVITY_MAP_WEEKS = 53;

/**
 * Intensidade do quadrado pela contagem do dia (decisão da tarefa 413, faixas fixas): 1 ação,
 * 2 a 3, 4 a 5, 6 ou mais.
 */
export function activityLevel(total: number): 1 | 2 | 3 | 4 {
  if (total >= 6) return 4;
  if (total >= 4) return 3;
  if (total >= 2) return 2;
  return 1;
}

/**
 * `GET /me/activity`: os dias com atividade das últimas 53 semanas, no fuso do usuário
 * (`resolveUserTimezone`). `to` é hoje nesse fuso; `from`, o domingo de 52 semanas antes da
 * semana corrente. Só os dias com contagem vêm em `days`. 2 consultas.
 */
export async function getMyActivity(db: Database, viewer: LearningViewer): Promise<ActivityMap> {
  const timezone = await resolveUserTimezone(db, viewer.id);
  const span = (ACTIVITY_MAP_WEEKS - 1) * 7;
  const result = await sql<{
    from: string;
    to: string;
    date: string | null;
    total: number | null;
    lessonsCompleted: number | null;
    forumPosts: number | null;
    communityActions: number | null;
  }>`
    WITH bounds AS (
      SELECT t.today, t.today - extract(dow FROM t.today)::int - ${span}::int AS first_day
        FROM (SELECT (now() AT TIME ZONE ${timezone})::date AS today) t
    )
    SELECT to_char(b.first_day, 'YYYY-MM-DD') AS "from", to_char(b.today, 'YYYY-MM-DD') AS "to",
           to_char(d.day, 'YYYY-MM-DD') AS date, d.total, d.lessons_completed, d.forum_posts,
           d.community_actions
      FROM bounds b
      LEFT JOIN activity_days d
        ON d.user_id = ${isUuid(viewer.id) ? viewer.id : null}::uuid
       AND d.day BETWEEN b.first_day AND b.today AND d.total > 0
     ORDER BY d.day`.execute(db);
  const first = result.rows[0];
  if (!first) throw new Error('activity_days: a consulta do mapa não devolveu os limites');
  const days: ActivityDay[] = [];
  for (const row of result.rows) {
    if (row.date === null || row.total === null) continue;
    days.push({
      date: row.date,
      total: row.total,
      lessonsCompleted: row.lessonsCompleted ?? 0,
      forumPosts: row.forumPosts ?? 0,
      communityActions: row.communityActions ?? 0,
      level: activityLevel(row.total),
    });
  }
  return { timezone, from: first.from, to: first.to, days };
}

// Ebooks.

/** Um ebook de "Meus ebooks" (`MyEbook` do contrato), sem a URL do arquivo. */
export interface MyEbook {
  id: string;
  slug: string;
  title: string;
  cover: CatalogCover | null;
  authorName: string | null;
  pages: number | null;
  /** Fim do acesso mais longo; `null` é vitalício. */
  expiresAt: Date | null;
}

/**
 * `GET /me/ebooks`: os ebooks publicados com direito ativo (de qualquer fonte, inclusive em
 * cascata), por título, numa consulta. O download é `getEbookDownload`, do catálogo.
 */
export async function listMyEbooks(
  db: Database,
  viewer: LearningViewer,
): Promise<{ items: MyEbook[] }> {
  if (!isUuid(viewer.id)) return { items: [] };
  const result = await sql<{
    id: string;
    slug: string;
    title: string;
    coverImageId: string | null;
    authorName: string | null;
    pages: number | null;
    hasLifetime: boolean;
    activeUntil: Date | null;
  }>`
    SELECT k.id, k.slug, k.title, k.cover_image_id, k.author_name, k.pages,
           ent.has_lifetime, ent.active_until
      FROM ebooks k
      JOIN LATERAL (
        SELECT bool_or(e.expires_at IS NULL) AS has_lifetime, max(e.expires_at) AS active_until,
               count(*) AS n
          FROM entitlements e
         WHERE e.user_id = ${viewer.id}::uuid AND e.product_type = 'ebook'
           AND e.product_id = k.id AND ${ACTIVE_ENTITLEMENT}
      ) ent ON ent.n > 0
     WHERE k.status = 'published' AND k.archived_at IS NULL
     ORDER BY k.title, k.id`.execute(db);
  return {
    items: result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      cover: catalogCover(row.coverImageId),
      authorName: row.authorName,
      pages: row.pages,
      expiresAt: row.hasLifetime ? null : row.activeUntil,
    })),
  };
}
