// Leituras de progresso para a equipe (spec 014; tarefa 413): progresso de um usuário, resumo
// do curso por faixa e alunos do curso. Todas exigem `progress.view`; o instrutor só alcança os
// próprios cursos (spec 008), e fora do alcance a resposta é `404`.

import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  type FieldError,
  notFound,
  permissionDenied,
  validationFailed,
} from '../../errors/domain-error.ts';
import {
  loadTarget,
  type ManagementRequest,
  managementAuditContext,
} from '../accounts/management/common.ts';
import { avatarUrlFor } from '../accounts/session-view.ts';
import { recordDenied } from '../audit/record.ts';
import { isCatalogId } from '../catalog/fields.ts';
import { type CatalogPage, readCatalogPageParams, sqlAnd } from '../catalog/read-common.ts';
import { type PermissionScope, permissionScope } from '../permissions/matrix.ts';
import {
  ACTIVE_ENTITLEMENT,
  COURSE_PROGRESS_STATES,
  type CourseProgressState,
  type CourseStats,
  countsOfStats,
  lastActivityOf,
  loadCourseStats,
  type ProgressCounts,
  progressCounts,
} from './common.ts';

/** Quem pede: a sessão do site admin ou, na Fase 5, uma chave MCP. */
export type LearningRequest = ManagementRequest;

/**
 * Exige `progress.view` e devolve o alcance (`own`: o instrutor). Sem a ação no papel: `403`
 * `permission_denied`, com a recusa gravada na auditoria.
 */
async function requireProgressView(
  db: Database,
  request: LearningRequest,
): Promise<PermissionScope> {
  const scope = permissionScope(request.actor, 'progress.view');
  if (scope !== null) return scope;
  await recordDenied(db, {
    context: managementAuditContext(request),
    permission: 'progress.view',
    targetType: null,
    targetId: null,
  });
  throw permissionDenied();
}

/** O progresso de um usuário num curso (`UserCourseProgress` do contrato, menos `certificate`). */
export interface UserCourseProgress {
  course: { type: 'course'; id: string; title: string };
  progress: ProgressCounts;
  /** Abertura ou conclusão de aula mais recente. */
  lastActivityAt: Date | null;
}

/**
 * `GET /users/{id}/progress`: um item por curso que o usuário iniciou ou a que tem acesso por
 * direito ativo, por título; cursos em qualquer estado de publicação. Só entram cursos que o
 * usuário tem ou já teve (direito não revogado, curso `open`, ou equipe com alcance): aula
 * amostra de curso que ele não tem não conta. O instrutor vê só os próprios cursos; usuário sem
 * nenhum deles, inexistente ou excluído: `404`. 3 consultas. O certificado de cada curso vem do
 * módulo de certificados.
 */
export async function getUserProgress(
  db: Database,
  request: LearningRequest,
  userId: string,
): Promise<{ items: UserCourseProgress[] }> {
  const scope = await requireProgressView(db, request);
  const target = await loadTarget(db, userId);
  const staff = target.role === 'admin' || target.role === 'manager';
  const instructor = target.role === 'instructor';
  const conditions: RawBuilder<unknown>[] = [
    sql`(ent.has_active OR prog.started)`,
    sql`(ent.has_any OR c.access_mode = 'open' OR ${staff}::boolean
         OR (${instructor}::boolean AND c.owner_id = ${target.id}::uuid))`,
  ];
  if (scope === 'own') conditions.push(sql`c.owner_id = ${request.actor.id}::uuid`);
  const courses = await sql<{ id: string; title: string }>`
    SELECT c.id, c.title
      FROM courses c
      LEFT JOIN LATERAL (
        SELECT bool_or(${ACTIVE_ENTITLEMENT}) AS has_active, count(*) > 0 AS has_any
          FROM entitlements e
         WHERE e.user_id = ${target.id}::uuid AND e.product_type = 'course'
           AND e.product_id = c.id AND e.revoked_at IS NULL AND e.starts_at <= now()
      ) ent ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS (SELECT 1 FROM lesson_progress lp
                        WHERE lp.user_id = ${target.id}::uuid AND lp.course_id = c.id) AS started
      ) prog ON true
     WHERE ${sqlAnd(conditions)}
     ORDER BY c.title, c.id`.execute(db);
  if (scope === 'own' && courses.rows.length === 0) throw notFound('Usuário não encontrado.');
  const stats = await loadCourseStats(
    db,
    target.id,
    courses.rows.map((row) => row.id),
  );
  return {
    items: courses.rows.map((row) => {
      const courseStats = stats.get(row.id) as CourseStats;
      return {
        course: { type: 'course' as const, id: row.id, title: row.title },
        progress: countsOfStats(courseStats),
        lastActivityAt: lastActivityOf(courseStats),
      };
    }),
  };
}

