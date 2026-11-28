import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { renderMarkdownToHtml } from '../markdown/render.ts';

interface ForumCourse {
  id: string;
  slug: string;
  title: string;
}

interface ForumLesson {
  id: string;
  title: string;
  description: string | null;
  status: string;
}

export async function syncCourseForum(trx: Database, course: ForumCourse): Promise<void> {
  const category = await trx
    .insertInto('forumCategories')
    .values({ courseId: course.id, kind: 'course', name: course.title })
    .onConflict((conflict) =>
      conflict.column('courseId').where('courseId', 'is not', null).doUpdateSet({
        name: course.title,
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  const lessons = await trx
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select(['lessons.id', 'lessons.title', 'lessons.description', 'lessons.status'])
    .where('modules.courseId', '=', course.id)
    .where('lessons.status', '=', 'published')
    .execute();
  for (const lesson of lessons) {
    await upsertLessonTopic(trx, category.id, course.slug, lesson);
  }
}

export async function syncLessonForum(
  trx: Database,
  course: ForumCourse,
  lesson: ForumLesson,
): Promise<void> {
  if (lesson.status !== 'published') return;
  const category = await trx
    .selectFrom('forumCategories')
    .select('id')
    .where('courseId', '=', course.id)
    .executeTakeFirst();
  if (category) await upsertLessonTopic(trx, category.id, course.slug, lesson);
}

async function upsertLessonTopic(
  trx: Database,
  categoryId: string,
  courseSlug: string,
  lesson: ForumLesson,
): Promise<void> {
  const link = `[Assistir à aula](/meus-cursos/${encodeURIComponent(courseSlug)}/aulas/${lesson.id})`;
  const description = [...(lesson.description ?? '').trim()]
    .slice(0, 20_000 - link.length - 2)
    .join('');
  const bodyMd = [description, link].filter(Boolean).join('\n\n');
  const bodyHtml = renderMarkdownToHtml(bodyMd);
  const topic = await trx
    .insertInto('forumTopics')
    .values({ categoryId, lessonId: lesson.id, title: lesson.title, bodyMd, bodyHtml })
    .onConflict((conflict) =>
      conflict.column('lessonId').where('lessonId', 'is not', null).doUpdateSet({
        title: lesson.title,
        bodyMd,
        bodyHtml,
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .updateTable('lessons')
    .set({ forumTopicId: topic.id })
    .where('id', '=', lesson.id)
    .where('forumTopicId', 'is distinct from', topic.id)
    .execute();
}

export async function archiveDeletedCourseForum(trx: Database, courseId: string): Promise<void> {
  await trx
    .updateTable('forumCategories')
    .set({ archivedAt: sql<Date>`now()` })
    .where('courseId', '=', courseId)
    .where('archivedAt', 'is', null)
    .execute();
}
