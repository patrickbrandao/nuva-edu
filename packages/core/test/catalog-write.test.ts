import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  archiveBundle,
  archiveCourse,
  archiveEbook,
  CATALOG_LIMITS,
  type CatalogRequest,
  cancelCourseReview,
  closeDatabase,
  countBundleAffectedStudents,
  countCourseAffectedStudents,
  countEbookAffectedStudents,
  createBundle,
  createCourse,
  createDatabase,
  createEbook,
  createLesson,
  createModule,
  type Database,
  DomainError,
  deleteBundle,
  deleteCourse,
  deleteEbook,
  deleteLesson,
  deleteModule,
  deleteOrphanImages,
  findCatalogCourse,
  listCatalogLessonLinks,
  publishBundle,
  publishCourse,
  publishEbook,
  type Role,
  reorderLessons,
  reorderModules,
  requestCourseReview,
  setBundleItems,
  setCourseOwner,
  setEbookTargets,
  setLessonLinks,
  unarchiveBundle,
  unarchiveCourse,
  unarchiveEbook,
  unpublishBundle,
  unpublishCourse,
  unpublishEbook,
  updateBundle,
  updateCourse,
  updateEbook,
  updateLesson,
  updateModule,
} from '../src/index.ts';

// Regras de escrita do catálogo (spec 009; 008 "Regra do instrutor"; P2, P3 e P5 da tarefa 400).

let db: Database;
let admin: CatalogRequest;
let manager: CatalogRequest;
let instructor: CatalogRequest;
let otherInstructor: CatalogRequest;
let student: CatalogRequest;

async function createUser(role: Role): Promise<CatalogRequest> {
  const row = await sql<{ id: string }>`
    INSERT INTO users (email, name, role)
    VALUES (${`cat-${randomUUID()}@exemplo.test`}, 'Pessoa de teste', ${role})
    RETURNING id`.execute(db);
  const id = row.rows[0]?.id as string;
  return { actor: { id, role }, context: { ip: '127.0.0.1', requestId: 'req-cat' } };
}

beforeAll(async () => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 4 });
  admin = await createUser('admin');
  manager = await createUser('manager');
  instructor = await createUser('instructor');
  otherInstructor = await createUser('instructor');
  student = await createUser('student');
});

afterAll(async () => {
  await closeDatabase(db);
});

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  const domain = error as DomainError;
  expect({ status: domain.status, code: domain.code }).toEqual({ status, code });
  return domain;
}

function slug(): string {
  return `curso-${randomUUID().slice(0, 8)}`;
}

async function auditOf(targetId: string) {
  const result = await sql<{ action: string; outcome: string; actorUserId: string | null }>`
    SELECT action, outcome, actor_user_id FROM audit_log
    WHERE target_id = ${targetId} ORDER BY created_at, id`.execute(db);
  return result.rows;
}

async function deniedFor(actorId: string, action: string): Promise<number> {
  const result = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM audit_log
    WHERE actor_user_id = ${actorId} AND action = ${action} AND outcome = 'denied'`.execute(db);
  return result.rows[0]?.n ?? 0;
}

async function jobsFor(type: string, key: string, value: string): Promise<number> {
  const result = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM jobs WHERE type = ${type} AND payload->>${key} = ${value}`.execute(
    db,
  );
  return result.rows[0]?.n ?? 0;
}

async function grant(userId: string, productType: string, productId: string): Promise<void> {
  await sql`
    INSERT INTO entitlements (user_id, product_type, product_id, source, source_id, granted_reason)
    VALUES (${userId}, ${productType}, ${productId}, 'grant', ${admin.actor.id}, 'teste')`.execute(
    db,
  );
}

/**
 * Torna o curso `open` direto na tabela: o curso nasce `private` (spec 009, "Modo de acesso
 * inicial") e o instrutor não muda o modo; assim o `version` dos testes não avança.
 */
async function openCourse(courseId: string): Promise<void> {
  await sql`UPDATE courses SET access_mode = 'open' WHERE id = ${courseId}`.execute(db);
}

/** Curso `open` com um módulo e uma aula publicada (pronto para publicar). */
async function courseWithLesson(request: CatalogRequest, extra: Record<string, unknown> = {}) {
  const created = await createCourse(db, request, { slug: slug(), title: 'Curso', ...extra });
  if (extra.accessMode === undefined) await openCourse(created.id);
  const course = (await findCatalogCourse(db, created.id)) as typeof created;
  const module = await createModule(db, request, course.id, { title: 'Módulo 1' });
  const lesson = await createLesson(db, admin, module.id, {
    title: 'Aula 1',
    status: 'published',
    videoUrl: 'https://youtu.be/abc',
  });
  return { course, module, lesson };
}

