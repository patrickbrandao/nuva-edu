// Aula e curso para o aluno (spec 014; tarefa 413; dono da escrita: classroom-api): abrir a
// aula, gravar posição e conclusão, e o progresso por módulo e aula. A decisão de acesso é
// sempre a do módulo de direitos (`canAccess`, spec 010).

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  type FieldError,
  notFound,
  validationFailed,
} from '../../errors/domain-error.ts';
import {
  type CatalogCourseView,
  type CatalogCourseViewLesson,
  type CatalogCourseViewModule,
  type CatalogLessonContent,
  getCourseView,
  getLessonContent,
} from '../catalog/classroom.ts';
import { CATALOG_LIMITS, isCatalogId } from '../catalog/fields.ts';
import { contentAccessDenied } from '../catalog/read-common.ts';
import { canAccess } from '../entitlements/access.ts';
import { enqueue } from '../jobs/queue.ts';
import {
  COMPLETION_VIAS,
  type CompletionVia,
  continueLessonOf,
  countsOfLessons,
  emptyProgress,
  type LearningViewer,
  loadLessonProgress,
  type ProgressCounts,
  type ProgressModule,
  progressCounts,
  resolveUserTimezone,
  toProgressModules,
} from './common.ts';

/** Folga da posição do vídeo além da duração informada pelo autor (spec 014, "Casos de erro"). */
export const POSITION_SLACK_SECONDS = 60;

/** O estado do usuário numa aula (`LessonUserState` do contrato). */
export interface LessonUserState {
  completedAt: Date | null;
  completedVia: CompletionVia | null;
  /** `null`: aula nunca aberta nem gravada. */
  positionSeconds: number | null;
  lastOpenedAt: Date | null;
}

interface UserStateRow {
  completedAt: Date | null;
  completedVia: string | null;
  positionSeconds: number;
  lastOpenedAt: Date;
}

function toUserState(row: UserStateRow): LessonUserState {
  return {
    completedAt: row.completedAt,
    completedVia: row.completedVia as CompletionVia | null,
    positionSeconds: row.positionSeconds,
    lastOpenedAt: row.lastOpenedAt,
  };
}

/** `unique_key` de `course.completed` (spec 014, "Progresso"). */
export function courseCompletedKey(userId: string, courseId: string): string {
  return `course.completed:${userId}:${courseId}`;
}

// Aula.

/** A aula com o estado do usuário (`LessonView` do contrato). */
export interface LessonView extends Omit<CatalogLessonContent, 'access'> {
  userState: LessonUserState;
}

/**
 * `GET /lessons/{id}`: o conteúdo da aula (`getLessonContent`, com os mesmos `404` e `403`
 * `access_denied`) e o estado do usuário. Grava a abertura: cria a linha de progresso ou
 * atualiza `last_opened_at` ("Continuar de onde parou"). Uma consulta além das do catálogo.
 */
export async function getLessonView(
  db: Database,
  viewer: LearningViewer,
  lessonId: unknown,
): Promise<LessonView> {
  const { access: _access, ...content } = await getLessonContent(db, viewer, lessonId);
  const result = await sql<UserStateRow>`
    INSERT INTO lesson_progress (user_id, lesson_id, course_id)
    VALUES (${viewer.id}::uuid, ${content.id}::uuid, ${content.course.id}::uuid)
    ON CONFLICT (user_id, lesson_id) DO UPDATE SET last_opened_at = now()
    RETURNING completed_at, completed_via, position_seconds, last_opened_at`.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error('lesson_progress: a abertura não devolveu a linha');
  return { ...content, userState: toUserState(row) };
}

export interface SaveLessonProgressInput {
  /** `true` conclui (idempotente); `false` desmarca. */
  completed?: unknown;
  /** Obrigatório com `completed: true`; ignorado nos demais. */
  completedVia?: unknown;
  /** Posição do vídeo, em segundos; `null` zera. */
  positionSeconds?: unknown;
}

/** O estado gravado e o progresso recalculado (`LessonProgressResult` do contrato). */
export interface LessonProgressResult {
  lessonId: string;
  userState: LessonUserState;
  module: { id: string; progress: ProgressCounts };
  course: { id: string; progress: ProgressCounts };
  /** Falso em aula amostra de curso que o aluno não tem: não entra no progresso. */
  countsForCourse: boolean;
  /** A gravação levou o curso de menos de 100% a 100% e `course.completed` foi enfileirada. */
  courseCompleted: boolean;
}

