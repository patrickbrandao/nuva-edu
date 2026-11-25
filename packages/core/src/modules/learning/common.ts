// Base do aprendizado (spec 014; tarefa 413): contagem de progresso, a regra de "continuar", o
// fuso do usuário e as duas leituras de progresso que as demais funções compõem (por aula, para
// um curso ou poucos; agregada por curso, para a estante).

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import type { CatalogViewer } from '../catalog/classroom.ts';
import { getSchoolTimezone } from '../settings/settings.ts';

/** O usuário da sessão do classroom, com o papel lido nesta requisição. */
export type LearningViewer = CatalogViewer;

export const COURSE_PROGRESS_STATES = ['not_started', 'in_progress', 'completed'] as const;
/** Estado do curso (ou do módulo) para o aluno (spec 014, "Progresso"). */
export type CourseProgressState = (typeof COURSE_PROGRESS_STATES)[number];

export const COMPLETION_VIAS = ['manual', 'video_end'] as const;
/** Como a aula foi concluída: pelo botão ou pelo fim do vídeo. */
export type CompletionVia = (typeof COMPLETION_VIAS)[number];

/** Progresso num curso ou módulo, sobre as aulas publicadas (`ProgressCounts` do contrato). */
export interface ProgressCounts {
  completedLessons: number;
  /** Aulas publicadas. */
  totalLessons: number;
  /** Inteiro de 0 a 100, arredondado para baixo: só 100 quando todas estão concluídas. */
  percent: number;
  state: CourseProgressState;
}

/**
 * A regra da tabela "Estado do curso para o aluno": concluído com 100% das aulas publicadas
 * (curso sem aula publicada nunca é concluído); em andamento com alguma aula aberta ou
 * concluída; senão, não iniciado.
 */
export function progressCounts(completed: number, total: number, opened: number): ProgressCounts {
  const completedLessons = Math.min(completed, total);
  if (total > 0 && completedLessons === total) {
    return { completedLessons, totalLessons: total, percent: 100, state: 'completed' };
  }
  return {
    completedLessons,
    totalLessons: total,
    percent: total === 0 ? 0 : Math.floor((completedLessons * 100) / total),
    state: opened > 0 || completedLessons > 0 ? 'in_progress' : 'not_started',
  };
}

/** Progresso de quem não tem o curso: nada conta (amostra sem o curso, spec 014). */
export function emptyProgress(total: number): ProgressCounts {
  return progressCounts(0, total, 0);
}

/**
 * Fuso em que os dias do usuário são contados (mapa de atividade). Até a Fase 6, que cria
 * `profiles.timezone` (spec 019), vale `school.timezone` para todos: este é o único ponto que
 * muda. Aceita transação.
 */
export function resolveUserTimezone(db: Database, _userId: string): Promise<string> {
  return getSchoolTimezone(db);
}

/**
 * "Direito ativo" da 010 em SQL, sobre o apelido `e` de `entitlements` (a mesma condição de
 * `canAccess`, com `now()` do banco). As leituras em lote daqui (estante, alunos do curso)
 * precisam dela dentro da própria consulta.
 */
export const ACTIVE_ENTITLEMENT = sql`e.revoked_at IS NULL AND e.starts_at <= now()
  AND (e.expires_at IS NULL OR e.expires_at > now())`;

/** Uma aula publicada do programa com o estado do usuário. */
export interface LessonProgressRow {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  id: string;
  title: string;
  durationSeconds: number;
  /** `null`: nunca aberta (sem linha em `lesson_progress`). */
  lastOpenedAt: Date | null;
  completedAt: Date | null;
  positionSeconds: number | null;
}

/**
 * As aulas publicadas dos cursos, na ordem do programa, com o progresso do usuário: uma
 * consulta. Para um curso ou para os cursos iniciados ("Meu progresso"); a estante usa
 * `loadCourseStats`, que agrega no banco.
 */
export async function loadLessonProgress(
  db: Database,
  userId: string,
  courseIds: readonly string[],
): Promise<Map<string, LessonProgressRow[]>> {
  const map = new Map<string, LessonProgressRow[]>(courseIds.map((id) => [id, []]));
  if (courseIds.length === 0) return map;
  const result = await sql<LessonProgressRow>`
    SELECT m.course_id, m.id AS module_id, m.title AS module_title, l.id, l.title,
           l.duration_seconds, lp.last_opened_at, lp.completed_at, lp.position_seconds
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ${userId}::uuid
     WHERE m.course_id = ANY(${[...courseIds]}::uuid[]) AND l.status = 'published'
     ORDER BY m.course_id, m.position, l.position, l.id`.execute(db);
  for (const row of result.rows) map.get(row.courseId)?.push(row);
  return map;
}

export function countsOfLessons(
  lessons: readonly Pick<LessonProgressRow, 'completedAt' | 'lastOpenedAt'>[],
): ProgressCounts {
  let completed = 0;
  let opened = 0;
  for (const lesson of lessons) {
    if (lesson.completedAt !== null) completed += 1;
    if (lesson.lastOpenedAt !== null) opened += 1;
  }
  return progressCounts(completed, lessons.length, opened);
}

/**
 * A aula do botão "Continuar" (spec 014, "Continuar de onde parou"), sobre as aulas publicadas
 * na ordem do programa: a aula atual (a de `lastOpenedAt` mais recente) se não estiver
 * concluída; se estiver, a próxima não concluída depois dela (ou, não havendo, a primeira não
 * concluída do programa); com todas concluídas, a primeira aula. Curso nunca aberto: a primeira
 * não concluída. Sem aula publicada: `null`. `loadCourseStats` aplica a mesma regra em SQL.
 */
