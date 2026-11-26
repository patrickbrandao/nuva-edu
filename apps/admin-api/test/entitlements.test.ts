import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, type CallOptions, callAs, createActor, deniedBy } from './actors.ts';
import { createTestApp, type TestApp } from './helpers.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

let admin: Actor;
let manager: Actor;
let instructor: Actor;

beforeAll(async () => {
  [admin, manager, instructor] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
  ]);
});

const call = (options: CallOptions) => callAs(test, options);

const uniqueTitle = (prefix: string) => `${prefix} ${randomUUID()}`;

async function create(url: string, as: Actor, payload: object) {
  const response = await call({ method: 'POST', url, as, payload });
  expect(response.statusCode).toBe(201);
  return response.json();
}

const newCourse = () => create('/api/v1/courses', manager, { title: uniqueTitle('Curso') });
const newEbook = () => create('/api/v1/ebooks', manager, { title: uniqueTitle('Ebook') });

/** Pacote com um curso e um ebook: a concessão dele gera dois derivados. */
async function bundleWithItems() {
  const [course, ebook] = await Promise.all([newCourse(), newEbook()]);
  const bundle = await create('/api/v1/bundles', manager, { title: uniqueTitle('Pacote') });
  const items = await call({
    method: 'PUT',
    url: `/api/v1/bundles/${bundle.id}/items`,
    as: manager,
    payload: {
      items: [
        { productType: 'course', productId: course.id },
        { productType: 'ebook', productId: ebook.id },
      ],
    },
  });
  expect(items.statusCode).toBe(200);
  return { bundle, course, ebook };
}

const grant = (as: Actor, userId: string, payload: object, csrf?: null) =>
  call({
    method: 'POST',
    url: `/api/v1/users/${userId}/entitlements`,
    as,
    payload,
    ...(csrf === null ? { csrf } : {}),
  });

const revoke = (as: Actor, id: string, payload: object = { reason: 'Engano' }) =>
  call({ method: 'POST', url: `/api/v1/entitlements/${id}/revoke`, as, payload });

const tree = (as: Actor, userId: string) =>
  call({ method: 'GET', url: `/api/v1/users/${userId}/entitlements`, as });

const productList = (as: Actor, type: string, id: string, query = '') =>
  call({ method: 'GET', url: `/api/v1/products/${type}/${id}/entitlements${query}`, as });

/** Registros de sucesso de uma ação cujo detalhe cita o direito. */
async function auditFor(action: string, entitlementId: string) {
  const rows = await test.db
    .selectFrom('auditLog')
    .selectAll()
    .where('action', '=', action)
    .where('outcome', '=', 'ok')
    .execute();
  return rows.filter(
    (row) => (row.details as { entitlementId?: string }).entitlementId === entitlementId,
  );
}

/**
 * Tarefas `notify` do `access.granted` na fila para o aluno. O aviso sai pela central
 * (spec 024): `grantEntitlement` enfileira uma tarefa por destinatário e a linha de
 * `email_outbox` só nasce quando o worker entrega.
 */
const accessNotices = async (userId: string) => {
  const rows = await test.db
    .selectFrom('jobs')
    .select(['id', 'payload'])
    .where('type', '=', 'notify')
    .execute();
  return rows.filter((row) => {
    const payload = row.payload as { type?: string; userId?: string };
    return payload.type === 'access.granted' && payload.userId === userId;
  });
};