describe('cursos', () => {
  it('o instrutor cria e vira o dono; a criação é auditada', async () => {
    const course = await createCourse(db, instructor, {
      slug: slug(),
      title: '  Meu curso  ',
      summary: '',
      level: 'beginner',
    });
    expect(course).toMatchObject({
      ownerId: instructor.actor.id,
      title: 'Meu curso',
      summary: null,
      status: 'draft',
      accessMode: 'private',
      priceCents: null,
      version: 1,
    });
    expect(await auditOf(course.id)).toEqual([
      { action: 'course.create', outcome: 'ok', actorUserId: instructor.actor.id },
    ]);
  });

  it('aluno não cria curso', async () => {
    await expectError(
      createCourse(db, student, { slug: slug(), title: 'X' }),
      403,
      'permission_denied',
    );
    expect(await deniedFor(student.actor.id, 'course.create')).toBe(1);
  });

  it('slug repetido é 409 slug_taken', async () => {
    const value = slug();
    await createCourse(db, manager, { slug: value, title: 'A' });
    await expectError(createCourse(db, manager, { slug: value, title: 'B' }), 409, 'slug_taken');
  });

  it('campos fora do formato e dos limites da RNF-03 são 400 com o campo', async () => {
    const error = await expectError(
      createCourse(db, manager, {
        slug: 'Com Espaço',
        title: 'x'.repeat(CATALOG_LIMITS.titleMaxLength + 1),
        summary: 'y'.repeat(CATALOG_LIMITS.summaryMaxLength + 1),
        description: 'z'.repeat(CATALOG_LIMITS.descriptionMaxLength + 1),
        level: 'expert',
      }),
      400,
      'validation_failed',
    );
    expect(error.errors?.map((e) => e.path)).toEqual([
      'body.slug',
      'body.title',
      'body.summary',
      'body.description',
      'body.level',
    ]);
    const ok = await createCourse(db, manager, {
      slug: slug(),
      title: 'x'.repeat(CATALOG_LIMITS.titleMaxLength),
      summary: 'y'.repeat(CATALOG_LIMITS.summaryMaxLength),
      description: 'z'.repeat(CATALOG_LIMITS.descriptionMaxLength),
    });
    expect(ok.description?.length).toBe(CATALOG_LIMITS.descriptionMaxLength);
  });

  it('instrutor recebe 404 no curso alheio e 403 ao mudar preço ou modo do próprio', async () => {
    const mine = await createCourse(db, instructor, { slug: slug(), title: 'Meu' });
    const other = await createCourse(db, otherInstructor, { slug: slug(), title: 'Alheio' });
    await expectError(
      updateCourse(db, instructor, other.id, { title: 'Novo', version: 1 }),
      404,
      'not_found',
    );
    await expectError(
      updateCourse(db, instructor, mine.id, { accessMode: 'paid', version: 1 }),
      403,
      'permission_denied',
    );
    await expectError(
      updateCourse(db, instructor, mine.id, { accessDays: 30, version: 1 }),
      403,
      'permission_denied',
    );
    await expectError(
      createCourse(db, instructor, {
        slug: slug(),
        title: 'Pago',
        accessMode: 'paid',
        priceCents: 100,
      }),
      403,
      'permission_denied',
    );
    expect(await deniedFor(instructor.actor.id, 'product.set_access')).toBeGreaterThanOrEqual(2);
    // Reenviar o mesmo modo não é mudança.
    const same = await updateCourse(db, instructor, mine.id, {
      accessMode: 'private',
      priceCents: null,
      accessDays: null,
      title: 'Meu, novo',
      version: 1,
    });
    expect(same).toMatchObject({ title: 'Meu, novo', version: 2 });
  });

  it('curso sem dono é só de gerente e admin', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'Sem dono' });
    expect(course.ownerId).toBeNull();
    await expectError(
      updateCourse(db, instructor, course.id, { title: 'X', version: 1 }),
      404,
      'not_found',
    );
  });

  it('gerente altera o modo de acesso e recebe 403 ao alterar o preço; admin define o preço', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'Modo' });
    const paid = await updateCourse(db, manager, course.id, {
      accessMode: 'paid',
      accessDays: 365,
      version: 1,
    });
    expect(paid).toMatchObject({ accessMode: 'paid', priceCents: null, accessDays: 365 });
    await expectError(
      updateCourse(db, manager, course.id, { priceCents: 4990, version: paid.version }),
      403,
      'permission_denied',
    );
    expect(await deniedFor(manager.actor.id, 'product.set_price')).toBe(1);
    const priced = await updateCourse(db, admin, course.id, {
      priceCents: 4990,
      version: paid.version,
    });
    expect(priced.priceCents).toBe(4990);
    const actions = (await auditOf(course.id)).map((row) => `${row.action}:${row.outcome}`);
    expect(actions).toEqual([
      'course.create:ok',
      'product.set_access:ok',
      'product.set_price:denied',
      'product.set_price:ok',
    ]);
    // Voltar a `open` limpa o preço, como consequência do modo.
    const open = await updateCourse(db, manager, course.id, {
      accessMode: 'open',
      version: priced.version,
    });
    expect(open).toMatchObject({ accessMode: 'open', priceCents: null });
    await expectError(
      updateCourse(db, admin, course.id, { priceCents: 100, version: open.version }),
      422,
      'price_not_allowed',
    );
  });

  it('version divergente é 409 version_conflict', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'V' });
    await updateCourse(db, manager, course.id, { title: 'V2', version: 1 });
    await expectError(
      updateCourse(db, manager, course.id, { title: 'V3', version: 1 }),
      409,
      'version_conflict',
    );
    await expectError(
      updateCourse(db, manager, course.id, { title: 'V3', version: 'x' }),
      400,
      'validation_failed',
    );
  });

  it('identificador fora do formato ou inexistente é 404', async () => {
    await expectError(updateCourse(db, admin, 'nada', { version: 1 }), 404, 'not_found');
    await expectError(updateCourse(db, admin, randomUUID(), { version: 1 }), 404, 'not_found');
  });

  it('publicar exige aula publicada e preço no curso pago', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'Vazio' });
    await expectError(publishCourse(db, manager, course.id), 422, 'course_has_no_published_lesson');
    const module = await createModule(db, manager, course.id, { title: 'M' });
    await createLesson(db, manager, module.id, { title: 'Rascunho' });
    await expectError(publishCourse(db, manager, course.id), 422, 'course_has_no_published_lesson');
    await createLesson(db, manager, module.id, { title: 'Pública', status: 'published' });
    await updateCourse(db, manager, course.id, { accessMode: 'paid', version: 1 });
    await expectError(publishCourse(db, manager, course.id), 422, 'price_required');
    await updateCourse(db, admin, course.id, { priceCents: 0, version: 2 });
    const published = await publishCourse(db, manager, course.id);
    expect(published).toMatchObject({ status: 'published', publishedAt: expect.any(Date) });
    // Já publicado: idempotente. Pago publicado não perde o preço.
    expect((await publishCourse(db, manager, course.id)).version).toBe(published.version);
    await expectError(
      updateCourse(db, admin, course.id, { priceCents: null, version: published.version }),
      422,
      'price_required',
    );
  });

  it('instrutor publica o próprio curso open, mas não o pago, e pede publicação', async () => {
    const { course } = await courseWithLesson(instructor);
    expect((await publishCourse(db, instructor, course.id)).status).toBe('published');
    expect((await unpublishCourse(db, instructor, course.id)).status).toBe('draft');

    const paid = await courseWithLesson(instructor);
    await updateCourse(db, manager, paid.course.id, { accessMode: 'private', version: 1 });
    await expectError(publishCourse(db, instructor, paid.course.id), 403, 'permission_denied');
    expect(await deniedFor(instructor.actor.id, 'course.publish')).toBeGreaterThanOrEqual(1);
    const requested = await requestCourseReview(db, instructor, paid.course.id);
    expect(requested.reviewRequestedAt).toBeInstanceOf(Date);
    expect((await requestCourseReview(db, instructor, paid.course.id)).version).toBe(
      requested.version,
    );
    const cancelled = await cancelCourseReview(db, instructor, paid.course.id);
    expect(cancelled.reviewRequestedAt).toBeNull();
    expect((await cancelCourseReview(db, instructor, paid.course.id)).version).toBe(
      cancelled.version,
    );
    await requestCourseReview(db, instructor, paid.course.id);
    const published = await publishCourse(db, manager, paid.course.id);
    expect(published.reviewRequestedAt).toBeNull();
    const actions = (await auditOf(paid.course.id)).map((row) => row.action);
    expect(actions).toContain('course.request_review');
    expect(actions).toContain('course.request_review_cancel');
  });

  it('publicar a última aula draft limpa o pedido de publicação', async () => {
    const { course, module } = await courseWithLesson(instructor);
    const draft = await createLesson(db, instructor, module.id, { title: 'Nova' });
    await requestCourseReview(db, instructor, course.id);
    await updateLesson(db, manager, draft.id, { status: 'published', version: draft.version });
    expect((await findCatalogCourse(db, course.id))?.reviewRequestedAt).toBeNull();
  });

  it('despublicar conta os alunos afetados e não revoga direitos', async () => {
    const { course } = await courseWithLesson(manager);
    await publishCourse(db, manager, course.id);
    const a = await createUser('student');
    const b = await createUser('student');
    await grant(a.actor.id, 'course', course.id);
    await grant(b.actor.id, 'course', course.id);
    await grant(b.actor.id, 'course', course.id).catch(() => undefined);
    expect(await countCourseAffectedStudents(db, manager, course.id)).toBe(2);
    await expectError(
      countCourseAffectedStudents(db, otherInstructor, course.id),
      404,
      'not_found',
    );
    await unpublishCourse(db, manager, course.id);
    const result = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM entitlements WHERE product_id = ${course.id} AND revoked_at IS NULL`.execute(
      db,
    );
    expect(result.rows[0]?.n).toBe(2);
    const unpublish = (await auditOf(course.id)).find((row) => row.action === 'course.unpublish');
    expect(unpublish).toBeDefined();
  });

  it('excluir curso com direito é 409 product_has_links também para o admin; arquivar só o admin', async () => {
    const { course } = await courseWithLesson(instructor);
    await grant(student.actor.id, 'course', course.id);
    await expectError(deleteCourse(db, admin, course.id), 409, 'product_has_links');
    await expectError(deleteCourse(db, instructor, course.id), 409, 'product_has_links');
    await expectError(archiveCourse(db, manager, course.id), 403, 'permission_denied');
    await expectError(archiveCourse(db, instructor, course.id), 403, 'permission_denied');
    expect(await deniedFor(manager.actor.id, 'course.archive')).toBe(1);
    await publishCourse(db, instructor, course.id);
    const archived = await archiveCourse(db, admin, course.id);
    expect(archived).toMatchObject({ status: 'draft', archivedAt: expect.any(Date) });
    expect((await archiveCourse(db, admin, course.id)).version).toBe(archived.version);
    await expectError(publishCourse(db, admin, course.id), 422, 'product_archived');
    await expectError(requestCourseReview(db, instructor, course.id), 422, 'product_archived');
    await expectError(unarchiveCourse(db, manager, course.id), 403, 'permission_denied');
    const restored = await unarchiveCourse(db, admin, course.id);
    expect(restored).toMatchObject({ archivedAt: null, status: 'draft' });
    expect((await unarchiveCourse(db, admin, course.id)).version).toBe(restored.version);
  });

  it('excluir curso com progresso e sem direito é 409 product_has_links para todos os papéis', async () => {
    const { course, lesson } = await courseWithLesson(instructor);
    await sql`
      INSERT INTO lesson_progress (user_id, lesson_id, course_id)
      VALUES (${student.actor.id}, ${lesson.id}, ${course.id})`.execute(db);
    const entitlements = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM entitlements WHERE product_id = ${course.id}`.execute(db);
    expect(entitlements.rows[0]?.n).toBe(0);
    for (const request of [admin, manager, instructor]) {
      await expectError(deleteCourse(db, request, course.id), 409, 'product_has_links');
    }
    // Quem não alcança o curso continua sem saber dele; o aluno não tem a ação.
    await expectError(deleteCourse(db, otherInstructor, course.id), 404, 'not_found');
    await expectError(deleteCourse(db, student, course.id), 403, 'permission_denied');
    expect(await findCatalogCourse(db, course.id)).toBeDefined();
    // Sem o progresso, o curso volta a poder ser excluído.
    await sql`DELETE FROM lesson_progress WHERE course_id = ${course.id}`.execute(db);
    await deleteCourse(db, admin, course.id);
    expect(await findCatalogCourse(db, course.id)).toBeUndefined();
  });

  it('excluir curso sem vínculos apaga a estrutura, tira dos pacotes e recalcula', async () => {
    const { course, lesson } = await courseWithLesson(instructor);
    const ebook = await createEbook(db, manager, { slug: slug(), title: 'E' });
    await setEbookTargets(db, manager, ebook.id, {
      targets: [
        { targetType: 'course', targetId: course.id },
        { targetType: 'lesson', targetId: lesson.id },
      ],
    });
    const bundle = await createBundle(db, manager, { slug: slug(), title: 'P' });
    await setBundleItems(db, manager, bundle.id, {
      items: [{ productType: 'course', productId: course.id }],
    });
    await expectError(deleteCourse(db, otherInstructor, course.id), 404, 'not_found');
    const before = await jobsFor('entitlement.recompute', 'productId', bundle.id);
    await deleteCourse(db, instructor, course.id);
    expect(await findCatalogCourse(db, course.id)).toBeUndefined();
    const left = await sql<{ items: number; links: number; lessons: number }>`
      SELECT (SELECT count(*)::int FROM bundle_items WHERE product_id = ${course.id}) AS items,
             (SELECT count(*)::int FROM product_ebooks WHERE ebook_id = ${ebook.id}) AS links,
             (SELECT count(*)::int FROM lessons WHERE id = ${lesson.id}) AS lessons`.execute(db);
    expect(left.rows[0]).toEqual({ items: 0, links: 0, lessons: 0 });
    expect(await jobsFor('entitlement.recompute', 'productId', bundle.id)).toBe(before + 1);
    expect((await auditOf(course.id)).at(-1)?.action).toBe('course.delete');
  });

  it('troca de dono é de gerente e admin, e o dono precisa ser instrutor', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'Dono' });
    await expectError(
      setCourseOwner(db, instructor, course.id, { ownerId: instructor.actor.id }),
      403,
      'permission_denied',
    );
    await expectError(
      setCourseOwner(db, manager, course.id, { ownerId: student.actor.id }),
      422,
      'owner_invalid',
    );
    const owned = await setCourseOwner(db, manager, course.id, {
      ownerId: instructor.actor.id,
      version: 1,
    });
    expect(owned.ownerId).toBe(instructor.actor.id);
    expect(
      (await setCourseOwner(db, admin, course.id, { ownerId: instructor.actor.id })).version,
    ).toBe(owned.version);
    await expectError(
      setCourseOwner(db, admin, course.id, { ownerId: null, version: 1 }),
      409,
      'version_conflict',
    );
    const created = await createCourse(db, manager, {
      slug: slug(),
      title: 'Com dono',
      ownerId: otherInstructor.actor.id,
    });
    expect(created.ownerId).toBe(otherInstructor.actor.id);
    await expectError(
      createCourse(db, instructor, { slug: slug(), title: 'X', ownerId: otherInstructor.actor.id }),
      403,
      'permission_denied',
    );
  });

  it('capa precisa ser imagem product_cover; capa em uso não some no expurgo', async () => {
    const image = await sql<{ id: string }>`
      INSERT INTO images (owner_user_id, purpose, original_width, original_height, created_at)
      VALUES (${manager.actor.id}, 'product_cover', 10, 10, now() - interval '2 days')
      RETURNING id`.execute(db);
    const avatar = await sql<{ id: string }>`
      INSERT INTO images (owner_user_id, purpose, original_width, original_height)
      VALUES (${manager.actor.id}, 'avatar', 10, 10) RETURNING id`.execute(db);
    const coverId = image.rows[0]?.id as string;
    await expectError(
      createCourse(db, manager, { slug: slug(), title: 'C', coverImageId: avatar.rows[0]?.id }),
      422,
      'cover_image_invalid',
    );
    const course = await createCourse(db, manager, {
      slug: slug(),
      title: 'C',
      coverImageId: coverId,
    });
    const ebook = await createEbook(db, manager, { slug: slug(), title: 'E' });
    await updateEbook(db, manager, ebook.id, { coverImageId: coverId, version: 1 });
    await deleteOrphanImages(db);
    const kept = await sql<{
      n: number;
    }>`SELECT count(*)::int AS n FROM images WHERE id = ${coverId}`.execute(db);
    expect(kept.rows[0]?.n).toBe(1);
    await updateCourse(db, manager, course.id, { coverImageId: null, version: 1 });
    await deleteEbook(db, manager, ebook.id);
    await deleteOrphanImages(db);
    const gone = await sql<{
      n: number;
    }>`SELECT count(*)::int AS n FROM images WHERE id = ${coverId}`.execute(db);
    expect(gone.rows[0]?.n).toBe(0);
  });
});

