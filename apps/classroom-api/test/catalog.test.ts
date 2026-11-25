import { randomUUID } from 'node:crypto';
import { grantManualEntitlement, type Role } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLASSROOM_RATE_LIMITS } from '../src/rate-limits.ts';
import {
  Browser,
  createUser,
  isolatedDatabase,
  type Reply,
  TEST_PASSWORD,
  type TestUser,
} from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

// Vitrine, produto, programa, aula, amostras, ebooks e direitos (specs 009 e 010; tarefa 430).
// Banco só deste arquivo: a vitrine lista tudo o que está publicado. O catálogo é gravado direto
// nas tabelas (a escrita é da admin-api).

const VIDEO_URL = 'https://youtu.be/segredo-video-430';
const LINK_URL = 'https://arquivos.exemplo.test/segredo-apoio-430.pdf';
const FILE_URL = 'https://arquivos.exemplo.test/segredo-ebook-430.pdf';
const SECRETS = [VIDEO_URL, LINK_URL, FILE_URL, 'segredo-'];

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;
let limited: TestApp;

/** Toda resposta passa aqui; só a aula aberta e o download podem levar URL de conteúdo. */
const withContent = new WeakSet<Reply>();
const replies: Reply[] = [];
function scan(reply: Reply): void {
  replies.push(reply);
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
}
const browser = () => new Browser(test.app, scan);

type Mode = 'open' | 'paid' | 'private';
interface Product {
  id: string;
  slug: string;
}

function productValues(prefix: string, mode: Mode, title: string, published = true) {
  return {
    slug: `${prefix}-${randomUUID().slice(0, 13)}`,
    title,
    summary: `Resumo de ${title}`,
    accessMode: mode,
    priceCents: mode === 'open' ? null : 9900,
    status: published ? 'published' : 'draft',
    publishedAt: published ? new Date() : null,
  };
}

