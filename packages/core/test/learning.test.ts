import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { type KyselyPlugin, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activityLevel,
  type CatalogRequest,
  closeDatabase,
  courseCompletedKey,
  createAccount,
  createDatabase,
  type Database,
  enqueueCourseCompletions,
  getCourseCompletion,
  getCourseLearningView,
  getCourseProgress,
  getCourseProgressSummary,
  getLessonView,
  getMyActivity,
  getMyProgress,
  getUserProgress,
  grantManualEntitlement,
  isDomainError,
  type LearningViewer,
  listContinueWatching,
  listCourseStudents,
  listMyCourses,
  listMyEbooks,
  progressCounts,
  type Role,
  resolveUserTimezone,
  saveLessonProgress,
  setSetting,
} from '../src/index.ts';
import { continueLessonOf } from '../src/modules/learning/common.ts';

// Aprendizado e progresso (tarefa 413; spec 014). Banco próprio deste arquivo; o catálogo é
// gravado direto nas tabelas.

let testDb: TestDatabase;
let db: Database;
let admin: LearningViewer;

type Mode = 'open' | 'paid' | 'private';

async function makeUser(role: Role = 'student', name = `Pessoa ${role}`): Promise<LearningViewer> {
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email: `${role}-${crypto.randomUUID()}@example.com`,
      name,
      password: 'Senha-Aprendizado-Teste-7Qa',
      role,
      emailVerified: true,
    }),
  );
  return { id, role };
}

function requestOf(user: LearningViewer): CatalogRequest {
  return { actor: { id: user.id, role: user.role }, context: { ip: '127.0.0.1', requestId: 'r' } };
}

interface CourseOptions {
  mode?: Mode;
  published?: boolean;
  title?: string;
  ownerId?: string | null;
  publishedAt?: Date;
}

async function makeCourse(options: CourseOptions = {}): Promise<{ id: string; slug: string }> {
  const mode = options.mode ?? 'paid';
  const published = options.published ?? true;
  return db
    .insertInto('courses')
    .values({
      slug: `curso-${crypto.randomUUID().slice(0, 13)}`,
      title: options.title ?? `Curso ${crypto.randomUUID().slice(0, 6)}`,
      accessMode: mode,
      priceCents: mode === 'open' ? null : 9900,
      status: published ? 'published' : 'draft',
      publishedAt: published ? (options.publishedAt ?? new Date()) : null,
      ownerId: options.ownerId ?? null,
    })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
}