interface ProgressCourse {
  id: string;
  open: boolean;
  /** Aulas publicadas. */
  total: number;
}

/** O curso que quem pede alcança com `progress.view`; fora do alcance ou inexistente: `404`. */
async function loadProgressCourse(
  db: Database,
  request: LearningRequest,
  courseId: unknown,
): Promise<ProgressCourse> {
  const scope = await requireProgressView(db, request);
  if (!isCatalogId(courseId)) throw notFound('Curso não encontrado.');
  const result = await sql<{ id: string; accessMode: string; total: number }>`
    SELECT c.id, c.access_mode,
           (SELECT count(*)::int FROM lessons l JOIN modules m ON m.id = l.module_id
             WHERE m.course_id = c.id AND l.status = 'published') AS total
      FROM courses c
     WHERE c.id = ${courseId.toLowerCase()}::uuid
       AND (${scope !== 'own'}::boolean OR c.owner_id = ${request.actor.id}::uuid)`.execute(db);
  const row = result.rows[0];
  if (!row) throw notFound('Curso não encontrado.');
  return { id: row.id, open: row.accessMode === 'open', total: row.total };
}

/**
 * Os alunos do curso com o progresso de cada um, como CTE `st`: quem tem direito ativo ao curso
 * e, em curso `open` (que não gera direito), quem abriu alguma aula; contas excluídas ficam de
 * fora. O progresso conta só aulas publicadas.
 */
function studentsCte(course: ProgressCourse): RawBuilder<unknown> {
  return sql`
    pop AS (
      SELECT x.user_id, bool_or(x.lifetime) AS lifetime, max(x.until) AS until
        FROM (
          SELECT e.user_id, (e.expires_at IS NULL) AS lifetime, e.expires_at AS until
            FROM entitlements e
           WHERE e.product_type = 'course' AND e.product_id = ${course.id}::uuid
             AND ${ACTIVE_ENTITLEMENT}
          UNION ALL
          SELECT lp.user_id, true, NULL::timestamptz
            FROM lesson_progress lp
           WHERE ${course.open}::boolean AND lp.course_id = ${course.id}::uuid
        ) x
       GROUP BY x.user_id
    ), agg AS (
      SELECT lp.user_id, count(lp.completed_at)::int AS completed, count(*)::int AS opened,
             GREATEST(max(lp.last_opened_at), max(lp.completed_at)) AS last_activity_at
        FROM lesson_progress lp
        JOIN lessons l ON l.id = lp.lesson_id AND l.status = 'published'
       WHERE lp.course_id = ${course.id}::uuid
       GROUP BY lp.user_id
    ), st AS (
      SELECT u.id, u.name, pr.avatar_image_id, pop.lifetime, pop.until,
             LEAST(COALESCE(agg.completed, 0), ${course.total}::int) AS completed,
             COALESCE(agg.opened, 0) AS opened, agg.last_activity_at
        FROM pop
        JOIN users u ON u.id = pop.user_id AND u.deleted_at IS NULL
        LEFT JOIN profiles pr ON pr.user_id = u.id
        LEFT JOIN agg ON agg.user_id = pop.user_id
    )`;
}

