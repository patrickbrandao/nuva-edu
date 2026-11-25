import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import type { KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CatalogRequest,
  type CatalogViewer,
  closeDatabase,
  createAccount,
  createDatabase,
  type Database,
  getAdminBundle,
  getAdminCourse,
  getAdminEbook,
  getAdminLesson,
  getCourseView,
  getEbookDownload,
  getEbookView,
  getLessonContent,
  getShowcaseProduct,
  grantManualEntitlement,
  isDomainError,
  listAdminBundles,
  listAdminCourses,
  listAdminEbooks,
  listSampleLessons,
  listShowcase,
  type Role,
  type ShowcaseBundle,
  type ShowcaseCourse,
} from '../src/index.ts';

// Leituras do catálogo (tarefa 411; spec 009). Banco próprio deste arquivo; o catálogo é
// gravado direto nas tabelas, para controlar estados que a escrita não deixa montar depressa.

let testDb: TestDatabase;
let db: Database;

const VIDEO_URL = 'https://youtu.be/segredo12345';
const LINK_URL = 'https://arquivos.exemplo.test/segredo-apoio.pdf';
const FILE_URL = 'https://arquivos.exemplo.test/segredo-ebook.pdf';

type Mode = 'open' | 'paid' | 'private';

function slug(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 13)}`;
}

async function makeUser(role: Role = 'student', name = `Pessoa ${role}`): Promise<CatalogViewer> {
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email: `${role}-${crypto.randomUUID()}@example.com`,
      name,
      password: 'Senha-Catalogo-Teste-7Qa',
      role,
      emailVerified: true,
    }),
  );
  return { id, role };
}

function requestOf(user: CatalogViewer): CatalogRequest {
  return { actor: { id: user.id, role: user.role }, context: { ip: '127.0.0.1', requestId: 'r' } };
}

interface ProductOptions {
  mode?: Mode;
  published?: boolean;
  archived?: boolean;
  title?: string;
  summary?: string | null;
  priceCents?: number | null;
  publishedAt?: Date;
}

function productValues(prefix: string, options: ProductOptions) {
  const mode = options.mode ?? 'paid';
  const published = options.published ?? true;
  return {
    slug: slug(prefix),
    title: options.title ?? `${prefix} ${crypto.randomUUID().slice(0, 6)}`,
    summary: options.summary ?? null,
    accessMode: mode,
    priceCents: mode === 'open' ? null : (options.priceCents ?? 9900),
    status: published ? 'published' : 'draft',
    publishedAt: published ? (options.publishedAt ?? new Date()) : null,
    archivedAt: options.archived ? new Date() : null,
  };
}

async function makeCourse(
  options: ProductOptions & {
    ownerId?: string | null;
    level?: string | null;
    reviewRequested?: boolean;
  } = {},
): Promise<{ id: string; slug: string }> {
  return db
    .insertInto('courses')
    .values({
      ...productValues('curso', options),
      ownerId: options.ownerId ?? null,
      level: options.level ?? null,
      reviewRequestedAt: options.reviewRequested ? new Date() : null,
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
      description: 'Descrição da aula',
      videoUrl: VIDEO_URL,
      videoProvider: 'youtube',
      durationSeconds: options.duration ?? 60,
      isSample: options.sample ?? false,
      status: (options.published ?? true) ? 'published' : 'draft',
      position,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeEbook(options: ProductOptions = {}): Promise<{ id: string; slug: string }> {
  return db
    .insertInto('ebooks')
    .values({
      ...productValues('ebook', options),
      fileUrl: FILE_URL,
      pages: 120,
      authorName: 'Ana',
    })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
}

async function makeBundle(
  items: { type: 'course' | 'ebook'; id: string }[],
  options: ProductOptions = {},
): Promise<{ id: string; slug: string }> {
  const bundle = await db
    .insertInto('bundles')
    .values(productValues('pacote', options))
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
  for (const [position, item] of items.entries()) {
    await db
      .insertInto('bundleItems')
      .values({ bundleId: bundle.id, productType: item.type, productId: item.id, position })
      .execute();
  }
  return bundle;
}

async function linkEbook(ebookId: string, targetType: 'course' | 'lesson', targetId: string) {
  await db.insertInto('productEbooks').values({ ebookId, targetType, targetId }).execute();
}

async function grant(user: CatalogViewer, productType: 'course' | 'ebook', productId: string) {
  await grantManualEntitlement(db, requestOf(admin), user.id, {
    productType,
    productId,
    reason: 'Teste da leitura do catálogo',
  });
}

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

/** Varre o objeto inteiro: nenhuma URL de conteúdo, em nenhuma chave. */
function expectNoContentUrl(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain('segredo');
  expect(text).not.toContain('https://');
  expect(text).not.toMatch(/"(videoUrl|fileUrl)"/);
  const walk = (node: unknown, path: string) => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const inCover = path.endsWith('.cover');
      if (/url/i.test(key) && !inCover) throw new Error(`chave de URL em ${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, '$');
}