function makeCourse(mode: Mode, title: string, published = true): Promise<Product> {
  return test.db
    .insertInto('courses')
    .values({ ...productValues('curso', mode, title, published), level: 'beginner' })
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
      description: 'Descrição da aula',
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

function makeEbook(mode: Mode, title: string): Promise<Product> {
  return test.db
    .insertInto('ebooks')
    .values({
      ...productValues('ebook', mode, title),
      fileUrl: FILE_URL,
      pages: 120,
      authorName: 'Ana',
    })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
}

let admin: TestUser;
async function grant(user: TestUser, productType: 'course' | 'ebook', productId: string) {
  await grantManualEntitlement(
    test.db,
    {
      actor: { id: admin.id, role: 'admin' as Role },
      context: { ip: '127.0.0.1', userAgent: null, requestId: 'teste-430' },
    },
    user.id,
    { productType, productId, reason: 'Teste das rotas do catálogo' },
  );
}

async function loggedIn(user: TestUser): Promise<Browser> {
  const session = browser();
  expect((await session.login(user.email)).statusCode).toBe(200);
  return session;
}

let paid: Product;
let paidSample: string;
let paidLesson: string;
let open: Product;
let hidden: Product;
let draft: Product;
let paidEbook: Product;
let hiddenEbook: Product;
let lessonEbook: Product;
let bundle: Product;
let student: TestUser;
let owner: TestUser;

beforeAll(async () => {
  database = await isolatedDatabase();
  test = createTestApp({ DATABASE_URL: database.url });
  limited = createTestApp({ DATABASE_URL: database.url }, { rateLimits: CLASSROOM_RATE_LIMITS });

  admin = await createUser(test.db, { role: 'admin' });
  student = await createUser(test.db);
  owner = await createUser(test.db);

  paid = await makeCourse('paid', 'Curso pago');
  const paidModule = await makeModule(paid.id, 0);
  paidSample = await makeLesson(paidModule, 0, true);
  paidLesson = await makeLesson(paidModule, 1);
  await test.db
    .insertInto('lessonLinks')
    .values({ lessonId: paidLesson, label: 'Apoio', url: LINK_URL, kind: 'file', position: 0 })
    .execute();

  open = await makeCourse('open', 'Curso aberto');
  await makeLesson(await makeModule(open.id, 0), 0);
  hidden = await makeCourse('private', 'Curso privado');
  await makeLesson(await makeModule(hidden.id, 0), 0);
  draft = await makeCourse('paid', 'Curso em rascunho', false);

  paidEbook = await makeEbook('paid', 'Ebook pago');
  hiddenEbook = await makeEbook('private', 'Ebook privado');
  lessonEbook = await makeEbook('paid', 'Ebook da aula');
  for (const lessonId of [paidSample, paidLesson]) {
    await test.db
      .insertInto('productEbooks')
      .values({ ebookId: lessonEbook.id, targetType: 'lesson', targetId: lessonId })
      .execute();
  }

  bundle = await test.db
    .insertInto('bundles')
    .values(productValues('pacote', 'paid', 'Pacote completo'))
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
  await test.db
    .insertInto('bundleItems')
    .values([
      { bundleId: bundle.id, productType: 'course', productId: paid.id, position: 0 },
      { bundleId: bundle.id, productType: 'ebook', productId: paidEbook.id, position: 1 },
    ])
    .execute();

  await grant(owner, 'course', paid.id);
  await grant(owner, 'course', hidden.id);
  await grant(owner, 'ebook', paidEbook.id);
}, 120_000);

afterAll(async () => {
  // Nenhuma resposta leva URL de conteúdo, fora a aula aberta e o download do ebook.
  for (const reply of replies) {
    if (withContent.has(reply)) continue;
    for (const secret of SECRETS) {
      expect(reply.body).not.toContain(secret);
    }
    expect(reply.body).not.toMatch(/video_?url|file_?url/i);
  }
  for (const app of [test, limited]) {
    expect(app.logText()).not.toContain(TEST_PASSWORD);
    await app.close();
  }
  await database.drop();
});

describe('vitrine (spec 009, "Vitrine pública")', () => {
  it('GET /catalog sem login lista o publicado não privado, sem URL de conteúdo', async () => {
    const reply = await browser().request('GET', '/api/v1/catalog?limit=100');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('public, no-cache');
    const page = reply.json();
    const ids = page.items.map((item: { id: string }) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([paid.id, open.id, paidEbook.id, lessonEbook.id, bundle.id]),
    );
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(hiddenEbook.id);
    expect(ids).not.toContain(draft.id);
    expect(page.nextCursor).toBeNull();
    expect(page.items.find((item: { id: string }) => item.id === paid.id)).toMatchObject({
      type: 'course',
      slug: paid.slug,
      accessMode: 'paid',
      priceCents: 9900,
      level: 'beginner',
      moduleCount: 1,
      lessonCount: 2,
      durationSeconds: 120,
      itemCount: null,
      pages: null,
    });
  });

  it('filtra por tipo e preço, busca, ordena e pagina por cursor', async () => {
    const visitor = browser();
    const courses = (await visitor.request('GET', '/api/v1/catalog?type=course')).json();
    expect(courses.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [paid.id, open.id].sort(),
    );
    const free = (await visitor.request('GET', '/api/v1/catalog?price=free')).json();
    expect(free.items.map((item: { id: string }) => item.id)).toEqual([open.id]);
    // Produto privado não aparece nem na busca.
    const search = (await visitor.request('GET', '/api/v1/catalog?q=privado')).json();
    expect(search.items).toEqual([]);

    const first = (await visitor.request('GET', '/api/v1/catalog?sort=title&limit=2')).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (
      await visitor.request(
        'GET',
        `/api/v1/catalog?sort=title&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).json();
    const titles = [...first.items, ...second.items].map((item: { title: string }) => item.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('parâmetro fora do contrato: 400', async () => {
    const visitor = browser();
    for (const query of ['sort=preco', 'type=plan', 'limit=0', 'limit=101', 'q=']) {
      const reply = await visitor.request('GET', `/api/v1/catalog?${query}`);
      expect(reply.statusCode, query).toBe(400);
      expect(reply.json().code).toBe('validation_failed');
    }
  });

  it('respeita o limite de visitante: 60 por minuto por IP, depois 429', async () => {
    const visitor = new Browser(limited.app, scan);
    for (let count = 0; count < 60; count += 1) {
      const reply = await visitor.request('GET', '/api/v1/catalog?limit=1');
      expect(reply.statusCode).toBe(200);
    }
    const blocked = await visitor.request('GET', '/api/v1/catalog?limit=1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toBeDefined();
    // A página do produto conta no mesmo limite; outro IP segue livre.
    const product = await visitor.request('GET', `/api/v1/catalog/course/${paid.slug}`);
    expect(product.statusCode).toBe(429);
    const other = new Browser(limited.app, scan);
    expect((await other.request('GET', '/api/v1/catalog?limit=1')).statusCode).toBe(200);
  });
});

describe('página do produto (GET /catalog/{type}/{slug})', () => {
  it('curso: descrição e programa, sem login e sem URL', async () => {
    const reply = await browser().request('GET', `/api/v1/catalog/course/${paid.slug}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('public, no-cache');
    const course = reply.json();
    expect(course).toMatchObject({ type: 'course', id: paid.id, accessMode: 'paid' });
    expect(course.program).toHaveLength(1);
    expect(course.program[0].lessons.map((lesson: { id: string }) => lesson.id)).toEqual([
      paidSample,
      paidLesson,
    ]);
  });

  it('pacote e ebook', async () => {
    const visitor = browser();
    const pack = await visitor.request('GET', `/api/v1/catalog/bundle/${bundle.slug}`);
    expect(pack.statusCode).toBe(200);
    expect(pack.json()).toMatchObject({ type: 'bundle', itemsPriceCents: 19800 });
    expect(pack.json().items.map((item: { id: string }) => item.id)).toEqual([
      paid.id,
      paidEbook.id,
    ]);
    const ebook = await visitor.request('GET', `/api/v1/catalog/ebook/${paidEbook.slug}`);
    expect(ebook.statusCode).toBe(200);
    expect(ebook.json()).toMatchObject({ type: 'ebook', pages: 120, authorName: 'Ana' });
  });

  it('privado, rascunho, inexistente ou tipo trocado: 404; tipo desconhecido: 400', async () => {
    const visitor = browser();
    for (const path of [
      `course/${hidden.slug}`,
      `ebook/${hiddenEbook.slug}`,
      `course/${draft.slug}`,
      'course/nao-existe',
      `ebook/${paid.slug}`,
    ]) {
      const reply = await visitor.request('GET', `/api/v1/catalog/${path}`);
      expect(reply.statusCode, path).toBe(404);
      expect(reply.json().code).toBe('not_found');
    }
    expect((await visitor.request('GET', `/api/v1/catalog/plan/${paid.slug}`)).statusCode).toBe(
      400,
    );
  });

  it('o privado continua 404 na vitrine até para quem tem o direito', async () => {
    const session = await loggedIn(owner);
    const reply = await session.request('GET', `/api/v1/catalog/course/${hidden.slug}`);
    expect(reply.statusCode).toBe(404);
  });
});

describe('curso com o estado do usuário (GET /courses/{slug})', () => {
  it('sem sessão: 401', async () => {
    const reply = await browser().request('GET', `/api/v1/courses/${paid.slug}`);
    expect(reply.statusCode).toBe(401);
  });

  it('pago sem direito: programa visível, bloqueado com o motivo, só a amostra abre', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', `/api/v1/courses/${paid.slug}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const course = reply.json();
    expect(course).toMatchObject({
      id: paid.id,
      accessMode: 'paid',
      priceCents: 9900,
      lessonCount: 2,
      access: { allowed: false, reason: 'no_entitlement', expiresAt: null },
      // Quem não tem o curso vê o progresso zerado (spec 014); `certificate` vem na tarefa 433.
      progress: { completedLessons: 0, totalLessons: 2, percent: 0, state: 'not_started' },
      continueLessonId: null,
      certificate: null,
    });
    expect(course).not.toHaveProperty('certificateEnabled');
    expect(course.modules).toHaveLength(1);
    expect(course.modules[0].progress).toMatchObject({ completedLessons: 0, totalLessons: 2 });
    expect(course.modules[0].lessons).toMatchObject([
      { id: paidSample, isSample: true, accessible: true, completed: false },
      { id: paidLesson, isSample: false, accessible: false, completed: false },
    ]);
  });

  it('com direito: liberado, todas as aulas abrem', async () => {
    const session = await loggedIn(owner);
    const course = (await session.request('GET', `/api/v1/courses/${paid.slug}`)).json();
    expect(course.access).toMatchObject({ allowed: true, reason: null });
    expect(
      course.modules[0].lessons.every((lesson: { accessible: boolean }) => lesson.accessible),
    ).toBe(true);
  });

  it('privado: 404 sem direito, 200 com direito; rascunho: 404', async () => {
    const outsider = await loggedIn(student);
    expect((await outsider.request('GET', `/api/v1/courses/${hidden.slug}`)).statusCode).toBe(404);
    expect((await outsider.request('GET', `/api/v1/courses/${draft.slug}`)).statusCode).toBe(404);
    const insider = await loggedIn(owner);
    const reply = await insider.request('GET', `/api/v1/courses/${hidden.slug}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ accessMode: 'private', access: { allowed: true } });
  });
});

describe('aula (GET /lessons/{id})', () => {
  it('sem sessão: 401', async () => {
    expect((await browser().request('GET', `/api/v1/lessons/${paidLesson}`)).statusCode).toBe(401);
  });

  it('curso pago sem direito: 403 access_denied com o motivo e nenhum dado da aula', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', `/api/v1/lessons/${paidLesson}`);
    expect(reply.statusCode).toBe(403);
    expect(reply.headers['content-type']).toContain('application/problem+json');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.json()).toMatchObject({ code: 'access_denied', reason: 'no_entitlement' });
    expect(reply.json()).not.toHaveProperty('title', 'Aula 2');
  });

  it('amostra abre para quem não tem o curso, sem os ebooks da aula', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', `/api/v1/lessons/${paidSample}`);
    withContent.add(reply);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.json()).toMatchObject({
      id: paidSample,
      isSample: true,
      videoProvider: 'youtube',
      videoUrl: VIDEO_URL,
      course: { id: paid.id, slug: paid.slug },
      ebooks: [],
      previousLessonId: null,
      nextLessonId: paidLesson,
      isLastLesson: false,
      // A abertura cria a linha de progresso (spec 014; rotas em `learning.test.ts`).
      userState: { completedAt: null, completedVia: null, positionSeconds: 0 },
    });
    expect(reply.json().userState.lastOpenedAt).not.toBeNull();
    expect(reply.json()).not.toHaveProperty('access');
  });

  it('com direito: vídeo, links de apoio, ebooks e vizinhas', async () => {
    const session = await loggedIn(owner);
    const reply = await session.request('GET', `/api/v1/lessons/${paidLesson}`);
    withContent.add(reply);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      id: paidLesson,
      videoUrl: VIDEO_URL,
      links: [{ label: 'Apoio', url: LINK_URL, kind: 'file' }],
      ebooks: [{ id: lessonEbook.id, slug: lessonEbook.slug }],
      previousLessonId: paidSample,
      nextLessonId: null,
      isLastLesson: true,
    });
  });

  it('inexistente: 404; identificador fora do formato: 400', async () => {
    const session = await loggedIn(owner);
    expect((await session.request('GET', `/api/v1/lessons/${randomUUID()}`)).statusCode).toBe(404);
    expect((await session.request('GET', '/api/v1/lessons/abc')).statusCode).toBe(400);
  });
});

describe('aulas liberadas (GET /samples)', () => {
  it('sem sessão: 401', async () => {
    expect((await browser().request('GET', '/api/v1/samples')).statusCode).toBe(401);
  });

  it('lista as amostras dos cursos que o usuário não tem; excludeOwned=false inclui as demais', async () => {
    const outsider = await loggedIn(student);
    const reply = await outsider.request('GET', '/api/v1/samples');
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      items: [{ id: paidSample, durationSeconds: 60, course: { id: paid.id, slug: paid.slug } }],
      nextCursor: null,
    });

    const insider = await loggedIn(owner);
    expect((await insider.request('GET', '/api/v1/samples')).json().items).toEqual([]);
    const all = await insider.request('GET', '/api/v1/samples?excludeOwned=false');
    expect(all.json().items.map((item: { id: string }) => item.id)).toEqual([paidSample]);
  });
});

describe('ebook (GET /ebooks/{slug} e /ebooks/{id}/download)', () => {
  it('sem sessão: 401', async () => {
    const visitor = browser();
    expect((await visitor.request('GET', `/api/v1/ebooks/${paidEbook.slug}`)).statusCode).toBe(401);
    expect(
      (await visitor.request('GET', `/api/v1/ebooks/${paidEbook.id}/download`)).statusCode,
    ).toBe(401);
  });

  it('sem direito: o ebook aparece bloqueado e o download é 403 com o motivo', async () => {
    const session = await loggedIn(student);
    const view = await session.request('GET', `/api/v1/ebooks/${paidEbook.slug}`);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      id: paidEbook.id,
      pages: 120,
      access: { allowed: false, reason: 'no_entitlement' },
    });
    const download = await session.request('GET', `/api/v1/ebooks/${paidEbook.id}/download`);
    expect(download.statusCode).toBe(403);
    expect(download.headers['cache-control']).toBe('no-store');
    expect(download.json()).toMatchObject({ code: 'access_denied', reason: 'no_entitlement' });
  });

  it('com direito: liberado, e o download devolve a URL com no-store', async () => {
    const session = await loggedIn(owner);
    const view = await session.request('GET', `/api/v1/ebooks/${paidEbook.slug}`);
    expect(view.json().access).toMatchObject({ allowed: true, reason: null });
    const download = await session.request('GET', `/api/v1/ebooks/${paidEbook.id}/download`);
    withContent.add(download);
    expect(download.statusCode).toBe(200);
    expect(download.headers['cache-control']).toBe('no-store');
    expect(download.json()).toEqual({ url: FILE_URL });
  });

  it('privado sem direito e inexistente: 404', async () => {
    const session = await loggedIn(student);
    expect((await session.request('GET', `/api/v1/ebooks/${hiddenEbook.slug}`)).statusCode).toBe(
      404,
    );
    expect((await session.request('GET', '/api/v1/ebooks/nao-existe')).statusCode).toBe(404);
    expect(
      (await session.request('GET', `/api/v1/ebooks/${randomUUID()}/download`)).statusCode,
    ).toBe(404);
  });
});

describe('direitos do aluno (GET /me/entitlements)', () => {
  it('sem sessão: 401', async () => {
    expect((await browser().request('GET', '/api/v1/me/entitlements')).statusCode).toBe(401);
  });

  it('lista os direitos do próprio usuário, com produto, origem e validade', async () => {
    const outsider = await loggedIn(student);
    expect((await outsider.request('GET', '/api/v1/me/entitlements')).json()).toEqual({
      items: [],
    });

    const insider = await loggedIn(owner);
    const reply = await insider.request('GET', '/api/v1/me/entitlements');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const { items } = reply.json();
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productType: 'course',
          productId: paid.id,
          productSlug: paid.slug,
          productTitle: 'Curso pago',
          source: 'grant',
          via: null,
          state: 'active',
          expiresAt: null,
        }),
        expect.objectContaining({ productType: 'course', productId: hidden.id }),
        expect.objectContaining({ productType: 'ebook', productId: paidEbook.id }),
      ]),
    );
    expect(items[0].startsAt).toMatch(/Z$/);
  });
});
