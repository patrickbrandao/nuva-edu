import { randomUUID } from 'node:crypto';
import { type Database, enqueue, grantEntitlement, type JobOf } from '@nuva-edu/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from '../src/handlers.ts';
import { createWorker, type Worker } from '../src/worker.ts';
import {
  captureLogger,
  clearJobs,
  getJob,
  handlerDependencies,
  openDatabase,
  testDatabaseUrl,
  waitFor,
} from './helpers.ts';

// `entitlement.recompute` (spec 010, "Recalcular a cascata") pelo worker real: a tarefa é
// enfileirada como a `admin-api` faz e o manipulador chama `recalculateEntitlements` do núcleo.
// O catálogo é gravado direto nas tabelas; as raízes, por `grantEntitlement` sem e-mail.

let db: Database;
let worker: Worker | null = null;
let captured = captureLogger();
let grantorId: string;

async function startWorker(): Promise<void> {
  captured = captureLogger();
  worker = createWorker({
    db,
    databaseUrl: testDatabaseUrl(),
    logger: captured.logger,
    handlers: createHandlers(handlerDependencies(db, captured.logger)),
    concurrency: 2,
    sweepIntervalMs: 50,
  });
  await worker.start();
}

async function makeUser(): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({ email: `aluno-${randomUUID()}@escola.test`, name: 'Ana Teste' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function slug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 13)}`;
}

async function makeCourse(): Promise<string> {
  const row = await db
    .insertInto('courses')
    .values({
      slug: slug('curso'),
      title: 'Curso de teste',
      accessMode: 'paid',
      priceCents: 9900,
      status: 'published',
      publishedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeEbook(): Promise<string> {
  const row = await db
    .insertInto('ebooks')
    .values({
      slug: slug('ebook'),
      title: 'Ebook de teste',
      accessMode: 'paid',
      priceCents: 1900,
      fileUrl: 'https://arquivos.example.com/ebook.pdf',
      status: 'published',
      publishedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeBundle(): Promise<string> {
  const row = await db
    .insertInto('bundles')
    .values({
      slug: slug('pacote'),
      title: 'Pacote de teste',
      accessMode: 'paid',
      priceCents: 19900,
      status: 'published',
      publishedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function addBundleItem(bundleId: string, productType: 'course' | 'ebook', productId: string) {
  await db
    .insertInto('bundleItems')
    .values({ bundleId, productType, productId, position: 0 })
    .execute();
}

async function linkEbook(ebookId: string, targetType: 'course' | 'bundle', targetId: string) {
  await db.insertInto('productEbooks').values({ ebookId, targetType, targetId }).execute();
}

async function unlinkEbook(ebookId: string, targetType: 'course' | 'bundle', targetId: string) {
  await db
    .deleteFrom('productEbooks')
    .where('ebookId', '=', ebookId)
    .where('targetType', '=', targetType)
    .where('targetId', '=', targetId)
    .execute();
}

/** Raiz por concessão manual, sem o e-mail (a fila fica só com o recálculo). */
async function grantRoot(
  userId: string,
  productType: 'course' | 'bundle' | 'ebook',
  productId: string,
): Promise<string> {
  const result = await db.transaction().execute((trx) =>
    grantEntitlement(trx, {
      userId,
      productType,
      productId,
      source: 'grant',
      sourceId: grantorId,
      grantedReason: 'teste',
      notify: false,
    }),
  );
  return result.entitlement.id;
}

/** Todos os direitos do usuário ao produto, revogados ou não, do mais antigo ao mais novo. */
async function rights(userId: string, productType: string, productId: string) {
  return db
    .selectFrom('entitlements')
    .select(['id', 'source', 'parentEntitlementId', 'revokedAt', 'revokeReason'])
    .where('userId', '=', userId)
    .where('productType', '=', productType)
    .where('productId', '=', productId)
    .orderBy('createdAt')
    .orderBy('id')
    .execute();
}

async function snapshot(userIds: string[]) {
  return db
    .selectFrom('entitlements')
    .select(['id', 'parentEntitlementId', 'revokedAt', 'revokeReason'])
    .where('userId', 'in', userIds)
    .orderBy('id')
    .execute();
}

/** Enfileira o recálculo e espera o worker concluir. */
async function recompute(
  productType: 'course' | 'bundle',
  productId: string,
  status: 'done' | 'failed' = 'done',
): Promise<string> {
  const job = await enqueue(db, 'entitlement.recompute', { productType, productId });
  if (!job) {
    throw new Error('recálculo não enfileirado');
  }
  await waitFor(async () => (await getJob(db, job.id)).status === status);
  return job.id;
}

function recomputeLog(jobId: string): Record<string, unknown> | undefined {
  return captured.lines.find(
    (line) => line.job_id === jobId && line.msg === 'Cascata de direitos recalculada',
  );
}

beforeAll(async () => {
  db = openDatabase(8);
  grantorId = await makeUser();
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await clearJobs(db);
  await startWorker();
});

afterEach(async () => {
  await worker?.stop({ timeoutMs: 1_000 });
  worker = null;
});

describe('entitlement.recompute', () => {
  it('ebook acrescentado ao curso é liberado a quem já tem o curso', async () => {
    const withCourse = await makeUser();
    const other = await makeUser();
    const course = await makeCourse();
    const otherCourse = await makeCourse();
    const ebook = await makeEbook();
    const root = await grantRoot(withCourse, 'course', course);
    await grantRoot(other, 'course', otherCourse);

    await linkEbook(ebook, 'course', course);
    expect(await rights(withCourse, 'ebook', ebook)).toHaveLength(0);
    const jobId = await recompute('course', course);

    expect(await rights(withCourse, 'ebook', ebook)).toMatchObject([
      { source: 'cascade', parentEntitlementId: root, revokedAt: null },
    ]);
    // Quem tem outro curso não ganha nada.
    expect(await rights(other, 'ebook', ebook)).toHaveLength(0);
    expect(recomputeLog(jobId)).toMatchObject({
      product_type: 'course',
      product_id: course,
      roots: 1,
      created: 1,
      revoked: 0,
      batches: 1,
    });
  });

  it('ebook removido do curso revoga só os derivados daquele vínculo', async () => {
    const student = await makeUser();
    const buyer = await makeUser();
    const course = await makeCourse();
    const removed = await makeEbook();
    const kept = await makeEbook();
    await linkEbook(removed, 'course', course);
    await linkEbook(kept, 'course', course);
    const root = await grantRoot(student, 'course', course);
    // O aluno também tem o ebook removido por conta própria, e outro aluno só o tem direto.
    const ownRoot = await grantRoot(student, 'ebook', removed);
    const buyerRoot = await grantRoot(buyer, 'ebook', removed);

    await unlinkEbook(removed, 'course', course);
    const jobId = await recompute('course', course);

    const mine = await rights(student, 'ebook', removed);
    const derived = mine.find((row) => row.parentEntitlementId === root);
    expect(derived?.revokedAt).not.toBeNull();
    expect(derived?.revokeReason).toBe('recalculation');
    expect(mine.find((row) => row.id === ownRoot)).toMatchObject({
      revokedAt: null,
      revokeReason: null,
    });
    expect(await rights(buyer, 'ebook', removed)).toMatchObject([
      { id: buyerRoot, revokedAt: null },
    ]);
    // O outro ebook do curso e o próprio curso continuam.
    expect(await rights(student, 'ebook', kept)).toMatchObject([
      { parentEntitlementId: root, revokedAt: null },
    ]);
    expect(await rights(student, 'course', course)).toMatchObject([{ id: root, revokedAt: null }]);
    expect(recomputeLog(jobId)).toMatchObject({ roots: 1, created: 0, revoked: 1 });
  });

  it('reexecutar a tarefa não duplica nem revoga de novo', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const added = await makeEbook();
    const removed = await makeEbook();
    await linkEbook(removed, 'course', course);
    await grantRoot(student, 'course', course);
    await linkEbook(added, 'course', course);
    await unlinkEbook(removed, 'course', course);

    const first = await recompute('course', course);
    expect(recomputeLog(first)).toMatchObject({ created: 1, revoked: 1 });
    const before = await snapshot([student]);
    expect(before).toHaveLength(3);

    // A mesma tarefa de novo pela fila, e mais uma vez direto no manipulador (nova tentativa).
    const second = await recompute('course', course);
    expect(recomputeLog(second)).toMatchObject({ roots: 1, created: 0, revoked: 0 });
    const handlers = createHandlers(handlerDependencies(db, captured.logger));
    const job = (await getJob(db, first)) as unknown as JobOf<'entitlement.recompute'>;
    await handlers['entitlement.recompute']?.(job, { signal: new AbortController().signal });

    expect(await snapshot([student])).toEqual(before);
    expect(await rights(student, 'ebook', added)).toHaveLength(1);
  });

  it('curso acrescentado ao pacote libera o curso e os ebooks dele; removido, revoga a árvore', async () => {
    const student = await makeUser();
    const bundle = await makeBundle();
    const course = await makeCourse();
    const ebook = await makeEbook();
    await linkEbook(ebook, 'course', course);
    const root = await grantRoot(student, 'bundle', bundle);

    await addBundleItem(bundle, 'course', course);
    const added = await recompute('bundle', bundle);
    const [derivedCourse] = await rights(student, 'course', course);
    expect(derivedCourse).toMatchObject({
      source: 'cascade',
      parentEntitlementId: root,
      revokedAt: null,
    });
    expect(await rights(student, 'ebook', ebook)).toMatchObject([
      { source: 'cascade', parentEntitlementId: derivedCourse?.id, revokedAt: null },
    ]);
    expect(recomputeLog(added)).toMatchObject({ product_type: 'bundle', roots: 1, created: 2 });

    await db.deleteFrom('bundleItems').where('bundleId', '=', bundle).execute();
    const removed = await recompute('bundle', bundle);
    expect(await rights(student, 'course', course)).toMatchObject([
      { revokeReason: 'recalculation' },
    ]);
    expect(await rights(student, 'ebook', ebook)).toMatchObject([
      { revokeReason: 'recalculation' },
    ]);
    expect(await rights(student, 'bundle', bundle)).toMatchObject([{ id: root, revokedAt: null }]);
    expect(recomputeLog(removed)).toMatchObject({ roots: 1, created: 0, revoked: 2 });
  });

  it('produto sem nenhum direito conclui sem gravar nada', async () => {
    const course = await makeCourse();
    const jobId = await recompute('course', course);
    expect(recomputeLog(jobId)).toMatchObject({ roots: 0, created: 0, revoked: 0, batches: 0 });
  });

  it('payload inválido falha de vez, sem nova tentativa', async () => {
    const jobId = await recompute('course', 'não-é-uuid', 'failed');
    const job = await getJob(db, jobId);
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('payload inválido');
    expect(recomputeLog(jobId)).toBeUndefined();
  });
});
