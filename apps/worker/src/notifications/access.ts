import { canAccess, type Database, isDomainError } from '@nuva-edu/core';

interface NotificationTarget {
  type: string;
  userId: string;
  targetType: string | null;
  targetId: string | null;
}

/** Uma aula de amostra não dá direito de receber os avisos do curso inteiro. */
export async function canReceiveTarget(db: Database, input: NotificationTarget): Promise<boolean> {
  if (input.type !== 'lesson.published') return true;
  if (input.targetId === null) return false;
  let courseId = input.targetId;
  if (input.targetType === 'lesson') {
    const lesson = await db
      .selectFrom('lessons')
      .innerJoin('modules', 'modules.id', 'lessons.moduleId')
      .select('modules.courseId')
      .where('lessons.id', '=', input.targetId)
      .executeTakeFirst();
    if (!lesson) return false;
    courseId = lesson.courseId;
  } else if (input.targetType !== 'course') {
    return false;
  }
  try {
    return (await canAccess(db, { id: input.userId }, { type: 'course', id: courseId })).allowed;
  } catch (error) {
    if (isDomainError(error) && error.code === 'not_found') return false;
    throw error;
  }
}
