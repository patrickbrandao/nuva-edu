import { randomUUID } from 'node:crypto';
import { grantManualEntitlement, type Role } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  createUser,
  isolatedDatabase,
  type Reply,
  TEST_PASSWORD,
  type TestUser,
} from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

// Progresso, estante, "continue assistindo", "meu progresso", atividade e "meus ebooks"
// (spec 014; tarefa 431). Banco só deste arquivo: a estante e a fila são conferidas inteiras.
// O catálogo é gravado direto nas tabelas (a escrita é da admin-api). Toda rota é chamada pelo
// HTTP: a validação de resposta do contrato roda em cada uma.

const VIDEO_URL = 'https://youtu.be/segredo-video-431';
const FILE_URL = 'https://arquivos.exemplo.test/segredo-ebook-431.pdf';

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;

/** Só a aula aberta pode levar URL de conteúdo. */
const withContent = new WeakSet<Reply>();
const replies: Reply[] = [];
function scan(reply: Reply): void {
  replies.push(reply);
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
}

type Mode = 'open' | 'paid' | 'private';
interface Product {
  id: string;
  slug: string;
}

function productValues(prefix: string, mode: Mode, title: string) {
  return {
    slug: `${prefix}-${randomUUID().slice(0, 13)}`,
    title,
    summary: `Resumo de ${title}`,
    accessMode: mode,
    priceCents: mode === 'open' ? null : 9900,
    status: 'published',
    publishedAt: new Date(),
  };
}

function makeCourse(mode: Mode, title: string): Promise<Product> {
  return test.db
    .insertInto('courses')
    .values({ ...productValues('curso', mode, title), level: 'beginner' })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
}