interface ParsedProgress {
  completed: boolean | undefined;
  completedVia: CompletionVia | undefined;
  positionSeconds: number | undefined;
}

function parseProgress(input: SaveLessonProgressInput): ParsedProgress {
  const errors: FieldError[] = [];
  const { completed, completedVia, positionSeconds } = input;
  if (completed !== undefined && typeof completed !== 'boolean') {
    errors.push({ path: 'body.completed', message: 'Use true ou false.' });
  }
  let via: CompletionVia | undefined;
  if (completed === true) {
    if ((COMPLETION_VIAS as readonly unknown[]).includes(completedVia)) {
      via = completedVia as CompletionVia;
    } else {
      errors.push({ path: 'body.completedVia', message: 'Use manual ou video_end.' });
    }
  }
  let position: number | undefined;
  if (positionSeconds === null) {
    position = 0;
  } else if (positionSeconds !== undefined) {
    if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) {
      errors.push({ path: 'body.positionSeconds', message: 'Informe um número de segundos.' });
    } else {
      position = positionSeconds;
    }
  }
  if (completed === undefined && positionSeconds === undefined && errors.length === 0) {
    errors.push({ path: 'body', message: 'Envie completed ou positionSeconds.' });
  }
  if (errors.length > 0) throw validationFailed(errors);
  return {
    completed: completed as boolean | undefined,
    completedVia: via,
    positionSeconds: position,
  };
}

/**
 * `PUT /lessons/{id}/progress`: grava só os campos enviados.
 *
 * - Aula ou curso despublicado, arquivado ou inexistente: `404`. Sem acesso à aula agora: `403`
 *   `access_denied` com `reason`. Corpo fora do formato: `400` `validation_failed`.
 * - `positionSeconds` negativo ou acima da duração + 60 s: `422` `position_out_of_range`. Aula
 *   sem duração informada (0) aceita até o teto de duração do catálogo + 60 s. A fração é
 *   descartada (a coluna é inteira).
 * - Concluir é idempotente: aula já concluída mantém `completedAt` e `completedVia`.
 * - A passagem de menos de 100% a 100% do curso, causada por esta gravação, enfileira
 *   `course.completed` na mesma transação, com a `unique_key` da 014. Não enfileira para aula
 *   amostra de curso que o aluno não tem (`countsForCourse = false`).
 * - Concluir soma 1 a `activity_days` no dia de hoje no fuso do usuário; desmarcar tira 1 do dia
 *   em que a aula foi concluída (o "Desfazer" não deixa atividade).
 *
 * As gravações de um usuário num curso são serializadas por trava consultiva: duas conclusões
 * simultâneas das duas últimas aulas enfileiram `course.completed` uma vez, não zero.
 */