describe('módulos e aulas', () => {
  it('reordenar 3 aulas grava a ordem nova numa transação', async () => {
    const course = await createCourse(db, instructor, { slug: slug(), title: 'Ordem' });
    const module = await createModule(db, instructor, course.id, { title: 'M' });
    const a = await createLesson(db, instructor, module.id, { title: 'A' });
    const b = await createLesson(db, instructor, module.id, { title: 'B' });
    const c = await createLesson(db, instructor, module.id, { title: 'C' });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    const reordered = await reorderLessons(db, instructor, module.id, {
      lessonIds: [c.id, a.id, b.id],
    });
    expect(reordered.map((lesson) => [lesson.title, lesson.position])).toEqual([
      ['C', 0],
      ['A', 1],
      ['B', 2],
    ]);
    await expectError(
      reorderLessons(db, instructor, module.id, { lessonIds: [c.id, a.id] }),
      422,
      'order_mismatch',
    );
    await expectError(
      reorderLessons(db, instructor, module.id, { lessonIds: [c.id, a.id, a.id] }),
      422,
      'order_mismatch',
    );
    await expectError(
      reorderLessons(db, otherInstructor, module.id, { lessonIds: [a.id, b.id, c.id] }),
      404,
      'not_found',
    );
    expect((await auditOf(module.id)).map((row) => row.action)).toEqual([
      'module.create',
      'lesson.reorder',
    ]);
  });

  it('reordena módulos, altera e exclui', async () => {
    const course = await createCourse(db, instructor, { slug: slug(), title: 'Módulos' });
    const m1 = await createModule(db, instructor, course.id, { title: 'Um' });
    const m2 = await createModule(db, instructor, course.id, { title: 'Dois' });
    const order = await reorderModules(db, instructor, course.id, { moduleIds: [m2.id, m1.id] });
    expect(order.map((module) => module.title)).toEqual(['Dois', 'Um']);
    await expectError(
      reorderModules(db, instructor, course.id, { moduleIds: 'x' }),
      400,
      'validation_failed',
    );
    const renamed = await updateModule(db, instructor, m1.id, { title: 'Um!', version: 1 });
    expect(renamed).toMatchObject({ title: 'Um!', version: 2 });
    expect((await updateModule(db, instructor, m1.id, { title: 'Um!', version: 2 })).version).toBe(
      2,
    );
    await expectError(
      updateModule(db, instructor, m1.id, { title: 'x', version: 1 }),
      409,
      'version_conflict',
    );
    await expectError(
      updateModule(db, otherInstructor, m1.id, { title: 'x', version: 2 }),
      404,
      'not_found',
    );
    await deleteModule(db, instructor, m2.id);
    await expectError(
      updateModule(db, instructor, m2.id, { title: 'x', version: 1 }),
      404,
      'not_found',
    );
  });

  it('excluir módulo: com aula recusa com 409 module_not_empty; vazio é apagado', async () => {
    const course = await createCourse(db, instructor, { slug: slug(), title: 'Excluir módulo' });
    await openCourse(course.id);
    const module = await createModule(db, instructor, course.id, { title: 'Com aula' });
    const lesson = await createLesson(db, instructor, module.id, { title: 'Rascunho' });
    const auditBefore = (await auditOf(module.id)).length;
    await expectError(deleteModule(db, instructor, module.id), 409, 'module_not_empty');
    // Nada gravado: módulo, aula e auditoria continuam como estavam.
    const kept = await db
      .selectFrom('lessons')
      .select('id')
      .where('moduleId', '=', module.id)
      .execute();
    expect(kept.map((row) => row.id)).toEqual([lesson.id]);
    expect((await auditOf(module.id)).length).toBe(auditBefore);
    // Aula publicada também impede.
    await updateLesson(db, instructor, lesson.id, { status: 'published', version: 1 });
    await expectError(deleteModule(db, instructor, module.id), 409, 'module_not_empty');
    // As aulas saem antes; o módulo vazio é apagado, com `module.delete`.
    await deleteLesson(db, instructor, lesson.id);
    await deleteModule(db, instructor, module.id);
    const gone = await db.selectFrom('modules').select('id').where('id', '=', module.id).execute();
    expect(gone).toEqual([]);
    expect((await auditOf(module.id)).map((row) => row.action)).toContain('module.delete');
  });

  it('limites de 100 módulos e 500 aulas por curso', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'Limites' });
    const modules = await sql<{ id: string }>`
      INSERT INTO modules (course_id, title, position)
      SELECT ${course.id}, 'M' || g, g FROM generate_series(0, ${CATALOG_LIMITS.modulesPerCourse - 1}) g
      RETURNING id`.execute(db);
    await expectError(
      createModule(db, manager, course.id, { title: 'Demais' }),
      422,
      'catalog_limit_exceeded',
    );
    const first = modules.rows[0]?.id as string;
    await sql`
      INSERT INTO lessons (module_id, title, position)
      SELECT ${first}, 'A' || g, g FROM generate_series(0, ${CATALOG_LIMITS.lessonsPerCourse - 1}) g`.execute(
      db,
    );
    await expectError(
      createLesson(db, manager, modules.rows[1]?.id, { title: 'Demais' }),
      422,
      'catalog_limit_exceeded',
    );
  });

  it('URL de vídeo é validada e o provedor classificado na gravação', async () => {
    const course = await createCourse(db, instructor, { slug: slug(), title: 'Vídeo' });
    const module = await createModule(db, instructor, course.id, { title: 'M' });
    const error = await expectError(
      createLesson(db, instructor, module.id, { title: 'A', videoUrl: 'http://exemplo.com/a.mp4' }),
      422,
      'content_url_invalid',
    );
    expect(error.errors?.[0]?.path).toBe('body.videoUrl');
    const lesson = await createLesson(db, instructor, module.id, {
      title: 'A',
      videoUrl: 'https://cdn.exemplo.com/live.m3u8',
      durationSeconds: 600,
    });
    expect(lesson).toMatchObject({ videoProvider: 'link', durationSeconds: 600 });
    const bunny = await updateLesson(db, instructor, lesson.id, {
      videoUrl: 'https://vz-1.b-cdn.net/x/playlist.m3u8',
      version: 1,
    });
    expect(bunny.videoProvider).toBe('bunny');
    const cleared = await updateLesson(db, instructor, lesson.id, { videoUrl: null, version: 2 });
    expect(cleared).toMatchObject({ videoUrl: null, videoProvider: null });
    expect(
      (await updateLesson(db, instructor, lesson.id, { videoUrl: null, version: 3 })).version,
    ).toBe(3);
    await expectError(
      updateLesson(db, instructor, lesson.id, { durationSeconds: -1, version: 3 }),
      400,
      'validation_failed',
    );
  });

  it('instrutor marca amostra no próprio curso e só publica aula de curso open', async () => {
    const { course, module } = await courseWithLesson(instructor);
    const sample = await createLesson(db, instructor, module.id, {
      title: 'Amostra',
      isSample: true,
    });
    expect(sample.isSample).toBe(true);
    await updateCourse(db, manager, course.id, { accessMode: 'paid', version: 1 });
    const draft = await createLesson(db, instructor, module.id, { title: 'Rascunho' });
    await expectError(
      updateLesson(db, instructor, draft.id, { status: 'published', version: 1 }),
      403,
      'permission_denied',
    );
    await expectError(
      createLesson(db, instructor, module.id, { title: 'Pública', status: 'published' }),
      403,
      'permission_denied',
    );
    expect(await deniedFor(instructor.actor.id, 'lesson.publish')).toBeGreaterThanOrEqual(1);
    const marked = await updateLesson(db, instructor, draft.id, { isSample: true, version: 1 });
    expect(marked.isSample).toBe(true);
  });

  it('despublicar ou excluir aula de curso publicado enfileira course.completion_check', async () => {
    const { course, module, lesson } = await courseWithLesson(manager);
    const second = await createLesson(db, manager, module.id, { title: 'B', status: 'published' });
    const third = await createLesson(db, manager, module.id, { title: 'C', status: 'published' });
    const before = await jobsFor('course.completion_check', 'courseId', course.id);
    // Curso em rascunho: não enfileira.
    await updateLesson(db, manager, third.id, { status: 'draft', version: 1 });
    expect(await jobsFor('course.completion_check', 'courseId', course.id)).toBe(before);
    await publishCourse(db, manager, course.id);
    await updateLesson(db, manager, second.id, { status: 'draft', version: 1 });
    expect(await jobsFor('course.completion_check', 'courseId', course.id)).toBe(before + 1);
    await deleteLesson(db, manager, lesson.id);
    expect(await jobsFor('course.completion_check', 'courseId', course.id)).toBe(before + 2);
    // Aula draft excluída: nada a conferir.
    await deleteLesson(db, manager, third.id);
    expect(await jobsFor('course.completion_check', 'courseId', course.id)).toBe(before + 2);
    // Módulo com aula não é apagado em cascata: a aula sai antes, com o próprio efeito.
    const other = await createModule(db, manager, course.id, { title: 'M2' });
    const inOther = await createLesson(db, manager, other.id, { title: 'D', status: 'published' });
    await expectError(deleteModule(db, manager, other.id), 409, 'module_not_empty');
    expect(await jobsFor('course.completion_check', 'courseId', course.id)).toBe(before + 2);
    await deleteLesson(db, manager, inOther.id);
    expect(await jobsFor('course.completion_check', 'courseId', course.id)).toBe(before + 3);
    await deleteModule(db, manager, other.id);
    expect(await jobsFor('course.completion_check', 'courseId', course.id)).toBe(before + 3);
    const actions = (await auditOf(second.id)).map((row) => row.action);
    expect(actions).toEqual(['lesson.create', 'lesson.unpublish']);
  });

  it('links de apoio: troca a lista inteira, até 20, URL validada', async () => {
    const { lesson } = await courseWithLesson(instructor);
    const links = await setLessonLinks(db, instructor, lesson.id, {
      links: [
        { label: 'Slides', url: 'https://exemplo.com/slides.pdf', kind: 'file' },
        { label: 'Site', url: 'https://exemplo.com', kind: 'page' },
      ],
      version: 1,
    });
    expect(links.map((link) => [link.label, link.position])).toEqual([
      ['Slides', 0],
      ['Site', 1],
    ]);
    const error = await expectError(
      setLessonLinks(db, instructor, lesson.id, {
        links: [{ label: 'X', url: 'https://u:p@exemplo.com', kind: 'page' }],
      }),
      422,
      'content_url_invalid',
    );
    expect(error.errors?.[0]?.path).toBe('body.links[0].url');
    await expectError(
      setLessonLinks(db, instructor, lesson.id, {
        links: Array.from({ length: CATALOG_LIMITS.linksPerLesson + 1 }, (_, i) => ({
          label: `L${i}`,
          url: `https://exemplo.com/${i}`,
          kind: 'page',
        })),
      }),
      422,
      'catalog_limit_exceeded',
    );
    await expectError(
      setLessonLinks(db, instructor, lesson.id, { links: [{ label: '', url: 'x', kind: 'zip' }] }),
      400,
      'validation_failed',
    );
    await expectError(
      setLessonLinks(db, instructor, lesson.id, { links: [], version: 1 }),
      409,
      'version_conflict',
    );
    await setLessonLinks(db, instructor, lesson.id, { links: [] });
    expect(await listCatalogLessonLinks(db, lesson.id)).toEqual([]);
  });
});

