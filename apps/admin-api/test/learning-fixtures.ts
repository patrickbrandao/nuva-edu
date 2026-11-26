import type { TestApp } from './helpers.ts';

// Catálogo e progresso gravados direto nas tabelas, para os testes de progresso e certificados
// (as regras de cada um têm os próprios testes no núcleo).

export interface CourseOptions {
  mode?: 'open' | 'paid' | 'private';
  ownerId?: string | null;
  enabled?: boolean;
  lessons?: number;
}

export interface TestCourse {
  id: string;
  title: string;
  lessons: string[];
}

/** Curso publicado com um módulo e `lessons` aulas publicadas (padrão: 4). */
export async function makeCourse(test: TestApp, options: CourseOptions = {}): Promise<TestCourse> {
  const mode = options.mode ?? 'open';
  const course = await test.db
    .insertInto('courses')
    .values({
      slug: `curso-${crypto.randomUUID()}`,
      title: `Curso ${crypto.randomUUID().slice(0, 8)}`,
      accessMode: mode,
      priceCents: mode === 'paid' ? 9900 : null,
      status: 'published',
      publishedAt: new Date(),
      ownerId: options.ownerId ?? null,
      certificateEnabled: options.enabled ?? true,
    })
    .returning(['id', 'title'])
    .executeTakeFirstOrThrow();
  const module = await test.db
    .insertInto('modules')
    .values({ courseId: course.id, title: 'Módulo', position: 0 })
    .returning('id')
    .executeTakeFirstOrThrow();
  const lessons: string[] = [];
  for (let position = 0; position < (options.lessons ?? 4); position += 1) {
    const lesson = await test.db
      .insertInto('lessons')
      .values({
        moduleId: module.id,
        title: `Aula ${position + 1}`,
        videoUrl: 'https://youtu.be/abc12345678',
        videoProvider: 'youtube',
        durationSeconds: 1800,
        status: 'published',
        position,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    lessons.push(lesson.id);
  }
  return { ...course, lessons };
}

/** Conclui as `count` primeiras aulas do curso (padrão: todas). */
export async function completeLessons(
  test: TestApp,
  userId: string,
  course: TestCourse,
  count = course.lessons.length,
  at = new Date(),
): Promise<void> {
  for (const lessonId of course.lessons.slice(0, count)) {
    await test.db
      .insertInto('lessonProgress')
      .values({
        userId,
        lessonId,
        courseId: course.id,
        firstOpenedAt: at,
        lastOpenedAt: at,
        completedAt: at,
        completedVia: 'manual',
      })
      .onConflict((oc) => oc.columns(['userId', 'lessonId']).doNothing())
      .execute();
  }
}

/** Direito ativo e vitalício ao curso, de concessão manual. */
export async function grantCourse(
  test: TestApp,
  userId: string,
  courseId: string,
  grantedBy: string,
): Promise<void> {
  await test.db
    .insertInto('entitlements')
    .values({
      userId,
      productType: 'course',
      productId: courseId,
      source: 'grant',
      sourceId: grantedBy,
      grantedReason: 'Teste',
    })
    .execute();
}