let admin: CatalogViewer;
let manager: CatalogViewer;
let instructor: CatalogViewer;
let otherInstructor: CatalogViewer;
let student: CatalogViewer;

// Curso grande: 3 módulos de 100 aulas publicadas, mais uma aula e um módulo em rascunho.
let big: { id: string; slug: string };
let bigLessons: string[];
let bigSample: string;
let bigDraft: string;
let courseEbook: { id: string; slug: string };
let lessonEbook: { id: string; slug: string };

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 6 });
  admin = await makeUser('admin');
  manager = await makeUser('manager');
  instructor = await makeUser('instructor', 'Íris Instrutora');
  otherInstructor = await makeUser('instructor');
  student = await makeUser('student');

  big = await makeCourse({
    title: 'Curso grande de teste',
    summary: 'Resumo com a palavra abacaxi',
    ownerId: instructor.id,
    level: 'beginner',
    publishedAt: new Date('2026-01-10T00:00:00Z'),
  });
  bigLessons = [];
  for (let m = 0; m < 3; m += 1) {
    const moduleId = await makeModule(big.id, m);
    const rows = await db
      .insertInto('lessons')
      .values(
        Array.from({ length: 100 }, (_, position) => ({
          moduleId,
          title: `Aula ${m + 1}.${position + 1}`,
          videoUrl: VIDEO_URL,
          videoProvider: 'youtube',
          durationSeconds: 10,
          isSample: m === 0 && position === 0,
          status: 'published',
          position,
        })),
      )
      .returning(['id', 'position'])
      .execute();
    rows.sort((a, b) => a.position - b.position);
    bigLessons.push(...rows.map((row) => row.id));
    if (m === 0) bigDraft = await makeLesson(moduleId, 100, { published: false, duration: 999 });
  }
  const emptyModule = await makeModule(big.id, 3);
  await makeLesson(emptyModule, 0, { published: false });
  bigSample = bigLessons[0] as string;
  await db
    .insertInto('lessonLinks')
    .values({ lessonId: bigSample, label: 'Apoio', url: LINK_URL, kind: 'file', position: 0 })
    .execute();
  courseEbook = await makeEbook({ title: 'Ebook do curso', mode: 'private' });
  lessonEbook = await makeEbook({ title: 'Ebook da aula' });
  await linkEbook(courseEbook.id, 'course', big.id);
  await linkEbook(lessonEbook.id, 'lesson', bigSample);
}, 120_000);

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