async function makeModule(courseId: string, position: number): Promise<string> {
  const row = await test.db
    .insertInto('modules')
    .values({ courseId, title: `Módulo ${position + 1}`, position })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeLesson(moduleId: string, position: number, sample = false): Promise<string> {
  const row = await test.db
    .insertInto('lessons')
    .values({
      moduleId,
      title: `Aula ${position + 1}`,
      videoUrl: VIDEO_URL,
      videoProvider: 'youtube',
      durationSeconds: 60,
      isSample: sample,
      status: 'published',
      position,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

let admin: TestUser;
async function grant(user: TestUser, productType: 'course' | 'ebook', productId: string) {
  await grantManualEntitlement(
    test.db,
    {
      actor: { id: admin.id, role: 'admin' as Role },
      context: { ip: '127.0.0.1', userAgent: null, requestId: 'teste-431' },
    },
    user.id,
    { productType, productId, reason: 'Teste das rotas de aprendizado' },
  );
}

async function loggedIn(user: TestUser): Promise<Browser> {
  const session = new Browser(test.app, scan);
  expect((await session.login(user.email)).statusCode).toBe(200);
  return session;
}

/** Abre a aula (a resposta leva a URL do vídeo). */
async function openLesson(session: Browser, lessonId: string): Promise<Reply> {
  const reply = await session.request('GET', `/api/v1/lessons/${lessonId}`);
  withContent.add(reply);
  return reply;
}

function save(session: Browser, lessonId: string, payload: unknown): Promise<Reply> {
  return session.request('PUT', `/api/v1/lessons/${lessonId}/progress`, { payload });
}

function completedJobs(userId: string, courseId: string) {
  return test.db
    .selectFrom('jobs')
    .select(['id', 'payload', 'uniqueKey'])
    .where('type', '=', 'course.completed')
    .where('uniqueKey', '=', `course.completed:${userId}:${courseId}`)
    .execute();
}

let paid: Product;
let moduleA: string;
let moduleB: string;
let lesson1: string;
let lesson2: string;
let lesson3: string;
let other: Product;
let otherLesson: string;
let hidden: Product;
let ebook: Product;
let student: TestUser;
let outsider: TestUser;
let lapsed: TestUser;

beforeAll(async () => {
  database = await isolatedDatabase();
  test = createTestApp({ DATABASE_URL: database.url });

  admin = await createUser(test.db, { role: 'admin' });
  student = await createUser(test.db);
  outsider = await createUser(test.db);
  lapsed = await createUser(test.db);

  // Curso pago com 2 módulos e 3 aulas; a primeira é amostra.
  paid = await makeCourse('paid', 'Curso de progresso');
  moduleA = await makeModule(paid.id, 0);
  moduleB = await makeModule(paid.id, 1);
  lesson1 = await makeLesson(moduleA, 0, true);
  lesson2 = await makeLesson(moduleA, 1);
  lesson3 = await makeLesson(moduleB, 0);

  other = await makeCourse('paid', 'Curso ainda não iniciado');
  otherLesson = await makeLesson(await makeModule(other.id, 0), 0);
  hidden = await makeCourse('private', 'Curso privado');
  await makeLesson(await makeModule(hidden.id, 0), 0);

  ebook = await test.db
    .insertInto('ebooks')
    .values({ ...productValues('ebook', 'paid', 'Ebook da estante'), fileUrl: FILE_URL, pages: 80 })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();

  await grant(student, 'course', paid.id);
  await grant(student, 'course', other.id);
  await grant(student, 'ebook', ebook.id);

  // Direito vencido: concedido e depois movido para o passado.
  await grant(lapsed, 'course', paid.id);
  await test.db
    .updateTable('entitlements')
    .set({
      startsAt: new Date(Date.now() - 2 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    })
    .where('userId', '=', lapsed.id)
    .execute();
}, 120_000);

afterAll(async () => {
  for (const reply of replies) {
    if (withContent.has(reply)) continue;
    expect(reply.body).not.toContain('segredo-');
    expect(reply.body).not.toMatch(/video_?url|file_?url/i);
  }
  expect(test.logText()).not.toContain(TEST_PASSWORD);
  await test.close();
  await database.drop();
});

describe('sem sessão', () => {
  it('toda rota de aprendizado responde 401', async () => {
    const visitor = new Browser(test.app, scan);
    for (const url of [
      '/api/v1/me/courses',
      '/api/v1/me/continue',
      '/api/v1/me/progress',
      '/api/v1/me/activity',
      '/api/v1/me/ebooks',
      `/api/v1/courses/${paid.slug}/progress`,
    ]) {
      expect((await visitor.request('GET', url)).statusCode, url).toBe(401);
    }
    expect((await save(visitor, lesson1, { completed: false })).statusCode).toBe(401);
  });
});

describe('antes de começar', () => {
  it('estante: cursos com direito, não iniciados, com "Comece por aqui"', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', '/api/v1/me/courses');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const shelf = reply.json();
    expect(shelf.counts).toMatchObject({
      all: 2,
      inProgress: 0,
      notStarted: 2,
      completed: 0,
      completedLessonSeconds: 0,
    });
    expect([paid.id, other.id]).toContain(shelf.startHereCourseId);
    expect(shelf.items).toHaveLength(2);
    const item = shelf.items.find((course: { id: string }) => course.id === paid.id);
    expect(item).toMatchObject({
      slug: paid.slug,
      progress: { completedLessons: 0, totalLessons: 3, percent: 0, state: 'not_started' },
      access: { state: 'active', expiresAt: null },
      action: 'start',
      lastAccessedAt: null,
      certificate: { state: 'in_progress', certificateId: null, code: null },
    });
    expect(item).not.toHaveProperty('certificateEnabled');
  });

  it('continuar, meu progresso e atividade vêm vazios', async () => {
    const session = await loggedIn(student);
    expect((await session.request('GET', '/api/v1/me/continue')).json()).toEqual({ items: [] });
    expect((await session.request('GET', '/api/v1/me/progress')).json()).toEqual({ items: [] });
    const activity = await session.request('GET', '/api/v1/me/activity');
    expect(activity.statusCode).toBe(200);
    expect(activity.headers['cache-control']).toBe('private, no-cache');
    expect(activity.json()).toMatchObject({ timezone: expect.any(String), days: [] });
    expect(activity.json().from < activity.json().to).toBe(true);
  });

  it('filtro, busca e ordem da estante; parâmetro fora do contrato: 400', async () => {
    const session = await loggedIn(student);
    const found = await session.request('GET', '/api/v1/me/courses?q=progresso&sort=title');
    expect(found.json().items.map((course: { id: string }) => course.id)).toEqual([paid.id]);
    expect(found.json().counts.all).toBe(2);
    const none = await session.request('GET', '/api/v1/me/courses?filter=completed');
    expect(none.json().items).toEqual([]);
    expect((await session.request('GET', '/api/v1/me/courses?filter=x')).statusCode).toBe(400);
    expect((await session.request('GET', '/api/v1/me/courses?sort=x')).statusCode).toBe(400);
  });
});

describe('abrir a aula (GET /lessons/{id})', () => {
  it('grava a abertura e devolve o userState; reabrir avança lastOpenedAt', async () => {
    const session = await loggedIn(student);
    const first = await openLesson(session, lesson1);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const state = first.json().userState;
    expect(state).toMatchObject({ completedAt: null, completedVia: null, positionSeconds: 0 });
    expect(Date.parse(state.lastOpenedAt)).not.toBeNaN();
    const again = (await openLesson(session, lesson1)).json().userState;
    expect(Date.parse(again.lastOpenedAt)).toBeGreaterThanOrEqual(Date.parse(state.lastOpenedAt));

    const course = (await session.request('GET', `/api/v1/courses/${paid.slug}`)).json();
    expect(course).toMatchObject({
      progress: { completedLessons: 0, totalLessons: 3, percent: 0, state: 'in_progress' },
      continueLessonId: lesson1,
      certificate: { state: 'in_progress', certificateId: null },
    });
  });

  it('acesso negado não grava abertura', async () => {
    const session = await loggedIn(outsider);
    expect((await session.request('GET', `/api/v1/lessons/${lesson2}`)).statusCode).toBe(403);
    const rows = await test.db
      .selectFrom('lessonProgress')
      .select('lessonId')
      .where('userId', '=', outsider.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it('admin abre a aula sem direito (acesso de equipe)', async () => {
    const session = await loggedIn(admin);
    expect((await openLesson(session, lesson2)).statusCode).toBe(200);
  });
});

describe('gravar o progresso (PUT /lessons/{id}/progress)', () => {
  it('sem o X-CSRF-Token: 403', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('PUT', `/api/v1/lessons/${lesson1}/progress`, {
      payload: { positionSeconds: 5 },
      csrf: false,
    });
    expect(reply.statusCode).toBe(403);
  });

  it('corpo fora do contrato: 400', async () => {
    const session = await loggedIn(student);
    expect((await save(session, lesson1, {})).statusCode).toBe(400);
    expect((await save(session, lesson1, { completed: 'sim' })).statusCode).toBe(400);
    expect((await save(session, lesson1, { completed: true })).statusCode).toBe(400);
    expect((await save(session, lesson1, { completed: true, extra: 1 })).statusCode).toBe(400);
    expect((await save(session, 'abc', { completed: false })).statusCode).toBe(400);
  });

  it('aula inexistente: 404', async () => {
    const session = await loggedIn(student);
    expect((await save(session, randomUUID(), { positionSeconds: 1 })).statusCode).toBe(404);
  });

  it('concluir sem acesso: 403 access_denied com o motivo', async () => {
    const session = await loggedIn(outsider);
    const reply = await save(session, lesson2, { completed: true, completedVia: 'manual' });
    expect(reply.statusCode).toBe(403);
    expect(reply.headers['content-type']).toContain('application/problem+json');
    expect(reply.json()).toMatchObject({ code: 'access_denied', reason: 'no_entitlement' });
  });

  it('direito vencido: 403 com reason expired, e a estante mostra "Renovar acesso"', async () => {
    const session = await loggedIn(lapsed);
    const reply = await save(session, lesson2, { completed: true, completedVia: 'manual' });
    expect(reply.statusCode).toBe(403);
    expect(reply.json()).toMatchObject({ code: 'access_denied', reason: 'expired' });
    const shelf = (await session.request('GET', '/api/v1/me/courses')).json();
    expect(shelf.items).toMatchObject([
      { id: paid.id, access: { state: 'expired' }, action: 'renew', continueLessonId: null },
    ]);
  });

  it('posição fora da faixa: 422 position_out_of_range', async () => {
    const session = await loggedIn(student);
    for (const positionSeconds of [-1, 60 + 60 + 1]) {
      const reply = await save(session, lesson1, { positionSeconds });
      expect(reply.statusCode).toBe(422);
      expect(reply.json()).toMatchObject({ code: 'position_out_of_range' });
    }
  });

  it('grava a posição (fração descartada) e null zera', async () => {
    const session = await loggedIn(student);
    const reply = await save(session, lesson1, { positionSeconds: 42.7 });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      lessonId: lesson1,
      userState: { positionSeconds: 42, completedAt: null },
      module: { id: moduleA },
      course: { id: paid.id, progress: { completedLessons: 0, totalLessons: 3 } },
      countsForCourse: true,
    });
    expect(reply.json()).not.toHaveProperty('courseCompleted');
    expect((await openLesson(session, lesson1)).json().userState.positionSeconds).toBe(42);

    const list = (await session.request('GET', '/api/v1/me/continue')).json();
    expect(list.items).toMatchObject([
      {
        course: { id: paid.id, slug: paid.slug },
        lesson: { id: lesson1, positionSeconds: 42 },
        progress: { state: 'in_progress' },
      },
    ]);

    const zeroed = await save(session, lesson1, { positionSeconds: null });
    expect(zeroed.json().userState.positionSeconds).toBe(0);
  });

  it('amostra de curso que o aluno não tem: grava, mas não conta para o curso', async () => {
    const session = await loggedIn(outsider);
    const reply = await save(session, lesson1, { completed: true, completedVia: 'video_end' });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      userState: { completedVia: 'video_end' },
      course: { progress: { completedLessons: 0, percent: 0, state: 'not_started' } },
      countsForCourse: false,
    });
    const course = (await session.request('GET', `/api/v1/courses/${paid.slug}`)).json();
    expect(course.progress).toMatchObject({ completedLessons: 0, state: 'not_started' });
    expect(course.continueLessonId).toBeNull();
    expect(course.modules[0].lessons[0]).toMatchObject({ id: lesson1, completed: false });
  });

  it('concluir é idempotente, desmarcar desfaz, e a última aula enfileira course.completed', async () => {
    const session = await loggedIn(student);
    const first = await save(session, lesson1, { completed: true, completedVia: 'manual' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      userState: { completedVia: 'manual' },
      module: { id: moduleA, progress: { completedLessons: 1, totalLessons: 2, percent: 50 } },
      course: { progress: { completedLessons: 1, totalLessons: 3, state: 'in_progress' } },
    });
    const { completedAt } = first.json().userState;
    expect(completedAt).not.toBeNull();

    const repeat = await save(session, lesson1, { completed: true, completedVia: 'video_end' });
    expect(repeat.json().userState).toMatchObject({ completedAt, completedVia: 'manual' });

    const undone = await save(session, lesson1, { completed: false });
    expect(undone.json()).toMatchObject({
      userState: { completedAt: null, completedVia: null },
      course: { progress: { completedLessons: 0 } },
    });

    for (const lessonId of [lesson1, lesson2]) {
      const reply = await save(session, lessonId, { completed: true, completedVia: 'manual' });
      expect(reply.statusCode).toBe(200);
    }
    expect(await completedJobs(student.id, paid.id)).toEqual([]);

    const last = await save(session, lesson3, { completed: true, completedVia: 'video_end' });
    expect(last.json()).toMatchObject({
      module: { id: moduleB, progress: { completedLessons: 1, totalLessons: 1, percent: 100 } },
      course: {
        progress: { completedLessons: 3, totalLessons: 3, percent: 100, state: 'completed' },
      },
    });
    const jobs = await completedJobs(student.id, paid.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({ userId: student.id, courseId: paid.id });

    // Repetir a conclusão não enfileira de novo.
    await save(session, lesson3, { completed: true, completedVia: 'manual' });
    expect(await completedJobs(student.id, paid.id)).toHaveLength(1);
  });
});

describe('depois de concluir o curso', () => {
  it('GET /courses/{slug}: progresso por módulo e aula', async () => {
    const session = await loggedIn(student);
    const course = (await session.request('GET', `/api/v1/courses/${paid.slug}`)).json();
    expect(course.progress).toMatchObject({
      completedLessons: 3,
      percent: 100,
      state: 'completed',
    });
    expect(course.modules.map((module: { progress: unknown }) => module.progress)).toMatchObject([
      { completedLessons: 2, totalLessons: 2, state: 'completed' },
      { completedLessons: 1, totalLessons: 1, state: 'completed' },
    ]);
    expect(
      course.modules.flatMap((module: { lessons: { completed: boolean }[] }) =>
        module.lessons.map((lesson) => lesson.completed),
      ),
    ).toEqual([true, true, true]);
  });

  it('GET /courses/{slug}/progress: por módulo e aula; privado sem direito e inexistente: 404', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', `/api/v1/courses/${paid.slug}/progress`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const progress = reply.json();
    expect(progress).toMatchObject({
      courseId: paid.id,
      progress: { completedLessons: 3, totalLessons: 3, percent: 100 },
    });
    expect(progress.modules).toMatchObject([
      { id: moduleA, lessons: [{ id: lesson1 }, { id: lesson2 }] },
      { id: moduleB, lessons: [{ id: lesson3 }] },
    ]);
    expect(progress.modules[0].lessons[0].completedAt).not.toBeNull();

    const untouched = await session.request('GET', `/api/v1/courses/${other.slug}/progress`);
    expect(untouched.json()).toMatchObject({
      progress: { completedLessons: 0, totalLessons: 1, state: 'not_started' },
      modules: [{ lessons: [{ id: otherLesson, completedAt: null }] }],
    });

    expect(
      (await session.request('GET', `/api/v1/courses/${hidden.slug}/progress`)).statusCode,
    ).toBe(404);
    expect((await session.request('GET', '/api/v1/courses/nao-existe/progress')).statusCode).toBe(
      404,
    );
  });

  it('estante: contadores, filtro "completed" e ação "Rever"', async () => {
    const session = await loggedIn(student);
    const shelf = (await session.request('GET', '/api/v1/me/courses?filter=completed')).json();
    expect(shelf.counts).toMatchObject({
      all: 2,
      inProgress: 0,
      notStarted: 1,
      completed: 1,
      completedLessonSeconds: 180,
    });
    expect(shelf.startHereCourseId).toBeNull();
    expect(shelf.items).toMatchObject([
      // Concluído sem template de certificado: aguarda o instrutor (spec 015, RF-12).
      {
        id: paid.id,
        action: 'review',
        progress: { percent: 100 },
        certificate: { state: 'awaiting_template', certificateId: null, code: null },
      },
    ]);
    expect(shelf.items[0].lastAccessedAt).not.toBeNull();
    // Curso concluído sai de "continue assistindo".
    expect((await session.request('GET', '/api/v1/me/continue')).json()).toEqual({ items: [] });
  });

  it('meu progresso: o curso iniciado, um quadrado por aula', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', '/api/v1/me/progress');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    expect(reply.json().items).toMatchObject([
      {
        course: { id: paid.id, slug: paid.slug, title: 'Curso de progresso' },
        progress: { completedLessons: 3, percent: 100 },
        modules: [{ id: moduleA }, { id: moduleB }],
      },
    ]);
  });

  it('atividade: as conclusões contam no dia de hoje; a desfeita não conta', async () => {
    const session = await loggedIn(student);
    const map = (await session.request('GET', '/api/v1/me/activity')).json();
    expect(map.days).toEqual([
      {
        date: map.to,
        total: 3,
        lessonsCompleted: 3,
        forumPosts: 0,
        communityActions: 0,
        level: 2,
      },
    ]);
  });

  it('meus ebooks: os com direito ativo, sem a URL do arquivo', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', '/api/v1/me/ebooks');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    expect(reply.json()).toEqual({
      items: [
        {
          id: ebook.id,
          slug: ebook.slug,
          title: 'Ebook da estante',
          cover: null,
          authorName: null,
          pages: 80,
          expiresAt: null,
        },
      ],
    });
    const none = await loggedIn(outsider);
    expect((await none.request('GET', '/api/v1/me/ebooks')).json()).toEqual({ items: [] });
  });
});
