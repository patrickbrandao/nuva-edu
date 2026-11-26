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

// Anotações (spec 016; tarefa 432). Banco só deste arquivo: os tetos (5.000 por usuário, 100 por
// aula) são preenchidos direto na tabela. Toda rota é chamada pelo HTTP: a validação de resposta
// do contrato roda em cada uma, inclusive no problem+json do `409` com `current`.

/** Marca presente em todo corpo e título de nota do teste: não pode aparecer no log. */
const SECRET = 'segredo-da-nota-432';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;

function scan(reply: Reply): void {
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
}

interface Course {
  id: string;
  slug: string;
}

function makeCourse(title: string): Promise<Course> {
  return test.db
    .insertInto('courses')
    .values({
      slug: `curso-${randomUUID().slice(0, 13)}`,
      title,
      summary: `Resumo de ${title}`,
      accessMode: 'paid',
      priceCents: 9900,
      status: 'published',
      publishedAt: new Date(),
      level: 'beginner',
    })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
}

async function makeLesson(
  courseId: string,
  title: string,
  status = 'published',
  position = 0,
): Promise<string> {
  const module = await test.db
    .insertInto('modules')
    .values({ courseId, title: `Módulo de ${title}`, position })
    .returning('id')
    .executeTakeFirstOrThrow();
  const row = await test.db
    .insertInto('lessons')
    .values({
      moduleId: module.id,
      title,
      videoUrl: 'https://youtu.be/video-432',
      videoProvider: 'youtube',
      durationSeconds: 600,
      isSample: false,
      status,
      position: 0,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

let admin: TestUser;
async function grant(user: TestUser, courseId: string) {
  await grantManualEntitlement(
    test.db,
    {
      actor: { id: admin.id, role: 'admin' as Role },
      context: { ip: '127.0.0.1', userAgent: null, requestId: 'teste-432' },
    },
    user.id,
    { productType: 'course', productId: courseId, reason: 'Teste das rotas de anotações' },
  );
}

async function loggedIn(user: TestUser): Promise<Browser> {
  const session = new Browser(test.app, scan);
  expect((await session.login(user.email)).statusCode).toBe(200);
  return session;
}

function create(session: Browser, payload: unknown): Promise<Reply> {
  return session.request('POST', '/api/v1/notes', { payload });
}

function patch(session: Browser, id: string, payload: unknown): Promise<Reply> {
  return session.request('PATCH', `/api/v1/notes/${id}`, { payload });
}

async function created(session: Browser, payload: Record<string, unknown>) {
  const reply = await create(session, payload);
  expect(reply.statusCode, reply.body).toBe(201);
  return reply.json() as {
    id: string;
    title: string | null;
    body: string;
    videoSeconds: number | null;
    createdAt: string;
    updatedAt: string;
  };
}

let course: Course;
let lesson: string;
let secondCourse: Course;
let secondLesson: string;
let draftLesson: string;
let student: TestUser;
let outsider: TestUser;

beforeAll(async () => {
  database = await isolatedDatabase();
  test = createTestApp({ DATABASE_URL: database.url });

  admin = await createUser(test.db, { role: 'admin' });
  student = await createUser(test.db);
  outsider = await createUser(test.db);

  course = await makeCourse('Curso das anotações');
  lesson = await makeLesson(course.id, 'Aula anotada');
  draftLesson = await makeLesson(course.id, 'Aula em rascunho', 'draft', 1);
  secondCourse = await makeCourse('Outro curso');
  secondLesson = await makeLesson(secondCourse.id, 'Aula do outro curso');

  await grant(student, course.id);
  await grant(student, secondCourse.id);
}, 120_000);

afterAll(async () => {
  // O texto e o título das notas não vão para o log (spec 016, "Privacidade").
  expect(test.logText()).not.toContain(SECRET);
  expect(test.logText()).not.toContain(TEST_PASSWORD);
  await test.close();
  await database.drop();
});

describe('sem sessão ou sem CSRF', () => {
  it('toda rota de anotações responde 401 sem sessão', async () => {
    const visitor = new Browser(test.app, scan);
    const id = randomUUID();
    for (const [method, url, payload] of [
      ['GET', '/api/v1/notes'],
      ['POST', '/api/v1/notes', { body: SECRET }],
      ['GET', `/api/v1/notes/${id}`],
      ['PATCH', `/api/v1/notes/${id}`, { updatedAt: new Date().toISOString() }],
      ['DELETE', `/api/v1/notes/${id}`],
      ['GET', `/api/v1/lessons/${lesson}/notes`],
    ] as const) {
      const reply = await visitor.request(method, url, payload ? { payload } : {});
      expect(reply.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('escrita sem o X-CSRF-Token: 403', async () => {
    const session = await loggedIn(student);
    const note = await created(session, { body: `${SECRET} csrf` });
    const off = { csrf: false };
    const post = await session.request('POST', '/api/v1/notes', {
      payload: { body: SECRET },
      ...off,
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().code).toBe('csrf_token_invalid');
    const edit = await session.request('PATCH', `/api/v1/notes/${note.id}`, {
      payload: { updatedAt: note.updatedAt, body: `${SECRET} x` },
      ...off,
    });
    expect(edit.statusCode).toBe(403);
    expect((await session.request('DELETE', `/api/v1/notes/${note.id}`, off)).statusCode).toBe(403);
    expect((await session.request('DELETE', `/api/v1/notes/${note.id}`)).statusCode).toBe(204);
  });
});

describe('criar (POST /notes)', () => {
  it('nota avulsa: 201, título sem os espaços das pontas, sem aula nem instante', async () => {
    const session = await loggedIn(student);
    const reply = await create(session, {
      title: `  ${SECRET} título  `,
      body: `${SECRET} avulsa`,
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const note = reply.json();
    expect(note).toEqual({
      id: expect.any(String),
      lesson: null,
      videoSeconds: null,
      title: `${SECRET} título`,
      body: `${SECRET} avulsa`,
      createdAt: expect.stringMatching(ISO),
      updatedAt: expect.stringMatching(ISO),
    });
    const blank = await created(session, { title: '   ', lessonId: null, body: `${SECRET} b` });
    expect(blank.title).toBeNull();
  });

  it('nota de aula: link de volta e fração do instante descartada', async () => {
    const session = await loggedIn(student);
    const reply = await create(session, {
      lessonId: lesson,
      body: `${SECRET} de aula`,
      videoSeconds: 83.9,
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({
      lesson: {
        id: lesson,
        title: 'Aula anotada',
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: 'Curso das anotações',
        available: true,
      },
      videoSeconds: 83,
      title: null,
    });
  });

  it('sem acesso à aula: 403 access_denied com o motivo', async () => {
    const session = await loggedIn(outsider);
    const reply = await create(session, { lessonId: lesson, body: `${SECRET} negada` });
    expect(reply.statusCode).toBe(403);
    expect(reply.headers['content-type']).toContain('application/problem+json');
    expect(reply.json()).toMatchObject({ code: 'access_denied', reason: 'no_entitlement' });
  });

  it('aula inexistente ou despublicada: 404', async () => {
    const session = await loggedIn(student);
    for (const lessonId of [randomUUID(), draftLesson]) {
      const reply = await create(session, { lessonId, body: `${SECRET} 404` });
      expect(reply.statusCode).toBe(404);
      expect(reply.json().code).toBe('not_found');
    }
  });

  it('limites de conteúdo: 422 com o code', async () => {
    const session = await loggedIn(student);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ body: '   \n ' }, 'note_empty'],
      [{ body: 'a'.repeat(20_001) }, 'note_too_long'],
      [{ lessonId: lesson, body: SECRET, videoSeconds: -1 }, 'note_video_seconds_invalid'],
      [
        { lessonId: lesson, body: SECRET, videoSeconds: 2_147_483_648 },
        'note_video_seconds_invalid',
      ],
      [{ body: SECRET, videoSeconds: 10 }, 'note_video_seconds_invalid'],
    ];
    for (const [payload, code] of cases) {
      const reply = await create(session, payload);
      expect(reply.statusCode, code).toBe(422);
      expect(reply.json().code).toBe(code);
    }
    expect((await create(session, { body: 'a'.repeat(20_000) })).statusCode).toBe(201);
  });

  it('corpo fora do contrato: 400', async () => {
    const session = await loggedIn(student);
    for (const payload of [
      {},
      { body: '' },
      { body: 7 },
      { body: SECRET, title: 't'.repeat(161) },
      { body: SECRET, lessonId: 'abc' },
      { body: SECRET, videoSeconds: '10' },
      { body: SECRET, extra: 1 },
    ]) {
      const reply = await create(session, payload);
      expect(reply.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(reply.json().code).toBe('validation_failed');
    }
  });
});

describe('ler, editar e excluir (/notes/{id})', () => {
  it('a própria nota: 200; alheia, inexistente: 404; id fora do formato: 400', async () => {
    const session = await loggedIn(student);
    const note = await created(session, { body: `${SECRET} leitura` });
    const reply = await session.request('GET', `/api/v1/notes/${note.id}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    expect(reply.json()).toEqual(note);

    const other = await loggedIn(outsider);
    expect((await other.request('GET', `/api/v1/notes/${note.id}`)).statusCode).toBe(404);
    expect(
      (await patch(other, note.id, { updatedAt: note.updatedAt, body: SECRET })).statusCode,
    ).toBe(404);
    expect((await other.request('DELETE', `/api/v1/notes/${note.id}`)).statusCode).toBe(404);
    // A equipe também não lê nota alheia.
    const staff = await loggedIn(admin);
    expect((await staff.request('GET', `/api/v1/notes/${note.id}`)).statusCode).toBe(404);

    expect((await session.request('GET', `/api/v1/notes/${randomUUID()}`)).statusCode).toBe(404);
    expect((await session.request('GET', '/api/v1/notes/abc')).statusCode).toBe(400);
    // Seguiu intacta.
    expect((await session.request('GET', `/api/v1/notes/${note.id}`)).json()).toEqual(note);
  });

  it('editar avança updatedAt; sem mudança devolve a nota como está', async () => {
    const session = await loggedIn(student);
    const note = await created(session, {
      lessonId: lesson,
      body: `${SECRET} v1`,
      videoSeconds: 30,
    });
    const edited = await patch(session, note.id, {
      updatedAt: note.updatedAt,
      title: `${SECRET} novo título`,
      body: `${SECRET} v2`,
      videoSeconds: null,
    });
    expect(edited.statusCode).toBe(200);
    const v2 = edited.json();
    expect(v2).toMatchObject({
      id: note.id,
      title: `${SECRET} novo título`,
      body: `${SECRET} v2`,
      videoSeconds: null,
      createdAt: note.createdAt,
    });
    expect(Date.parse(v2.updatedAt)).toBeGreaterThan(Date.parse(note.updatedAt));

    const same = await patch(session, note.id, { updatedAt: v2.updatedAt });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toEqual(v2);
    const equal = await patch(session, note.id, { updatedAt: v2.updatedAt, body: v2.body });
    expect(equal.statusCode).toBe(200);
    expect(equal.json().updatedAt).toBe(v2.updatedAt);
  });

  it('updatedAt desatualizado: 409 version_conflict com a versão atual, mesmo sem mudança', async () => {
    const session = await loggedIn(student);
    const note = await created(session, {
      lessonId: lesson,
      body: `${SECRET} conflito v1`,
      videoSeconds: 12,
    });
    const v2 = (
      await patch(session, note.id, { updatedAt: note.updatedAt, body: `${SECRET} conflito v2` })
    ).json();

    for (const payload of [
      { updatedAt: note.updatedAt, body: `${SECRET} do outro dispositivo` },
      { updatedAt: note.updatedAt },
    ]) {
      const reply = await patch(session, note.id, payload);
      expect(reply.statusCode).toBe(409);
      expect(reply.headers['content-type']).toContain('application/problem+json');
      const problem = reply.json();
      expect(problem).toMatchObject({ code: 'version_conflict', status: 409 });
      // `current` é a `Note` do contrato, com as datas em ISO 8601.
      expect(problem.current).toEqual(v2);
      expect(problem.current.lesson.id).toBe(lesson);
    }
    expect((await session.request('GET', `/api/v1/notes/${note.id}`)).json()).toEqual(v2);
  });

  it('editar: 422 pelos limites, 400 fora do contrato', async () => {
    const session = await loggedIn(student);
    const note = await created(session, { body: `${SECRET} limites` });
    const base = { updatedAt: note.updatedAt };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, body: '   ' }, 'note_empty'],
      [{ ...base, body: 'a'.repeat(20_001) }, 'note_too_long'],
      [{ ...base, videoSeconds: 5 }, 'note_video_seconds_invalid'],
    ];
    for (const [payload, code] of cases) {
      const reply = await patch(session, note.id, payload);
      expect(reply.statusCode, code).toBe(422);
      expect(reply.json().code).toBe(code);
    }
    for (const payload of [
      { body: SECRET },
      { ...base, body: '' },
      { ...base, title: 't'.repeat(161) },
      { updatedAt: 'ontem' },
      { ...base, lessonId: lesson },
    ]) {
      expect((await patch(session, note.id, payload)).statusCode).toBe(400);
    }
    expect((await patch(session, 'abc', base)).statusCode).toBe(400);
    expect((await patch(session, randomUUID(), base)).statusCode).toBe(404);
  });

  it('excluir: 204 e depois 404', async () => {
    const session = await loggedIn(student);
    const note = await created(session, { body: `${SECRET} excluir` });
    const reply = await session.request('DELETE', `/api/v1/notes/${note.id}`);
    expect(reply.statusCode).toBe(204);
    expect(reply.body).toBe('');
    expect((await session.request('GET', `/api/v1/notes/${note.id}`)).statusCode).toBe(404);
    expect((await session.request('DELETE', `/api/v1/notes/${note.id}`)).statusCode).toBe(404);
    expect((await session.request('DELETE', '/api/v1/notes/abc')).statusCode).toBe(400);
  });
});

describe('listas', () => {
  let reader: TestUser;
  let session: Browser;
  let first: { id: string };
  let second: { id: string };
  let elsewhere: { id: string };
  let standalone: { id: string };

  beforeAll(async () => {
    reader = await createUser(test.db);
    await grant(reader, course.id);
    await grant(reader, secondCourse.id);
    session = await loggedIn(reader);
    first = await created(session, { lessonId: lesson, body: `${SECRET} primeira **forte**` });
    second = await created(session, { lessonId: lesson, body: `${SECRET} segunda girafa` });
    elsewhere = await created(session, { lessonId: secondLesson, body: `${SECRET} terceira` });
    standalone = await created(session, { title: 'Ideia', body: `${SECRET} quarta girafa` });
  });

  it('GET /lessons/{id}/notes: da mais antiga à mais recente, com o corpo', async () => {
    const reply = await session.request('GET', `/api/v1/lessons/${lesson}/notes`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const { items } = reply.json();
    expect(items.map((note: { id: string }) => note.id)).toEqual([first.id, second.id]);
    expect(items[0].body).toBe(`${SECRET} primeira **forte**`);
    expect(Object.keys(reply.json())).toEqual(['items']);
  });

  it('GET /lessons/{id}/notes: sem nota, 200 vazio na aula publicada e 404 fora do ar', async () => {
    const other = await loggedIn(outsider);
    const empty = await other.request('GET', `/api/v1/lessons/${secondLesson}/notes`);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ items: [] });
    for (const id of [randomUUID(), draftLesson]) {
      expect((await other.request('GET', `/api/v1/lessons/${id}/notes`)).statusCode).toBe(404);
    }
    expect((await other.request('GET', '/api/v1/lessons/abc/notes')).statusCode).toBe(400);
  });

  it('GET /notes: da alteração mais recente à mais antiga, com trecho e sem corpo', async () => {
    const reply = await session.request('GET', '/api/v1/notes');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const page = reply.json();
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((note: { id: string }) => note.id)).toEqual([
      standalone.id,
      elsewhere.id,
      second.id,
      first.id,
    ]);
    expect(page.items[0]).toEqual({
      id: standalone.id,
      lesson: null,
      videoSeconds: null,
      title: 'Ideia',
      excerpt: `${SECRET} quarta girafa`,
      createdAt: expect.stringMatching(ISO),
      updatedAt: expect.stringMatching(ISO),
    });
    expect(page.items[3].excerpt).not.toContain('**');
    expect(page.items[3]).not.toHaveProperty('body');
    expect(page.items[1].lesson).toMatchObject({ id: secondLesson, courseId: secondCourse.id });
  });

  it('GET /notes: filtros, busca e paginação por cursor', async () => {
    const ids = async (query: string) => {
      const reply = await session.request('GET', `/api/v1/notes?${query}`);
      expect(reply.statusCode, query).toBe(200);
      return reply.json().items.map((note: { id: string }) => note.id);
    };
    expect(await ids('kind=standalone')).toEqual([standalone.id]);
    expect(await ids('kind=lesson')).toEqual([elsewhere.id, second.id, first.id]);
    expect(await ids(`courseId=${secondCourse.id}`)).toEqual([elsewhere.id]);
    expect(await ids('q=girafa')).toEqual([standalone.id, second.id]);
    expect(await ids('q=girafa&kind=lesson')).toEqual([second.id]);
    expect(await ids('q=girafa%20inexistente')).toEqual([]);

    const pageOne = (await session.request('GET', '/api/v1/notes?limit=3')).json();
    expect(pageOne.items).toHaveLength(3);
    expect(pageOne.nextCursor).toEqual(expect.any(String));
    const pageTwo = (
      await session.request(
        'GET',
        `/api/v1/notes?limit=3&cursor=${encodeURIComponent(pageOne.nextCursor)}`,
      )
    ).json();
    expect(pageTwo.items.map((note: { id: string }) => note.id)).toEqual([first.id]);
    expect(pageTwo.nextCursor).toBeNull();
  });

  it('GET /notes: parâmetro ou cursor fora do formato: 400', async () => {
    for (const query of [
      'limit=0',
      'limit=101',
      'kind=x',
      'courseId=abc',
      'cursor=nao-e-cursor',
      `q=${'a'.repeat(201)}`,
    ]) {
      const reply = await session.request('GET', `/api/v1/notes?${query}`);
      expect(reply.statusCode, query).toBe(400);
    }
  });

  it('cada usuário só vê as próprias notas', async () => {
    const other = await loggedIn(outsider);
    expect((await other.request('GET', '/api/v1/notes')).json().items).toEqual([]);
    const lessonNotes = await other.request('GET', `/api/v1/lessons/${lesson}/notes`);
    expect(lessonNotes.json()).toEqual({ items: [] });
  });

  it('depois de perder o acesso: lê, edita e exclui; não cria nota de aula', async () => {
    await test.db
      .updateTable('entitlements')
      .set({
        startsAt: new Date(Date.now() - 2 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      })
      .where('userId', '=', reader.id)
      .execute();

    const denied = await create(session, { lessonId: lesson, body: `${SECRET} sem acesso` });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('access_denied');

    const list = await session.request('GET', `/api/v1/lessons/${lesson}/notes`);
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(2);
    const note = (await session.request('GET', `/api/v1/notes/${first.id}`)).json();
    const edited = await patch(session, first.id, {
      updatedAt: note.updatedAt,
      body: `${SECRET} editada sem acesso`,
    });
    expect(edited.statusCode).toBe(200);
    expect((await session.request('DELETE', `/api/v1/notes/${second.id}`)).statusCode).toBe(204);
    // Nota avulsa não depende de acesso.
    expect((await create(session, { body: `${SECRET} avulsa sem acesso` })).statusCode).toBe(201);
  });
});

describe('tetos de quantidade', () => {
  it('100 notas na aula: a lista vem inteira e a 101ª é 422 note_lesson_limit_reached', async () => {
    const user = await createUser(test.db);
    await grant(user, course.id);
    await test.db
      .insertInto('notes')
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          userId: user.id,
          lessonId: lesson,
          courseId: course.id,
          lessonTitleSnapshot: 'Aula anotada',
          courseTitleSnapshot: 'Curso das anotações',
          body: `${SECRET} em lote ${index}`,
        })),
      )
      .execute();
    const session = await loggedIn(user);
    const list = await session.request('GET', `/api/v1/lessons/${lesson}/notes`);
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(100);

    const reply = await create(session, { lessonId: lesson, body: `${SECRET} a 101ª` });
    expect(reply.statusCode).toBe(422);
    expect(reply.json().code).toBe('note_lesson_limit_reached');
    // Em outra aula e avulsa, segue criando.
    expect((await create(session, { body: `${SECRET} avulsa` })).statusCode).toBe(201);
  });

  it('5.000 notas do usuário: 422 note_limit_reached; editar segue valendo', async () => {
    const user = await createUser(test.db);
    await test.db
      .insertInto('notes')
      .values(
        Array.from({ length: 4_999 }, (_, index) => ({
          userId: user.id,
          body: `${SECRET} em lote ${index}`,
        })),
      )
      .execute();
    const session = await loggedIn(user);
    const last = await created(session, { body: `${SECRET} a 5.000ª` });
    const reply = await create(session, { body: `${SECRET} a 5.001ª` });
    expect(reply.statusCode).toBe(422);
    expect(reply.json().code).toBe('note_limit_reached');
    const edited = await patch(session, last.id, {
      updatedAt: last.updatedAt,
      body: `${SECRET} editada no teto`,
    });
    expect(edited.statusCode).toBe(200);
  });
});