describe('vitrine', () => {
  it('lista só publicados open e paid, com os totais das aulas publicadas e sem URL', async () => {
    const draft = await makeCourse({ published: false });
    const archived = await makeCourse({ archived: true });
    const hidden = await makeCourse({ mode: 'private', title: 'Curso abacaxi privado' });
    const page = await listShowcase(db, { limit: 100 });
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(big.id);
    expect(ids).toContain(lessonEbook.id);
    for (const id of [draft.id, archived.id, hidden.id, courseEbook.id]) {
      expect(ids).not.toContain(id);
    }
    const item = page.items.find((candidate) => candidate.id === big.id);
    expect(item).toMatchObject({
      type: 'course',
      level: 'beginner',
      accessMode: 'paid',
      priceCents: 9900,
      moduleCount: 3,
      lessonCount: 300,
      durationSeconds: 3000,
      itemCount: null,
      pages: null,
      cover: null,
    });
    expect(page.items.find((candidate) => candidate.id === lessonEbook.id)).toMatchObject({
      type: 'ebook',
      pages: 120,
      moduleCount: null,
      lessonCount: null,
    });
    expectNoContentUrl(page);

    // A busca olha título e resumo e nunca acha o privado.
    const found = await listShowcase(db, { q: 'ABACAXI' });
    expect(found.items.map((candidate) => candidate.id)).toEqual([big.id]);
  });

  it('filtra por tipo, nível e preço, ordena e pagina por cursor', async () => {
    const open = await makeCourse({ mode: 'open', title: 'AAA aberto', level: 'advanced' });
    const free = await makeEbook({ priceCents: 0, title: 'AAB grátis' });
    const cheap = await makeCourse({ priceCents: 100, title: 'AAC barato' });
    const bundle = await makeBundle(
      [
        { type: 'course', id: cheap.id },
        { type: 'ebook', id: free.id },
        { type: 'course', id: (await makeCourse({ published: false })).id },
      ],
      { priceCents: 5_000_000, title: 'AAD pacote' },
    );

    const bundles = await listShowcase(db, { type: 'bundle' });
    expect(bundles.items.map((item) => item.id)).toEqual([bundle.id]);
    expect(bundles.items[0]).toMatchObject({ type: 'bundle', itemCount: 2, level: null });

    const advanced = await listShowcase(db, { level: 'advanced' });
    expect(advanced.items.map((item) => item.id)).toEqual([open.id]);

    const freeIds = (await listShowcase(db, { price: 'free', limit: 100 })).items.map((i) => i.id);
    expect(freeIds).toEqual(expect.arrayContaining([open.id, free.id]));
    expect(freeIds).not.toContain(cheap.id);
    const paidIds = (await listShowcase(db, { price: 'paid', limit: 100 })).items.map((i) => i.id);
    expect(paidIds).toContain(cheap.id);
    expect(paidIds).not.toContain(open.id);
    expect(paidIds).not.toContain(free.id);

    const byTitle = await listShowcase(db, { sort: 'title', limit: 4 });
    expect(byTitle.items.map((item) => item.id)).toEqual([open.id, free.id, cheap.id, bundle.id]);
    const expensive = await listShowcase(db, { sort: '-priceCents', limit: 1 });
    expect(expensive.items[0]?.id).toBe(bundle.id);
    const cheapest = await listShowcase(db, { sort: 'priceCents', limit: 100 });
    const prices = cheapest.items.map((item) => item.priceCents ?? 0);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    // Paginação: duas páginas de 2 cobrem os 4 primeiros por título, sem repetir.
    const first = await listShowcase(db, { sort: 'title', limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const second = await listShowcase(db, { sort: 'title', limit: 2, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual([
      open.id,
      free.id,
      cheap.id,
      bundle.id,
    ]);
    const recent = await listShowcase(db, { limit: 100 });
    expect(recent.nextCursor).toBeNull();
    expect(recent.items.at(-1)?.id).toBe(big.id);

    const counter = countingDb();
    await listShowcase(counter.db, { limit: 100 });
    expect(counter.count()).toBe(1);
  });

  it('recusa parâmetro fora do formato com 400', async () => {
    for (const query of [
      { type: 'plano' },
      { level: 'expert' },
      { price: 'caro' },
      { sort: 'slug' },
      { limit: 0 },
      { limit: 101 },
      { q: '   ' },
      { cursor: 'nao-e-cursor' },
    ]) {
      await expectError(listShowcase(db, query), 400, 'validation_failed');
    }
    // Cursor de outra ordenação não vale.
    const page = await listShowcase(db, { sort: 'title', limit: 1 });
    await expectError(listShowcase(db, { cursor: page.nextCursor }), 400, 'validation_failed');
  });

  it('programa de 300 aulas em até 3 consultas, sem rascunho e sem URL', async () => {
    const counter = countingDb();
    const product = (await getShowcaseProduct(counter.db, 'course', big.slug)) as ShowcaseCourse;
    expect(counter.count()).toBeLessThanOrEqual(3);
    expect(counter.count()).toBe(2);
    expect(product).toMatchObject({
      type: 'course',
      id: big.id,
      instructorName: 'Íris Instrutora',
      moduleCount: 3,
      lessonCount: 300,
      durationSeconds: 3000,
    });
    expect(product.program).toHaveLength(3);
    expect(product.program.map((module) => module.position)).toEqual([0, 1, 2]);
    const lessons = product.program.flatMap((module) => module.lessons);
    expect(lessons.map((lesson) => lesson.id)).toEqual(bigLessons);
    expect(lessons.map((lesson) => lesson.id)).not.toContain(bigDraft);
    expect(product.program[0]).toMatchObject({ lessonCount: 100, durationSeconds: 1000 });
    expect(lessons[0]).toMatchObject({ isSample: true, position: 0, durationSeconds: 10 });
    expectNoContentUrl(product);
  });

  it('página de pacote soma os itens pagos e esconde o item privado; ebook sem URL', async () => {
    const paid = await makeCourse({ priceCents: 3000, summary: 'Resumo do pago' });
    const secret = await makeCourse({ mode: 'private', summary: 'Resumo secreto' });
    const draft = await makeEbook({ published: false });
    const bundle = await makeBundle(
      [
        { type: 'course', id: secret.id },
        { type: 'ebook', id: lessonEbook.id },
        { type: 'ebook', id: draft.id },
        { type: 'course', id: paid.id },
      ],
      { priceCents: 10_000 },
    );
    const product = (await getShowcaseProduct(db, 'bundle', bundle.slug)) as ShowcaseBundle;
    expect(product.itemsPriceCents).toBe(3000 + 9900);
    expect(product.items.map((item) => item.id)).toEqual([secret.id, lessonEbook.id, paid.id]);
    expect(product.items[0]).toMatchObject({
      visible: false,
      summary: null,
      priceCents: null,
      accessMode: 'private',
    });
    expect(product.items[2]).toMatchObject({
      type: 'course',
      visible: true,
      summary: 'Resumo do pago',
      priceCents: 3000,
    });
    expectNoContentUrl(product);

    const ebook = await getShowcaseProduct(db, 'ebook', lessonEbook.slug);
    expect(ebook).toMatchObject({ type: 'ebook', authorName: 'Ana', pages: 120 });
    expectNoContentUrl(ebook);
  });

  it('privado, rascunho, arquivado e inexistente respondem 404', async () => {
    const hidden = await makeCourse({ mode: 'private' });
    const draft = await makeBundle([], { published: false });
    const archived = await makeEbook({ archived: true });
    await expectError(getShowcaseProduct(db, 'course', hidden.slug), 404, 'not_found');
    await expectError(getShowcaseProduct(db, 'bundle', draft.slug), 404, 'not_found');
    await expectError(getShowcaseProduct(db, 'ebook', archived.slug), 404, 'not_found');
    await expectError(getShowcaseProduct(db, 'ebook', courseEbook.slug), 404, 'not_found');
    await expectError(getShowcaseProduct(db, 'course', 'nao-existe'), 404, 'not_found');
    await expectError(getShowcaseProduct(db, 'plano', big.slug), 404, 'not_found');
    await expectError(getShowcaseProduct(db, 'course', 42), 404, 'not_found');
  });
});

describe('curso, aula e ebook para o usuário logado', () => {
  it('sem direito: programa visível, só a amostra abre, e nenhuma URL', async () => {
    const counter = countingDb();
    const view = await getCourseView(counter.db, student, big.slug);
    // Curso, decisão de acesso, programa e direitos aos ebooks vinculados.
    expect(counter.count()).toBe(4);
    expect(view.access).toEqual({ allowed: false, reason: 'no_entitlement', expiresAt: null });
    expect(view).toMatchObject({
      lessonCount: 300,
      moduleCount: 3,
      instructorName: 'Íris Instrutora',
    });
    const lessons = view.modules.flatMap((module) => module.lessons);
    expect(lessons.filter((lesson) => lesson.accessible).map((lesson) => lesson.id)).toEqual([
      bigSample,
    ]);
    expect(view.ebooks).toEqual([
      {
        id: courseEbook.id,
        slug: courseEbook.slug,
        title: 'Ebook do curso',
        cover: null,
        accessible: false,
      },
    ]);
    expectNoContentUrl(view);
  });

  it('curso sem ebook vinculado custa 3 consultas', async () => {
    const course = await makeCourse({ mode: 'open' });
    await makeLesson(await makeModule(course.id, 0), 0);
    const counter = countingDb();
    const view = await getCourseView(counter.db, student, course.slug);
    expect(counter.count()).toBe(3);
    expect(view.access.allowed).toBe(true);
    expect(view.modules[0]?.lessons[0]?.accessible).toBe(true);
  });

  it('com direito: tudo abre e o ebook da cascata fica acessível', async () => {
    const owner = await makeUser('student');
    await grant(owner, 'course', big.id);
    const view = await getCourseView(db, owner, big.slug);
    expect(view.access).toEqual({ allowed: true, reason: null, expiresAt: null });
    expect(view.modules.flatMap((m) => m.lessons).every((lesson) => lesson.accessible)).toBe(true);
    expect(view.ebooks[0]).toMatchObject({ id: courseEbook.id, accessible: true });
  });

  it('curso privado some para quem não tem direito; rascunho é 404 até para a equipe', async () => {
    const hidden = await makeCourse({ mode: 'private' });
    await makeLesson(await makeModule(hidden.id, 0), 0);
    await expectError(getCourseView(db, student, hidden.slug), 404, 'not_found');
    const owner = await makeUser('student');
    await grant(owner, 'course', hidden.id);
    expect((await getCourseView(db, owner, hidden.slug)).access.allowed).toBe(true);
    expect((await getCourseView(db, manager, hidden.slug)).access.allowed).toBe(true);

    const draft = await makeCourse({ published: false });
    await expectError(getCourseView(db, admin, draft.slug), 404, 'not_found');
    await expectError(getCourseView(db, student, 'nao-existe'), 404, 'not_found');
    await expectError(getCourseView(db, student, null), 404, 'not_found');
  });

  it('aula sem acesso responde 403 access_denied com o motivo e sem dados', async () => {
    const error = await expectError(
      getLessonContent(db, student, bigLessons[1]),
      403,
      'access_denied',
    );
    expect(error.extras).toEqual({ reason: 'no_entitlement' });
    expectNoContentUrl({ detail: error.detail, title: error.title, extras: error.extras });
  });

  it('aula amostra abre sem o curso, com o vídeo e os links, mas sem os ebooks', async () => {
    const content = await getLessonContent(db, student, bigSample);
    expect(content).toMatchObject({
      id: bigSample,
      isSample: true,
      videoProvider: 'youtube',
      videoUrl: VIDEO_URL,
      course: { id: big.id, slug: big.slug, title: 'Curso grande de teste' },
      module: { title: 'Módulo 1' },
      ebooks: [],
      previousLessonId: null,
      nextLessonId: bigLessons[1],
      isLastLesson: false,
    });
    expect(content.links).toEqual([
      { id: expect.any(String), label: 'Apoio', url: LINK_URL, kind: 'file', position: 0 },
    ]);
    expect(content.access).toMatchObject({ allowed: true, basis: 'sample' });
  });

  it('aula com direito traz os ebooks da aula e as vizinhas entre as publicadas', async () => {
    const owner = await makeUser('student');
    await grant(owner, 'course', big.id);
    const sample = await getLessonContent(db, owner, bigSample);
    expect(sample.ebooks).toEqual([
      {
        id: lessonEbook.id,
        slug: lessonEbook.slug,
        title: 'Ebook da aula',
        cover: null,
        accessible: true,
      },
    ]);
    // A última do módulo 1 pula a aula em rascunho e segue para o módulo 2.
    const edge = await getLessonContent(db, owner, bigLessons[99]);
    expect(edge).toMatchObject({
      previousLessonId: bigLessons[98],
      nextLessonId: bigLessons[100],
      isLastLesson: false,
      ebooks: [],
    });
    const last = await getLessonContent(db, owner, bigLessons[299]);
    expect(last).toMatchObject({ nextLessonId: null, isLastLesson: true });
    expect(last.access).toMatchObject({ allowed: true, basis: 'entitlement' });
  });

  it('aula em rascunho, de curso despublicado ou inexistente responde 404', async () => {
    await expectError(getLessonContent(db, admin, bigDraft), 404, 'not_found');
    const draftCourse = await makeCourse({ published: false, mode: 'open' });
    const lesson = await makeLesson(await makeModule(draftCourse.id, 0), 0);
    await expectError(getLessonContent(db, student, lesson), 404, 'not_found');
    await expectError(getLessonContent(db, student, crypto.randomUUID()), 404, 'not_found');
    await expectError(getLessonContent(db, student, 'x'), 404, 'not_found');
  });

  it('aulas liberadas: só de cursos que o usuário não abre, a menos que peça todas', async () => {
    const viewer = await makeUser('student');
    const owned = await makeCourse();
    const ownedSample = await makeLesson(await makeModule(owned.id, 0), 0, { sample: true });
    await grant(viewer, 'course', owned.id);
    const open = await makeCourse({ mode: 'open' });
    const openSample = await makeLesson(await makeModule(open.id, 0), 0, { sample: true });
    const hidden = await makeCourse({ mode: 'private' });
    const hiddenSample = await makeLesson(await makeModule(hidden.id, 0), 0, { sample: true });
    const draftSample = await makeLesson(await makeModule(owned.id, 1), 0, {
      sample: true,
      published: false,
    });

    const counter = countingDb();
    const mine = await listSampleLessons(counter.db, viewer, { limit: 100 });
    expect(counter.count()).toBe(1);
    const ids = mine.items.map((item) => item.id);
    expect(ids).toContain(bigSample);
    for (const id of [ownedSample, openSample, hiddenSample, draftSample]) {
      expect(ids).not.toContain(id);
    }
    expect(mine.items.find((item) => item.id === bigSample)).toEqual({
      id: bigSample,
      title: 'Aula 1.1',
      durationSeconds: 10,
      course: { id: big.id, slug: big.slug, title: 'Curso grande de teste', cover: null },
    });
    expectNoContentUrl(mine);

    const all = await listSampleLessons(db, viewer, { excludeOwned: false, limit: 100 });
    const allIds = all.items.map((item) => item.id);
    expect(allIds).toEqual(expect.arrayContaining([bigSample, ownedSample, openSample]));
    expect(allIds).not.toContain(hiddenSample);
    expect(allIds).not.toContain(draftSample);
    // O dono não vê as amostras do próprio curso como "liberadas".
    const forOwner = await listSampleLessons(db, instructor, { limit: 100 });
    expect(forOwner.items.map((item) => item.id)).not.toContain(bigSample);

    const first = await listSampleLessons(db, viewer, { excludeOwned: false, limit: 2 });
    const second = await listSampleLessons(db, viewer, {
      excludeOwned: false,
      limit: 100,
      cursor: first.nextCursor,
    });
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(allIds);
    await expectError(listSampleLessons(db, viewer, { limit: 500 }), 400, 'validation_failed');
  });

  it('ebook: estado de acesso sem a URL; download só com acesso', async () => {
    const view = await getEbookView(db, student, lessonEbook.slug);
    expect(view).toMatchObject({
      id: lessonEbook.id,
      accessMode: 'paid',
      priceCents: 9900,
      authorName: 'Ana',
      pages: 120,
      access: { allowed: false, reason: 'no_entitlement', expiresAt: null },
    });
    expectNoContentUrl(view);
    const denied = await expectError(
      getEbookDownload(db, student, lessonEbook.id),
      403,
      'access_denied',
    );
    expect(denied.extras).toEqual({ reason: 'no_entitlement' });

    const owner = await makeUser('student');
    await grant(owner, 'ebook', lessonEbook.id);
    expect((await getEbookView(db, owner, lessonEbook.slug)).access.allowed).toBe(true);
    expect(await getEbookDownload(db, owner, lessonEbook.id)).toEqual({ url: FILE_URL });

    // Privado: 404 sem direito; com o curso (cascata), aparece e baixa.
    await expectError(getEbookView(db, student, courseEbook.slug), 404, 'not_found');
    const viaCourse = await makeUser('student');
    await grant(viaCourse, 'course', big.id);
    expect((await getEbookView(db, viaCourse, courseEbook.slug)).access.allowed).toBe(true);
    expect(await getEbookDownload(db, viaCourse, courseEbook.id)).toEqual({ url: FILE_URL });

    const draft = await makeEbook({ published: false, mode: 'open' });
    await expectError(getEbookView(db, admin, draft.slug), 404, 'not_found');
    await expectError(getEbookDownload(db, student, draft.id), 404, 'not_found');
    expect(await getEbookDownload(db, admin, draft.id)).toEqual({ url: FILE_URL });
    await db.updateTable('ebooks').set({ fileUrl: null }).where('id', '=', draft.id).execute();
    await expectError(getEbookDownload(db, admin, draft.id), 404, 'not_found');
    await expectError(getEbookDownload(db, student, crypto.randomUUID()), 404, 'not_found');
    await expectError(getEbookDownload(db, student, 'x'), 404, 'not_found');
    await expectError(getEbookView(db, student, 7), 404, 'not_found');
  });
});

describe('listas e detalhes do admin', () => {
  it('lista cursos com filtros, "aguardando publicação" e o alcance do instrutor', async () => {
    const waiting = await makeCourse({
      published: false,
      ownerId: otherInstructor.id,
      reviewRequested: true,
      title: 'Curso zeta aguardando',
    });
    const archived = await makeCourse({ archived: true, published: false, ownerId: instructor.id });

    const counter = countingDb();
    const all = await listAdminCourses(counter.db, requestOf(manager), { limit: 100 });
    expect(counter.count()).toBe(1);
    const ids = all.items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([big.id, waiting.id, archived.id]));
    expect(all.items.find((item) => item.id === big.id)).toMatchObject({
      owner: { id: instructor.id, name: 'Íris Instrutora' },
      status: 'published',
      moduleCount: 4,
      lessonCount: 300,
      durationSeconds: 3000,
      reviewRequestedAt: null,
      archivedAt: null,
    });

    const awaiting = await listAdminCourses(db, requestOf(admin), { awaitingReview: true });
    expect(awaiting.items.map((item) => item.id)).toEqual([waiting.id]);
    expect(awaiting.items[0]?.reviewRequestedAt).toBeInstanceOf(Date);

    const onlyArchived = await listAdminCourses(db, requestOf(admin), {
      status: 'archived',
      limit: 100,
    });
    expect(onlyArchived.items.map((item) => item.id)).toContain(archived.id);
    expect(onlyArchived.items.every((item) => item.archivedAt !== null)).toBe(true);
    const drafts = await listAdminCourses(db, requestOf(admin), { status: 'draft', limit: 100 });
    expect(drafts.items.map((item) => item.id)).toContain(waiting.id);
    expect(drafts.items.map((item) => item.id)).not.toContain(archived.id);

    const byOwner = await listAdminCourses(db, requestOf(admin), {
      ownerId: otherInstructor.id,
      accessMode: 'paid',
      q: 'zeta',
      sort: 'title',
    });
    expect(byOwner.items.map((item) => item.id)).toEqual([waiting.id]);

    // O instrutor só vê os próprios, mesmo pedindo o dono alheio.
    const own = await listAdminCourses(db, requestOf(instructor), { limit: 100 });
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.every((item) => item.owner?.id === instructor.id)).toBe(true);
    const alien = await listAdminCourses(db, requestOf(instructor), {
      ownerId: otherInstructor.id,
    });
    expect(alien.items).toEqual([]);

    // Paginação nas três ordens.
    for (const sort of ['title', '-createdAt', '-updatedAt'] as const) {
      const full = await listAdminCourses(db, requestOf(admin), { sort, limit: 100 });
      const first = await listAdminCourses(db, requestOf(admin), { sort, limit: 3 });
      const rest = await listAdminCourses(db, requestOf(admin), {
        sort,
        limit: 100,
        cursor: first.nextCursor,
      });
      expect([...first.items, ...rest.items].map((item) => item.id)).toEqual(
        full.items.map((item) => item.id),
      );
    }

    for (const query of [
      { status: 'x' },
      { accessMode: 'x' },
      { ownerId: 'x' },
      { awaitingReview: 'sim' },
      { sort: 'x' },
    ]) {
      await expectError(listAdminCourses(db, requestOf(admin), query), 400, 'validation_failed');
    }
  });

  it('aluno recebe 403 nas leituras do admin, com a recusa na auditoria', async () => {
    const request = requestOf(student);
    await expectError(listAdminCourses(db, request), 403, 'permission_denied');
    await expectError(getAdminCourse(db, request, big.id), 403, 'permission_denied');
    await expectError(getAdminLesson(db, request, bigSample), 403, 'permission_denied');
    await expectError(listAdminEbooks(db, request), 403, 'permission_denied');
    await expectError(getAdminEbook(db, request, lessonEbook.id), 403, 'permission_denied');
    await expectError(listAdminBundles(db, request), 403, 'permission_denied');
    await expectError(listAdminBundles(db, requestOf(instructor)), 403, 'permission_denied');
    await expectError(getAdminBundle(db, requestOf(instructor), big.id), 403, 'permission_denied');
    const denied = await db
      .selectFrom('auditLog')
      .select('action')
      .where('actorUserId', '=', student.id)
      .where('outcome', '=', 'denied')
      .execute();
    expect(denied.map((row) => row.action).sort()).toEqual([
      'course.edit',
      'course.edit',
      'course.edit',
      'ebook.link',
      'ebook.link',
      'ebook_bundle.manage',
    ]);
  });

  it('detalhe do curso e da aula para o editor; curso alheio ao instrutor é 404', async () => {
    const holder = await makeUser('student');
    await grant(holder, 'course', big.id);
    const detail = await getAdminCourse(db, requestOf(instructor), big.id);
    expect(detail).toMatchObject({
      id: big.id,
      description: null,
      certificateEnabled: true,
      certificateHours: null,
      version: 1,
      moduleCount: 4,
      lessonCount: 300,
    });
    expect(detail.studentCount).toBeGreaterThanOrEqual(1);
    expect(detail.modules.map((module) => module.lessons.length)).toEqual([101, 100, 100, 1]);
    expect(detail.modules[0]?.lessons.at(-1)).toMatchObject({
      id: bigDraft,
      status: 'draft',
      videoProvider: 'youtube',
      position: 100,
    });
    await expectError(getAdminCourse(db, requestOf(otherInstructor), big.id), 404, 'not_found');
    await expectError(getAdminCourse(db, requestOf(admin), crypto.randomUUID()), 404, 'not_found');
    await expectError(getAdminCourse(db, requestOf(admin), 'x'), 404, 'not_found');

    const lesson = await getAdminLesson(db, requestOf(instructor), bigSample);
    expect(lesson).toMatchObject({
      id: bigSample,
      courseId: big.id,
      type: 'video',
      status: 'published',
      isSample: true,
      videoUrl: VIDEO_URL,
      videoProvider: 'youtube',
      version: 1,
      ebooks: [
        { id: lessonEbook.id, slug: lessonEbook.slug, title: 'Ebook da aula', status: 'published' },
      ],
    });
    expect(lesson.links).toMatchObject([{ label: 'Apoio', url: LINK_URL }]);
    expect(lesson).not.toHaveProperty('ownerId');
    expect((await getAdminLesson(db, requestOf(manager), bigDraft)).status).toBe('draft');
    await expectError(getAdminLesson(db, requestOf(otherInstructor), bigSample), 404, 'not_found');
    await expectError(getAdminLesson(db, requestOf(admin), crypto.randomUUID()), 404, 'not_found');
    await expectError(getAdminLesson(db, requestOf(admin), 'x'), 404, 'not_found');
  });

  it('ebooks: lista com filtros e detalhe com os vínculos que quem pede alcança', async () => {
    const draft = await makeEbook({ published: false, title: 'Ebook ômega rascunho' });
    const list = await listAdminEbooks(db, requestOf(instructor), { limit: 100 });
    expect(list.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([draft.id, lessonEbook.id, courseEbook.id]),
    );
    const found = await listAdminEbooks(db, requestOf(manager), { q: 'ômega', status: 'draft' });
    expect(found.items).toMatchObject([{ id: draft.id, authorName: 'Ana', pages: 120 }]);
    expect(found.items[0]).not.toHaveProperty('fileUrl');
    const first = await listAdminEbooks(db, requestOf(admin), { sort: 'title', limit: 1 });
    const rest = await listAdminEbooks(db, requestOf(admin), {
      sort: 'title',
      limit: 100,
      cursor: first.nextCursor,
    });
    expect(rest.items.map((item) => item.id)).not.toContain(first.items[0]?.id);

    const alien = await makeCourse({ ownerId: otherInstructor.id, title: 'Curso alheio' });
    const bundle = await makeBundle([], { title: 'Pacote com vínculo' });
    await linkEbook(lessonEbook.id, 'course', alien.id);
    await db
      .insertInto('productEbooks')
      .values({ ebookId: lessonEbook.id, targetType: 'bundle', targetId: bundle.id })
      .execute();
    const detail = await getAdminEbook(db, requestOf(admin), lessonEbook.id);
    expect(detail).toMatchObject({ id: lessonEbook.id, fileUrl: FILE_URL, version: 1 });
    expect(detail.targets).toEqual([
      { targetType: 'bundle', targetId: bundle.id, title: 'Pacote com vínculo', course: null },
      { targetType: 'course', targetId: alien.id, title: 'Curso alheio', course: null },
      {
        targetType: 'lesson',
        targetId: bigSample,
        title: 'Aula 1.1',
        course: { type: 'course', id: big.id, title: 'Curso grande de teste' },
      },
    ]);
    const forInstructor = await getAdminEbook(db, requestOf(instructor), lessonEbook.id);
    expect(forInstructor.targets.map((target) => target.targetId)).toEqual([bigSample]);
    expect(detail.studentCount).toBeGreaterThanOrEqual(1);
    await expectError(getAdminEbook(db, requestOf(admin), crypto.randomUUID()), 404, 'not_found');
    await expectError(getAdminEbook(db, requestOf(admin), 'x'), 404, 'not_found');
  });

  it('pacotes: lista e detalhe com os itens em qualquer estado', async () => {
    const paid = await makeCourse({ priceCents: 2500, title: 'Item pago' });
    const draft = await makeEbook({ published: false, priceCents: 700, title: 'Item rascunho' });
    const archived = await makeCourse({ archived: true, mode: 'private', title: 'Item arquivado' });
    const bundle = await makeBundle(
      [
        { type: 'course', id: paid.id },
        { type: 'ebook', id: draft.id },
        { type: 'course', id: archived.id },
      ],
      { title: 'Pacote sigma do admin', published: false },
    );
    const list = await listAdminBundles(db, requestOf(manager), { q: 'sigma' });
    expect(list.items).toMatchObject([{ id: bundle.id, itemCount: 3, status: 'draft' }]);
    const detail = await getAdminBundle(db, requestOf(manager), bundle.id);
    expect(detail).toMatchObject({
      itemCount: 3,
      itemsPriceCents: 3200,
      studentCount: 0,
      version: 1,
    });
    expect(detail.items).toEqual([
      {
        productType: 'course',
        productId: paid.id,
        title: 'Item pago',
        accessMode: 'paid',
        priceCents: 2500,
        status: 'published',
        archived: false,
        position: 0,
      },
      {
        productType: 'ebook',
        productId: draft.id,
        title: 'Item rascunho',
        accessMode: 'paid',
        priceCents: 700,
        status: 'draft',
        archived: false,
        position: 1,
      },
      {
        productType: 'course',
        productId: archived.id,
        title: 'Item arquivado',
        accessMode: 'private',
        priceCents: 9900,
        status: 'published',
        archived: true,
        position: 2,
      },
    ]);
    await expectError(getAdminBundle(db, requestOf(admin), crypto.randomUUID()), 404, 'not_found');
    await expectError(getAdminBundle(db, requestOf(admin), 'x'), 404, 'not_found');
  });
});
