// Conclusão do curso (spec 014, "Progresso"; tarefa 413): o fato "o aluno concluiu o curso",
// para a emissão do certificado (015), e a conferência disparada quando uma aula é despublicada
// ou excluída (`course.completion_check`, spec 005).

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { isUuid } from '../entitlements/types.ts';
import { JOB_DEFINITIONS } from '../jobs/registry.ts';
import { ACTIVE_ENTITLEMENT } from './common.ts';
import { courseCompletedKey } from './lessons.ts';

/** A conclusão de um curso por um usuário, sobre as aulas publicadas agora. */
export interface CourseCompletion {
  userId: string;
  courseId: string;
  /** Aulas publicadas. */
  totalLessons: number;
  completedLessons: number;
  /** 100% das aulas publicadas concluídas (curso sem aula publicada nunca é concluído). */
  completed: boolean;
  /** Conclusão da última aula; `null` enquanto o curso não está concluído. */
  completedAt: Date | null;
  /** Soma da duração das aulas publicadas (base da carga horária do certificado). */
  durationSeconds: number;
}

/**
 * O usuário concluiu o curso? Uma consulta; aceita transação. Não confere acesso nem
 * publicação do curso: quem emite o certificado confere com `canAccess`.
 */
export async function getCourseCompletion(
  db: Database,
  userId: string,
  courseId: string,
): Promise<CourseCompletion> {
  const empty: CourseCompletion = {
    userId,
    courseId,
    totalLessons: 0,
    completedLessons: 0,
    completed: false,
    completedAt: null,
    durationSeconds: 0,
  };
  if (!isUuid(userId) || !isUuid(courseId)) return empty;
  const result = await sql<{
    total: number;
    completed: number;
    lastCompletedAt: Date | null;
    durationSeconds: number;
  }>`
    SELECT count(*)::int AS total, count(lp.completed_at)::int AS completed,
           max(lp.completed_at) AS last_completed_at,
           COALESCE(sum(l.duration_seconds), 0)::int AS duration_seconds
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ${userId}::uuid
     WHERE m.course_id = ${courseId}::uuid AND l.status = 'published'`.execute(db);
  const row = result.rows[0];
  if (!row) return empty;
  const completed = row.total > 0 && row.completed === row.total;
  return {
    userId,
    courseId,
    totalLessons: row.total,
    completedLessons: row.completed,
    completed,
    completedAt: completed ? row.lastCompletedAt : null,
    durationSeconds: row.durationSeconds,
  };
}

/** Alunos por lote na conferência de conclusão (spec 005, `course.completion_check`). */
export const COURSE_COMPLETION_CHECK_BATCH_SIZE = 500;

export interface EnqueueCourseCompletionsResult {
  /** Usuários com 100% do curso e acesso a ele. */
  candidates: number;
  /** Tarefas `course.completed` criadas (quem já tinha uma ativa não ganha outra). */
  enqueued: number;
}

/**
 * O trabalho de `course.completion_check`: enfileira `course.completed` (com a `unique_key` da
 * 014) para cada usuário que tem 100% das aulas publicadas do curso e o acessa agora (curso
 * `open`, direito ativo, admin, gerente ou instrutor dono), em lotes de 500, um `INSERT` por
 * lote. Não distingue quem já estava em 100% antes: os manipuladores de `course.completed` são
 * idempotentes. Curso despublicado, arquivado, inexistente ou sem aula publicada: nada.
 */
export async function enqueueCourseCompletions(
  db: Database,
  courseId: string,
  options: { batchSize?: number } = {},
): Promise<EnqueueCourseCompletionsResult> {
  const outcome: EnqueueCourseCompletionsResult = { candidates: 0, enqueued: 0 };
  if (!isUuid(courseId)) return outcome;
  const batchSize = options.batchSize ?? COURSE_COMPLETION_CHECK_BATCH_SIZE;
  const definition = JOB_DEFINITIONS['course.completed'];
  let after: string | null = null;
  for (;;) {
    const batch: { rows: { userId: string }[] } = await sql<{ userId: string }>`
      WITH course AS (
        SELECT c.id, c.access_mode, c.owner_id,
               (SELECT count(*)::int FROM lessons l JOIN modules m ON m.id = l.module_id
                 WHERE m.course_id = c.id AND l.status = 'published') AS total
          FROM courses c
         WHERE c.id = ${courseId}::uuid AND c.status = 'published' AND c.archived_at IS NULL
      ), done AS (
        SELECT lp.user_id
          FROM lesson_progress lp
          JOIN lessons l ON l.id = lp.lesson_id AND l.status = 'published'
          JOIN course ON course.id = lp.course_id
         WHERE lp.completed_at IS NOT NULL AND course.total > 0
           AND (${after}::uuid IS NULL OR lp.user_id > ${after}::uuid)
         GROUP BY lp.user_id, course.total
        HAVING count(*) >= course.total
      )
      SELECT d.user_id
        FROM done d
        JOIN users u ON u.id = d.user_id AND u.deleted_at IS NULL
        CROSS JOIN course c
       WHERE c.access_mode = 'open' OR u.role IN ('admin', 'manager')
          OR (u.role = 'instructor' AND c.owner_id = u.id)
          OR EXISTS (SELECT 1 FROM entitlements e
                      WHERE e.user_id = u.id AND e.product_type = 'course'
                        AND e.product_id = c.id AND ${ACTIVE_ENTITLEMENT})
       ORDER BY d.user_id
       LIMIT ${batchSize}`.execute(db);
    const userIds = batch.rows.map((row) => row.userId);
    if (userIds.length === 0) break;
    outcome.candidates += userIds.length;
    const inserted = await db
      .insertInto('jobs')
      .values(
        userIds.map((userId) => ({
          type: 'course.completed',
          payload: JSON.stringify({ userId, courseId: courseId.toLowerCase() }),
          priority: definition.priority,
          maxAttempts: definition.maxAttempts,
          uniqueKey: courseCompletedKey(userId, courseId.toLowerCase()),
        })),
      )
      .onConflict((oc) =>
        // Predicado idêntico ao do índice parcial da fila (ver `enqueue`).
        oc.column('uniqueKey').where(sql<boolean>`status IN ('queued', 'running')`).doNothing(),
      )
      .returning('id')
      .execute();
    outcome.enqueued += inserted.length;
    if (userIds.length < batchSize) break;
    after = userIds.at(-1) ?? null;
  }
  return outcome;
}