export async function saveLessonProgress(
  db: Database,
  viewer: LearningViewer,
  lessonId: unknown,
  input: SaveLessonProgressInput,
): Promise<LessonProgressResult> {
  const parsed = parseProgress(input);
  if (!isCatalogId(lessonId) || !isCatalogId(viewer.id)) throw notFound('Aula não encontrada.');
  const id = lessonId.toLowerCase();
  const userId = viewer.id.toLowerCase();
  const lesson = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .innerJoin('courses', 'courses.id', 'modules.courseId')
    .select([
      'lessons.durationSeconds',
      'lessons.moduleId as moduleId',
      'modules.courseId as courseId',
    ])
    .where('lessons.id', '=', id)
    .where('lessons.status', '=', 'published')
    .where('courses.status', '=', 'published')
    .where('courses.archivedAt', 'is', null)
    .executeTakeFirst();
  if (!lesson) throw notFound('Aula não encontrada.');
  const decision = await canAccess(db, viewer, { type: 'lesson', id });
  if (!decision.allowed) throw contentAccessDenied(decision.reason);

  if (parsed.positionSeconds !== undefined) {
    const ceiling =
      lesson.durationSeconds > 0 ? lesson.durationSeconds : CATALOG_LIMITS.lessonDurationMaxSeconds;
    if (parsed.positionSeconds < 0 || parsed.positionSeconds > ceiling + POSITION_SLACK_SECONDS) {
      throw businessRule(
        'position_out_of_range',
        'A posição do vídeo está fora da duração da aula.',
      );
    }
  }
  const position =
    parsed.positionSeconds === undefined ? undefined : Math.floor(parsed.positionSeconds);

  // `basis = sample` também sai para quem tem o curso (a amostra é avaliada antes do direito).
  let hasCourseNow = true;
  let countsForCourse = true;
  if (decision.basis === 'sample') {
    const course = await canAccess(db, viewer, { type: 'course', id: lesson.courseId });
    hasCourseNow = course.allowed;
    // Acesso vencido: o progresso de quem já teve o curso fica preservado e continua contando.
    countsForCourse = course.allowed || course.reason === 'expired';
  }

  return db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`lesson_progress:${userId}:${lesson.courseId}`}, 0))`.execute(trx);
    const before = await trx
      .selectFrom('lessonProgress')
      .select(['completedAt', 'completedVia', 'positionSeconds', 'lastOpenedAt'])
      .where('userId', '=', userId)
      .where('lessonId', '=', id)
      .forUpdate()
      .executeTakeFirst();
    const wasCompleted = before != null && before.completedAt !== null;
    const completing = parsed.completed === true && !wasCompleted;
    const uncompleting = parsed.completed === false && wasCompleted;

    let state: UserStateRow;
    if (before && !completing && !uncompleting && position === undefined) {
      state = before;
    } else {
      const completedAt = completing
        ? sql`now()`
        : uncompleting
          ? sql`NULL`
          : sql`lesson_progress.completed_at`;
      const completedVia = completing
        ? sql`${parsed.completedVia ?? null}`
        : uncompleting
          ? sql`NULL`
          : sql`lesson_progress.completed_via`;
      const result = await sql<UserStateRow>`
        INSERT INTO lesson_progress
               (user_id, lesson_id, course_id, position_seconds, completed_at, completed_via)
        VALUES (${userId}::uuid, ${id}::uuid, ${lesson.courseId}::uuid, ${position ?? 0},
                ${completing ? sql`now()` : sql`NULL`},
                ${completing ? (parsed.completedVia ?? null) : null})
        ON CONFLICT (user_id, lesson_id) DO UPDATE SET
          position_seconds = ${position === undefined ? sql`lesson_progress.position_seconds` : sql`${position}`},
          completed_at = ${completedAt},
          completed_via = ${completedVia}
        RETURNING completed_at, completed_via, position_seconds, last_opened_at`.execute(trx);
      const row = result.rows[0];
      if (!row) throw new Error('lesson_progress: a gravação não devolveu a linha');
      state = row;
    }

    if (completing || uncompleting) {
      const timezone = await resolveUserTimezone(trx, userId);
      if (completing) {
        await sql`
          INSERT INTO activity_days (user_id, day, lessons_completed)
          VALUES (${userId}::uuid, (now() AT TIME ZONE ${timezone})::date, 1)
          ON CONFLICT (user_id, day) DO UPDATE
            SET lessons_completed = activity_days.lessons_completed + 1`.execute(trx);
      } else if (before?.completedAt) {
        await sql`
          UPDATE activity_days SET lessons_completed = lessons_completed - 1
           WHERE user_id = ${userId}::uuid AND lessons_completed > 0
             AND day = (${before.completedAt}::timestamptz AT TIME ZONE ${timezone})::date`.execute(
          trx,
        );
      }
    }

    const modules = await sql<{
      moduleId: string;
      total: number;
      completed: number;
      opened: number;
    }>`
      SELECT m.id AS module_id, count(*)::int AS total,
             count(lp.completed_at)::int AS completed, count(lp.lesson_id)::int AS opened
        FROM lessons l
        JOIN modules m ON m.id = l.module_id
        LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ${userId}::uuid
       WHERE m.course_id = ${lesson.courseId}::uuid AND l.status = 'published'
       GROUP BY m.id`.execute(trx);
    let total = 0;
    let completed = 0;
    let opened = 0;
    let moduleProgress = emptyProgress(0);
    for (const row of modules.rows) {
      total += row.total;
      completed += row.completed;
      opened += row.opened;
      if (row.moduleId === lesson.moduleId) {
        moduleProgress = countsForCourse
          ? progressCounts(row.completed, row.total, row.opened)
          : emptyProgress(row.total);
      }
    }

    let courseCompleted = false;
    if (completing && hasCourseNow && total > 0 && completed >= total) {
      await enqueue(
        trx,
        'course.completed',
        { userId, courseId: lesson.courseId },
        { uniqueKey: courseCompletedKey(userId, lesson.courseId) },
      );
      courseCompleted = true;
    }

    return {
      lessonId: id,
      userState: toUserState(state),
      module: { id: lesson.moduleId, progress: moduleProgress },
      course: {
        id: lesson.courseId,
        progress: countsForCourse ? progressCounts(completed, total, opened) : emptyProgress(total),
      },
      countsForCourse,
      courseCompleted,
    };
  });
}

// Curso.

export interface LearningCourseViewLesson extends CatalogCourseViewLesson {
  completed: boolean;
}

export interface LearningCourseViewModule extends Omit<CatalogCourseViewModule, 'lessons'> {
  progress: ProgressCounts;
  lessons: LearningCourseViewLesson[];
}

/**
 * O curso com o estado do usuário (`CourseView` do contrato, menos `certificate`, que vem do
 * módulo de certificados; `certificateEnabled` fica para ele decidir).
 */
export interface LearningCourseView extends Omit<CatalogCourseView, 'modules'> {
  progress: ProgressCounts;
  /** Aula do botão "Continuar"; `null` sem acesso ou sem aula publicada. */
  continueLessonId: string | null;
  modules: LearningCourseViewModule[];
}

/**
 * `GET /courses/{slug}`: `getCourseView` do catálogo (mesmos `404`) com o progresso por módulo e
 * aula e a aula de "Continuar": uma consulta a mais. Quem não tem nem teve o curso vê tudo
 * zerado, mesmo com aula amostra concluída; acesso vencido mantém o progresso, sem "Continuar".
 */
export async function getCourseLearningView(
  db: Database,
  viewer: LearningViewer,
  slug: unknown,
): Promise<LearningCourseView> {
  const view = await getCourseView(db, viewer, slug);
  const counts = view.access.allowed || view.access.reason === 'expired';
  const rows = counts
    ? await db
        .selectFrom('lessonProgress')
        .select(['lessonId', 'completedAt', 'lastOpenedAt'])
        .where('userId', '=', viewer.id)
        .where('courseId', '=', view.id)
        .execute()
    : [];
  const byLesson = new Map(rows.map((row) => [row.lessonId, row]));
  const flat: { id: string; completedAt: Date | null; lastOpenedAt: Date | null }[] = [];
  const modules = view.modules.map((module) => {
    const lessons = module.lessons.map((lesson) => {
      const row = byLesson.get(lesson.id);
      const state = {
        id: lesson.id,
        completedAt: row?.completedAt ?? null,
        lastOpenedAt: row?.lastOpenedAt ?? null,
      };
      flat.push(state);
      return { state, lesson: { ...lesson, completed: state.completedAt !== null } };
    });
    return {
      ...module,
      progress: countsOfLessons(lessons.map((item) => item.state)),
      lessons: lessons.map((item) => item.lesson),
    };
  });
  return {
    ...view,
    progress: countsOfLessons(flat),
    continueLessonId: view.access.allowed ? continueLessonOf(flat) : null,
    modules,
  };
}

/** Progresso por módulo e aula num curso (`CourseProgress` do contrato). */
export interface CourseProgress {
  courseId: string;
  progress: ProgressCounts;
  modules: ProgressModule[];
}

/**
 * `GET /courses/{slug}/progress`: progresso por módulo e aula, sobre as aulas publicadas, em 3
 * consultas. Curso em rascunho, arquivado, inexistente ou `private` sem acesso: `404`. Quem não
 * tem nem teve o curso recebe o programa com tudo zerado.
 */
export async function getCourseProgress(
  db: Database,
  viewer: LearningViewer,
  slug: unknown,
): Promise<CourseProgress> {
  if (typeof slug !== 'string') throw notFound('Curso não encontrado.');
  const course = await db
    .selectFrom('courses')
    .select(['id', 'accessMode'])
    .where('slug', '=', slug)
    .where('status', '=', 'published')
    .where('archivedAt', 'is', null)
    .executeTakeFirst();
  if (!course) throw notFound('Curso não encontrado.');
  const decision = await canAccess(db, viewer, { type: 'course', id: course.id });
  if (course.accessMode === 'private' && !decision.allowed) {
    throw notFound('Curso não encontrado.');
  }
  const counts = decision.allowed || decision.reason === 'expired';
  const lessons = (await loadLessonProgress(db, viewer.id, [course.id])).get(course.id) ?? [];
  return {
    courseId: course.id,
    progress: counts ? countsOfLessons(lessons) : emptyProgress(lessons.length),
    modules: toProgressModules(lessons, counts),
  };
}