/** Resumo de progresso de um curso (`CourseProgressSummary` do contrato). */
export interface CourseProgressSummary {
  courseId: string;
  totalLessons: number;
  /** Alunos com acesso ao curso. */
  studentCount: number;
  buckets: {
    notStarted: number;
    upTo25: number;
    upTo50: number;
    upTo75: number;
    upTo99: number;
    completed: number;
  };
  /** Concluídos ÷ alunos com acesso; 0 sem alunos. */
  completionRate: number;
}

/**
 * `GET /courses/{id}/progress-summary`: alunos com acesso por faixa de progresso e a taxa de
 * conclusão, em 2 consultas. As faixas somam `studentCount` e seguem as aulas concluídas:
 * nenhuma, `notStarted`; todas as publicadas, `completed`; no meio, pelo percentual arredondado
 * para baixo (até 25, 50, 75 e 99; quem concluiu alguma e ainda está em 0% fica em `upTo25`).
 * Curso sem aula publicada: todos em `notStarted`. Curso alheio ao instrutor: `404`.
 */
export async function getCourseProgressSummary(
  db: Database,
  request: LearningRequest,
  courseId: unknown,
): Promise<CourseProgressSummary> {
  const course = await loadProgressCourse(db, request, courseId);
  const total = sql`${course.total}::int`;
  const done = sql`(${total} > 0 AND st.completed >= ${total})`;
  const percent = sql`(st.completed * 100 / GREATEST(${total}, 1))`;
  const middle = sql`st.completed > 0 AND NOT ${done}`;
  const result = await sql<CourseProgressSummary['buckets'] & { studentCount: number }>`
    WITH ${studentsCte(course)}
    SELECT count(*)::int AS student_count,
           count(*) FILTER (WHERE st.completed = 0)::int AS not_started,
           count(*) FILTER (WHERE ${middle} AND ${percent} <= 25)::int AS up_to25,
           count(*) FILTER (WHERE ${middle} AND ${percent} > 25 AND ${percent} <= 50)::int
             AS up_to50,
           count(*) FILTER (WHERE ${middle} AND ${percent} > 50 AND ${percent} <= 75)::int
             AS up_to75,
           count(*) FILTER (WHERE ${middle} AND ${percent} > 75)::int AS up_to99,
           count(*) FILTER (WHERE st.completed > 0 AND ${done})::int AS completed
      FROM st`.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error('progress-summary: a consulta não devolveu a linha de totais');
  const { studentCount, ...buckets } = row;
  return {
    courseId: course.id,
    totalLessons: course.total,
    studentCount,
    buckets,
    completionRate:
      studentCount === 0 ? 0 : Math.round((buckets.completed / studentCount) * 10_000) / 10_000,
  };
}

export const COURSE_STUDENT_SORTS = ['name', '-lastActivityAt', '-percent'] as const;
export type CourseStudentSort = (typeof COURSE_STUDENT_SORTS)[number];

/** Um aluno do curso (`CourseStudent` do contrato): nome e avatar, sem e-mail nem compras. */
export interface CourseStudent {
  user: { id: string; name: string; avatarUrl: string | null };
  progress: ProgressCounts;
  lastActivityAt: Date | null;
  /** Fim do acesso mais longo; `null` vitalício ou curso `open`. */
  accessExpiresAt: Date | null;
}