export function continueLessonOf(
  lessons: readonly Pick<LessonProgressRow, 'id' | 'completedAt' | 'lastOpenedAt'>[],
): string | null {
  let current = -1;
  let currentAt = Number.NEGATIVE_INFINITY;
  lessons.forEach((lesson, index) => {
    const openedAt = lesson.lastOpenedAt?.getTime();
    if (openedAt !== undefined && openedAt >= currentAt) {
      current = index;
      currentAt = openedAt;
    }
  });
  const currentLesson = lessons[current];
  if (currentLesson && currentLesson.completedAt === null) return currentLesson.id;
  const next =
    lessons.find((lesson, index) => index > current && lesson.completedAt === null) ??
    lessons.find((lesson) => lesson.completedAt === null) ??
    lessons[0];
  return next?.id ?? null;
}

/** O progresso de um usuário num curso, agregado no banco. */
export interface CourseStats {
  /** Aulas publicadas. */
  total: number;
  completed: number;
  opened: number;
  /** Soma da duração das aulas publicadas concluídas. */
  completedSeconds: number;
  lastOpenedAt: Date | null;
  lastCompletedAt: Date | null;
  /** A aula de "Continuar", pela regra de `continueLessonOf`. */
  continueLessonId: string | null;
}

const NO_STATS: CourseStats = {
  total: 0,
  completed: 0,
  opened: 0,
  completedSeconds: 0,
  lastOpenedAt: null,
  lastCompletedAt: null,
  continueLessonId: null,
};

/**
 * Totais, conclusão, última abertura e aula de "Continuar" de vários cursos para um usuário,
 * numa consulta que devolve uma linha por curso (a estante de 200 cursos não traz as aulas).
 * Curso sem aula publicada vem zerado.
 */
export async function loadCourseStats(
  db: Database,
  userId: string,
  courseIds: readonly string[],
): Promise<Map<string, CourseStats>> {
  const map = new Map<string, CourseStats>(courseIds.map((id) => [id, NO_STATS]));
  if (courseIds.length === 0) return map;
  const result = await sql<CourseStats & { courseId: string }>`
    WITH seq AS (
      SELECT m.course_id, l.id, l.duration_seconds,
             row_number() OVER (PARTITION BY m.course_id
                                    ORDER BY m.position, l.position, l.id) AS n,
             lp.completed_at, lp.last_opened_at
        FROM lessons l
        JOIN modules m ON m.id = l.module_id
        LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ${userId}::uuid
       WHERE m.course_id = ANY(${[...courseIds]}::uuid[]) AND l.status = 'published'
    ), cur AS (
      SELECT DISTINCT ON (course_id) course_id, n
        FROM seq
       WHERE last_opened_at IS NOT NULL
       ORDER BY course_id, last_opened_at DESC, n DESC
    )
    SELECT s.course_id,
           count(*)::int AS total,
           count(s.completed_at)::int AS completed,
           count(s.last_opened_at)::int AS opened,
           COALESCE(sum(s.duration_seconds) FILTER (WHERE s.completed_at IS NOT NULL), 0)::int
             AS completed_seconds,
           max(s.last_opened_at) AS last_opened_at,
           max(s.completed_at) AS last_completed_at,
           COALESCE(
             (array_agg(s.id ORDER BY s.n)
                FILTER (WHERE s.n = cur.n AND s.completed_at IS NULL))[1],
             (array_agg(s.id ORDER BY s.n)
                FILTER (WHERE s.completed_at IS NULL AND s.n > COALESCE(cur.n, 0)))[1],
             (array_agg(s.id ORDER BY s.n) FILTER (WHERE s.completed_at IS NULL))[1],
             (array_agg(s.id ORDER BY s.n))[1]
           ) AS continue_lesson_id
      FROM seq s
      LEFT JOIN cur ON cur.course_id = s.course_id
     GROUP BY s.course_id`.execute(db);
  for (const { courseId, ...stats } of result.rows) map.set(courseId, stats);
  return map;
}

export function countsOfStats(stats: CourseStats): ProgressCounts {
  return progressCounts(stats.completed, stats.total, stats.opened);
}

/** O instante mais recente entre abrir e concluir uma aula do curso. */
export function lastActivityOf(stats: CourseStats): Date | null {
  const { lastOpenedAt, lastCompletedAt } = stats;
  if (lastOpenedAt === null) return lastCompletedAt;
  if (lastCompletedAt === null) return lastOpenedAt;
  return new Date(Math.max(lastOpenedAt.getTime(), lastCompletedAt.getTime()));
}

/** Progresso por módulo e aula (`ProgressModule` do contrato). */
export interface ProgressModule {
  id: string;
  title: string;
  progress: ProgressCounts;
  lessons: { id: string; title: string; completedAt: Date | null }[];
}

/**
 * Agrupa as aulas de um curso por módulo, com o progresso de cada um. Com `counts = false`
 * (quem não tem o curso), nenhuma aula aparece concluída.
 */
export function toProgressModules(
  lessons: readonly LessonProgressRow[],
  counts: boolean,
): ProgressModule[] {
  const groups: { id: string; title: string; rows: LessonProgressRow[] }[] = [];
  for (const lesson of lessons) {
    let group = groups.at(-1);
    if (!group || group.id !== lesson.moduleId) {
      group = { id: lesson.moduleId, title: lesson.moduleTitle, rows: [] };
      groups.push(group);
    }
    group.rows.push(lesson);
  }
  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    progress: counts ? countsOfLessons(group.rows) : emptyProgress(group.rows.length),
    lessons: group.rows.map((row) => ({
      id: row.id,
      title: row.title,
      completedAt: counts ? row.completedAt : null,
    })),
  }));
}
