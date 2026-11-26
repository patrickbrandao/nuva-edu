import { randomUUID } from 'node:crypto';
import { catalogSlugFromTitle } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  auditOf,
  type CallOptions,
  callAs,
  catalogVersion,
  createActor,
  deniedBy,
  editAs,
} from './actors.ts';
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
/** `PATCH` com a `version` atual do item (a da última resposta, no site). */
const edit = (options: CallOptions & { payload: object }) => editAs(test, options);

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

/**
 * Curso `open` do instrutor: o gerente o cria com o dono e o modo. Criado pelo próprio
 * instrutor, o curso nasce `private` e ele não publica curso nem aula (spec 009, "Modo de
 * acesso inicial").
 */
async function openCourseOf(owner: Actor, extra: object = {}) {
  const course = await newCourse(manager, { ownerId: owner.id, accessMode: 'open', ...extra });
  expect(course).toMatchObject({ accessMode: 'open', owner: { id: owner.id } });
  return course;
}

/**
 * Curso com um módulo e uma aula publicada: pronto para publicar. O do instrutor é `open`,
 * criado pelo gerente; o da equipe nasce `private`.
 */
async function publishableCourse(as: Actor, extra: object = {}) {
  const course =
    as.role === 'instructor' ? await openCourseOf(as, extra) : await newCourse(as, extra);
  const module = await newModule(as, course.id);
  const lesson = await newLesson(as, module.id);
  const published = await edit({
    method: 'PATCH',
    url: `/api/v1/lessons/${lesson.id}`,
    as,
    payload: { status: 'published' },
  });
  expect(published.statusCode).toBe(200);
  return { course, module, lesson };
}

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
      slug: catalogSlugFromTitle(title, 'course'),
      summary: 'Resumo',
      description: '# Olá',
      level: 'beginner',
      status: 'draft',
      accessMode: 'private',
      cover: null,
      priceCents: null,
      owner: { id: instructor.id },
      reviewRequestedAt: null,
      archivedAt: null,
      moduleCount: 0,
      lessonCount: 0,
      studentCount: 0,
      modules: [],
      ebooks: [],
      version: 1,
    });
    expect(await auditOf(test, course.id, 'course.create')).toHaveLength(1);

    const read = await call({ method: 'GET', url: `/api/v1/courses/${course.id}`, as: instructor });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(course);
  });

  it('sem slug, o núcleo o gera do título; o segundo curso de mesmo título ganha o sufixo -2', async () => {
    const title = uniqueTitle('Curso Repetido');
    const first = await newCourse(manager, { title });
    const second = await newCourse(instructor, { title });
    const base = catalogSlugFromTitle(title, 'course');
    expect(first.slug).toBe(base);
    expect(second.slug).toBe(`${base}-2`);
    expect(second).toMatchObject({ accessMode: 'private', priceCents: null });
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
  it('altera só os campos enviados, com a version da última resposta, e grava a auditoria', async () => {
    const course = await newCourse(instructor, { summary: 'Antes' });
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: instructor,
      payload: {
        title: 'Título novo',
        certificateEnabled: false,
        certificateHours: 12,
        version: course.version,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: course.id,
      title: 'Título novo',
      summary: 'Antes',
      slug: course.slug,
      certificateEnabled: false,
      certificateHours: 12,
      version: course.version + 1,
    });
    expect(await auditOf(test, course.id, 'course.update')).toHaveLength(1);

    // A edição seguinte leva a `version` da resposta anterior.
    const again = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: instructor,
      payload: { summary: null, version: response.json().version },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ title: 'Título novo', summary: null });
  });

  it('curso alheio ao instrutor: 404 em toda rota do curso, módulo e aula', async () => {
    const { course, module, lesson } = await publishableCourse(otherInstructor);
    const attempts: Array<Pick<CallOptions, 'method' | 'url' | 'payload'>> = [
      { method: 'GET', url: `/api/v1/courses/${course.id}` },
      {
        method: 'PATCH',
        url: `/api/v1/courses/${course.id}`,
        payload: { title: 'Meu', version: course.version },
      },
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
      {
        method: 'PATCH',
        url: `/api/v1/modules/${module.id}`,
        payload: { title: 'M', version: module.version },
      },
      { method: 'DELETE', url: `/api/v1/modules/${module.id}` },
      { method: 'POST', url: `/api/v1/modules/${module.id}/lessons`, payload: { title: 'A' } },
      {
        method: 'PUT',
        url: `/api/v1/modules/${module.id}/lessons/order`,
        payload: { lessonIds: [lesson.id] },
      },
      { method: 'GET', url: `/api/v1/lessons/${lesson.id}` },
      {
        method: 'PATCH',
        url: `/api/v1/lessons/${lesson.id}`,
        payload: {
          title: 'A',
          version: await catalogVersion(test, `/api/v1/lessons/${lesson.id}`),
        },
      },
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
    expect(course).toMatchObject({ accessMode: 'private', priceCents: null });
    const access = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: owner,
      payload: { accessMode: 'paid' },
    });
    expect(access.statusCode).toBe(403);
    expect(access.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, owner.id)).toHaveLength(1);

    // A permissão do campo vem antes da regra do valor: em curso `open`, que não tem preço,
    // o instrutor que envia `priceCents` recebe 403; o admin, que tem a permissão, 422.
    const opened = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { accessMode: 'open' },
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ accessMode: 'open' });
    const ownerOpenPrice = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: owner,
      payload: { priceCents: 9900 },
    });
    expect(ownerOpenPrice.statusCode).toBe(403);
    expect(ownerOpenPrice.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, owner.id)).toHaveLength(2);
    // Também na criação: o instrutor que envia preço recebe 403 e nada é criado.
    const createPrice = await call({
      method: 'POST',
      url: '/api/v1/courses',
      as: owner,
      payload: { title: uniqueTitle(), priceCents: 9900 },
    });
    expect(createPrice.statusCode).toBe(403);
    expect(createPrice.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, owner.id)).toHaveLength(3);
    const openPrice = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: admin,
      payload: { priceCents: 9900 },
    });
    expect(openPrice.statusCode).toBe(422);
    expect(openPrice.json()).toMatchObject({ code: 'price_not_allowed' });

    // O gerente define o modo, mas não o preço; o admin, os dois.
    const managerAccess = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { accessMode: 'paid', accessDays: 365 },
    });
    expect(managerAccess.statusCode).toBe(200);
    expect(managerAccess.json()).toMatchObject({ accessMode: 'paid', accessDays: 365 });
    const price = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: owner,
      payload: { priceCents: 9900 },
    });
    expect(price.statusCode).toBe(403);
    expect(price.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, owner.id)).toHaveLength(4);
    // O título segue editável pelo dono.
    const title = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: owner,
      payload: { title: 'Outro título', priceCents: null },
    });
    expect(title.statusCode).toBe(200);
    const managerPrice = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { priceCents: 9900 },
    });
    expect(managerPrice.statusCode).toBe(403);
    const adminPrice = await edit({
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
    const cover = await edit({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: manager,
      payload: { coverImageId: randomUUID() },
    });
    expect(cover.statusCode).toBe(422);
    expect(cover.json()).toMatchObject({ code: 'cover_image_invalid' });

    const missing = await edit({
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
    const course = await openCourseOf(instructor);
    const empty = await call({
      method: 'POST',
      url: `/api/v1/courses/${course.id}/publish`,
      as: instructor,
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toMatchObject({ code: 'course_has_no_published_lesson' });

    const module = await newModule(instructor, course.id);
    const lesson = await newLesson(instructor, module.id, { durationSeconds: 600 });
    await edit({
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
    const paid = await edit({
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
      version: 1,
      lessons: [],
    });
    const second = await newModule(instructor, course.id, 'Segundo');
    await newLesson(instructor, second.id, { title: 'Aula do segundo' });

    const renamed = await edit({
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
    // De novo, com a `version` da resposta anterior.
    const renamedAgain = await call({
      method: 'PATCH',
      url: `/api/v1/modules/${second.id}`,
      as: instructor,
      payload: { title: 'Segundo', version: renamed.json().version },
    });
    expect(renamedAgain.statusCode).toBe(200);
    expect(renamedAgain.json().version).toBe(renamed.json().version + 1);

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
      {
        method: 'PATCH',
        url: `/api/v1/modules/${randomUUID()}`,
        payload: { title: 'X', version: 1 },
      },
      { method: 'DELETE', url: `/api/v1/modules/${randomUUID()}` },
    ] as const) {
      expect((await call({ ...attempt, as: manager })).statusCode).toBe(404);
    }
  });
});

describe('aulas e links de apoio', () => {
  it('cria com vídeo, lê, edita, publica e exclui', async () => {
    const course = await openCourseOf(instructor);
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
      version: 1,
      links: [],
      ebooks: [],
    });
    expect(await auditOf(test, created.id, 'lesson.create')).toHaveLength(1);

    const read = await call({
      method: 'GET',
      url: `/api/v1/lessons/${created.id}`,
      as: instructor,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(created);

    const updated = await edit({
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
    // Sem duração na criação: o `null` vai ao núcleo, que grava `0`.
    expect(await newLesson(instructor, module.id, { durationSeconds: null })).toMatchObject({
      durationSeconds: 0,
    });

    const sample = await edit({
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
    const patched = await edit({
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
    // Criado pelo instrutor, o curso nasce `private`.
    const course = await newCourse(instructor);
    expect(course).toMatchObject({ accessMode: 'private' });
    const module = await newModule(instructor, course.id);
    const lesson = await newLesson(instructor, module.id);
    const response = await edit({
      method: 'PATCH',
      url: `/api/v1/lessons/${lesson.id}`,
      as: instructor,
      payload: { status: 'published' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
  });

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

    // Aula de outro módulo do mesmo curso, na lista, é movida para este; a origem fecha a
    // numeração das que ficaram.
    const movedIn = await call({
      method: 'PUT',
      url: `/api/v1/modules/${second.id}/lessons/order`,
      as: instructor,
      payload: { lessonIds: [two.id] },
    });
    expect(movedIn.statusCode).toBe(200);
    expect(movedIn.json()).toMatchObject({
      id: second.id,
      courseId: course.id,
      lessons: [{ id: two.id, moduleId: second.id, position: 0 }],
    });
    expect(movedIn.json().version).toEqual(expect.any(Number));
    const source = await call({
      method: 'GET',
      url: `/api/v1/courses/${course.id}`,
      as: instructor,
    });
    const sourceLessons = source
      .json()
      .modules.find((item: { id: string }) => item.id === first.id)
      .lessons.map((lesson: { id: string; position: number }) => [lesson.id, lesson.position]);
    expect(sourceLessons).toEqual([
      [three.id, 0],
      [one.id, 1],
    ]);
    const moves = await auditOf(test, second.id, 'lesson.reorder');
    expect(moves.map((row) => row.details)).toContainEqual({
      lessonIds: [two.id],
      moved: [{ lessonId: two.id, fromModuleId: first.id, toModuleId: second.id }],
    });

    // Aula de outro curso não entra.
    const other = await newCourse(instructor);
    const otherModule = await newModule(instructor, other.id);
    const foreign = await call({
      method: 'PUT',
      url: `/api/v1/modules/${otherModule.id}/lessons/order`,
      as: instructor,
      payload: { lessonIds: [one.id] },
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json()).toMatchObject({ code: 'order_mismatch' });

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

describe('version da edição: 409 com a antiga, 400 sem ela', () => {
  it('curso, módulo e aula: version antiga é 409 version_conflict e nada é gravado', async () => {
    const course = await newCourse(manager);
    const module = await newModule(manager, course.id, 'Original');
    const lesson = await newLesson(manager, module.id, { title: 'Original' });
    const items = [
      { url: `/api/v1/courses/${course.id}`, stale: course.version, audit: 'course.update' },
      { url: `/api/v1/modules/${module.id}`, stale: module.version, audit: 'module.update' },
      { url: `/api/v1/lessons/${lesson.id}`, stale: lesson.version, audit: 'lesson.update' },
    ];
    for (const item of items) {
      // Outra pessoa grava antes: a `version` que se tinha fica antiga.
      const first = await edit({
        method: 'PATCH',
        url: item.url,
        as: manager,
        payload: { title: 'Antes' },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().version).toBe(item.stale + 1);

      const stale = await call({
        method: 'PATCH',
        url: item.url,
        as: manager,
        payload: { title: 'Perdida', version: item.stale },
      });
      expect(`${item.url} ${stale.statusCode}`).toBe(`${item.url} 409`);
      expect(stale.json()).toMatchObject({ code: 'version_conflict' });
      expect(await auditOf(test, item.url.split('/')[4] as string, item.audit)).toHaveLength(1);

      const noVersion = await call({
        method: 'PATCH',
        url: item.url,
        as: manager,
        payload: { title: 'Sem versão' },
      });
      expect(`${item.url} ${noVersion.statusCode}`).toBe(`${item.url} 400`);
      expect(noVersion.json()).toMatchObject({ code: 'validation_failed' });
    }
    const detail = await call({ method: 'GET', url: `/api/v1/courses/${course.id}`, as: manager });
    expect(detail.json()).toMatchObject({
      title: 'Antes',
      version: course.version + 1,
      modules: [{ id: module.id, title: 'Antes', lessons: [{ id: lesson.id, title: 'Antes' }] }],
    });

    // Corpo só com a `version`: 400 no curso e na aula (ao menos um campo além dela).
    for (const url of [`/api/v1/courses/${course.id}`, `/api/v1/lessons/${lesson.id}`]) {
      const empty = await edit({ method: 'PATCH', url, as: manager, payload: {} });
      expect(`${url} ${empty.statusCode}`).toBe(`${url} 400`);
    }
  });

  it('links da aula e dono do curso: version opcional; enviada e antiga, 409 sem gravar', async () => {
    const course = await newCourse(manager);
    const module = await newModule(manager, course.id);
    const lesson = await newLesson(manager, module.id);
    const links = [{ label: 'Slides', url: 'https://exemplo.com/slides.pdf', kind: 'file' }];

    const fresh = await call({
      method: 'PUT',
      url: `/api/v1/lessons/${lesson.id}/links`,
      as: manager,
      payload: { links, version: lesson.version },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().version).toBe(lesson.version + 1);
    const staleLinks = await call({
      method: 'PUT',
      url: `/api/v1/lessons/${lesson.id}/links`,
      as: manager,
      payload: { links: [], version: lesson.version },
    });
    expect(staleLinks.statusCode).toBe(409);
    expect(staleLinks.json()).toMatchObject({ code: 'version_conflict' });
    expect(await auditOf(test, lesson.id, 'lesson.set_links')).toHaveLength(1);
    const read = await call({ method: 'GET', url: `/api/v1/lessons/${lesson.id}`, as: manager });
    expect(read.json().links).toHaveLength(1);

    const owner = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}/owner`,
      as: manager,
      payload: { ownerId: instructor.id, version: course.version },
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().version).toBe(course.version + 1);
    const staleOwner = await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}/owner`,
      as: manager,
      payload: { ownerId: otherInstructor.id, version: course.version },
    });
    expect(staleOwner.statusCode).toBe(409);
    expect(staleOwner.json()).toMatchObject({ code: 'version_conflict' });
    expect(await auditOf(test, course.id, 'course.set_owner')).toHaveLength(1);
    const kept = await call({ method: 'GET', url: `/api/v1/courses/${course.id}`, as: manager });
    expect(kept.json()).toMatchObject({ owner: { id: instructor.id } });
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