describe('concessão manual', () => {
  it('gerente concede um pacote: 201 com a cascata, auditoria e aviso ao aluno; repetir responde 200 sem gravar', async () => {
    const student = await createActor(test, 'student');
    const { bundle, course, ebook } = await bundleWithItems();
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

    const response = await grant(manager, student.id, {
      productType: 'bundle',
      productId: bundle.id,
      expiresAt,
      reason: '  Bolsa de estudos  ',
    });
    expect(response.statusCode).toBe(201);
    const node = response.json();
    expect(node).toMatchObject({
      product: { type: 'bundle', id: bundle.id, title: bundle.title },
      source: 'grant',
      sourceId: manager.id,
      parentEntitlementId: null,
      state: 'active',
      expiresAt,
      revokedAt: null,
      revokeReason: null,
      grantedReason: 'Bolsa de estudos',
      grantedBy: { id: manager.id },
    });
    expect(
      node.children.map((child: { product: { id: string } }) => child.product.id).sort(),
    ).toEqual([course.id, ebook.id].sort());
    for (const child of node.children) {
      expect(child).toMatchObject({
        source: 'cascade',
        parentEntitlementId: node.id,
        state: 'active',
        grantedBy: null,
      });
    }

    const audit = await auditFor('entitlement.grant', node.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: manager.id, targetId: student.id });
    expect(audit[0]?.details).toMatchObject({ reason: 'Bolsa de estudos', productId: bundle.id });

    const notices = await accessNotices(student.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toMatchObject({
      type: 'access.granted',
      userId: student.id,
      actorId: null,
      targetType: 'bundle',
      targetId: bundle.id,
      data: { productType: 'bundle', productTitle: bundle.title },
    });

    // A mesma concessão (usuário, quem concede, produto), ainda ativa: nada novo.
    const again = await grant(manager, student.id, {
      productType: 'bundle',
      productId: bundle.id,
      reason: 'De novo',
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(node);
    expect(await auditFor('entitlement.grant', node.id)).toHaveLength(1);
    expect(await accessNotices(student.id)).toHaveLength(1);

    // Outro membro da equipe concede o mesmo produto: é outra raiz.
    const other = await grant(admin, student.id, {
      productType: 'bundle',
      productId: bundle.id,
      expiresAt: null,
      reason: 'Cortesia',
    });
    expect(other.statusCode).toBe(201);
    expect(other.json()).toMatchObject({ sourceId: admin.id, expiresAt: null });
    expect(other.json().id).not.toBe(node.id);

    // Árvore do usuário: as duas raízes, a mais recente primeiro, com os derivados.
    const listed = await tree(manager, student.id);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([
      other.json().id,
      node.id,
    ]);
    expect(listed.json().items[1]).toEqual(node);
  });

  it('instrutor recebe 403 nas quatro rotas, com a negação na auditoria', async () => {
    const student = await createActor(test, 'student');
    const course = await newCourse();
    const granted = await grant(manager, student.id, {
      productType: 'course',
      productId: course.id,
      reason: 'Teste',
    });
    expect(granted.statusCode).toBe(201);

    const responses = await Promise.all([
      grant(instructor, student.id, {
        productType: 'course',
        productId: course.id,
        reason: 'Teste',
      }),
      revoke(instructor, granted.json().id),
      tree(instructor, student.id),
      productList(instructor, 'course', course.id),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'permission_denied' });
    }
    const denied = await deniedBy(test, instructor.id);
    expect(denied).toHaveLength(4);
    for (const row of denied) {
      expect(row.details).toMatchObject({ permission: 'entitlement.manage' });
    }
    // Nada foi gravado: o direito continua ativo e só há a concessão do gerente.
    const listed = await tree(manager, student.id);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0]).toMatchObject({ state: 'active', sourceId: manager.id });
  });

  it('validade no passado: 422; produto ou usuário inexistente: 404; fora do contrato: 400; sem CSRF: 403; sem sessão: 401', async () => {
    const student = await createActor(test, 'student');
    const course = await newCourse();
    const valid = { productType: 'course', productId: course.id, reason: 'Teste' };

    const past = await grant(manager, student.id, {
      ...valid,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.statusCode).toBe(422);
    expect(past.json()).toMatchObject({ code: 'expires_at_in_past' });

    const noProduct = await grant(manager, student.id, { ...valid, productId: randomUUID() });
    expect(noProduct.statusCode).toBe(404);
    const noUser = await grant(manager, randomUUID(), valid);
    expect(noUser.statusCode).toBe(404);
    expect((await tree(manager, randomUUID())).statusCode).toBe(404);

    for (const payload of [
      { productType: 'course', productId: course.id },
      { ...valid, reason: '' },
      { ...valid, productType: 'plan' },
      { ...valid, expiresAt: 'amanhã' },
      { ...valid, extra: true },
    ]) {
      expect((await grant(manager, student.id, payload)).statusCode).toBe(400);
    }
    expect((await grant(manager, 'nao-e-uuid', valid)).statusCode).toBe(400);

    const noCsrf = await grant(manager, student.id, valid, null);
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });

    const anonymous = await test.app.inject({
      method: 'GET',
      url: `/api/v1/users/${student.id}/entitlements`,
    });
    expect(anonymous.statusCode).toBe(401);

    // Nenhuma das tentativas concedeu nada nem enfileirou o aviso.
    expect((await tree(manager, student.id)).json()).toEqual({ items: [] });
    expect(await accessNotices(student.id)).toHaveLength(0);
  });
});