export interface CourseStudentsQuery {
  /** Trecho do nome. */
  q?: unknown;
  state?: unknown;
  sort?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

const STUDENTS_SCOPE = 'course-students';

const STUDENT_ORDER: Record<CourseStudentSort, RawBuilder<unknown>> = {
  name: sql`lower(st.name), st.id`,
  '-lastActivityAt': sql`st.last_activity_at DESC NULLS LAST, st.id`,
  '-percent': sql`st.completed DESC, st.id`,
};

function encodeOffset(sort: string, offset: number): string {
  return Buffer.from(`${STUDENTS_SCOPE}:${sort}:${offset}`, 'utf8').toString('base64url');
}

function decodeOffset(cursor: unknown, sort: string): number | undefined {
  if (typeof cursor !== 'string') return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const prefix = `${STUDENTS_SCOPE}:${sort}:`;
  if (!text.startsWith(prefix)) return undefined;
  const rest = text.slice(prefix.length);
  if (!/^[1-9]\d{0,8}$/.test(rest)) return undefined;
  return Number(rest);
}

/**
 * `GET /courses/{id}/students`: os alunos com acesso ao curso (a mesma população do resumo),
 * com nome, avatar, progresso, última atividade e fim do acesso; busca por trecho do nome,
 * filtro por estado e ordem por nome, última atividade (padrão) ou progresso. Paginada por
 * cursor opaco, que guarda a posição na ordem pedida (as três ordens são sobre valor calculado).
 * 2 consultas. Parâmetro fora do formato: `400`; curso alheio ao instrutor: `404`.
 */
export async function listCourseStudents(
  db: Database,
  request: LearningRequest,
  courseId: unknown,
  query: CourseStudentsQuery = {},
): Promise<CatalogPage<CourseStudent>> {
  const course = await loadProgressCourse(db, request, courseId);
  const errors: FieldError[] = [];
  const state = query.state as CourseProgressState | undefined;
  if (state !== undefined && !COURSE_PROGRESS_STATES.includes(state)) {
    errors.push({ path: 'query.state', message: 'Estado desconhecido.' });
  }
  const params = readCatalogPageParams(
    { q: query.q, sort: query.sort, limit: query.limit },
    STUDENTS_SCOPE,
    COURSE_STUDENT_SORTS,
    '-lastActivityAt',
    errors,
  );
  let offset = 0;
  if (query.cursor !== undefined) {
    const decoded = decodeOffset(query.cursor, params.sort);
    if (decoded === undefined) {
      throw validationFailed([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
    }
    offset = decoded;
  }
  const total = sql`${course.total}::int`;
  const done = sql`(${total} > 0 AND st.completed >= ${total})`;
  const conditions: RawBuilder<unknown>[] = [];
  if (params.pattern !== undefined) conditions.push(sql`st.name ILIKE ${params.pattern}`);
  if (state === 'completed') conditions.push(done);
  if (state === 'not_started') conditions.push(sql`st.opened = 0 AND st.completed = 0`);
  if (state === 'in_progress') {
    conditions.push(sql`(st.opened > 0 OR st.completed > 0) AND NOT ${done}`);
  }
  const result = await sql<{
    id: string;
    name: string;
    avatarImageId: string | null;
    lifetime: boolean;
    until: Date | null;
    completed: number;
    opened: number;
    lastActivityAt: Date | null;
  }>`
    WITH ${studentsCte(course)}
    SELECT st.id, st.name, st.avatar_image_id, st.lifetime, st.until, st.completed, st.opened,
           st.last_activity_at
      FROM st
     WHERE ${sqlAnd(conditions)}
     ORDER BY ${STUDENT_ORDER[params.sort]}
     LIMIT ${params.limit + 1} OFFSET ${offset}`.execute(db);
  const page = result.rows.slice(0, params.limit);
  return {
    items: page.map((row) => ({
      user: { id: row.id, name: row.name, avatarUrl: avatarUrlFor(row.avatarImageId) },
      progress: progressCounts(row.completed, course.total, row.opened),
      lastActivityAt: row.lastActivityAt,
      accessExpiresAt: row.lifetime ? null : row.until,
    })),
    nextCursor:
      result.rows.length > params.limit ? encodeOffset(params.sort, offset + params.limit) : null,
  };
}