describe('ebooks', () => {
  it('só gerente e admin criam; publicar exige o arquivo; arquivar só o admin', async () => {
    await expectError(
      createEbook(db, instructor, { slug: slug(), title: 'E' }),
      403,
      'permission_denied',
    );
    await expectError(
      createEbook(db, manager, { slug: slug(), title: 'E', fileUrl: 'http://exemplo.com/e.pdf' }),
      422,
      'content_url_invalid',
    );
    const ebook = await createEbook(db, manager, {
      slug: slug(),
      title: 'Ebook',
      authorName: 'Autora',
      pages: 120,
    });
    expect(ebook).toMatchObject({ authorName: 'Autora', pages: 120, fileUrl: null });
    await expectError(publishEbook(db, manager, ebook.id), 422, 'ebook_file_required');
    const withFile = await updateEbook(db, manager, ebook.id, {
      fileUrl: 'https://exemplo.com/e.pdf',
      version: 1,
    });
    const published = await publishEbook(db, manager, ebook.id);
    expect(published.status).toBe('published');
    await expectError(
      updateEbook(db, manager, ebook.id, { fileUrl: null, version: published.version }),
      422,
      'ebook_file_required',
    );
    expect(withFile.version).toBe(2);
    expect(await countEbookAffectedStudents(db, manager, ebook.id)).toBe(0);
    expect((await unpublishEbook(db, manager, ebook.id)).status).toBe('draft');
    await expectError(archiveEbook(db, manager, ebook.id), 403, 'permission_denied');
    expect((await archiveEbook(db, admin, ebook.id)).archivedAt).toBeInstanceOf(Date);
    await expectError(publishEbook(db, admin, ebook.id), 422, 'product_archived');
    expect((await unarchiveEbook(db, admin, ebook.id)).archivedAt).toBeNull();
    await expectError(
      createEbook(db, manager, { slug: ebook.slug, title: 'X' }),
      409,
      'slug_taken',
    );
  });

  it('excluir ebook com direito é 409 para o admin', async () => {
    const ebook = await createEbook(db, manager, { slug: slug(), title: 'E' });
    await grant(student.actor.id, 'ebook', ebook.id);
    await expectError(deleteEbook(db, admin, ebook.id), 409, 'product_has_links');
  });

  it('vínculos: o instrutor só vincula aos próprios cursos e aulas e não mexe nos alheios', async () => {
    const mine = await courseWithLesson(instructor);
    const other = await courseWithLesson(otherInstructor);
    const bundle = await createBundle(db, manager, { slug: slug(), title: 'P' });
    const ebook = await createEbook(db, manager, { slug: slug(), title: 'E' });
    await setEbookTargets(db, manager, ebook.id, {
      targets: [{ targetType: 'course', targetId: other.course.id }],
    });
    const visible = await setEbookTargets(db, instructor, ebook.id, {
      targets: [
        { targetType: 'course', targetId: mine.course.id },
        { targetType: 'lesson', targetId: mine.lesson.id },
      ],
    });
    expect(visible).toHaveLength(2);
    const all = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM product_ebooks WHERE ebook_id = ${ebook.id}`.execute(db);
    expect(all.rows[0]?.n).toBe(3);
    expect(
      await jobsFor('entitlement.recompute', 'productId', mine.course.id),
    ).toBeGreaterThanOrEqual(1);
    await expectError(
      setEbookTargets(db, instructor, ebook.id, {
        targets: [{ targetType: 'course', targetId: other.course.id }],
      }),
      404,
      'not_found',
    );
    // `bundle` na lista é 400 para qualquer papel (spec 009, "Vínculo `bundle` no admin").
    for (const actor of [instructor, manager, admin]) {
      const invalid = await expectError(
        setEbookTargets(db, actor, ebook.id, {
          targets: [
            { targetType: 'course', targetId: mine.course.id },
            { targetType: 'bundle', targetId: bundle.id },
          ],
        }),
        400,
        'validation_failed',
      );
      expect(invalid.errors?.map((item) => item.path)).toEqual(['body.targets[1].targetType']);
    }
    await expectError(
      setEbookTargets(db, manager, ebook.id, {
        targets: [{ targetType: 'lesson', targetId: randomUUID() }],
      }),
      422,
      'catalog_item_not_found',
    );
    await expectError(
      setEbookTargets(db, manager, ebook.id, {
        targets: [
          { targetType: 'course', targetId: mine.course.id },
          { targetType: 'course', targetId: mine.course.id },
        ],
      }),
      400,
      'validation_failed',
    );
    // O instrutor limpa os dele; o vínculo alheio fica.
    expect(await setEbookTargets(db, instructor, ebook.id, { targets: [] })).toEqual([]);
    // O vínculo `bundle` só nasce de carga direta e a troca nunca o alcança.
    await db
      .insertInto('productEbooks')
      .values({ ebookId: ebook.id, targetType: 'bundle', targetId: bundle.id })
      .execute();
    const left = await setEbookTargets(db, manager, ebook.id, {
      targets: [{ targetType: 'course', targetId: other.course.id }],
    });
    expect(left.map((target) => target.targetType).sort()).toEqual(['bundle', 'course']);
    expect(await jobsFor('entitlement.recompute', 'productId', bundle.id)).toBe(0);
    await expectError(
      setEbookTargets(db, student, ebook.id, { targets: [] }),
      403,
      'permission_denied',
    );
    await expectError(
      setEbookTargets(db, manager, randomUUID(), { targets: [] }),
      404,
      'not_found',
    );
    // Excluir o ebook tira os vínculos e recalcula os pais.
    const beforeBundle = await jobsFor('entitlement.recompute', 'productId', bundle.id);
    await deleteEbook(db, manager, ebook.id);
    expect(await jobsFor('entitlement.recompute', 'productId', bundle.id)).toBe(beforeBundle + 1);
  });
});

describe('pacotes', () => {
  it('itens: pacote em pacote é 400, alvo inexistente é 422, mudança recalcula', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'C' });
    const ebook = await createEbook(db, manager, { slug: slug(), title: 'E' });
    const bundle = await createBundle(db, manager, { slug: slug(), title: 'Pacote' });
    const other = await createBundle(db, manager, { slug: slug(), title: 'Outro' });
    await expectError(publishBundle(db, manager, bundle.id), 422, 'bundle_has_no_items');
    const nested = await expectError(
      setBundleItems(db, manager, bundle.id, {
        items: [
          { productType: 'course', productId: course.id },
          { productType: 'bundle', productId: other.id },
        ],
      }),
      400,
      'validation_failed',
    );
    expect(nested.errors?.map((item) => item.path)).toEqual(['body.items[1].productType']);
    // Id de pacote enviado como curso ou ebook não existe na tabela do tipo.
    for (const productType of ['course', 'ebook']) {
      const disguised = await expectError(
        setBundleItems(db, manager, bundle.id, {
          items: [{ productType, productId: other.id }],
        }),
        422,
        'catalog_item_not_found',
      );
      expect(disguised.errors?.[0]?.path).toBe('body.items[0].productId');
    }
    const missing = await expectError(
      setBundleItems(db, manager, bundle.id, {
        items: [
          { productType: 'course', productId: course.id },
          { productType: 'ebook', productId: randomUUID() },
        ],
      }),
      422,
      'catalog_item_not_found',
    );
    expect(missing.errors?.[0]?.path).toBe('body.items[1].productId');
    await expectError(
      setBundleItems(db, instructor, bundle.id, { items: [] }),
      403,
      'permission_denied',
    );
    const items = await setBundleItems(db, manager, bundle.id, {
      items: [
        { productType: 'ebook', productId: ebook.id },
        { productType: 'course', productId: course.id },
      ],
      version: 1,
    });
    expect(items.map((item) => [item.productType, item.position])).toEqual([
      ['ebook', 0],
      ['course', 1],
    ]);
    expect(await jobsFor('entitlement.recompute', 'productId', bundle.id)).toBe(1);
    // Só a ordem: não recalcula.
    await setBundleItems(db, manager, bundle.id, {
      items: [
        { productType: 'course', productId: course.id },
        { productType: 'ebook', productId: ebook.id },
      ],
    });
    expect(await jobsFor('entitlement.recompute', 'productId', bundle.id)).toBe(1);
    await expectError(
      setBundleItems(db, manager, bundle.id, { items: [], version: 1 }),
      409,
      'version_conflict',
    );
    const priced = await updateBundle(db, manager, bundle.id, {
      accessMode: 'paid',
      title: 'Pacote pago',
      version: 3,
    });
    await expectError(publishBundle(db, manager, bundle.id), 422, 'price_required');
    await updateBundle(db, admin, bundle.id, { priceCents: 9900, version: priced.version });
    expect((await publishBundle(db, manager, bundle.id)).status).toBe('published');
    await expectError(
      setBundleItems(db, manager, bundle.id, { items: [] }),
      422,
      'bundle_has_no_items',
    );
    await grant(student.actor.id, 'bundle', bundle.id);
    expect(await countBundleAffectedStudents(db, manager, bundle.id)).toBe(1);
    await setBundleItems(db, manager, bundle.id, {
      items: [{ productType: 'course', productId: course.id }],
    });
    expect(await jobsFor('entitlement.recompute', 'productId', bundle.id)).toBe(2);
    expect((await unpublishBundle(db, manager, bundle.id)).status).toBe('draft');
    await expectError(deleteBundle(db, admin, bundle.id), 409, 'product_has_links');
    expect((await archiveBundle(db, admin, bundle.id)).archivedAt).toBeInstanceOf(Date);
    expect((await unarchiveBundle(db, admin, bundle.id)).archivedAt).toBeNull();
    await deleteBundle(db, manager, other.id);
    await expectError(countBundleAffectedStudents(db, manager, other.id), 404, 'not_found');
  });

  it('limite de itens do pacote', async () => {
    const bundle = await createBundle(db, manager, { slug: slug(), title: 'Grande' });
    await expectError(
      setBundleItems(db, manager, bundle.id, {
        items: Array.from({ length: CATALOG_LIMITS.itemsPerBundle + 1 }, () => ({
          productType: 'course',
          productId: randomUUID(),
        })),
      }),
      422,
      'catalog_limit_exceeded',
    );
  });
});