describe('revogação manual', () => {
  it('gerente revoga a concessão com a cascata e a auditoria; de novo: 409 entitlement_already_revoked', async () => {
    const student = await createActor(test, 'student');
    const { bundle } = await bundleWithItems();
    const granted = await grant(manager, student.id, {
      productType: 'bundle',
      productId: bundle.id,
      reason: 'Bolsa',
    });
    expect(granted.statusCode).toBe(201);
    const id = granted.json().id;

    const response = await revoke(manager, id, { reason: 'Concedido por engano' });
    expect(response.statusCode).toBe(200);
    const node = response.json();
    expect(node).toMatchObject({ id, state: 'revoked', revokeReason: 'manual' });
    expect(node.revokedAt).not.toBeNull();
    expect(node.children).toHaveLength(2);
    for (const child of node.children) {
      expect(child).toMatchObject({ state: 'revoked', revokeReason: 'manual' });
    }

    const audit = await auditFor('entitlement.revoke', id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: manager.id, targetId: student.id });
    expect(audit[0]?.details).toMatchObject({ reason: 'Concedido por engano', revokedCount: 3 });

    const again = await revoke(manager, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'entitlement_already_revoked' });
    expect(await auditFor('entitlement.revoke', id)).toHaveLength(1);

    // A árvore mostra o revogado; a concessão repetida cria outra raiz.
    expect((await tree(manager, student.id)).json().items).toEqual([node]);
    const regrant = await grant(manager, student.id, {
      productType: 'bundle',
      productId: bundle.id,
      reason: 'Agora sim',
    });
    expect(regrant.statusCode).toBe(201);
    expect(regrant.json().id).not.toBe(id);
  });

  it('raiz de pedido e direito derivado: 409 entitlement_not_revocable; inexistente: 404; sem motivo: 400', async () => {
    const student = await createActor(test, 'student');
    const { bundle } = await bundleWithItems();
    const course = await newCourse();
    const order = await test.db
      .insertInto('entitlements')
      .values({
        userId: student.id,
        productType: 'course',
        productId: course.id,
        source: 'order',
        sourceId: randomUUID(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const granted = await grant(manager, student.id, {
      productType: 'bundle',
      productId: bundle.id,
      reason: 'Bolsa',
    });
    const derived = granted.json().children[0].id;

    for (const id of [order.id, derived]) {
      const response = await revoke(manager, id);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'entitlement_not_revocable' });
      expect(await auditFor('entitlement.revoke', id)).toHaveLength(0);
    }
    expect((await revoke(manager, randomUUID())).statusCode).toBe(404);
    expect((await revoke(manager, granted.json().id, {})).statusCode).toBe(400);
    expect((await revoke(manager, granted.json().id, { reason: '' })).statusCode).toBe(400);

    // Nada mudou: pedido e concessão seguem ativos.
    const items = (await tree(manager, student.id)).json().items;
    expect(items.map((item: { state: string }) => item.state)).toEqual(['active', 'active']);
  });
});

describe('quem tem acesso a um produto', () => {
  it('lista raiz e derivado, filtra por estado e pagina por cursor', async () => {
    const { bundle, course } = await bundleWithItems();
    const [direct, viaBundle, revoked] = await Promise.all([
      createActor(test, 'student'),
      createActor(test, 'student'),
      createActor(test, 'student'),
    ]);
    const grants = await Promise.all([
      grant(manager, direct.id, { productType: 'course', productId: course.id, reason: 'A' }),
      grant(manager, viaBundle.id, { productType: 'bundle', productId: bundle.id, reason: 'B' }),
      grant(manager, revoked.id, { productType: 'course', productId: course.id, reason: 'C' }),
    ]);
    for (const response of grants) {
      expect(response.statusCode).toBe(201);
    }
    expect((await revoke(manager, grants[2]?.json().id)).statusCode).toBe(200);

    const active = await productList(admin, 'course', course.id);
    expect(active.statusCode).toBe(200);
    const page = active.json();
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(2);
    const byUser = new Map<string, Record<string, unknown>>(
      page.items.map((item: { user: { id: string } }) => [item.user.id, item]),
    );
    expect(byUser.get(direct.id)).toMatchObject({
      source: 'grant',
      via: null,
      state: 'active',
      user: { id: direct.id, name: 'Pessoa de Teste', avatarUrl: null },
    });
    expect(byUser.get(viaBundle.id)).toMatchObject({
      source: 'cascade',
      via: { type: 'bundle', id: bundle.id, title: bundle.title },
      state: 'active',
    });

    const revokedList = await productList(admin, 'course', course.id, '?state=revoked');
    expect(revokedList.statusCode).toBe(200);
    expect(revokedList.json().items).toHaveLength(1);
    expect(revokedList.json().items[0]).toMatchObject({
      user: { id: revoked.id },
      state: 'revoked',
    });
    expect(revokedList.json().items[0].revokedAt).not.toBeNull();

    const first = await productList(admin, 'course', course.id, '?limit=1');
    expect(first.json().items).toHaveLength(1);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await productList(
      admin,
      'course',
      course.id,
      `?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().nextCursor).toBeNull();
    expect([first.json().items[0].id, second.json().items[0].id].sort()).toEqual(
      page.items.map((item: { id: string }) => item.id).sort(),
    );
  });

  it('produto inexistente: 404; tipo, estado, limite e cursor inválidos: 400', async () => {
    const course = await newCourse();
    expect((await productList(manager, 'course', randomUUID())).statusCode).toBe(404);
    for (const [type, query] of [
      ['plan', ''],
      ['course', '?state=paused'],
      ['course', '?limit=0'],
      ['course', '?limit=101'],
      ['course', '?cursor=nao-e-cursor'],
    ] as const) {
      expect((await productList(manager, type, course.id, query)).statusCode).toBe(400);
    }
    expect((await productList(manager, 'course', course.id)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
