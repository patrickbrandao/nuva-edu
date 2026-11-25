import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { type KyselyPlugin, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AccessFacts,
  canAccess,
  closeDatabase,
  createAccount,
  createDatabase,
  type Database,
  decideAccess,
  type EntitlementView,
  expandCascade,
  getEntitlementStatuses,
  grantEntitlement,
  grantManualEntitlement,
  hasActiveAccess,
  isDomainError,
  listMyEntitlements,
  listProductEntitlements,
  listUserEntitlements,
  type ManagementRequest,
  type Role,
  recalculateEntitlements,
  revokeEntitlementTree,
  revokeManualEntitlement,
} from '../src/index.ts';

// Direitos de acesso (tarefa 412; spec 010). Banco próprio deste arquivo; catálogo gravado
// direto nas tabelas da 0009 (as funções de escrita do catálogo são da tarefa 410).

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 6 });
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

interface TestUser {
  id: string;
  role: Role;
}

async function makeUser(role: Role = 'student'): Promise<TestUser> {
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email: `${role}-${crypto.randomUUID()}@example.com`,
      name: `Pessoa ${role}`,
      password: 'Senha-Direitos-Teste-7Qa',
      role,
      emailVerified: true,
    }),
  );
  return { id, role };
}

function slug(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 13)}`;
}

type Mode = 'open' | 'paid' | 'private';

async function makeCourse(
  options: { mode?: Mode; published?: boolean; ownerId?: string | null; archived?: boolean } = {},
): Promise<string> {
  const mode = options.mode ?? 'paid';
  const published = options.published ?? true;
  const row = await db
    .insertInto('courses')
    .values({
      slug: slug('curso'),
      title: `Curso ${crypto.randomUUID().slice(0, 6)}`,
      accessMode: mode,
      priceCents: mode === 'open' ? null : 9900,
      ownerId: options.ownerId ?? null,
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
      archivedAt: options.archived ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeLesson(
  courseId: string,
  options: { sample?: boolean; published?: boolean } = {},
): Promise<string> {
  let module = await db
    .selectFrom('modules')
    .select('id')
    .where('courseId', '=', courseId)
    .executeTakeFirst();
  if (!module) {
    module = await db
      .insertInto('modules')
      .values({ courseId, title: 'Módulo 1', position: 0 })
      .returning('id')
      .executeTakeFirstOrThrow();
  }
  const count = await db
    .selectFrom('lessons')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('moduleId', '=', module.id)
    .executeTakeFirstOrThrow();
  const row = await db
    .insertInto('lessons')
    .values({
      moduleId: module.id,
      title: `Aula ${count.n + 1}`,
      isSample: options.sample ?? false,
      status: (options.published ?? true) ? 'published' : 'draft',
      position: count.n,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeEbook(options: { mode?: Mode; published?: boolean } = {}): Promise<string> {
  const mode = options.mode ?? 'paid';
  const published = options.published ?? true;
  const row = await db
    .insertInto('ebooks')
    .values({
      slug: slug('ebook'),
      title: `Ebook ${crypto.randomUUID().slice(0, 6)}`,
      accessMode: mode,
      priceCents: mode === 'open' ? null : 1900,
      fileUrl: 'https://arquivos.example.com/ebook.pdf',
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeBundle(items: { type: 'course' | 'ebook'; id: string }[]): Promise<string> {
  const row = await db
    .insertInto('bundles')
    .values({
      slug: slug('pacote'),
      title: `Pacote ${crypto.randomUUID().slice(0, 6)}`,
      accessMode: 'paid',
      priceCents: 19900,
      status: 'published',
      publishedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (items.length > 0) {
    await db
      .insertInto('bundleItems')
      .values(
        items.map((item, position) => ({
          bundleId: row.id,
          productType: item.type,
          productId: item.id,
          position,
        })),
      )
      .execute();
  }
  return row.id;
}

async function linkEbook(
  ebookId: string,
  targetType: 'course' | 'bundle' | 'lesson',
  targetId: string,
) {
  await db.insertInto('productEbooks').values({ ebookId, targetType, targetId }).execute();
}

async function unlinkEbook(ebookId: string, targetType: string, targetId: string) {
  await db
    .deleteFrom('productEbooks')
    .where('ebookId', '=', ebookId)
    .where('targetType', '=', targetType)
    .where('targetId', '=', targetId)
    .execute();
}

/** Concede uma raiz pela função de baixo nível (`grant` por padrão, sem e-mail). */
async function grantRoot(
  userId: string,
  productType: 'course' | 'bundle' | 'ebook',
  productId: string,
  options: {
    source?: 'order' | 'subscription' | 'grant';
    sourceId?: string;
    startsAt?: Date;
    expiresAt?: Date | null;
    notify?: boolean;
  } = {},
) {
  const source = options.source ?? 'grant';
  return db.transaction().execute((trx) =>
    grantEntitlement(trx, {
      userId,
      productType,
      productId,
      source,
      sourceId: options.sourceId ?? (source === 'grant' ? grantor.id : crypto.randomUUID()),
      grantedReason: source === 'grant' ? 'teste' : null,
      ...(options.startsAt ? { startsAt: options.startsAt } : {}),
      expiresAt: options.expiresAt ?? null,
      notify: options.notify ?? false,
    }),
  );
}

async function treeOf(rootId: string) {
  return sql<{
    id: string;
    productType: string;
    productId: string;
    parentEntitlementId: string | null;
    source: string;
    revokedAt: Date | null;
    revokeReason: string | null;
    expiresAt: Date | null;
  }>`
    WITH RECURSIVE tree AS (
      SELECT * FROM entitlements WHERE id = ${rootId}::uuid
      UNION ALL SELECT e.* FROM entitlements e JOIN tree t ON e.parent_entitlement_id = t.id
    ) SELECT * FROM tree ORDER BY created_at, id`
    .execute(db)
    .then((result) => result.rows);
}

async function active(rootId: string) {
  return (await treeOf(rootId)).filter((row) => row.revokedAt === null);
}

function request(user: TestUser): ManagementRequest {
  return {
    actor: { id: user.id, role: user.role },
    context: { ip: '10.41.2.1', userAgent: 'vitest', requestId: 'req-direitos' },
  };
}

async function rejects(promise: Promise<unknown>, code: string, status?: number) {
  try {
    await promise;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    expect(error.code).toBe(code);
    if (status !== undefined) expect(error.status).toBe(status);
    return error;
  }
  throw new Error(`esperava o erro ${code}`);
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

let grantor: TestUser;
let admin: TestUser;
let manager: TestUser;
let instructor: TestUser;

beforeAll(async () => {
  grantor = await makeUser('manager');
  admin = await makeUser('admin');
  manager = await makeUser('manager');
  instructor = await makeUser('instructor');
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('concessão e cascata', () => {
  it('pacote com 2 cursos e 1 ebook cria 1 raiz e os derivados, com os ebooks dos cursos', async () => {
    const student = await makeUser();
    const courseA = await makeCourse();
    const courseB = await makeCourse();
    const ebookDirect = await makeEbook();
    const ebookOfA = await makeEbook();
    const ebookTwoLessons = await makeEbook();
    const ebookAlsoDirect = await makeEbook();
    const ebookOfBundleLink = await makeEbook();
    const lesson1 = await makeLesson(courseB);
    const lesson2 = await makeLesson(courseB);
    await linkEbook(ebookOfA, 'course', courseA);
    // Ebook vinculado a duas aulas do mesmo curso: um só derivado sob o curso.
    await linkEbook(ebookTwoLessons, 'lesson', lesson1);
    await linkEbook(ebookTwoLessons, 'lesson', lesson2);
    // Ebook do pacote e também do curso: um só derivado, no primeiro caminho (direto no pacote).
    await linkEbook(ebookAlsoDirect, 'course', courseA);
    const bundle = await makeBundle([
      { type: 'course', id: courseA },
      { type: 'course', id: courseB },
      { type: 'ebook', id: ebookDirect },
      { type: 'ebook', id: ebookAlsoDirect },
    ]);
    // Vínculo com alvo no pacote equivale a incluir no pacote (009).
    await linkEbook(ebookOfBundleLink, 'bundle', bundle);

    const granted = await grantRoot(student.id, 'bundle', bundle, { notify: true });
    expect(granted.created).toBe(true);
    expect(granted.cascadeCount).toBe(7);
    const tree = await treeOf(granted.entitlement.id);
    expect(tree).toHaveLength(8);
    const root = tree[0];
    expect(root?.source).toBe('grant');
    const byProduct = new Map(tree.map((row) => [row.productId, row]));
    for (const id of [courseA, courseB, ebookDirect, ebookAlsoDirect, ebookOfBundleLink]) {
      expect(byProduct.get(id)?.parentEntitlementId).toBe(root?.id);
      expect(byProduct.get(id)?.source).toBe('cascade');
    }
    expect(byProduct.get(ebookOfA)?.parentEntitlementId).toBe(byProduct.get(courseA)?.id);
    expect(byProduct.get(ebookTwoLessons)?.parentEntitlementId).toBe(byProduct.get(courseB)?.id);
    expect(tree.filter((row) => row.productId === ebookAlsoDirect)).toHaveLength(1);

    const outbox = await db
      .selectFrom('emailOutbox')
      .select(['type', 'data'])
      .where('userId', '=', student.id)
      .execute();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.type).toBe('access.granted');
    expect(outbox[0]?.data).toMatchObject({ productType: 'bundle', expiresAt: null });

    const expanded = await expandCascade(db, 'bundle', bundle);
    expect(expanded.map((node) => node.productId)).toEqual([
      courseA,
      courseB,
      ebookDirect,
      ebookAlsoDirect,
      ebookOfBundleLink,
    ]);
    expect(await expandCascade(db, 'ebook', ebookDirect)).toEqual([]);
  });

  it('repetir a concessão (webhook reprocessado) não duplica nada', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', course);
    const sourceId = crypto.randomUUID();
    const first = await grantRoot(student.id, 'course', course, { source: 'order', sourceId });
    const second = await grantRoot(student.id, 'course', course, { source: 'order', sourceId });
    expect(second.created).toBe(false);
    expect(second.cascadeCount).toBe(0);
    expect(second.entitlement.id).toBe(first.entitlement.id);
    const rows = await db
      .selectFrom('entitlements')
      .select('id')
      .where('userId', '=', student.id)
      .execute();
    expect(rows).toHaveLength(2);
  });

  it('exige transação e produto existente', async () => {
    const student = await makeUser();
    await expect(
      grantEntitlement(db, {
        userId: student.id,
        productType: 'course',
        productId: crypto.randomUUID(),
        source: 'grant',
        sourceId: grantor.id,
        grantedReason: 'x',
      }),
    ).rejects.toThrow(TypeError);
    await rejects(grantRoot(student.id, 'course', crypto.randomUUID()), 'not_found', 404);
    await rejects(grantRoot(student.id, 'ebook', 'nao-e-uuid'), 'not_found', 404);
  });

  it('cascata de 200 itens concede e revoga em menos de 500 ms cada (RNF-02)', async () => {
    const student = await makeUser();
    const items: { type: 'course' | 'ebook'; id: string }[] = [];
    const courseIds: string[] = [];
    for (let i = 0; i < 40; i += 1) courseIds.push(await makeCourse());
    const ebookIds = await db
      .insertInto('ebooks')
      .values(
        Array.from({ length: 160 }, () => ({
          slug: slug('ebook-carga'),
          title: 'Ebook de carga',
          accessMode: 'paid',
          priceCents: 100,
        })),
      )
      .returning('id')
      .execute();
    for (const id of courseIds) items.push({ type: 'course', id });
    // 80 ebooks direto no pacote, 80 pendurados nos cursos (2 por curso).
    for (const row of ebookIds.slice(0, 80)) items.push({ type: 'ebook', id: row.id });
    await db
      .insertInto('productEbooks')
      .values(
        ebookIds.slice(80).map((row, index) => ({
          ebookId: row.id,
          targetType: 'course',
          targetId: courseIds[Math.floor(index / 2)] as string,
        })),
      )
      .execute();
    const bundle = await makeBundle(items);

    const start = performance.now();
    const granted = await grantRoot(student.id, 'bundle', bundle);
    const grantMs = performance.now() - start;
    expect(granted.cascadeCount).toBe(200);
    expect(grantMs).toBeLessThan(500);

    const startRevoke = performance.now();
    const revoked = await db
      .transaction()
      .execute((trx) => revokeEntitlementTree(trx, granted.entitlement.id, 'refund'));
    const revokeMs = performance.now() - startRevoke;
    expect(revoked).toBe(201);
    expect(revokeMs).toBeLessThan(500);
  });
});

describe('revogação', () => {
  it('reembolsar o pacote revoga a árvore toda e nada além; o curso avulso segue acessível', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const lesson = await makeLesson(course);
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', course);
    const bundle = await makeBundle([{ type: 'course', id: course }]);
    const order = await grantRoot(student.id, 'course', course, { source: 'order' });
    const pack = await grantRoot(student.id, 'bundle', bundle, { source: 'order' });

    const count = await db
      .transaction()
      .execute((trx) => revokeEntitlementTree(trx, pack.entitlement.id, 'refund'));
    expect(count).toBe(3);
    const packTree = await treeOf(pack.entitlement.id);
    expect(packTree.every((row) => row.revokeReason === 'refund')).toBe(true);
    expect(await active(order.entitlement.id)).toHaveLength(2);
    expect((await canAccess(db, student, { type: 'lesson', id: lesson })).allowed).toBe(true);
    expect((await canAccess(db, student, { type: 'ebook', id: ebook })).allowed).toBe(true);

    // Repetir não revoga mais nada; id fora do formato é ignorado.
    expect(
      await db
        .transaction()
        .execute((trx) => revokeEntitlementTree(trx, [pack.entitlement.id, 'x'], 'refund')),
    ).toBe(0);
    expect(await db.transaction().execute((trx) => revokeEntitlementTree(trx, [], 'refund'))).toBe(
      0,
    );
  });

  it('ebook recebido pelos cursos A e B segue ativo quando A é revogado', async () => {
    const student = await makeUser();
    const courseA = await makeCourse();
    const courseB = await makeCourse();
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', courseA);
    await linkEbook(ebook, 'course', courseB);
    const a = await grantRoot(student.id, 'course', courseA);
    await grantRoot(student.id, 'course', courseB, { source: 'order' });
    await db.transaction().execute((trx) => revokeEntitlementTree(trx, a.entitlement.id, 'manual'));
    expect(await canAccess(db, student, { type: 'ebook', id: ebook })).toMatchObject({
      allowed: true,
      basis: 'entitlement',
    });
    expect(await canAccess(db, student, { type: 'course', id: courseA })).toMatchObject({
      allowed: false,
      reason: 'no_entitlement',
    });
  });

  it('assinatura vencida com concessão manual do mesmo curso: segue ativo pela raiz grant', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const subscription = await grantRoot(student.id, 'course', course, { source: 'subscription' });
    await grantRoot(student.id, 'course', course);
    await db
      .transaction()
      .execute((trx) =>
        revokeEntitlementTree(trx, subscription.entitlement.id, 'subscription_ended'),
      );
    expect((await canAccess(db, student, { type: 'course', id: course })).allowed).toBe(true);
  });

  it('reembolso parcial: revoga só a raiz do item reembolsado', async () => {
    const student = await makeUser();
    const course1 = await makeCourse();
    const course2 = await makeCourse();
    const item1 = await grantRoot(student.id, 'course', course1, { source: 'order' });
    await grantRoot(student.id, 'course', course2, { source: 'order' });
    await db
      .transaction()
      .execute((trx) => revokeEntitlementTree(trx, item1.entitlement.id, 'refund'));
    expect((await canAccess(db, student, { type: 'course', id: course1 })).allowed).toBe(false);
    expect((await canAccess(db, student, { type: 'course', id: course2 })).allowed).toBe(true);
  });

  it('compra de pacote por quem já tem um dos cursos vitalício: duas raízes para o curso', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const bundle = await makeBundle([{ type: 'course', id: course }]);
    await grantRoot(student.id, 'course', course, { source: 'order' });
    const pack = await grantRoot(student.id, 'bundle', bundle, { source: 'order' });
    expect(pack.created).toBe(true);
    const rows = await db
      .selectFrom('entitlements')
      .select('id')
      .where('userId', '=', student.id)
      .where('productId', '=', course)
      .where('revokedAt', 'is', null)
      .execute();
    expect(rows).toHaveLength(2);
  });
});

describe('canAccess', () => {
  it('aula usa uma consulta e devolve o motivo certo em cada negativa', async () => {
    const student = await makeUser();
    const paid = await makeCourse();
    const lesson = await makeLesson(paid);
    const counter = countingDb();
    expect(await canAccess(counter.db, student, { type: 'lesson', id: lesson })).toEqual({
      allowed: false,
      reason: 'no_entitlement',
      basis: null,
      expiresAt: null,
    });
    expect(counter.count()).toBe(1);

    const until = new Date(Date.now() + 10 * DAY);
    await grantRoot(student.id, 'course', paid, { source: 'order', expiresAt: until });
    const later = new Date(Date.now() + 30 * DAY);
    await grantRoot(student.id, 'course', paid, { source: 'order', expiresAt: later });
    const allowed = await canAccess(counter.db, student, { type: 'lesson', id: lesson });
    expect(allowed).toMatchObject({ allowed: true, reason: null, basis: 'entitlement' });
    // Fim do acesso mais longo.
    expect(allowed.expiresAt?.getTime()).toBe(later.getTime());
    expect(counter.count()).toBe(2);

    // Visitante: sem consulta.
    expect(await canAccess(counter.db, null, { type: 'lesson', id: lesson })).toMatchObject({
      reason: 'not_authenticated',
    });
    expect(counter.count()).toBe(2);
  });

  it('direito com expires_at no passado nega com expired sem nenhuma tarefa', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const lesson = await makeLesson(course);
    await grantRoot(student.id, 'course', course, {
      source: 'order',
      startsAt: new Date(Date.now() - 10 * DAY),
      expiresAt: new Date(Date.now() - DAY),
    });
    expect(await canAccess(db, student, { type: 'lesson', id: lesson })).toMatchObject({
      allowed: false,
      reason: 'expired',
    });
    const jobs = await db
      .selectFrom('jobs')
      .select('id')
      .where(sql<boolean>`payload->>'productId' = ${course}`)
      .execute();
    expect(jobs).toHaveLength(0);
    // Vence "agora": um segundo de validade.
    const course2 = await makeCourse();
    await grantRoot(student.id, 'course', course2, {
      source: 'order',
      startsAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() + 800),
    });
    expect((await canAccess(db, student, { type: 'course', id: course2 })).allowed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(await canAccess(db, student, { type: 'course', id: course2 })).toMatchObject({
      reason: 'expired',
    });
  });

  it('direito agendado (starts_at no futuro) ainda não vale', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await grantRoot(student.id, 'course', course, {
      source: 'order',
      startsAt: new Date(Date.now() + DAY),
    });
    expect(await canAccess(db, student, { type: 'course', id: course })).toMatchObject({
      reason: 'no_entitlement',
    });
  });

  it('suspenso não acessa; despublicado nega mesmo com direito; amostra e aberto liberam', async () => {
    const student = await makeUser();
    const paid = await makeCourse();
    const lesson = await makeLesson(paid);
    const sample = await makeLesson(paid, { sample: true });
    const draftLesson = await makeLesson(paid, { published: false });
    const draftCourse = await makeCourse({ published: false });
    const draftCourseLesson = await makeLesson(draftCourse, { sample: true });
    const archived = await makeCourse({ archived: true });
    const open = await makeCourse({ mode: 'open' });
    const openLesson = await makeLesson(open);
    const privateCourse = await makeCourse({ mode: 'private' });
    const privateSample = await makeLesson(privateCourse, { sample: true });
    await grantRoot(student.id, 'course', draftCourse);
    await grantRoot(student.id, 'course', archived);

    expect(await canAccess(db, student, { type: 'lesson', id: sample })).toMatchObject({
      allowed: true,
      basis: 'sample',
    });
    // Amostra libera independentemente do modo do curso (009).
    expect(await canAccess(db, student, { type: 'lesson', id: privateSample })).toMatchObject({
      basis: 'sample',
    });
    expect(await canAccess(db, student, { type: 'lesson', id: openLesson })).toMatchObject({
      allowed: true,
      basis: 'open',
      expiresAt: null,
    });
    expect(await canAccess(db, student, { type: 'lesson', id: draftLesson })).toMatchObject({
      reason: 'unpublished',
    });
    expect(await canAccess(db, student, { type: 'lesson', id: draftCourseLesson })).toMatchObject({
      reason: 'unpublished',
    });
    expect(await canAccess(db, student, { type: 'course', id: draftCourse })).toMatchObject({
      reason: 'unpublished',
    });
    expect(await canAccess(db, student, { type: 'course', id: archived })).toMatchObject({
      reason: 'unpublished',
    });
    expect(await canAccess(db, student, { type: 'lesson', id: lesson })).toMatchObject({
      reason: 'no_entitlement',
    });

    await db
      .updateTable('users')
      .set({
        suspendedAt: new Date(),
        suspendedKind: 'full',
        suspendedReason: 'teste',
        suspendedBy: admin.id,
      })
      .where('id', '=', student.id)
      .execute();
    expect(await canAccess(db, student, { type: 'lesson', id: openLesson })).toMatchObject({
      reason: 'suspended',
    });
  });

  it('equipe: admin e gerente tudo; instrutor só os próprios cursos (mesmo em rascunho)', async () => {
    const otherInstructor = await makeUser('instructor');
    const own = await makeCourse({ ownerId: instructor.id, published: false });
    const ownLesson = await makeLesson(own, { published: false });
    const foreign = await makeCourse({ ownerId: otherInstructor.id });
    const foreignLesson = await makeLesson(foreign);
    const ebook = await makeEbook({ published: false });

    expect(await canAccess(db, instructor, { type: 'lesson', id: ownLesson })).toMatchObject({
      allowed: true,
      basis: 'owner',
    });
    expect(await canAccess(db, instructor, { type: 'lesson', id: foreignLesson })).toMatchObject({
      reason: 'no_entitlement',
    });
    await grantRoot(instructor.id, 'course', foreign);
    expect((await canAccess(db, instructor, { type: 'lesson', id: foreignLesson })).allowed).toBe(
      true,
    );
    // Ebook não tem dono: o instrutor segue a regra de aluno.
    expect(await canAccess(db, instructor, { type: 'ebook', id: ebook })).toMatchObject({
      reason: 'unpublished',
    });
    for (const staff of [admin, manager]) {
      expect(await canAccess(db, staff, { type: 'lesson', id: ownLesson })).toMatchObject({
        allowed: true,
        basis: 'staff',
      });
      expect(await canAccess(db, staff, { type: 'ebook', id: ebook })).toMatchObject({
        basis: 'staff',
      });
    }
  });

  it('programa: público se publicado e não privado; privado só com direito; ebook aberto e pago', async () => {
    const student = await makeUser();
    const paid = await makeCourse();
    const privateCourse = await makeCourse({ mode: 'private' });
    const draft = await makeCourse({ published: false });
    expect(await canAccess(db, null, { type: 'course_program', id: paid })).toMatchObject({
      allowed: true,
      basis: 'public',
    });
    expect(await canAccess(db, null, { type: 'course_program', id: privateCourse })).toMatchObject({
      reason: 'not_authenticated',
    });
    expect(await canAccess(db, null, { type: 'course_program', id: draft })).toMatchObject({
      reason: 'unpublished',
    });
    expect(
      await canAccess(db, student, { type: 'course_program', id: privateCourse }),
    ).toMatchObject({
      reason: 'no_entitlement',
    });
    await grantRoot(student.id, 'course', privateCourse);
    expect(
      await canAccess(db, student, { type: 'course_program', id: privateCourse }),
    ).toMatchObject({
      allowed: true,
      basis: 'entitlement',
      expiresAt: null,
    });

    const openEbook = await makeEbook({ mode: 'open' });
    const paidEbook = await makeEbook();
    expect(await canAccess(db, student, { type: 'ebook', id: openEbook })).toMatchObject({
      basis: 'open',
    });
    expect(await canAccess(db, student, { type: 'ebook', id: paidEbook })).toMatchObject({
      reason: 'no_entitlement',
    });
    expect(await canAccess(db, null, { type: 'ebook', id: paidEbook })).toMatchObject({
      reason: 'not_authenticated',
    });
  });

  it('alvo inexistente ou id inválido: 404; usuário inexistente: not_authenticated', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await rejects(
      canAccess(db, student, { type: 'lesson', id: crypto.randomUUID() }),
      'not_found',
      404,
    );
    await rejects(canAccess(db, student, { type: 'course', id: 'abc' }), 'not_found', 404);
    expect(
      await canAccess(db, { id: crypto.randomUUID() }, { type: 'course', id: course }),
    ).toMatchObject({
      reason: 'not_authenticated',
    });
    expect(await canAccess(db, { id: 'x' }, { type: 'course', id: course })).toMatchObject({
      reason: 'not_authenticated',
    });
  });

  it('decideAccess é a mesma regra, para quem já leu os fatos em lote', () => {
    const base: AccessFacts = {
      target: 'course',
      user: { id: 'u', role: 'student', suspended: false },
      published: true,
      accessMode: 'paid',
      ownerId: null,
      entitlement: { state: 'none' },
    };
    expect(decideAccess(base).reason).toBe('no_entitlement');
    expect(decideAccess({ ...base, entitlement: { state: 'expired' } }).reason).toBe('expired');
    expect(decideAccess({ ...base, user: null }).reason).toBe('not_authenticated');
    expect(decideAccess({ ...base, target: 'course_program', accessMode: 'open' }).basis).toBe(
      'public',
    );
    expect(decideAccess({ ...base, target: 'course_program', accessMode: 'private' }).reason).toBe(
      'no_entitlement',
    );
    expect(
      decideAccess({
        ...base,
        user: { id: 'u', role: 'instructor', suspended: false },
        ownerId: 'u',
      }).basis,
    ).toBe('owner');
  });

  it('getEntitlementStatuses resume vários produtos numa consulta', async () => {
    const student = await makeUser();
    const a = await makeCourse();
    const b = await makeCourse();
    const c = await makeCourse();
    await grantRoot(student.id, 'course', a);
    await grantRoot(student.id, 'course', b, {
      source: 'order',
      startsAt: new Date(Date.now() - 3 * DAY),
      expiresAt: new Date(Date.now() - DAY),
    });
    const counter = countingDb();
    const map = await getEntitlementStatuses(counter.db, student.id, {
      productType: 'course',
      productIds: [a, b, c, a, 'x'],
    });
    expect(counter.count()).toBe(1);
    expect(map.get(a)).toEqual({ state: 'active', expiresAt: null });
    expect(map.get(b)).toEqual({ state: 'expired' });
    expect(map.get(c)).toEqual({ state: 'none' });
    expect(map.size).toBe(3);
    expect(
      (await getEntitlementStatuses(db, student.id, { productType: 'course', productIds: [] }))
        .size,
    ).toBe(0);
  });
});

describe('hasActiveAccess', () => {
  it('direito ativo de qualquer fonte ou equipe; curso aberto não conta', async () => {
    const student = await makeUser();
    const open = await makeCourse({ mode: 'open' });
    await makeLesson(open);
    expect(await hasActiveAccess(db, student)).toBe(false);
    expect(await hasActiveAccess(db, null)).toBe(false);
    expect(await hasActiveAccess(db, instructor)).toBe(true);
    const ebook = await makeEbook();
    const root = await grantRoot(student.id, 'ebook', ebook);
    expect(await hasActiveAccess(db, student)).toBe(true);
    await db
      .transaction()
      .execute((trx) => revokeEntitlementTree(trx, root.entitlement.id, 'manual'));
    expect(await hasActiveAccess(db, student)).toBe(false);
  });
});

describe('concessão manual', () => {
  it('gerente concede com motivo e validade: auditoria, e-mail e árvore; repetir devolve a mesma', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', course);
    const expiresAt = new Date(Date.now() + 30 * DAY);
    const result = await grantManualEntitlement(db, request(manager), student.id, {
      productType: 'course',
      productId: course,
      expiresAt,
      reason: '  Cortesia do evento  ',
    });
    expect(result.created).toBe(true);
    expect(result.entitlement).toMatchObject({
      source: 'grant',
      sourceId: manager.id,
      state: 'active',
      grantedReason: 'Cortesia do evento',
      grantedBy: { id: manager.id, name: 'Pessoa manager' },
      product: { type: 'course', id: course },
      parentEntitlementId: null,
    });
    expect(result.entitlement.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(result.entitlement.children).toHaveLength(1);
    expect(result.entitlement.children[0]).toMatchObject({
      source: 'cascade',
      grantedBy: null,
      product: { type: 'ebook', id: ebook },
    });

    const audit = await db
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'entitlement.grant')
      .where('targetId', '=', student.id)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: manager.id,
      origin: 'admin_panel',
      outcome: 'ok',
    });
    expect(audit[0]?.details).toMatchObject({
      reason: 'Cortesia do evento',
      productId: course,
      cascadeCount: 1,
    });
    const emails = await db
      .selectFrom('emailOutbox')
      .select('data')
      .where('userId', '=', student.id)
      .where('type', '=', 'access.granted')
      .execute();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.data).toMatchObject({
      productType: 'course',
      expiresAt: expiresAt.toISOString(),
    });

    const again = await grantManualEntitlement(db, request(manager), student.id, {
      productType: 'course',
      productId: course,
      reason: 'de novo',
    });
    expect(again.created).toBe(false);
    expect(again.entitlement.id).toBe(result.entitlement.id);
    const auditAfter = await db
      .selectFrom('auditLog')
      .select('id')
      .where('action', '=', 'entitlement.grant')
      .where('targetId', '=', student.id)
      .execute();
    expect(auditAfter).toHaveLength(1);
  });

  it('concessão vencida do mesmo admin é substituída por uma nova', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const old = await grantRoot(student.id, 'course', course, {
      sourceId: admin.id,
      startsAt: new Date(Date.now() - 5 * DAY),
      expiresAt: new Date(Date.now() - DAY),
    });
    const result = await grantManualEntitlement(db, request(admin), student.id, {
      productType: 'course',
      productId: course,
      expiresAt: null,
      reason: 'Renovação',
    });
    expect(result.created).toBe(true);
    expect(result.entitlement.id).not.toBe(old.entitlement.id);
    const [previous] = await treeOf(old.entitlement.id);
    expect(previous?.revokeReason).toBe('manual');
    const audit = await db
      .selectFrom('auditLog')
      .select('details')
      .where('action', '=', 'entitlement.grant')
      .where('targetId', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ replacedEntitlementId: old.entitlement.id });
  });

  it('instrutor recebe 403 com a negação na auditoria; entradas inválidas', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await rejects(
      grantManualEntitlement(db, request(instructor), student.id, {
        productType: 'course',
        productId: course,
        reason: 'x',
      }),
      'permission_denied',
      403,
    );
    const denied = await db
      .selectFrom('auditLog')
      .select(['outcome', 'details'])
      .where('action', '=', 'entitlement.grant')
      .where('actorUserId', '=', instructor.id)
      .execute();
    expect(denied).toHaveLength(1);
    expect(denied[0]?.outcome).toBe('denied');

    await rejects(
      grantManualEntitlement(db, request(manager), student.id, {
        productType: 'plan' as never,
        productId: 'x',
        reason: '   ',
        expiresAt: new Date('nope'),
      }),
      'validation_failed',
      400,
    );
    await rejects(
      grantManualEntitlement(db, request(manager), student.id, {
        productType: 'course',
        productId: course,
        reason: 'x'.repeat(501),
      }),
      'validation_failed',
    );
    await rejects(
      grantManualEntitlement(db, request(manager), student.id, {
        productType: 'course',
        productId: course,
        reason: 'ok',
        expiresAt: new Date(Date.now() - 1000),
      }),
      'expires_at_in_past',
      422,
    );
    await rejects(
      grantManualEntitlement(db, request(manager), crypto.randomUUID(), {
        productType: 'course',
        productId: course,
        reason: 'ok',
      }),
      'not_found',
      404,
    );
    await rejects(
      grantManualEntitlement(db, request(manager), student.id, {
        productType: 'bundle',
        productId: crypto.randomUUID(),
        reason: 'ok',
      }),
      'not_found',
      404,
    );
  });

  it('revogação manual: só raiz grant; order e derivado dão 409; já revogada dá 409', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', course);
    const granted = await grantManualEntitlement(db, request(manager), student.id, {
      productType: 'course',
      productId: course,
      reason: 'Bolsa',
    });
    const order = await grantRoot(student.id, 'course', course, { source: 'order' });

    await rejects(
      revokeManualEntitlement(db, request(instructor), granted.entitlement.id, { reason: 'x' }),
      'permission_denied',
      403,
    );
    await rejects(
      revokeManualEntitlement(db, request(manager), order.entitlement.id, { reason: 'x' }),
      'entitlement_not_revocable',
      409,
    );
    const child = granted.entitlement.children[0] as EntitlementView;
    await rejects(
      revokeManualEntitlement(db, request(manager), child.id, { reason: 'x' }),
      'entitlement_not_revocable',
      409,
    );
    await rejects(
      revokeManualEntitlement(db, request(manager), crypto.randomUUID(), { reason: 'x' }),
      'not_found',
      404,
    );
    await rejects(
      revokeManualEntitlement(db, request(manager), 'abc', { reason: 'x' }),
      'not_found',
      404,
    );
    await rejects(
      revokeManualEntitlement(db, request(manager), granted.entitlement.id, { reason: '' }),
      'validation_failed',
      400,
    );

    const revoked = await revokeManualEntitlement(db, request(manager), granted.entitlement.id, {
      reason: 'Fim da bolsa',
    });
    expect(revoked).toMatchObject({ state: 'revoked', revokeReason: 'manual' });
    expect(revoked.children[0]).toMatchObject({ state: 'revoked', revokeReason: 'manual' });
    expect(await active(order.entitlement.id)).toHaveLength(2);
    const audit = await db
      .selectFrom('auditLog')
      .select(['details', 'targetId'])
      .where('action', '=', 'entitlement.revoke')
      .where('outcome', '=', 'ok')
      .where('targetId', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ reason: 'Fim da bolsa', revokedCount: 2 });
    await rejects(
      revokeManualEntitlement(db, request(manager), granted.entitlement.id, { reason: 'x' }),
      'entitlement_already_revoked',
      409,
    );
  });
});

describe('recálculo da cascata', () => {
  it('acrescentar ebook ao curso libera a quem tem o curso; remover revoga só os derivados do vínculo', async () => {
    const withCourse = await makeUser();
    const viaBundle = await makeUser();
    const buyer = await makeUser();
    const course = await makeCourse();
    const lesson = await makeLesson(course);
    const bundle = await makeBundle([{ type: 'course', id: course }]);
    const ebook = await makeEbook();
    const direct = await grantRoot(withCourse.id, 'course', course);
    const pack = await grantRoot(viaBundle.id, 'bundle', bundle);
    const ebookRoot = await grantRoot(buyer.id, 'ebook', ebook, { source: 'order' });
    await grantRoot(buyer.id, 'course', course, { source: 'order' });

    await linkEbook(ebook, 'lesson', lesson);
    const added = await recalculateEntitlements(db, { productType: 'course', productId: course });
    expect(added).toMatchObject({ roots: 3, created: 3, revoked: 0, batches: 1 });
    for (const user of [withCourse, viaBundle, buyer]) {
      expect((await canAccess(db, user, { type: 'ebook', id: ebook })).allowed).toBe(true);
    }
    expect((await active(pack.entitlement.id)).map((row) => row.productId)).toContain(ebook);

    const again = await recalculateEntitlements(db, { productType: 'course', productId: course });
    expect(again).toMatchObject({ created: 0, revoked: 0 });

    await unlinkEbook(ebook, 'lesson', lesson);
    const removed = await recalculateEntitlements(db, { productType: 'course', productId: course });
    expect(removed).toMatchObject({ created: 0, revoked: 3 });
    expect((await canAccess(db, withCourse, { type: 'ebook', id: ebook })).allowed).toBe(false);
    expect((await canAccess(db, viaBundle, { type: 'ebook', id: ebook })).allowed).toBe(false);
    // Quem comprou o ebook avulso não é afetado.
    expect((await canAccess(db, buyer, { type: 'ebook', id: ebook })).allowed).toBe(true);
    expect(await active(ebookRoot.entitlement.id)).toHaveLength(1);
    const revokedRows = (await treeOf(direct.entitlement.id)).filter(
      (row) => row.revokedAt !== null,
    );
    expect(revokedRows.map((row) => row.revokeReason)).toEqual(['recalculation']);
  });

  it('pacote: item acrescentado e removido, ebook que muda de caminho, lotes e raízes vencidas', async () => {
    const users = [await makeUser(), await makeUser(), await makeUser()];
    const courseA = await makeCourse();
    const courseB = await makeCourse();
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', courseB);
    const bundle = await makeBundle([{ type: 'course', id: courseA }]);
    const roots = [];
    for (const user of users) roots.push(await grantRoot(user.id, 'bundle', bundle));
    const expiredUser = await makeUser();
    const expiredRoot = await grantRoot(expiredUser.id, 'bundle', bundle, {
      source: 'order',
      startsAt: new Date(Date.now() - 5 * DAY),
      expiresAt: new Date(Date.now() - DAY),
    });

    await db
      .insertInto('bundleItems')
      .values({ bundleId: bundle, productType: 'course', productId: courseB, position: 1 })
      .execute();
    const added = await recalculateEntitlements(db, {
      productType: 'bundle',
      productId: bundle,
      batchSize: 2,
    });
    expect(added).toMatchObject({ roots: 3, created: 6, revoked: 0, batches: 2 });
    expect(await active(expiredRoot.entitlement.id)).toHaveLength(2);
    const first = roots[0]?.entitlement.id as string;
    const tree = await active(first);
    const courseBNode = tree.find((row) => row.productId === courseB);
    expect(tree.find((row) => row.productId === ebook)?.parentEntitlementId).toBe(courseBNode?.id);

    // O ebook passa a estar direto no pacote: muda de caminho (fica sob a raiz).
    await db
      .insertInto('bundleItems')
      .values({ bundleId: bundle, productType: 'ebook', productId: ebook, position: 2 })
      .execute();
    const moved = await recalculateEntitlements(db, { productType: 'bundle', productId: bundle });
    expect(moved).toMatchObject({ created: 3, revoked: 3 });
    const movedTree = await active(first);
    expect(movedTree.filter((row) => row.productId === ebook)).toHaveLength(1);
    expect(movedTree.find((row) => row.productId === ebook)?.parentEntitlementId).toBe(first);

    // Remover o curso B revoga o derivado dele (e os filhos); o ebook segue direto no pacote.
    await db
      .deleteFrom('bundleItems')
      .where('bundleId', '=', bundle)
      .where('productId', '=', courseB)
      .execute();
    const removed = await recalculateEntitlements(db, { productType: 'bundle', productId: bundle });
    expect(removed).toMatchObject({ created: 0, revoked: 3 });
    expect(
      (await canAccess(db, users[0] as TestUser, { type: 'course', id: courseB })).allowed,
    ).toBe(false);
    expect((await canAccess(db, users[0] as TestUser, { type: 'ebook', id: ebook })).allowed).toBe(
      true,
    );

    expect(
      await recalculateEntitlements(db, { productType: 'course', productId: crypto.randomUUID() }),
    ).toEqual({
      roots: 0,
      created: 0,
      revoked: 0,
      batches: 0,
    });
    await rejects(
      recalculateEntitlements(db, { productType: 'ebook' as never, productId: bundle }),
      'validation_failed',
    );
    await rejects(
      recalculateEntitlements(db, { productType: 'bundle', productId: 'x' }),
      'validation_failed',
    );
  });
});

describe('listas', () => {
  it('árvore do usuário, quem tem acesso ao produto e o que o aluno tem', async () => {
    const student = await makeUser();
    const other = await makeUser();
    const course = await makeCourse();
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', course);
    const bundle = await makeBundle([{ type: 'course', id: course }]);
    const pack = await grantRoot(student.id, 'bundle', bundle, { source: 'order' });
    const direct = await grantManualEntitlement(db, request(admin), student.id, {
      productType: 'ebook',
      productId: ebook,
      reason: 'Material extra',
    });
    const expired = await grantRoot(other.id, 'course', course, {
      source: 'order',
      startsAt: new Date(Date.now() - 3 * DAY),
      expiresAt: new Date(Date.now() - DAY),
    });
    const revokedCourse = await makeCourse();
    const revoked = await grantRoot(student.id, 'course', revokedCourse);
    await db
      .transaction()
      .execute((trx) => revokeEntitlementTree(trx, revoked.entitlement.id, 'manual'));

    const tree = await listUserEntitlements(db, request(manager), student.id);
    expect(tree.items.map((item) => item.id)).toEqual([
      revoked.entitlement.id,
      direct.entitlement.id,
      pack.entitlement.id,
    ]);
    const packView = tree.items[2] as EntitlementView;
    expect(packView.children).toHaveLength(1);
    expect(packView.children[0]?.product.id).toBe(course);
    expect(packView.children[0]?.children[0]?.product.id).toBe(ebook);
    expect(tree.items[0]?.state).toBe('revoked');
    await rejects(
      listUserEntitlements(db, request(instructor), student.id),
      'permission_denied',
      403,
    );
    await rejects(
      listUserEntitlements(db, request(manager), crypto.randomUUID()),
      'not_found',
      404,
    );

    const activeOnes = await listProductEntitlements(db, request(manager), {
      productType: 'ebook',
      productId: ebook,
    });
    expect(activeOnes.items).toHaveLength(2);
    expect(activeOnes.items[0]).toMatchObject({
      id: direct.entitlement.id,
      source: 'grant',
      via: null,
    });
    expect(activeOnes.items[1]).toMatchObject({
      source: 'cascade',
      via: { type: 'bundle', id: bundle },
      user: { id: student.id, avatarUrl: null },
    });
    const page1 = await listProductEntitlements(db, request(manager), {
      productType: 'ebook',
      productId: ebook,
      limit: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listProductEntitlements(db, request(manager), {
      productType: 'ebook',
      productId: ebook,
      limit: 1,
      cursor: page1.nextCursor as string,
    });
    expect(page2.items[0]?.id).toBe(activeOnes.items[1]?.id);
    expect(page2.nextCursor).toBeNull();
    const expiredOnes = await listProductEntitlements(db, request(admin), {
      productType: 'course',
      productId: course,
      state: 'expired',
    });
    expect(expiredOnes.items.map((item) => item.id)).toContain(expired.entitlement.id);
    await rejects(
      listProductEntitlements(db, request(manager), {
        productType: 'ebook',
        productId: ebook,
        state: 'gone' as never,
        limit: 0,
      }),
      'validation_failed',
    );
    await rejects(
      listProductEntitlements(db, request(manager), {
        productType: 'ebook',
        productId: ebook,
        cursor: 'lixo',
      }),
      'validation_failed',
    );
    await rejects(
      listProductEntitlements(db, request(manager), {
        productType: 'course',
        productId: crypto.randomUUID(),
      }),
      'not_found',
    );
    await rejects(
      listProductEntitlements(db, request(instructor), {
        productType: 'course',
        productId: course,
      }),
      'permission_denied',
    );

    const mine = await listMyEntitlements(db, student.id);
    expect(mine.items.map((item) => item.id)).not.toContain(revoked.entitlement.id);
    const viaCourse = mine.items.find(
      (item) => item.productId === ebook && item.source === 'cascade',
    );
    expect(viaCourse).toMatchObject({ state: 'active', via: { productType: 'bundle' } });
    expect(mine.items.find((item) => item.id === pack.entitlement.id)).toMatchObject({
      productType: 'bundle',
      via: null,
      expiresAt: null,
    });
    const otherMine = await listMyEntitlements(db, other.id);
    expect(otherMine.items.find((item) => item.productId === course)).toMatchObject({
      state: 'expired',
      source: 'order',
    });
    expect(otherMine.items).toHaveLength(2);
    expect((await listMyEntitlements(db, 'x')).items).toEqual([]);
  });
});
