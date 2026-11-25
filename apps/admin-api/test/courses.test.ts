import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { slugFromTitle } from '../src/routes/catalog-common.ts';
import { type Actor, auditOf, type CallOptions, callAs, createActor, deniedBy } from './actors.ts';
import { createTestApp, type TestApp } from './helpers.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

let admin: Actor;
let manager: Actor;
let instructor: Actor;
let otherInstructor: Actor;

beforeAll(async () => {
  [admin, manager, instructor, otherInstructor] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
    createActor(test, 'instructor'),
  ]);
});

const call = (options: CallOptions) => callAs(test, options);

/** Título único: o slug gerado dele não repete no banco compartilhado. */
const uniqueTitle = (prefix = 'Curso') => `${prefix} ${randomUUID()}`;

async function newCourse(as: Actor, extra: object = {}) {
  const response = await call({
    method: 'POST',
    url: '/api/v1/courses',
    as,
    payload: { title: uniqueTitle(), ...extra },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function newModule(as: Actor, courseId: string, title = 'Módulo') {
  const response = await call({
    method: 'POST',
    url: `/api/v1/courses/${courseId}/modules`,
    as,
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function newLesson(as: Actor, moduleId: string, extra: object = {}) {
  const response = await call({
    method: 'POST',
    url: `/api/v1/modules/${moduleId}/lessons`,
    as,
    payload: { title: 'Aula', ...extra },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

/** Curso com um módulo e uma aula publicada: pronto para publicar. */
async function publishableCourse(as: Actor, extra: object = {}) {
  const course = await newCourse(as, extra);
  const module = await newModule(as, course.id);
  const lesson = await newLesson(as, module.id);
  const published = await call({
    method: 'PATCH',
    url: `/api/v1/lessons/${lesson.id}`,
    as,
    payload: { status: 'published' },
  });
  expect(published.statusCode).toBe(200);
  return { course, module, lesson };
}

describe('slugFromTitle', () => {
  it('tira acentos, troca o resto por hífen e corta em 160', () => {
    expect(slugFromTitle('  Introdução à Programação: C++ & Ação!  ')).toBe(
      'introducao-a-programacao-c-acao',
    );
    expect(slugFromTitle('???')).toBe('item');
    const long = slugFromTitle(`${'a'.repeat(159)} b`);
    expect(long).toBe('a'.repeat(159));
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('POST e GET /api/v1/courses', () => {
  it('instrutor cria: vira o dono, rascunho, slug gerado do título, com auditoria', async () => {
    const title = uniqueTitle('Introdução à Edição');
    const response = await call({
      method: 'POST',
      url: '/api/v1/courses',
      as: instructor,
      payload: { title, summary: 'Resumo', description: '# Olá', level: 'beginner' },
    });
    expect(response.statusCode).toBe(201);
    const course = response.json();
    expect(course).toMatchObject({
      title,
      slug: slugFromTitle(title),
      summary: 'Resumo',
      description: '# Olá',
      level: 'beginner',
      status: 'draft',
      cover: null,
      priceCents: null,
      owner: { id: instructor.id },
      reviewRequestedAt: null,
      archivedAt: null,
      moduleCount: 0,
      lessonCount: 0,
      studentCount: 0,
      modules: [],
    });
    expect(course).not.toHaveProperty('version');
    expect(await auditOf(test, course.id, 'course.create')).toHaveLength(1);

    const read = await call({ method: 'GET', url: `/api/v1/courses/${course.id}`, as: instructor });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(course);
  });

  it('gerente informa slug e dono; slug repetido: 409 slug_taken; dono que não é instrutor: 422', async () => {
    const slug = `curso-${randomUUID()}`;
    const created = await newCourse(manager, { slug, ownerId: instructor.id });
    expect(created).toMatchObject({ slug, owner: { id: instructor.id } });

    const repeated = await call({
      method: 'POST',
      url: '/api/v1/courses',
      as: manager,
      payload: { title: 'Outro', slug },
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ code: 'slug_taken' });

    const invalidOwner = await call({
      method: 'POST',
      url: '/api/v1/courses',
      as: manager,
      payload: { title: uniqueTitle(), ownerId: manager.id },
    });
    expect(invalidOwner.statusCode).toBe(422);
    expect(invalidOwner.json()).toMatchObject({ code: 'owner_invalid' });
  });

  it('corpo fora do contrato: 400; sem X-CSRF-Token: 403; sem sessão: 401', async () => {
    const invalid = await call({
      method: 'POST',
      url: '/api/v1/courses',
      as: manager,
      payload: { title: '', extra: true },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'validation_failed' });

    const noCsrf = await call({
      method: 'POST',
      url: '/api/v1/courses',
      as: manager,
      payload: { title: uniqueTitle() },
      csrf: null,
    });
    expect(noCsrf.statusCode).toBe(403);

    const anonymous = await test.app.inject({ method: 'GET', url: '/api/v1/courses' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('lista com busca, filtros e cursor; o instrutor vê só os próprios', async () => {
    const marker = randomUUID();
    const mine = await newCourse(instructor, { title: `Lista ${marker} A` });
    const theirs = await newCourse(otherInstructor, { title: `Lista ${marker} B` });
    const orphan = await newCourse(manager, { title: `Lista ${marker} C` });

    const all = await call({
      method: 'GET',
      url: `/api/v1/courses?q=${marker}&sort=title`,
      as: manager,
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().items.map((item: { id: string }) => item.id)).toEqual([
      mine.id,
      theirs.id,
      orphan.id,
    ]);
    expect(all.json().nextCursor).toBeNull();
    expect(all.json().items[0]).not.toHaveProperty('modules');

    const firstPage = await call({
      method: 'GET',
      url: `/api/v1/courses?q=${marker}&sort=title&limit=2`,
      as: manager,
    });
    expect(firstPage.json().items).toHaveLength(2);
    const cursor = firstPage.json().nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    const secondPage = await call({
      method: 'GET',
      url: `/api/v1/courses?q=${marker}&sort=title&limit=2&cursor=${encodeURIComponent(cursor)}`,
      as: manager,
    });
    expect(secondPage.json().items.map((item: { id: string }) => item.id)).toEqual([orphan.id]);

    const byOwner = await call({
      method: 'GET',
      url: `/api/v1/courses?q=${marker}&ownerId=${otherInstructor.id}&status=draft`,
      as: manager,
    });
    expect(byOwner.json().items.map((item: { id: string }) => item.id)).toEqual([theirs.id]);

    await call({
      method: 'POST',
      url: `/api/v1/courses/${mine.id}/request-review`,
      as: instructor,
    });
    const awaiting = await call({
      method: 'GET',
      url: `/api/v1/courses?q=${marker}&awaitingReview=true`,
      as: manager,
    });
    expect(awaiting.json().items.map((item: { id: string }) => item.id)).toEqual([mine.id]);

    const own = await call({ method: 'GET', url: `/api/v1/courses?q=${marker}`, as: instructor });
    expect(own.json().items.map((item: { id: string }) => item.id)).toEqual([mine.id]);

    const invalid = await call({ method: 'GET', url: '/api/v1/courses?sort=slug', as: manager });
    expect(invalid.statusCode).toBe(400);
  });

  it('aluno com sessão do admin: 403, com a negação na auditoria', async () => {
    const student = await createActor(test, 'student');
    const response = await call({ method: 'GET', url: '/api/v1/courses', as: student });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, student.id)).toHaveLength(1);
  });
});

describe('PATCH /api/v1/courses/{id} e a regra do instrutor', () => {
  it('altera só os campos enviados, sem version no corpo, e grava a auditoria', async () => {
    const course = await newCourse(instructor, { summary: 'Antes' });
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: instructor,
      payload: { title: 'Título novo', certificateEnabled: false, certificateHours: 12 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: course.id,
      title: 'Título novo',
      summary: 'Antes',
      slug: course.slug,
      certificateEnabled: false,
      certificateHours: 12,
    });
    expect(await auditOf(test, course.id, 'course.update')).toHaveLength(1);

    // Duas edições seguidas: a rota lê a versão atual a cada uma.
    const again = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: instructor,
      payload: { summary: null },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ title: 'Título novo', summary: null });
  });

  it('curso alheio ao instrutor: 404 em toda rota do curso, módulo e aula', async () => {
    const { course, module, lesson } = await publishableCourse(otherInstructor);
    const attempts: Array<Pick<CallOptions, 'method' | 'url' | 'payload'>> = [
      { method: 'GET', url: `/api/v1/courses/${course.id}` },
      { method: 'PATCH', url: `/api/v1/courses/${course.id}`, payload: { title: 'Meu' } },
      { method: 'DELETE', url: `/api/v1/courses/${course.id}` },
      { method: 'POST', url: `/api/v1/courses/${course.id}/publish` },
      { method: 'POST', url: `/api/v1/courses/${course.id}/unpublish` },
      { method: 'POST', url: `/api/v1/courses/${course.id}/request-review` },
      { method: 'DELETE', url: `/api/v1/courses/${course.id}/request-review` },
      { method: 'POST', url: `/api/v1/courses/${course.id}/modules`, payload: { title: 'M' } },
      {
        method: 'PUT',
        url: `/api/v1/courses/${course.id}/modules/order`,
        payload: { moduleIds: [module.id] },
      },
      { method: 'PATCH', url: `/api/v1/modules/${module.id}`, payload: { title: 'M' } },
      { method: 'DELETE', url: `/api/v1/modules/${module.id}` },
      { method: 'POST', url: `/api/v1/modules/${module.id}/lessons`, payload: { title: 'A' } },
      {
        method: 'PUT',
        url: `/api/v1/modules/${module.id}/lessons/order`,
        payload: { lessonIds: [lesson.id] },
      },
      { method: 'GET', url: `/api/v1/lessons/${lesson.id}` },
      { method: 'PATCH', url: `/api/v1/lessons/${lesson.id}`, payload: { title: 'A' } },
      { method: 'DELETE', url: `/api/v1/lessons/${lesson.id}` },
      { method: 'PUT', url: `/api/v1/lessons/${lesson.id}/links`, payload: { links: [] } },
    ];
    for (const attempt of attempts) {
      const response = await call({ ...attempt, as: instructor });
      expect(`${attempt.method} ${attempt.url} ${response.statusCode}`).toBe(
        `${attempt.method} ${attempt.url} 404`,
      );
      expect(response.json()).toMatchObject({ code: 'not_found' });
    }
    // Nada mudou no curso alheio.
    const intact = await call({ method: 'GET', url: `/api/v1/courses/${course.id}`, as: manager });
    expect(intact.json()).toMatchObject({ title: course.title, modules: [{ id: module.id }] });
  });

  it('instrutor que muda o preço ou o modo de acesso do próprio curso: 403, gravado uma vez', async () => {
    const owner = await createActor(test, 'instructor');
    const course = await newCourse(owner);
    const access = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: owner,
      payload: { accessMode: 'paid' },
    });
    expect(access.statusCode).toBe(403);
    expect(access.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, owner.id)).toHaveLength(1);

    // Produto aberto não tem preço: a regra do produto vem antes da permissão.
    const openPrice = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: admin,
      payload: { priceCents: 9900 },
    });
    expect(openPrice.statusCode).toBe(422);
    expect(openPrice.json()).toMatchObject({ code: 'price_not_allowed' });

    // O gerente define o modo, mas não o preço; o admin, os dois.
    const managerAccess = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { accessMode: 'paid', accessDays: 365 },
    });
    expect(managerAccess.statusCode).toBe(200);
    expect(managerAccess.json()).toMatchObject({ accessMode: 'paid', accessDays: 365 });
    const price = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: owner,
      payload: { priceCents: 9900 },
    });
    expect(price.statusCode).toBe(403);
    expect(price.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, owner.id)).toHaveLength(2);
    // O título segue editável pelo dono.
    const title = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: owner,
      payload: { title: 'Outro título', priceCents: null },
    });
    expect(title.statusCode).toBe(200);
    const managerPrice = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { priceCents: 9900 },
    });
    expect(managerPrice.statusCode).toBe(403);
    const adminPrice = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: admin,
      payload: { priceCents: 9900 },
    });
    expect(adminPrice.statusCode).toBe(200);
    expect(adminPrice.json()).toMatchObject({ accessMode: 'paid', priceCents: 9900 });
  });

  it('capa que não existe: 422 cover_image_invalid; curso inexistente: 404', async () => {
    const course = await newCourse(manager);
    const cover = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { coverImageId: randomUUID() },
    });
    expect(cover.statusCode).toBe(422);
    expect(cover.json()).toMatchObject({ code: 'cover_image_invalid' });

    const missing = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${randomUUID()}`,
      as: manager,
      payload: { title: 'X' },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('publicação, pedido de publicação, arquivo e dono', () => {
  it('publicar exige aula publicada; instrutor publica e despublica o próprio curso open', async () => {
    const course = await newCourse(instructor);
    const empty = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/publish`,
      as: instructor,
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toMatchObject({ code: 'course_has_no_published_lesson' });

    const module = await newModule(instructor, course.id);
    const lesson = await newLesson(instructor, module.id, { durationSeconds: 600 });
    await call({
      method: 'PATCH',
      url: `/api/v1/lessons/${lesson.id}`,
      as: instructor,
      payload: { status: 'published' },
    });
    const published = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/publish`,
      as: instructor,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      status: 'published',
      lessonCount: 1,
      durationSeconds: 600,
      publishedAt: expect.any(String),
    });
    expect(await auditOf(test, course.id, 'course.publish')).toHaveLength(1);

    const unpublished = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/unpublish`,
      as: instructor,
    });
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.json()).toMatchObject({ status: 'draft' });
  });

  it('curso pago: o instrutor não publica (403) e pede a publicação; sem preço: 422', async () => {
    const { course } = await publishableCourse(instructor);
    const paid = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { accessMode: 'paid' },
    });
    expect(paid.statusCode).toBe(200);

    const denied = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/publish`,
      as: instructor,
    });
    expect(denied.statusCode).toBe(403);

    const requested = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/request-review`,
      as: instructor,
    });
    expect(requested.statusCode).toBe(200);
    const requestedAt = requested.json().reviewRequestedAt;
    expect(requestedAt).toEqual(expect.any(String));
    const repeated = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/request-review`,
      as: instructor,
    });
    expect(repeated.json().reviewRequestedAt).toBe(requestedAt);
    expect(await auditOf(test, course.id, 'course.request_review')).toHaveLength(1);

    const cancelled = await call({
      method: 'DELETE',
      url: `/api/v1/courses/${course.id}/request-review`,
      as: instructor,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ reviewRequestedAt: null });

    const noPrice = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/publish`,
      as: manager,
    });
    expect(noPrice.statusCode).toBe(422);
    expect(noPrice.json()).toMatchObject({ code: 'price_required' });
  });

  it('arquivar e desarquivar: só admin, idempotentes; arquivado não publica', async () => {
    const { course } = await publishableCourse(manager);
    const denied = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/archive`,
      as: manager,
    });
    expect(denied.statusCode).toBe(403);

    const archived = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/archive`,
      as: admin,
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ status: 'draft', archivedAt: expect.any(String) });
    const again = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/archive`,
      as: admin,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().archivedAt).toBe(archived.json().archivedAt);
    expect(await auditOf(test, course.id, 'course.archive')).toHaveLength(1);

    const publish = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/publish`,
      as: admin,
    });
    expect(publish.statusCode).toBe(422);
    expect(publish.json()).toMatchObject({ code: 'product_archived' });

    const listed = await call({
      method: 'GET',
      url: `/api/v1/courses?status=archived&q=${encodeURIComponent(course.title)}`,
      as: admin,
    });
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([course.id]);

    const unarchived = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/unarchive`,
      as: admin,
    });
    expect(unarchived.statusCode).toBe(200);
    expect(unarchived.json()).toMatchObject({ status: 'draft', archivedAt: null });
  });

  it('PATCH /owner: gerente troca e tira o dono; instrutor recebe 403; não instrutor: 422', async () => {
    const course = await newCourse(instructor);
    const denied = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}/owner`,
      as: instructor,
      payload: { ownerId: null },
    });
    expect(denied.statusCode).toBe(403);

    const changed = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}/owner`,
      as: manager,
      payload: { ownerId: otherInstructor.id },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ owner: { id: otherInstructor.id } });
    expect(await auditOf(test, course.id, 'course.set_owner')).toHaveLength(1);
    // O antigo dono deixa de alcançar o curso.
    const lost = await call({ method: 'GET', url: `/api/v1/courses/${course.id}`, as: instructor });
    expect(lost.statusCode).toBe(404);

    const invalid = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}/owner`,
      as: manager,
      payload: { ownerId: admin.id },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ code: 'owner_invalid' });

    const cleared = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}/owner`,
      as: manager,
      payload: { ownerId: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ owner: null });
  });
});

describe('DELETE /api/v1/courses/{id}', () => {
  it('exclui o curso sem vínculos, com módulos e aulas', async () => {
    const { course, lesson } = await publishableCourse(instructor);
    const response = await call({
      method: 'DELETE',
      url: `/api/v1/courses/${course.id}`,
      as: instructor,
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(await auditOf(test, course.id, 'course.delete')).toHaveLength(1);
    for (const url of [`/api/v1/courses/${course.id}`, `/api/v1/lessons/${lesson.id}`]) {
      expect((await call({ method: 'GET', url, as: manager })).statusCode).toBe(404);
    }
  });

  it('com direito associado: 409 product_has_links, também para o admin', async () => {
    const course = await newCourse(manager);
    const student = await createActor(test, 'student');
    await test.db
      .insertInto('entitlements')
      .values({
        userId: student.id,
        productType: 'course',
        productId: course.id,
        source: 'grant',
        sourceId: admin.id,
        grantedReason: 'teste',
      })
      .execute();
    const response = await call({
      method: 'DELETE',
      url: `/api/v1/courses/${course.id}`,
      as: admin,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'product_has_links' });
    const detail = await call({ method: 'GET', url: `/api/v1/courses/${course.id}`, as: admin });
    expect(detail.json()).toMatchObject({ studentCount: 1 });
  });
});

describe('módulos', () => {
  it('cria, renomeia, reordena e exclui', async () => {
    const course = await newCourse(instructor);
    const first = await newModule(instructor, course.id, 'Primeiro');
    expect(first).toMatchObject({
      courseId: course.id,
      title: 'Primeiro',
      position: 0,
      lessons: [],
    });
    expect(first).not.toHaveProperty('version');
    const second = await newModule(instructor, course.id, 'Segundo');
    await newLesson(instructor, second.id, { title: 'Aula do segundo' });

    const renamed = await call({
      method: 'PATCH',
      url: `/api/v1/modules/${second.id}`,
      as: instructor,
      payload: { title: 'Segundo, revisto' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      id: second.id,
      title: 'Segundo, revisto',
      lessons: [{ title: 'Aula do segundo', status: 'draft' }],
    });
    expect(await auditOf(test, second.id, 'module.update')).toHaveLength(1);
    // De novo, sem `version` no corpo.
    const renamedAgain = await call({
      method: 'PATCH',
      url: `/api/v1/modules/${second.id}`,
      as: instructor,
      payload: { title: 'Segundo' },
    });
    expect(renamedAgain.statusCode).toBe(200);

    const reordered = await call({
      method: 'PUT',
      url: `/api/v1/courses/${course.id}/modules/order`,
      as: instructor,
      payload: { moduleIds: [second.id, first.id] },
    });
    expect(reordered.statusCode).toBe(200);
    expect(
      reordered
        .json()
        .items.map((item: { id: string; position: number }) => [item.id, item.position]),
    ).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
    expect(reordered.json().items[0].lessons).toHaveLength(1);

    const mismatch = await call({
      method: 'PUT',
      url: `/api/v1/courses/${course.id}/modules/order`,
      as: instructor,
      payload: { moduleIds: [first.id] },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toMatchObject({ code: 'order_mismatch' });

    const removed = await call({
      method: 'DELETE',
      url: `/api/v1/modules/${first.id}`,
      as: instructor,
    });
    expect(removed.statusCode).toBe(204);
    const detail = await call({
      method: 'GET',
      url: `/api/v1/courses/${course.id}`,
      as: instructor,
    });
    expect(detail.json().modules.map((item: { id: string }) => item.id)).toEqual([second.id]);

    for (const attempt of [
      { method: 'PATCH', url: `/api/v1/modules/${randomUUID()}`, payload: { title: 'X' } },
      { method: 'DELETE', url: `/api/v1/modules/${randomUUID()}` },
    ] as const) {
      expect((await call({ ...attempt, as: manager })).statusCode).toBe(404);
    }
  });
});

describe('aulas e links de apoio', () => {
  it('cria com vídeo, lê, edita, publica e exclui', async () => {
    const course = await newCourse(instructor);
    const module = await newModule(instructor, course.id);
    const created = await newLesson(instructor, module.id, {
      title: 'Primeira aula',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      durationSeconds: 300,
    });
    expect(created).toMatchObject({
      courseId: course.id,
      moduleId: module.id,
      title: 'Primeira aula',
      description: null,
      type: 'video',
      status: 'draft',
      isSample: false,
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoProvider: 'youtube',
      durationSeconds: 300,
      position: 0,
      links: [],
      ebooks: [],
    });
    expect(created).not.toHaveProperty('version');
    expect(await auditOf(test, created.id, 'lesson.create')).toHaveLength(1);

    const read = await call({
      method: 'GET',
      url: `/api/v1/lessons/${created.id}`,
      as: instructor,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(created);

    const updated = await call({
      method: 'PATCH',
      url: `/api/v1/lessons/${created.id}`,
      as: instructor,
      payload: {
        title: 'Aula revista',
        videoUrl: null,
        durationSeconds: null,
        status: 'published',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      title: 'Aula revista',
      videoUrl: null,
      videoProvider: null,
      durationSeconds: 0,
      status: 'published',
    });
    expect(await auditOf(test, created.id, 'lesson.publish')).toHaveLength(1);

    const sample = await call({
      method: 'PATCH',
      url: `/api/v1/lessons/${created.id}`,
      as: manager,
      payload: { isSample: true, status: 'draft' },
    });
    expect(sample.statusCode).toBe(200);
    expect(sample.json()).toMatchObject({ isSample: true, status: 'draft' });

    const removed = await call({
      method: 'DELETE',
      url: `/api/v1/lessons/${created.id}`,
      as: instructor,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await call({ method: 'GET', url: `/api/v1/lessons/${created.id}`, as: instructor }))
        .statusCode,
    ).toBe(404);
  });

  it('URL de vídeo fora das regras: 422 content_url_invalid com o campo', async () => {
    const course = await newCourse(instructor);
    const module = await newModule(instructor, course.id);
    for (const videoUrl of [
      'http://exemplo.com/video',
      'https://user:senha@exemplo.com/v',
      'x y',
    ]) {
      const response = await call({
        method: 'POST',
        url: `/api/v1/modules/${module.id}/lessons`,
        as: instructor,
        payload: { title: 'Aula', videoUrl },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: 'content_url_invalid',
        errors: [{ path: 'body.videoUrl' }],
      });
    }
    const lesson = await newLesson(instructor, module.id);
    const patched = await call({
      method: 'PATCH',
      url: `/api/v1/lessons/${lesson.id}`,
      as: instructor,
      payload: { videoUrl: 'ftp://exemplo.com/video.mp4' },
    });
    expect(patched.statusCode).toBe(422);
    expect(patched.json()).toMatchObject({
      code: 'content_url_invalid',
      errors: [{ path: 'body.videoUrl' }],
    });
  });

  it('instrutor não publica aula de curso que não é open: 403', async () => {
    const course = await newCourse(instructor);
    const module = await newModule(instructor, course.id);
    const lesson = await newLesson(instructor, module.id);
    await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { accessMode: 'private' },
    });
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/lessons/${lesson.id}`,
      as: instructor,
      payload: { status: 'published' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
  });

  // Mover aula de outro módulo pela ordem (contrato) ainda não existe no núcleo: tarefa 620.
  it('reordena as aulas do módulo', async () => {
    const course = await newCourse(instructor);
    const first = await newModule(instructor, course.id, 'A');
    const second = await newModule(instructor, course.id, 'B');
    const one = await newLesson(instructor, first.id, { title: 'Um' });
    const two = await newLesson(instructor, first.id, { title: 'Dois' });
    const three = await newLesson(instructor, first.id, { title: 'Três' });

    const reordered = await call({
      method: 'PUT',
      url: `/api/v1/modules/${first.id}/lessons/order`,
      as: instructor,
      payload: { lessonIds: [three.id, two.id, one.id] },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json()).toMatchObject({ id: first.id, courseId: course.id });
    expect(
      reordered
        .json()
        .lessons.map((lesson: { id: string; position: number; moduleId: string }) => [
          lesson.id,
          lesson.position,
          lesson.moduleId,
        ]),
    ).toEqual([
      [three.id, 0, first.id],
      [two.id, 1, first.id],
      [one.id, 2, first.id],
    ]);
    expect(await auditOf(test, first.id, 'lesson.reorder')).toHaveLength(1);

    const emptied = await call({
      method: 'PUT',
      url: `/api/v1/modules/${second.id}/lessons/order`,
      as: instructor,
      payload: { lessonIds: [] },
    });
    expect(emptied.statusCode).toBe(200);
    expect(emptied.json()).toMatchObject({ id: second.id, lessons: [] });

    const mismatch = await call({
      method: 'PUT',
      url: `/api/v1/modules/${first.id}/lessons/order`,
      as: instructor,
      payload: { lessonIds: [one.id] },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toMatchObject({ code: 'order_mismatch' });

    const missing = await call({
      method: 'PUT',
      url: `/api/v1/modules/${randomUUID()}/lessons/order`,
      as: instructor,
      payload: { lessonIds: [] },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('PUT /links troca a lista inteira; URL inválida: 422 com o índice do link', async () => {
    const course = await newCourse(instructor);
    const module = await newModule(instructor, course.id);
    const lesson = await newLesson(instructor, module.id);
    const set = await call({
      method: 'PUT',
      url: `/api/v1/lessons/${lesson.id}/links`,
      as: instructor,
      payload: {
        links: [
          { label: 'Slides', url: 'https://exemplo.com/slides.pdf', kind: 'file' },
          { label: 'Leitura', url: 'https://exemplo.com/artigo', kind: 'page' },
        ],
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().links).toEqual([
      {
        id: expect.any(String),
        label: 'Slides',
        url: 'https://exemplo.com/slides.pdf',
        kind: 'file',
        position: 0,
      },
      {
        id: expect.any(String),
        label: 'Leitura',
        url: 'https://exemplo.com/artigo',
        kind: 'page',
        position: 1,
      },
    ]);
    expect(await auditOf(test, lesson.id, 'lesson.set_links')).toHaveLength(1);

    const invalid = await call({
      method: 'PUT',
      url: `/api/v1/lessons/${lesson.id}/links`,
      as: instructor,
      payload: {
        links: [
          { label: 'Bom', url: 'https://exemplo.com/a', kind: 'page' },
          { label: 'Ruim', url: 'http://exemplo.com/b', kind: 'page' },
        ],
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      code: 'content_url_invalid',
      errors: [{ path: 'body.links[1].url' }],
    });

    const tooMany = await call({
      method: 'PUT',
      url: `/api/v1/lessons/${lesson.id}/links`,
      as: instructor,
      payload: {
        links: Array.from({ length: 21 }, (_, index) => ({
          label: `Link ${index}`,
          url: 'https://exemplo.com/a',
          kind: 'page',
        })),
      },
    });
    expect(tooMany.statusCode).toBe(400);

    const cleared = await call({
      method: 'PUT',
      url: `/api/v1/lessons/${lesson.id}/links`,
      as: instructor,
      payload: { links: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().links).toEqual([]);
  });
});

describe('respostas conferem com o contrato', () => {
  it('nenhuma chamada deste arquivo gerou resposta fora do esquema', () => {
    const mismatches = test.lines.filter(
      (line) => line.level === 'error' || String(line.msg ?? '').includes('contrato não declara'),
    );
    expect(mismatches).toEqual([]);
  });
});
