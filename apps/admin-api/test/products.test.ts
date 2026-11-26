import { randomUUID } from 'node:crypto';
import { catalogSlugFromTitle } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const uniqueTitle = (prefix: string) => `${prefix} ${randomUUID()}`;

const FILE_URL = 'https://cdn.example.com/livros/guia.pdf';

async function create(url: string, as: Actor, payload: object) {
  const response = await call({ method: 'POST', url, as, payload });
  expect(response.statusCode).toBe(201);
  return response.json();
}

const newEbook = (as: Actor, extra: object = {}) =>
  create('/api/v1/ebooks', as, { title: uniqueTitle('Ebook'), ...extra });

const newBundle = (as: Actor, extra: object = {}) =>
  create('/api/v1/bundles', as, { title: uniqueTitle('Pacote'), ...extra });

const newCourse = (as: Actor, extra: object = {}) =>
  create('/api/v1/courses', as, { title: uniqueTitle('Curso'), ...extra });

/** Curso do ator com um módulo e uma aula. */
async function courseWithLesson(as: Actor) {
  const course = await newCourse(as);
  const module = await create(`/api/v1/courses/${course.id}/modules`, as, { title: 'Módulo' });
  const lesson = await create(`/api/v1/modules/${module.id}/lessons`, as, { title: 'Aula 1' });
  return { course, lesson };
}

async function grant(productType: 'ebook' | 'bundle', productId: string) {
  const student = await createActor(test, 'student');
  await test.db
    .insertInto('entitlements')
    .values({
      userId: student.id,
      productType,
      productId,
      source: 'grant',
      sourceId: admin.id,
      grantedReason: 'teste',
    })
    .execute();
}

/** Tarefas `entitlement.recompute` na fila para o produto. */
async function recomputes(productId: string): Promise<number> {
  const rows = await test.db
    .selectFrom('jobs')
    .select(['payload'])
    .where('type', '=', 'entitlement.recompute')
    .execute();
  return rows.filter((row) => (row.payload as { productId?: string }).productId === productId)
    .length;
}

const post = (url: string, as: Actor) => call({ method: 'POST', url, as });