async function makeModule(courseId: string, position: number): Promise<string> {
  const row = await db
    .insertInto('modules')
    .values({ courseId, title: `Módulo ${position + 1}`, position })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeLesson(
  moduleId: string,
  position: number,
  options: { sample?: boolean; published?: boolean; duration?: number } = {},
): Promise<string> {
  const row = await db
    .insertInto('lessons')
    .values({
      moduleId,
      title: `Aula ${position + 1}`,
      videoUrl: 'https://youtu.be/abc12345678',
      videoProvider: 'youtube',
      durationSeconds: options.duration ?? 600,
      isSample: options.sample ?? false,
      status: (options.published ?? true) ? 'published' : 'draft',
      position,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Curso com um módulo e `count` aulas publicadas de 10 minutos. */
async function courseWith(count: number, options: CourseOptions = {}) {
  const course = await makeCourse(options);
  const moduleId = await makeModule(course.id, 0);
  const lessons: string[] = [];
  for (let position = 0; position < count; position += 1) {
    lessons.push(await makeLesson(moduleId, position));
  }
  return { ...course, moduleId, lessons };
}

async function grant(
  user: LearningViewer,
  productId: string,
  productType: 'course' | 'ebook' = 'course',
) {
  await grantManualEntitlement(db, requestOf(admin), user.id, {
    productType,
    productId,
    reason: 'Teste do aprendizado',
  });
}

/** Leva o direito do usuário ao curso para o passado: acesso vencido. */
async function expire(user: LearningViewer, courseId: string) {
  await sql`
    UPDATE entitlements
       SET starts_at = now() - interval '10 days', expires_at = now() - interval '1 day'
     WHERE user_id = ${user.id}::uuid AND product_id = ${courseId}::uuid`.execute(db);
}

const complete = (user: LearningViewer, lessonId: string) =>
  saveLessonProgress(db, user, lessonId, { completed: true, completedVia: 'manual' });

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!isDomainError(error)) throw new Error(`esperava ${code}, veio ${String(error)}`);
  expect({ status: error.status, code: error.code }).toEqual({ status, code });
  return error;
}

function countingDb(): { db: Database; count: () => number } {
  let queries = 0;
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      queries += 1;
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  };
  return { db: db.withPlugin(plugin), count: () => queries };
}

async function completedJobs(userId: string, courseId: string): Promise<number> {
  const result = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM jobs
     WHERE type = 'course.completed' AND unique_key = ${courseCompletedKey(userId, courseId)}`.execute(
    db,
  );
  return result.rows[0]?.n ?? 0;
}

async function finishJobs(userId: string, courseId: string): Promise<void> {
  await sql`UPDATE jobs SET status = 'done', finished_at = now()
             WHERE unique_key = ${courseCompletedKey(userId, courseId)}`.execute(db);
}

async function openedAt(user: LearningViewer, lessonId: string, minutesAgo: number) {
  await sql`
    UPDATE lesson_progress
       SET first_opened_at = now() - interval '2 days',
           last_opened_at = now() - make_interval(mins => ${minutesAgo})
     WHERE user_id = ${user.id}::uuid AND lesson_id = ${lessonId}::uuid`.execute(db);
}

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 6 });
  admin = await makeUser('admin');
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

describe('regras puras', () => {
  it('estado e percentual do progresso', () => {
    expect(progressCounts(0, 4, 0)).toEqual({
      completedLessons: 0,
      totalLessons: 4,
      percent: 0,
      state: 'not_started',
    });
    expect(progressCounts(0, 4, 1).state).toBe('in_progress');
    expect(progressCounts(45, 46, 46)).toMatchObject({ percent: 97, state: 'in_progress' });
    expect(progressCounts(4, 4, 4)).toMatchObject({ percent: 100, state: 'completed' });
    // Curso sem aula publicada nunca é concluído; concluídas não passam do total.
    expect(progressCounts(0, 0, 0)).toMatchObject({ percent: 0, state: 'not_started' });
    expect(progressCounts(9, 3, 9)).toMatchObject({ completedLessons: 3, state: 'completed' });
  });

  it('"continuar" nos três casos e nas bordas', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    const lesson = (id: string, opened: number | null, done = false) => ({
      id,
      lastOpenedAt: opened === null ? null : at(opened),
      completedAt: done ? at(59) : null,
    });
    // Atual pendente.
    expect(continueLessonOf([lesson('a', 1, true), lesson('b', 5), lesson('c', null)])).toBe('b');
    // Atual concluída: a próxima não concluída depois dela.
    expect(continueLessonOf([lesson('a', null), lesson('b', 5, true), lesson('c', null)])).toBe(
      'c',
    );
    // Atual concluída e nada pendente depois: a primeira pendente do programa.
    expect(continueLessonOf([lesson('a', null), lesson('b', 1, true), lesson('c', 5, true)])).toBe(
      'a',
    );
    // Tudo concluído: a primeira aula.
    expect(continueLessonOf([lesson('a', 1, true), lesson('b', 5, true)])).toBe('a');
    // Nunca aberto: a primeira; sem aula: nada.
    expect(continueLessonOf([lesson('a', null), lesson('b', null)])).toBe('a');
    expect(continueLessonOf([])).toBeNull();
  });

  it('intensidade do mapa', () => {
    expect([1, 2, 3, 4, 5, 6, 40].map(activityLevel)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('aula: abrir e gravar', () => {
  it('abrir grava a abertura e devolve o estado; reabrir mantém posição e conclusão', async () => {
    const student = await makeUser();
    const course = await courseWith(2, { mode: 'open' });
    const [first] = course.lessons as [string, string];
    const view = await getLessonView(db, student, first);
    expect(view.id).toBe(first);
    expect(view).not.toHaveProperty('access');
    expect(view.userState).toMatchObject({
      completedAt: null,
      completedVia: null,
      positionSeconds: 0,
    });
    expect(view.userState.lastOpenedAt).toBeInstanceOf(Date);
    await saveLessonProgress(db, student, first, { positionSeconds: 123.7 });
    await openedAt(student, first, 30);
    const again = await getLessonView(db, student, first);
    expect(again.userState.positionSeconds).toBe(123);
    expect(again.userState.lastOpenedAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('sem acesso: 403 com o motivo, sem gravar; despublicada ou inexistente: 404', async () => {
    const student = await makeUser();
    const course = await courseWith(1);
    const [lesson] = course.lessons as [string];
    const denied = await expectError(complete(student, lesson), 403, 'access_denied');
    expect(denied.extras).toEqual({ reason: 'no_entitlement' });
    await expectError(getLessonView(db, student, lesson), 403, 'access_denied');
    const rows = await db
      .selectFrom('lessonProgress')
      .select('lessonId')
      .where('userId', '=', student.id)
      .execute();
    expect(rows).toEqual([]);
    await grant(student, course.id);
    await expire(student, course.id);
    const expired = await expectError(complete(student, lesson), 403, 'access_denied');
    expect(expired.extras).toEqual({ reason: 'expired' });

    const draft = await makeLesson(course.moduleId, 5, { published: false });
    await expectError(complete(admin, draft), 404, 'not_found');
    await expectError(complete(admin, crypto.randomUUID()), 404, 'not_found');
    await expectError(complete(admin, 'x'), 404, 'not_found');
    const hidden = await courseWith(1, { published: false });
    await expectError(complete(admin, hidden.lessons[0] as string), 404, 'not_found');
  });

  it('corpo fora do formato: 400; posição fora da faixa: 422', async () => {
    const student = await makeUser();
    const course = await courseWith(1, { mode: 'open' });
    const [lesson] = course.lessons as [string];
    const save = (input: Record<string, unknown>) => saveLessonProgress(db, student, lesson, input);
    await expectError(save({}), 400, 'validation_failed');
    await expectError(save({ completed: 'sim' }), 400, 'validation_failed');
    await expectError(save({ completed: true }), 400, 'validation_failed');
    await expectError(save({ completed: true, completedVia: 'x' }), 400, 'validation_failed');
    await expectError(save({ positionSeconds: '10' }), 400, 'validation_failed');
    await expectError(save({ positionSeconds: Number.NaN }), 400, 'validation_failed');
    await expectError(save({ positionSeconds: -1 }), 422, 'position_out_of_range');
    await expectError(save({ positionSeconds: 661 }), 422, 'position_out_of_range');
    // Duração + 60 s ainda vale; `null` zera.
    expect((await save({ positionSeconds: 660 })).userState.positionSeconds).toBe(660);
    expect((await save({ positionSeconds: null })).userState.positionSeconds).toBe(0);
    // Aula sem duração informada: vale o teto do catálogo.
    const unknown = await makeLesson(course.moduleId, 1, { duration: 0 });
    const result = await saveLessonProgress(db, student, unknown, { positionSeconds: 5000 });
    expect(result.userState.positionSeconds).toBe(5000);
    await expectError(
      saveLessonProgress(db, student, unknown, { positionSeconds: 86_461 }),
      422,
      'position_out_of_range',
    );
  });

  it('marcar e desmarcar atualiza o módulo e o curso; marcar de novo é idempotente', async () => {
    const student = await makeUser();
    const course = await makeCourse({ mode: 'open' });
    const m1 = await makeModule(course.id, 0);
    const m2 = await makeModule(course.id, 1);
    const a = await makeLesson(m1, 0);
    const b = await makeLesson(m1, 1);
    const c = await makeLesson(m2, 0);
    await makeLesson(m2, 1, { published: false });

    const first = await saveLessonProgress(db, student, a, {
      completed: true,
      completedVia: 'video_end',
      positionSeconds: 590,
    });
    expect(first).toMatchObject({
      lessonId: a,
      countsForCourse: true,
      courseCompleted: false,
      userState: { completedVia: 'video_end', positionSeconds: 590 },
      module: { id: m1, progress: { completedLessons: 1, totalLessons: 2, percent: 50 } },
      course: {
        id: course.id,
        progress: { completedLessons: 1, totalLessons: 3, percent: 33, state: 'in_progress' },
      },
    });
    // De novo, agora pelo botão: mantém o instante e a fonte.
    const again = await complete(student, a);
    expect(again.userState.completedAt).toEqual(first.userState.completedAt);
    expect(again.userState.completedVia).toBe('video_end');
    expect(again.userState.positionSeconds).toBe(590);

    const undone = await saveLessonProgress(db, student, a, { completed: false });
    expect(undone.userState).toMatchObject({ completedAt: null, completedVia: null });
    expect(undone.module.progress).toMatchObject({ completedLessons: 0, state: 'in_progress' });
    expect(undone.course.progress).toMatchObject({ completedLessons: 0, percent: 0 });
    // Desmarcar o que não está marcado não muda nada.
    expect(
      (await saveLessonProgress(db, student, b, { completed: false })).userState,
    ).toMatchObject({ completedAt: null });

    const progress = await getCourseProgress(db, student, course.slug);
    expect(progress.courseId).toBe(course.id);
    expect(progress.modules.map((module) => module.lessons.map((lesson) => lesson.id))).toEqual([
      [a, b],
      [c],
    ]);
    expect(progress.modules[1]?.progress.state).toBe('not_started');
  });

  it('concluir a última aula enfileira course.completed uma vez', async () => {
    const student = await makeUser();
    const course = await courseWith(2);
    await grant(student, course.id);
    const [a, b] = course.lessons as [string, string];
    expect((await complete(student, a)).courseCompleted).toBe(false);
    expect(await completedJobs(student.id, course.id)).toBe(0);
    const last = await complete(student, b);
    expect(last.courseCompleted).toBe(true);
    expect(last.course.progress).toMatchObject({ percent: 100, state: 'completed' });
    expect(await completedJobs(student.id, course.id)).toBe(1);
    const job = await db
      .selectFrom('jobs')
      .select(['payload', 'status'])
      .where('uniqueKey', '=', courseCompletedKey(student.id, course.id))
      .executeTakeFirstOrThrow();
    expect(job).toEqual({
      payload: { userId: student.id, courseId: course.id },
      status: 'queued',
    });
    // Marcar de novo não é passagem: nada enfileirado, mesmo com a primeira tarefa encerrada.
    await finishJobs(student.id, course.id);
    expect((await complete(student, b)).courseCompleted).toBe(false);
    expect((await complete(student, a)).courseCompleted).toBe(false);
    expect(await completedJobs(student.id, course.id)).toBe(1);
    // Desmarcar e marcar de novo é outra passagem.
    await saveLessonProgress(db, student, b, { completed: false });
    expect((await complete(student, b)).courseCompleted).toBe(true);
    expect(await completedJobs(student.id, course.id)).toBe(2);

    const completion = await getCourseCompletion(db, student.id, course.id);
    expect(completion).toMatchObject({
      completed: true,
      totalLessons: 2,
      completedLessons: 2,
      durationSeconds: 1200,
    });
    expect(completion.completedAt).toBeInstanceOf(Date);
  });

  it('duas conclusões simultâneas das duas últimas aulas enfileiram uma tarefa', async () => {
    const student = await makeUser();
    const course = await courseWith(2, { mode: 'open' });
    const [a, b] = course.lessons as [string, string];
    const results = await Promise.all([complete(student, a), complete(student, b)]);
    expect(results.filter((result) => result.courseCompleted)).toHaveLength(1);
    expect(await completedJobs(student.id, course.id)).toBe(1);
  });

  it('amostra de curso que o aluno não tem não entra no progresso até ele ter o curso', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const moduleId = await makeModule(course.id, 0);
    const sample = await makeLesson(moduleId, 0, { sample: true });
    const result = await complete(student, sample);
    expect(result.countsForCourse).toBe(false);
    expect(result.courseCompleted).toBe(false);
    expect(result.userState.completedAt).toBeInstanceOf(Date);
    expect(result.course.progress).toMatchObject({ completedLessons: 0, state: 'not_started' });
    expect(result.module.progress).toMatchObject({ completedLessons: 0, totalLessons: 1 });
    // Curso de uma aula só, concluída como amostra: nada de `course.completed`.
    expect(await completedJobs(student.id, course.id)).toBe(0);
    expect((await listMyCourses(db, student)).items).toEqual([]);
    const view = await getCourseLearningView(db, student, course.slug);
    expect(view.progress).toMatchObject({ completedLessons: 0, state: 'not_started' });
    expect(view.continueLessonId).toBeNull();
    expect(view.modules[0]?.lessons[0]).toMatchObject({ completed: false, accessible: true });
    const progress = await getCourseProgress(db, student, course.slug);
    expect(progress.progress.state).toBe('not_started');
    expect(progress.modules[0]?.lessons[0]?.completedAt).toBeNull();

    // Com o curso, a conclusão antiga passa a contar; quem tem o curso conta a amostra.
    await grant(student, course.id);
    const owned = await getCourseLearningView(db, student, course.slug);
    expect(owned.progress).toMatchObject({ completedLessons: 1, state: 'completed' });
    const again = await saveLessonProgress(db, student, sample, { completed: false });
    expect(again.countsForCourse).toBe(true);
    expect((await complete(student, sample)).courseCompleted).toBe(true);
  });
});

describe('curso com o estado do usuário', () => {
  it('progresso por módulo, aulas concluídas e "continuar" nos três casos', async () => {
    const student = await makeUser();
    const course = await courseWith(3);
    await grant(student, course.id);
    const [a, b, c] = course.lessons as [string, string, string];
    const fresh = await getCourseLearningView(db, student, course.slug);
    expect(fresh.progress.state).toBe('not_started');
    expect(fresh.continueLessonId).toBe(a);

    // Atual pendente: a aula aberta por último.
    await getLessonView(db, student, a);
    await getLessonView(db, student, b);
    await openedAt(student, a, 20);
    await openedAt(student, b, 10);
    let view = await getCourseLearningView(db, student, course.slug);
    expect(view.continueLessonId).toBe(b);
    expect(view.progress).toMatchObject({ completedLessons: 0, state: 'in_progress' });

    // Atual concluída: a próxima não concluída.
    await complete(student, b);
    view = await getCourseLearningView(db, student, course.slug);
    expect(view.continueLessonId).toBe(c);
    expect(view.modules[0]?.progress).toMatchObject({ completedLessons: 1, totalLessons: 3 });
    expect(view.modules[0]?.lessons.map((lesson) => lesson.completed)).toEqual([
      false,
      true,
      false,
    ]);
    expect((await listMyCourses(db, student)).items[0]?.continueLessonId).toBe(c);

    // Tudo concluído: a primeira aula.
    await complete(student, a);
    await complete(student, c);
    view = await getCourseLearningView(db, student, course.slug);
    expect(view.continueLessonId).toBe(a);
    expect(view.progress.state).toBe('completed');
    const shelf = await listMyCourses(db, student);
    expect(shelf.items[0]).toMatchObject({ continueLessonId: a, action: 'review' });

    // Aula nova publicada: volta a "em andamento"; despublicada, sai do cálculo.
    const extra = await makeLesson(course.moduleId, 3);
    view = await getCourseLearningView(db, student, course.slug);
    expect(view.progress).toMatchObject({
      completedLessons: 3,
      totalLessons: 4,
      percent: 75,
      state: 'in_progress',
    });
    expect(view.continueLessonId).toBe(extra);
    await db.updateTable('lessons').set({ status: 'draft' }).where('id', '=', extra).execute();
    expect((await getCourseProgress(db, student, course.slug)).progress.state).toBe('completed');
  });

  it('privado sem acesso, rascunho e inexistente: 404', async () => {
    const student = await makeUser();
    const hidden = await courseWith(1, { mode: 'private' });
    await expectError(getCourseProgress(db, student, hidden.slug), 404, 'not_found');
    await expectError(getCourseLearningView(db, student, hidden.slug), 404, 'not_found');
    const draft = await courseWith(1, { published: false });
    await expectError(getCourseProgress(db, admin, draft.slug), 404, 'not_found');
    await expectError(getCourseProgress(db, admin, 'nao-existe'), 404, 'not_found');
    await expectError(getCourseProgress(db, admin, 42), 404, 'not_found');
    await grant(student, hidden.id);
    expect((await getCourseProgress(db, student, hidden.slug)).progress.totalLessons).toBe(1);
  });
});

describe('estante', () => {
  it('filtros, contadores, busca, ordens, acesso vencido, curso aberto e "continue"', async () => {
    const student = await makeUser();
    const done = await courseWith(2, { title: 'Abacaxi concluído', publishedAt: new Date(1e12) });
    const going = await courseWith(2, { title: 'Banana em andamento' });
    const fresh = await courseWith(1, { title: 'Caju novo' });
    const expired = await courseWith(2, { title: 'Damasco vencido' });
    const open = await courseWith(2, { mode: 'open', title: 'Embaúba aberto' });
    const openUntouched = await courseWith(1, { mode: 'open', title: 'Figo aberto intocado' });
    const hidden = await courseWith(1, { title: 'Goiaba despublicado' });
    for (const course of [done, going, fresh, expired, hidden]) await grant(student, course.id);
    await db.updateTable('courses').set({ status: 'draft' }).where('id', '=', hidden.id).execute();

    await complete(student, done.lessons[0] as string);
    await complete(student, done.lessons[1] as string);
    await getLessonView(db, student, going.lessons[0] as string);
    await saveLessonProgress(db, student, going.lessons[0] as string, { positionSeconds: 42 });
    await complete(student, expired.lessons[0] as string);
    await expire(student, expired.id);
    await getLessonView(db, student, open.lessons[1] as string);
    await openedAt(student, done.lessons[0] as string, 60);
    await openedAt(student, done.lessons[1] as string, 50);
    await openedAt(student, expired.lessons[0] as string, 70);
    await openedAt(student, going.lessons[0] as string, 5);
    await openedAt(student, open.lessons[1] as string, 15);

    const counting = countingDb();
    const shelf = await listMyCourses(counting.db, student);
    expect(counting.count()).toBeLessThanOrEqual(3);
    expect(shelf.items.map((item) => item.title)).toEqual([
      'Banana em andamento',
      'Embaúba aberto',
      'Abacaxi concluído',
      'Damasco vencido',
      'Caju novo',
    ]);
    expect(shelf.items.map((item) => item.id)).not.toContain(openUntouched.id);
    expect(shelf.counts).toEqual({
      all: 5,
      inProgress: 3,
      notStarted: 1,
      completed: 1,
      completedLessonSeconds: 1800,
    });
    expect(shelf.startHereCourseId).toBeNull();
    const byTitle = new Map(shelf.items.map((item) => [item.title, item]));
    expect(byTitle.get('Abacaxi concluído')).toMatchObject({
      action: 'review',
      access: { state: 'active', expiresAt: null },
      progress: { percent: 100, state: 'completed' },
      certificateEnabled: true,
    });
    expect(byTitle.get('Banana em andamento')).toMatchObject({
      action: 'continue',
      continueLessonId: going.lessons[0],
      progress: { completedLessons: 0, state: 'in_progress' },
    });
    expect(byTitle.get('Caju novo')).toMatchObject({
      action: 'start',
      continueLessonId: fresh.lessons[0],
      lastAccessedAt: null,
    });
    // Acesso vencido: selo, progresso preservado e sem aula para continuar.
    expect(byTitle.get('Damasco vencido')).toMatchObject({
      action: 'renew',
      access: { state: 'expired', expiresAt: null },
      continueLessonId: null,
      progress: { completedLessons: 1, totalLessons: 2, percent: 50 },
    });
    expect(byTitle.get('Embaúba aberto')).toMatchObject({
      access: { state: 'open', expiresAt: null },
      acquiredAt: null,
      continueLessonId: open.lessons[1],
    });
    expect(byTitle.get('Banana em andamento')?.acquiredAt).toBeInstanceOf(Date);

    const titles = async (query: Record<string, unknown>) =>
      (await listMyCourses(db, student, query)).items.map((item) => item.title);
    expect(await titles({ filter: 'completed' })).toEqual(['Abacaxi concluído']);
    expect(await titles({ filter: 'not_started' })).toEqual(['Caju novo']);
    expect(await titles({ filter: 'in_progress', sort: 'title' })).toEqual([
      'Banana em andamento',
      'Damasco vencido',
      'Embaúba aberto',
    ]);
    expect(await titles({ q: ' ABERTO ' })).toEqual(['Embaúba aberto']);
    expect((await titles({ sort: '-percent' })).slice(0, 2)).toEqual([
      'Abacaxi concluído',
      'Damasco vencido',
    ]);
    expect((await titles({ sort: '-publishedAt' })).at(-1)).toBe('Abacaxi concluído');
    // Os contadores não mudam com o filtro e a busca.
    expect((await listMyCourses(db, student, { filter: 'completed', q: 'x' })).counts.all).toBe(5);
    await expectError(listMyCourses(db, student, { filter: 'x' }), 400, 'validation_failed');
    await expectError(listMyCourses(db, student, { sort: 'x' }), 400, 'validation_failed');
    await expectError(listMyCourses(db, student, { q: ' ' }), 400, 'validation_failed');

    // "Continue assistindo": em andamento e com acesso, do mais recente ao mais antigo.
    const continuing = await listContinueWatching(db, student);
    expect(continuing.items.map((item) => item.course.title)).toEqual([
      'Banana em andamento',
      'Embaúba aberto',
    ]);
    expect(continuing.items[0]).toMatchObject({
      lesson: { id: going.lessons[0], title: 'Aula 1', positionSeconds: 42 },
      progress: { state: 'in_progress' },
    });
    expect(continuing.items[0]?.lastOpenedAt).toBeInstanceOf(Date);

    // "Meu progresso": só os iniciados, inclusive o vencido, com um quadrado por aula.
    const mine = await getMyProgress(db, student);
    expect(mine.items.map((item) => item.course.title)).toEqual([
      'Banana em andamento',
      'Embaúba aberto',
      'Abacaxi concluído',
      'Damasco vencido',
    ]);
    const grid = mine.items.find((item) => item.course.id === expired.id);
    expect(grid?.progress.percent).toBe(50);
    expect(grid?.modules[0]?.lessons.map((lesson) => lesson.completedAt !== null)).toEqual([
      true,
      false,
    ]);
  });

  it('"Comece por aqui" e limite de 3 em "Continue assistindo"', async () => {
    const student = await makeUser();
    expect(await listMyCourses(db, student)).toEqual({
      counts: { all: 0, inProgress: 0, notStarted: 0, completed: 0, completedLessonSeconds: 0 },
      startHereCourseId: null,
      items: [],
    });
    expect(await listContinueWatching(db, student)).toEqual({ items: [] });
    expect(await getMyProgress(db, student)).toEqual({ items: [] });
    const courses = [];
    for (let index = 0; index < 4; index += 1) {
      const course = await courseWith(2);
      await grant(student, course.id);
      await sql`UPDATE entitlements SET starts_at = now() - make_interval(days => ${4 - index})
                 WHERE user_id = ${student.id}::uuid AND product_id = ${course.id}::uuid`.execute(
        db,
      );
      courses.push(course);
    }
    expect((await listMyCourses(db, student)).startHereCourseId).toBe(courses[3]?.id);
    for (const [index, course] of courses.entries()) {
      await getLessonView(db, student, course.lessons[0] as string);
      await openedAt(student, course.lessons[0] as string, 10 * (index + 1));
    }
    expect((await listMyCourses(db, student)).startHereCourseId).toBeNull();
    const continuing = await listContinueWatching(db, student);
    expect(continuing.items.map((item) => item.course.id)).toEqual(
      courses.slice(0, 3).map((course) => course.id),
    );
  });

  it('200 cursos em até 3 consultas', async () => {
    const student = await makeUser();
    await sql`
      WITH c AS (
        INSERT INTO courses (slug, title, access_mode, price_cents, status, published_at)
        SELECT 'estante-' || g, 'Estante ' || lpad(g::text, 3, '0'), 'paid', 1000, 'published', now()
          FROM generate_series(1, 200) g
        RETURNING id
      ), m AS (
        INSERT INTO modules (course_id, title, position) SELECT id, 'M', 0 FROM c
        RETURNING id, course_id
      ), l AS (
        INSERT INTO lessons (module_id, title, duration_seconds, status, position)
        SELECT m.id, 'Aula ' || p, 60, 'published', p FROM m, generate_series(0, 2) p
        RETURNING id, module_id, position
      ), e AS (
        INSERT INTO entitlements (user_id, product_type, product_id, source, source_id, granted_reason)
        SELECT ${student.id}::uuid, 'course', id, 'grant', ${admin.id}::uuid, 'Teste' FROM c
      )
      INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at, completed_via)
      SELECT ${student.id}::uuid, l.id, m.course_id, now(), 'manual'
        FROM l JOIN m ON m.id = l.module_id
       WHERE l.position = 0`.execute(db);
    const counting = countingDb();
    const shelf = await listMyCourses(counting.db, student, { sort: 'title' });
    expect(counting.count()).toBeLessThanOrEqual(3);
    expect(shelf.items).toHaveLength(200);
    expect(shelf.counts).toMatchObject({
      all: 200,
      inProgress: 200,
      completedLessonSeconds: 12000,
    });
    expect(shelf.items[0]).toMatchObject({
      title: 'Estante 001',
      progress: { completedLessons: 1, totalLessons: 3, percent: 33 },
    });
    expect(shelf.items.every((item) => item.continueLessonId !== null)).toBe(true);
  });

  it('equipe vê na estante o que abriu; ebooks com direito ativo', async () => {
    const instructor = await makeUser('instructor');
    const own = await courseWith(1, { ownerId: instructor.id });
    const other = await courseWith(1, { mode: 'open' });
    await getLessonView(db, instructor, own.lessons[0] as string);
    await getLessonView(db, admin, own.lessons[0] as string);
    await getLessonView(db, instructor, other.lessons[0] as string);
    const shelf = await listMyCourses(db, instructor, { sort: 'title' });
    expect(shelf.items.map((item) => [item.id, item.access.state]).sort()).toEqual(
      [
        [own.id, 'active'],
        [other.id, 'open'],
      ].sort(),
    );
    expect((await listMyCourses(db, admin)).items.map((item) => item.id)).toContain(own.id);

    const student = await makeUser();
    const makeEbook = (title: string, published = true) =>
      db
        .insertInto('ebooks')
        .values({
          slug: `ebook-${crypto.randomUUID().slice(0, 13)}`,
          title,
          accessMode: 'paid',
          priceCents: 500,
          status: published ? 'published' : 'draft',
          publishedAt: published ? new Date() : null,
          fileUrl: 'https://arquivos.exemplo.test/segredo.pdf',
          pages: 80,
          authorName: 'Ana',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    const mine = await makeEbook('Meu ebook');
    const draft = await makeEbook('Ebook em rascunho', false);
    await makeEbook('Ebook de outro');
    await grant(student, mine.id, 'ebook');
    await grant(student, draft.id, 'ebook');
    const ebooks = await listMyEbooks(db, student);
    expect(ebooks.items).toEqual([
      expect.objectContaining({
        id: mine.id,
        title: 'Meu ebook',
        authorName: 'Ana',
        pages: 80,
        cover: null,
        expiresAt: null,
      }),
    ]);
    expect(JSON.stringify(ebooks)).not.toContain('segredo');
    expect(await listMyEbooks(db, { id: 'x', role: 'student' })).toEqual({ items: [] });
  });
});

describe('mapa de atividade', () => {
  it('conta a conclusão no dia do fuso do usuário, diferente do dia em UTC', async () => {
    // Um fuso em que agora é outro dia: UTC+14 na segunda metade do dia UTC, UTC-12 na primeira.
    const timezone = new Date().getUTCHours() >= 12 ? 'Pacific/Kiritimati' : 'Etc/GMT+12';
    await setSetting(db, 'school.timezone', timezone);
    try {
      const student = await makeUser();
      expect(await resolveUserTimezone(db, student.id)).toBe(timezone);
      const course = await courseWith(3, { mode: 'open' });
      const [a, b, c] = course.lessons as [string, string, string];
      const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
      const utcDay = new Date().toISOString().slice(0, 10);
      expect(localDay).not.toBe(utcDay);

      await complete(student, a);
      await complete(student, b);
      await complete(student, a);
      let map = await getMyActivity(db, student);
      expect(map.timezone).toBe(timezone);
      expect(map.to).toBe(localDay);
      expect(map.days).toEqual([
        {
          date: localDay,
          total: 2,
          lessonsCompleted: 2,
          forumPosts: 0,
          communityActions: 0,
          level: 2,
        },
      ]);
      // 53 semanas: começa num domingo, 52 semanas antes da semana corrente.
      const from = new Date(`${map.from}T00:00:00Z`);
      const to = new Date(`${map.to}T00:00:00Z`);
      expect(from.getUTCDay()).toBe(0);
      expect((to.getTime() - from.getTime()) / 86_400_000).toBe(364 + to.getUTCDay());

      // Desfazer tira a ação do dia; o dia zerado sai da lista.
      await saveLessonProgress(db, student, a, { completed: false });
      map = await getMyActivity(db, student);
      expect(map.days.map((day) => day.total)).toEqual([1]);
      await saveLessonProgress(db, student, b, { completed: false });
      expect((await getMyActivity(db, student)).days).toEqual([]);
      // Dia fora da janela não aparece.
      await complete(student, c);
      await sql`UPDATE activity_days SET day = day - 400 WHERE user_id = ${student.id}::uuid`.execute(
        db,
      );
      expect((await getMyActivity(db, student)).days).toEqual([]);
    } finally {
      await setSetting(db, 'school.timezone', 'America/Sao_Paulo');
    }
  });
});

describe('leituras da equipe', () => {
  it('progresso de um usuário, com o alcance do instrutor', async () => {
    const instructor = await makeUser('instructor');
    const outsider = await makeUser('instructor');
    const student = await makeUser();
    const own = await courseWith(2, { ownerId: instructor.id, title: 'Alfa do instrutor' });
    const other = await courseWith(2, { title: 'Beta da escola' });
    const open = await courseWith(1, { mode: 'open', title: 'Gama aberto' });
    const sampleOnly = await makeCourse({ title: 'Delta só amostra' });
    const sample = await makeLesson(await makeModule(sampleOnly.id, 0), 0, { sample: true });
    await courseWith(1, { mode: 'open', title: 'Aberto nunca visto' });
    await grant(student, own.id);
    await grant(student, other.id);
    await complete(student, own.lessons[0] as string);
    await complete(student, open.lessons[0] as string);
    await complete(student, sample);

    const all = await getUserProgress(db, requestOf(admin), student.id);
    expect(all.items.map((item) => item.course.title)).toEqual([
      'Alfa do instrutor',
      'Beta da escola',
      'Gama aberto',
    ]);
    expect(all.items[0]).toMatchObject({
      course: { type: 'course', id: own.id },
      progress: { completedLessons: 1, totalLessons: 2, percent: 50, state: 'in_progress' },
    });
    expect(all.items[0]?.lastActivityAt).toBeInstanceOf(Date);
    expect(all.items[1]).toMatchObject({
      progress: { state: 'not_started' },
      lastActivityAt: null,
    });
    expect(all.items[2]?.progress.state).toBe('completed');

    const scoped = await getUserProgress(db, requestOf(instructor), student.id);
    expect(scoped.items.map((item) => item.course.id)).toEqual([own.id]);
    await expectError(getUserProgress(db, requestOf(outsider), student.id), 404, 'not_found');
    await expectError(getUserProgress(db, requestOf(admin), crypto.randomUUID()), 404, 'not_found');
    expect(await getUserProgress(db, requestOf(admin), outsider.id)).toEqual({ items: [] });

    const before = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_log WHERE outcome = 'denied'`.execute(db);
    await expectError(
      getUserProgress(db, requestOf(student), student.id),
      403,
      'permission_denied',
    );
    await expectError(
      getCourseProgressSummary(db, requestOf(student), own.id),
      403,
      'permission_denied',
    );
    const after = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_log WHERE outcome = 'denied'`.execute(db);
    expect((after.rows[0]?.n ?? 0) - (before.rows[0]?.n ?? 0)).toBe(2);
  });

  it('resumo por faixa e alunos do curso', async () => {
    const instructor = await makeUser('instructor');
    const outsider = await makeUser('instructor');
    const course = await courseWith(4, { ownerId: instructor.id });
    const names = ['Ana', 'Bia', 'Caio', 'Davi', 'Eva', 'Fábio'];
    const students: LearningViewer[] = [];
    for (const name of names) {
      const student = await makeUser('student', name);
      await grant(student, course.id);
      students.push(student);
    }
    const [ana, bia, caio, davi, eva, fabio] = students as [
      LearningViewer,
      LearningViewer,
      LearningViewer,
      LearningViewer,
      LearningViewer,
      LearningViewer,
    ];
    const completeN = async (student: LearningViewer, n: number) => {
      for (const lesson of course.lessons.slice(0, n)) await complete(student, lesson);
    };
    await completeN(ana, 4);
    await completeN(bia, 3);
    await completeN(caio, 2);
    await completeN(davi, 1);
    await getLessonView(db, eva, course.lessons[0] as string);
    // Fábio não abriu nada; quem perdeu o acesso e a conta excluída ficam fora.
    const gone = await makeUser('student', 'Vencido');
    await grant(gone, course.id);
    await completeN(gone, 4);
    await expire(gone, course.id);
    const deleted = await makeUser('student', 'Excluída');
    await grant(deleted, course.id);
    await db
      .updateTable('users')
      .set({ deletedAt: new Date() })
      .where('id', '=', deleted.id)
      .execute();
    await sql`UPDATE entitlements SET expires_at = now() + interval '30 days'
               WHERE user_id = ${bia.id}::uuid AND product_id = ${course.id}::uuid`.execute(db);
    await openedAt(ana, course.lessons[0] as string, 100);

    const summary = await getCourseProgressSummary(db, requestOf(instructor), course.id);
    expect(summary).toEqual({
      courseId: course.id,
      totalLessons: 4,
      studentCount: 6,
      buckets: { notStarted: 2, upTo25: 1, upTo50: 1, upTo75: 1, upTo99: 0, completed: 1 },
      completionRate: 0.1667,
    });
    await expectError(
      getCourseProgressSummary(db, requestOf(outsider), course.id),
      404,
      'not_found',
    );
    await expectError(getCourseProgressSummary(db, requestOf(admin), 'x'), 404, 'not_found');
    const empty = await courseWith(0);
    expect(await getCourseProgressSummary(db, requestOf(admin), empty.id)).toMatchObject({
      totalLessons: 0,
      studentCount: 0,
      completionRate: 0,
    });

    const list = (query: Record<string, unknown> = {}) =>
      listCourseStudents(db, requestOf(instructor), course.id, query);
    const byName = await list({ sort: 'name' });
    expect(byName.items.map((item) => item.user.name)).toEqual(names);
    expect(byName.nextCursor).toBeNull();
    expect(byName.items[0]).toMatchObject({
      user: { id: ana.id, name: 'Ana', avatarUrl: null },
      progress: { completedLessons: 4, percent: 100, state: 'completed' },
      accessExpiresAt: null,
    });
    expect(byName.items[1]?.accessExpiresAt).toBeInstanceOf(Date);
    expect(byName.items[4]).toMatchObject({ progress: { state: 'in_progress', percent: 0 } });
    expect(byName.items[5]).toMatchObject({
      user: { id: fabio.id },
      progress: { state: 'not_started' },
      lastActivityAt: null,
    });
    expect(JSON.stringify(byName)).not.toContain('@example.com');

    expect(
      (await list({ sort: '-percent' })).items.map((item) => item.user.name).slice(0, 4),
    ).toEqual(['Ana', 'Bia', 'Caio', 'Davi']);
    const recent = await list();
    expect(recent.items.at(-1)?.user.id).toBe(fabio.id);
    const names2 = async (query: Record<string, unknown>) =>
      (await list({ sort: 'name', ...query })).items.map((item) => item.user.name);
    expect(await names2({ state: 'completed' })).toEqual(['Ana']);
    expect(await names2({ state: 'in_progress' })).toEqual(['Bia', 'Caio', 'Davi', 'Eva']);
    expect(await names2({ state: 'not_started' })).toEqual(['Fábio']);
    // Busca por trecho, sem diferenciar maiúsculas (acento diferencia).
    expect(await names2({ q: 'A' })).toEqual(['Ana', 'Bia', 'Caio', 'Davi', 'Eva']);
    expect(await names2({ q: 'ai' })).toEqual(['Caio']);

    // Paginação por cursor, na ordem pedida.
    const first = await list({ sort: 'name', limit: 4 });
    expect(first.items).toHaveLength(4);
    const second = await list({ sort: 'name', limit: 4, cursor: first.nextCursor });
    expect(second.items.map((item) => item.user.name)).toEqual(['Eva', 'Fábio']);
    expect(second.nextCursor).toBeNull();
    await expectError(list({ cursor: first.nextCursor }), 400, 'validation_failed');
    await expectError(list({ cursor: 'x' }), 400, 'validation_failed');
    await expectError(list({ cursor: 7 }), 400, 'validation_failed');
    await expectError(list({ state: 'x' }), 400, 'validation_failed');
    await expectError(list({ sort: 'x' }), 400, 'validation_failed');
    await expectError(listCourseStudents(db, requestOf(outsider), course.id), 404, 'not_found');

    // Curso aberto: aluno é quem abriu alguma aula.
    const open = await courseWith(1, { mode: 'open' });
    await complete(eva, open.lessons[0] as string);
    const openStudents = await listCourseStudents(db, requestOf(admin), open.id);
    expect(openStudents.items).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ id: eva.id }),
        accessExpiresAt: null,
        progress: expect.objectContaining({ state: 'completed' }),
      }),
    ]);
    expect((await getCourseProgressSummary(db, requestOf(admin), open.id)).completionRate).toBe(1);
  });
});

describe('conferência de conclusão', () => {
  it('enfileira course.completed de quem chegou a 100% e tem acesso, em lotes', async () => {
    const course = await courseWith(3);
    const [a, b, c] = course.lessons as [string, string, string];
    const reached: LearningViewer[] = [];
    for (let index = 0; index < 3; index += 1) {
      const student = await makeUser();
      await grant(student, course.id);
      await complete(student, a);
      await complete(student, b);
      reached.push(student);
    }
    const behind = await makeUser();
    await grant(behind, course.id);
    await complete(behind, a);
    const lapsed = await makeUser();
    await grant(lapsed, course.id);
    await complete(lapsed, a);
    await complete(lapsed, b);
    await expire(lapsed, course.id);
    expect((await getCourseCompletion(db, reached[0]?.id as string, course.id)).completed).toBe(
      false,
    );

    // A terceira aula sai do programa: três alunos passam a ter 100%.
    await db.updateTable('lessons').set({ status: 'draft' }).where('id', '=', c).execute();
    const outcome = await enqueueCourseCompletions(db, course.id, { batchSize: 2 });
    expect(outcome).toEqual({ candidates: 3, enqueued: 3 });
    for (const student of reached) expect(await completedJobs(student.id, course.id)).toBe(1);
    expect(await completedJobs(behind.id, course.id)).toBe(0);
    expect(await completedJobs(lapsed.id, course.id)).toBe(0);
    // De novo, com as tarefas ainda na fila: nenhuma duplicada.
    expect(await enqueueCourseCompletions(db, course.id)).toEqual({ candidates: 3, enqueued: 0 });

    const draft = await courseWith(1, { published: false });
    expect(await enqueueCourseCompletions(db, draft.id)).toEqual({ candidates: 0, enqueued: 0 });
    expect(await enqueueCourseCompletions(db, 'x')).toEqual({ candidates: 0, enqueued: 0 });
    expect(await getCourseCompletion(db, 'x', course.id)).toMatchObject({
      completed: false,
      totalLessons: 0,
    });
    expect(await getCourseCompletion(db, behind.id, course.id)).toMatchObject({
      completed: false,
      completedLessons: 1,
      totalLessons: 2,
      completedAt: null,
    });
  });
});