describe('ebooks: criar, ler e listar', () => {
  it('gerente cria: rascunho, slug gerado do título, com auditoria; o instrutor lê e não cria', async () => {
    const title = uniqueTitle('Guia de Edição');
    const response = await call({
      method: 'POST',
      url: '/api/v1/ebooks',
      as: manager,
      payload: {
        title,
        summary: 'Resumo',
        description: '# Olá',
        authorName: 'Autora',
        fileUrl: FILE_URL,
        pages: 120,
      },
    });
    expect(response.statusCode).toBe(201);
    const ebook = response.json();
    expect(ebook).toMatchObject({
      title,
      slug: catalogSlugFromTitle(title, 'ebook'),
      accessMode: 'private',
      summary: 'Resumo',
      description: '# Olá',
      authorName: 'Autora',
      fileUrl: FILE_URL,
      pages: 120,
      status: 'draft',
      cover: null,
      priceCents: null,
      publishedAt: null,
      archivedAt: null,
      targets: [],
      studentCount: 0,
    });
    expect(ebook).not.toHaveProperty('version');
    expect(await auditOf(test, ebook.id, 'ebook.create')).toHaveLength(1);

    const read = await call({ method: 'GET', url: `/api/v1/ebooks/${ebook.id}`, as: instructor });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(ebook);

    const denied = await call({
      method: 'POST',
      url: '/api/v1/ebooks',
      as: instructor,
      payload: { title: uniqueTitle('Ebook') },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(test, instructor.id)).not.toHaveLength(0);
  });

  it('slug repetido: 409; URL do arquivo e capa inválidas: 422; fora do contrato: 400; sem CSRF: 403; sem sessão: 401', async () => {
    const slug = `ebook-${randomUUID()}`;
    expect(await newEbook(manager, { slug })).toMatchObject({ slug });
    const send = (payload: object, csrf?: null) =>
      call({
        method: 'POST',
        url: '/api/v1/ebooks',
        as: manager,
        payload,
        ...(csrf === null ? { csrf } : {}),
      });

    const repeated = await send({ title: 'Outro', slug });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ code: 'slug_taken' });

    const badUrl = await send({ title: uniqueTitle('Ebook'), fileUrl: 'ftp://exemplo.com/a.pdf' });
    expect(badUrl.statusCode).toBe(422);
    expect(badUrl.json()).toMatchObject({ code: 'content_url_invalid' });

    const badCover = await send({ title: uniqueTitle('Ebook'), coverImageId: randomUUID() });
    expect(badCover.statusCode).toBe(422);
    expect(badCover.json()).toMatchObject({ code: 'cover_image_invalid' });

    const invalid = await send({ title: '', sobra: true });
    expect(invalid.statusCode).toBe(400);

    expect((await send({ title: uniqueTitle('Ebook') }, null)).statusCode).toBe(403);
    const anonymous = await test.app.inject({ method: 'GET', url: '/api/v1/ebooks' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('lista com busca, filtro de estado e cursor', async () => {
    const mark = randomUUID();
    const first = await newEbook(manager, { title: `Lista ${mark} A`, fileUrl: FILE_URL });
    const second = await newEbook(manager, { title: `Lista ${mark} B` });
    expect((await post(`/api/v1/ebooks/${first.id}/publish`, manager)).statusCode).toBe(200);

    const list = (query: string, as: Actor = manager) =>
      call({ method: 'GET', url: `/api/v1/ebooks?q=${mark}${query}`, as });

    const all = await list('&sort=title', instructor);
    expect(all.statusCode).toBe(200);
    expect(all.json().items.map((item: { id: string }) => item.id)).toEqual([first.id, second.id]);
    expect(all.json().nextCursor).toBeNull();
    expect(all.json().items[0]).not.toHaveProperty('fileUrl');

    const published = await list('&status=published');
    expect(published.json().items.map((item: { id: string }) => item.id)).toEqual([first.id]);

    const page = await list('&sort=title&limit=1');
    expect(page.json().items).toHaveLength(1);
    const next = await list(`&sort=title&limit=1&cursor=${page.json().nextCursor}`);
    expect(next.json().items.map((item: { id: string }) => item.id)).toEqual([second.id]);

    expect((await list('&status=qualquer')).statusCode).toBe(400);
  });
});

describe('ebooks: editar, publicar, arquivar e excluir', () => {
  it('PATCH altera só os campos enviados, sem version no corpo; preço é só do admin', async () => {
    const ebook = await newEbook(manager, { summary: 'Antes', pages: 10 });
    const patch = (as: Actor, payload: object) =>
      call({ method: 'PATCH', url: `/api/v1/ebooks/${ebook.id}`, as, payload });

    const renamed = await patch(manager, { title: 'Depois', pages: null });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ title: 'Depois', summary: 'Antes', pages: null });
    expect(renamed.json()).not.toHaveProperty('version');
    // Duas edições seguidas, sem `version`: a rota lê a versão atual a cada uma.
    expect((await patch(manager, { summary: null })).json()).toMatchObject({ summary: null });
    expect(await auditOf(test, ebook.id, 'ebook.update')).toHaveLength(2);

    expect((await patch(manager, { accessMode: 'paid' })).statusCode).toBe(200);
    const price = await patch(manager, { priceCents: 4900 });
    expect(price.statusCode).toBe(403);
    const priced = await patch(admin, { priceCents: 4900, accessDays: 365 });
    expect(priced.statusCode).toBe(200);
    expect(priced.json()).toMatchObject({ accessMode: 'paid', priceCents: 4900, accessDays: 365 });

    expect((await patch(instructor, { title: 'Meu' })).statusCode).toBe(403);
    expect((await patch(manager, {})).statusCode).toBe(400);
    const missing = await call({
      method: 'PATCH',
      url: `/api/v1/ebooks/${randomUUID()}`,
      as: manager,
      payload: { title: 'Nada' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('publicar exige o arquivo e, se pago, o preço; despublicar volta a rascunho', async () => {
    const ebook = await newEbook(manager);
    const url = `/api/v1/ebooks/${ebook.id}`;
    const noFile = await post(`${url}/publish`, manager);
    expect(noFile.statusCode).toBe(422);
    expect(noFile.json()).toMatchObject({ code: 'ebook_file_required' });

    await call({ method: 'PATCH', url, as: manager, payload: { fileUrl: FILE_URL } });
    await call({ method: 'PATCH', url, as: manager, payload: { accessMode: 'paid' } });
    const noPrice = await post(`${url}/publish`, manager);
    expect(noPrice.statusCode).toBe(422);
    expect(noPrice.json()).toMatchObject({ code: 'price_required' });

    await call({ method: 'PATCH', url, as: admin, payload: { priceCents: 1000 } });
    const published = await post(`${url}/publish`, manager);
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published' });
    expect(published.json().publishedAt).not.toBeNull();
    expect(await auditOf(test, ebook.id, 'ebook.publish')).toHaveLength(1);

    expect((await post(`${url}/unpublish`, instructor)).statusCode).toBe(403);
    const draft = await post(`${url}/unpublish`, manager);
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({ status: 'draft' });
  });

  it('arquivar e desarquivar: só admin, idempotentes; arquivado não publica', async () => {
    const ebook = await newEbook(manager, { fileUrl: FILE_URL });
    const url = `/api/v1/ebooks/${ebook.id}`;
    expect((await post(`${url}/archive`, manager)).statusCode).toBe(403);

    const archived = await post(`${url}/archive`, admin);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().archivedAt).not.toBeNull();
    const again = await post(`${url}/archive`, admin);
    expect(again.statusCode).toBe(200);
    expect(again.json().archivedAt).toBe(archived.json().archivedAt);
    expect(await auditOf(test, ebook.id, 'ebook.archive')).toHaveLength(1);

    const publish = await post(`${url}/publish`, manager);
    expect(publish.statusCode).toBe(422);
    expect(publish.json()).toMatchObject({ code: 'product_archived' });

    const listed = await call({
      method: 'GET',
      url: `/api/v1/ebooks?status=archived&q=${encodeURIComponent(ebook.title)}`,
      as: manager,
    });
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([ebook.id]);

    expect((await post(`${url}/unarchive`, manager)).statusCode).toBe(403);
    const back = await post(`${url}/unarchive`, admin);
    expect(back.statusCode).toBe(200);
    expect(back.json()).toMatchObject({ archivedAt: null, status: 'draft' });
    expect((await post(`${url}/unarchive`, admin)).statusCode).toBe(200);
  });

  it('exclui o ebook sem vínculos; com direito associado: 409 product_has_links', async () => {
    const ebook = await newEbook(manager);
    const url = `/api/v1/ebooks/${ebook.id}`;
    expect((await call({ method: 'DELETE', url, as: instructor })).statusCode).toBe(403);
    const removed = await call({ method: 'DELETE', url, as: manager });
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
    expect(await auditOf(test, ebook.id, 'ebook.delete')).toHaveLength(1);
    expect((await call({ method: 'GET', url, as: manager })).statusCode).toBe(404);

    const sold = await newEbook(manager);
    await grant('ebook', sold.id);
    const refused = await call({ method: 'DELETE', url: `/api/v1/ebooks/${sold.id}`, as: admin });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'product_has_links' });
    const detail = await call({ method: 'GET', url: `/api/v1/ebooks/${sold.id}`, as: admin });
    expect(detail.json()).toMatchObject({ studentCount: 1 });
  });
});

describe('PUT /api/v1/ebooks/{id}/targets', () => {
  const put = (ebookId: string, as: Actor, targets: object[]) =>
    call({ method: 'PUT', url: `/api/v1/ebooks/${ebookId}/targets`, as, payload: { targets } });

  it('gerente vincula a curso e aula, com o recálculo do curso na fila e a auditoria', async () => {
    const ebook = await newEbook(manager);
    const { course, lesson } = await courseWithLesson(instructor);
    const other = await newCourse(manager);

    const response = await put(ebook.id, manager, [
      { targetType: 'course', targetId: other.id },
      { targetType: 'lesson', targetId: lesson.id },
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('version');
    expect(response.json().targets).toEqual([
      { targetType: 'course', targetId: other.id, title: other.title, course: null },
      {
        targetType: 'lesson',
        targetId: lesson.id,
        title: 'Aula 1',
        course: { type: 'course', id: course.id, title: course.title },
      },
    ]);
    expect(await recomputes(other.id)).toBe(1);
    expect(await recomputes(course.id)).toBe(1);
    expect(await auditOf(test, ebook.id, 'ebook.set_targets')).toHaveLength(1);

    // A mesma lista não muda nada: nenhum recálculo novo.
    expect((await put(ebook.id, manager, response.json().targets.map(targetOf))).statusCode).toBe(
      200,
    );
    expect(await recomputes(other.id)).toBe(1);

    const cleared = await put(ebook.id, manager, []);
    expect(cleared.json().targets).toEqual([]);
    expect(await recomputes(other.id)).toBe(2);
  });

  it('instrutor só vincula aos próprios cursos e aulas, e a lista dele não toca os vínculos alheios', async () => {
    const ebook = await newEbook(manager);
    const mine = await courseWithLesson(instructor);
    const theirs = await courseWithLesson(otherInstructor);
    await put(ebook.id, manager, [{ targetType: 'course', targetId: theirs.course.id }]);

    for (const target of [
      { targetType: 'course', targetId: theirs.course.id },
      { targetType: 'lesson', targetId: theirs.lesson.id },
      { targetType: 'course', targetId: randomUUID() },
    ]) {
      const refused = await put(ebook.id, instructor, [target]);
      expect(refused.statusCode).toBe(404);
    }

    const linked = await put(ebook.id, instructor, [
      { targetType: 'course', targetId: mine.course.id },
      { targetType: 'lesson', targetId: mine.lesson.id },
    ]);
    expect(linked.statusCode).toBe(200);
    // O instrutor vê só os vínculos com o que é dele.
    expect(linked.json().targets.map(targetOf)).toEqual([
      { targetType: 'course', targetId: mine.course.id },
      { targetType: 'lesson', targetId: mine.lesson.id },
    ]);

    const emptied = await put(ebook.id, instructor, []);
    expect(emptied.json().targets).toEqual([]);
    const full = await call({ method: 'GET', url: `/api/v1/ebooks/${ebook.id}`, as: manager });
    expect(full.json().targets.map(targetOf)).toEqual([
      { targetType: 'course', targetId: theirs.course.id },
    ]);

    // A aula passa a mostrar o ebook vinculado.
    await put(ebook.id, instructor, [{ targetType: 'lesson', targetId: mine.lesson.id }]);
    const lesson = await call({
      method: 'GET',
      url: `/api/v1/lessons/${mine.lesson.id}`,
      as: instructor,
    });
    expect(lesson.json().ebooks).toEqual([
      { id: ebook.id, slug: ebook.slug, title: ebook.title, status: 'draft' },
    ]);
  });

  it('não toca o vínculo a pacote; alvo inexistente: 422; alvo `bundle` no corpo e aluno: recusados', async () => {
    const ebook = await newEbook(manager);
    const bundle = await newBundle(manager);
    const course = await newCourse(manager);
    await test.db
      .insertInto('productEbooks')
      .values({ ebookId: ebook.id, targetType: 'bundle', targetId: bundle.id })
      .execute();
    const bundleLinks = () =>
      test.db
        .selectFrom('productEbooks')
        .select(['targetType', 'targetId'])
        .where('ebookId', '=', ebook.id)
        .where('targetType', '=', 'bundle')
        .execute();

    const linked = await put(ebook.id, manager, [{ targetType: 'course', targetId: course.id }]);
    expect(linked.statusCode).toBe(200);
    expect(linked.json().targets.map(targetOf)).toEqual([
      { targetType: 'bundle', targetId: bundle.id },
      { targetType: 'course', targetId: course.id },
    ]);
    expect((await put(ebook.id, manager, [])).statusCode).toBe(200);
    expect(await bundleLinks()).toEqual([{ targetType: 'bundle', targetId: bundle.id }]);
    expect(await recomputes(bundle.id)).toBe(0);

    const missing = await put(ebook.id, manager, [
      { targetType: 'course', targetId: randomUUID() },
    ]);
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({ code: 'catalog_item_not_found' });

    const asBundle = await put(ebook.id, manager, [{ targetType: 'bundle', targetId: bundle.id }]);
    expect(asBundle.statusCode).toBe(400);
    expect((await put(randomUUID(), manager, [])).statusCode).toBe(404);
    const student = await createActor(test, 'student');
    expect((await put(ebook.id, student, [])).statusCode).toBe(403);
  });
});

const targetOf = (target: { targetType: string; targetId: string }) => ({
  targetType: target.targetType,
  targetId: target.targetId,
});

describe('pacotes: criar, ler, listar e editar', () => {
  it('gerente cria, lê e lista; o instrutor não alcança pacotes', async () => {
    const title = uniqueTitle('Pacote Ação');
    const response = await call({
      method: 'POST',
      url: '/api/v1/bundles',
      as: manager,
      payload: { title, summary: 'Resumo', description: 'Texto' },
    });
    expect(response.statusCode).toBe(201);
    const bundle = response.json();
    expect(bundle).toMatchObject({
      title,
      slug: catalogSlugFromTitle(title, 'bundle'),
      accessMode: 'private',
      summary: 'Resumo',
      description: 'Texto',
      status: 'draft',
      cover: null,
      priceCents: null,
      itemCount: 0,
      items: [],
      itemsPriceCents: 0,
      studentCount: 0,
    });
    expect(bundle).not.toHaveProperty('version');
    expect(await auditOf(test, bundle.id, 'bundle.create')).toHaveLength(1);

    const read = await call({ method: 'GET', url: `/api/v1/bundles/${bundle.id}`, as: manager });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(bundle);

    const listed = await call({
      method: 'GET',
      url: `/api/v1/bundles?q=${encodeURIComponent(title)}&status=draft&sort=title&limit=5`,
      as: manager,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([bundle.id]);
    expect(listed.json().items[0]).not.toHaveProperty('items');
    expect(listed.json().nextCursor).toBeNull();

    const repeated = await call({
      method: 'POST',
      url: '/api/v1/bundles',
      as: manager,
      payload: { title: 'Outro', slug: bundle.slug },
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ code: 'slug_taken' });

    for (const url of ['/api/v1/bundles', `/api/v1/bundles/${bundle.id}`]) {
      expect((await call({ method: 'GET', url, as: instructor })).statusCode).toBe(403);
    }
    expect(
      (await call({ method: 'GET', url: `/api/v1/bundles/${randomUUID()}`, as: manager }))
        .statusCode,
    ).toBe(404);
  });

  it('PATCH altera só os campos enviados, sem version no corpo; preço é só do admin', async () => {
    const bundle = await newBundle(manager, { summary: 'Antes' });
    const patch = (as: Actor, payload: object) =>
      call({ method: 'PATCH', url: `/api/v1/bundles/${bundle.id}`, as, payload });

    const renamed = await patch(manager, { title: 'Depois' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ title: 'Depois', summary: 'Antes' });
    expect((await patch(manager, { accessMode: 'paid' })).statusCode).toBe(200);
    expect((await patch(manager, { priceCents: 9900 })).statusCode).toBe(403);
    const priced = await patch(admin, { priceCents: 9900 });
    expect(priced.json()).toMatchObject({ accessMode: 'paid', priceCents: 9900 });
    // Modo de acesso e preço têm ações próprias na auditoria.
    expect(await auditOf(test, bundle.id, 'bundle.update')).toHaveLength(1);
    expect((await patch(manager, { sobra: 1 })).statusCode).toBe(400);
  });
});

describe('PUT /api/v1/bundles/{id}/items', () => {
  const put = (bundleId: string, as: Actor, items: object[]) =>
    call({ method: 'PUT', url: `/api/v1/bundles/${bundleId}/items`, as, payload: { items } });

  it('troca a lista na ordem enviada e enfileira o recálculo quando a composição muda', async () => {
    const bundle = await newBundle(manager);
    const course = await newCourse(manager);
    const ebook = await newEbook(manager);
    const url = `/api/v1/ebooks/${ebook.id}`;
    await call({ method: 'PATCH', url, as: manager, payload: { accessMode: 'paid' } });
    await call({ method: 'PATCH', url, as: admin, payload: { priceCents: 2500 } });
    await grant('bundle', bundle.id);

    const response = await put(bundle.id, manager, [
      { productType: 'ebook', productId: ebook.id },
      { productType: 'course', productId: course.id },
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('version');
    expect(response.json()).toMatchObject({ itemCount: 2, itemsPriceCents: 2500, studentCount: 1 });
    expect(response.json().items).toEqual([
      {
        productType: 'ebook',
        productId: ebook.id,
        title: ebook.title,
        accessMode: 'paid',
        priceCents: 2500,
        status: 'draft',
        archived: false,
        position: 0,
      },
      {
        productType: 'course',
        productId: course.id,
        title: course.title,
        accessMode: course.accessMode,
        priceCents: null,
        status: 'draft',
        archived: false,
        position: 1,
      },
    ]);
    expect(await recomputes(bundle.id)).toBe(1);
    expect(await auditOf(test, bundle.id, 'bundle.set_items')).toHaveLength(1);

    // Só a ordem: nada a recalcular.
    const reordered = await put(bundle.id, manager, [
      { productType: 'course', productId: course.id },
      { productType: 'ebook', productId: ebook.id },
    ]);
    expect(reordered.json().items.map((item: { productId: string }) => item.productId)).toEqual([
      course.id,
      ebook.id,
    ]);
    expect(await recomputes(bundle.id)).toBe(1);

    // Remover um item de pacote que alguém tem: recálculo de novo.
    const removed = await put(bundle.id, manager, [
      { productType: 'course', productId: course.id },
    ]);
    expect(removed.json()).toMatchObject({ itemCount: 1, itemsPriceCents: 0 });
    expect(await recomputes(bundle.id)).toBe(2);
  });

  it('pacote contendo pacote: 422; item inexistente: 422; repetido e fora do contrato: 400', async () => {
    const bundle = await newBundle(manager);
    const inner = await newBundle(manager);
    const course = await newCourse(manager);

    // O contrato só aceita `course` e `ebook`: pacote enviado como um deles não é achado.
    for (const productType of ['course', 'ebook']) {
      const nested = await put(bundle.id, manager, [{ productType, productId: inner.id }]);
      expect(nested.statusCode).toBe(422);
      expect(nested.json()).toMatchObject({ code: 'catalog_item_not_found' });
    }
    const missing = await put(bundle.id, manager, [
      { productType: 'course', productId: course.id },
      { productType: 'ebook', productId: randomUUID() },
    ]);
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({ code: 'catalog_item_not_found' });

    // `productType: bundle` não passa da validação do contrato.
    const asBundle = await put(bundle.id, manager, [
      { productType: 'bundle', productId: inner.id },
    ]);
    expect(asBundle.statusCode).toBe(400);
    const repeated = await put(bundle.id, manager, [
      { productType: 'course', productId: course.id },
      { productType: 'course', productId: course.id },
    ]);
    expect(repeated.statusCode).toBe(400);

    const detail = await call({ method: 'GET', url: `/api/v1/bundles/${bundle.id}`, as: manager });
    expect(detail.json().items).toEqual([]);
    expect(await recomputes(bundle.id)).toBe(0);

    expect((await put(bundle.id, instructor, [])).statusCode).toBe(403);
    expect((await put(randomUUID(), manager, [])).statusCode).toBe(404);
  });
});

describe('pacotes: publicar, arquivar e excluir', () => {
  it('publicar exige um item; pacote publicado não fica vazio; despublicar volta a rascunho', async () => {
    const bundle = await newBundle(manager);
    const course = await newCourse(manager);
    const url = `/api/v1/bundles/${bundle.id}`;
    const empty = await post(`${url}/publish`, manager);
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toMatchObject({ code: 'bundle_has_no_items' });

    const items = (list: object[]) =>
      call({ method: 'PUT', url: `${url}/items`, as: manager, payload: { items: list } });
    await items([{ productType: 'course', productId: course.id }]);
    const published = await post(`${url}/publish`, manager);
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published', itemCount: 1 });
    expect(await auditOf(test, bundle.id, 'bundle.publish')).toHaveLength(1);

    const emptied = await items([]);
    expect(emptied.statusCode).toBe(422);
    expect(emptied.json()).toMatchObject({ code: 'bundle_has_no_items' });

    const draft = await post(`${url}/unpublish`, manager);
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({ status: 'draft' });
  });

  it('arquivar e desarquivar: só admin, idempotentes; arquivado não publica', async () => {
    const bundle = await newBundle(manager);
    const url = `/api/v1/bundles/${bundle.id}`;
    expect((await post(`${url}/archive`, manager)).statusCode).toBe(403);
    const archived = await post(`${url}/archive`, admin);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().archivedAt).not.toBeNull();
    expect((await post(`${url}/archive`, admin)).json().archivedAt).toBe(
      archived.json().archivedAt,
    );
    const publish = await post(`${url}/publish`, manager);
    expect(publish.statusCode).toBe(422);
    expect(publish.json()).toMatchObject({ code: 'product_archived' });

    expect((await post(`${url}/unarchive`, manager)).statusCode).toBe(403);
    const back = await post(`${url}/unarchive`, admin);
    expect(back.statusCode).toBe(200);
    expect(back.json()).toMatchObject({ archivedAt: null, status: 'draft' });
  });

  it('exclui o pacote sem vínculos; com direito associado: 409 product_has_links', async () => {
    const bundle = await newBundle(manager);
    const url = `/api/v1/bundles/${bundle.id}`;
    expect((await call({ method: 'DELETE', url, as: instructor })).statusCode).toBe(403);
    const removed = await call({ method: 'DELETE', url, as: manager });
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
    expect(await auditOf(test, bundle.id, 'bundle.delete')).toHaveLength(1);
    expect((await call({ method: 'GET', url, as: manager })).statusCode).toBe(404);

    const sold = await newBundle(manager);
    await grant('bundle', sold.id);
    const refused = await call({ method: 'DELETE', url: `/api/v1/bundles/${sold.id}`, as: admin });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'product_has_links' });
  });
});

describe('respostas conferem com o contrato', () => {
  it('nenhuma chamada deste arquivo gerou resposta fora do esquema', () => {
    const errors = test.lines.filter((line) => line.level === 'error');
    expect(errors).toEqual([]);
    // Status que a rota devolve e o contrato ainda não declara (tarefa 660, do arquiteto): o
    // cliente recebe o erro certo e a base só avisa. Qualquer outro aviso é divergência nova.
    const undeclared = test.lines
      .filter((line) => String(line.msg ?? '').includes('contrato não declara'))
      .map((line) => `${line.operation} ${line.status}`);
    expect([...new Set(undeclared)]).toEqual(['setEbookTargets 422']);
  });
});
