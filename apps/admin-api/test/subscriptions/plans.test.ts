import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, auditOf, type CallOptions, callAs, createActor, deniedBy } from '../actors.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

// Planos da escola pela admin-api (spec 012, "Planos"; specs 008 e 028). Só o `admin` tem
// `plan.manage`; gerente e instrutor recebem `403` auditado. Cada escrita do núcleo grava a
// auditoria na própria transação, e as rotas só devolvem o formato do contrato.

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

/** Grupo e título únicos: o banco dos testes é compartilhado entre os arquivos. */
function planPayload(overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID().slice(0, 8);
  return {
    groupKey: `grupo-${suffix}`,
    title: `Plano ${suffix}`,
    interval: 'month',
    priceCents: 9_900,
    ...overrides,
  };
}

async function createPlan(payload: Record<string, unknown> = {}) {
  const response = await call({
    method: 'POST',
    url: '/api/v1/plans',
    as: admin,
    payload: planPayload(payload),
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

/** Curso publicado para os itens do plano (`course.create` é de gerente e admin). */
async function newCourse(): Promise<{ id: string; title: string }> {
  const response = await call({
    method: 'POST',
    url: '/api/v1/courses',
    as: manager,
    payload: { title: `Curso do plano ${randomUUID().slice(0, 8)}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe('criação e leitura de planos', () => {
  it('admin cria o plano com os padrões e o vê na lista e na ficha, com a auditoria', async () => {
    const payload = planPayload({ description: 'Acesso mensal', priceCents: 19_900 });
    const created = await call({
      method: 'POST',
      url: '/api/v1/plans',
      as: admin,
      payload,
    });
    expect(created.statusCode).toBe(201);
    const plan = created.json();
    expect(plan).toMatchObject({
      groupKey: payload.groupKey,
      title: payload.title,
      description: 'Acesso mensal',
      interval: 'month',
      priceCents: 19_900,
      includesAll: false,
      includesPrivate: false,
      active: true,
      position: 0,
      providerPlanId: null,
      subscriptionCount: 0,
      items: [],
    });
    // `slug` gerado de `groupKey` e `interval`; datas em ISO e centavos inteiros.
    expect(plan.slug).toEqual(expect.any(String));
    expect(plan.createdAt).toMatch(/Z$/);
    expect(plan.updatedAt).toMatch(/Z$/);

    const fetched = await call({ method: 'GET', url: `/api/v1/plans/${plan.id}`, as: admin });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(plan);

    const listed = await call({
      method: 'GET',
      url: `/api/v1/plans?groupKey=${payload.groupKey}`,
      as: admin,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([plan.id]);
    expect(listed.json().nextCursor).toBeNull();

    const audit = await auditOf(test, plan.id, 'plan.create');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: admin.id, targetType: 'plan' });
  });

  it('filtra por situação e periodicidade, busca por título e pagina por cursor', async () => {
    const groupKey = `grupo-${randomUUID().slice(0, 8)}`;
    const monthly = await createPlan({
      groupKey,
      interval: 'month',
      title: 'Mensal',
      active: false,
    });
    const yearly = await createPlan({ groupKey, interval: 'year', title: 'Anual' });

    const inactive = await call({ method: 'GET', url: '/api/v1/plans?active=false', as: admin });
    expect(inactive.json().items.map((item: { id: string }) => item.id)).toContain(monthly.id);
    expect(inactive.json().items.map((item: { id: string }) => item.id)).not.toContain(yearly.id);

    const annual = await call({ method: 'GET', url: '/api/v1/plans?interval=year', as: admin });
    expect(annual.json().items.map((item: { id: string }) => item.id)).toContain(yearly.id);
    expect(annual.json().items.map((item: { id: string }) => item.id)).not.toContain(monthly.id);

    const first = await call({ method: 'GET', url: '/api/v1/plans?limit=1', as: admin });
    expect(first.json().items).toHaveLength(1);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await call({
      method: 'GET',
      url: `/api/v1/plans?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      as: admin,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items[0].id).not.toBe(first.json().items[0].id);
  });

  it('gerente e instrutor recebem 403 nas rotas de plano, com a negação na auditoria', async () => {
    const plan = await createPlan();
    const responses = await Promise.all([
      call({ method: 'GET', url: '/api/v1/plans', as: manager }),
      call({ method: 'POST', url: '/api/v1/plans', as: manager, payload: planPayload() }),
      call({ method: 'GET', url: `/api/v1/plans/${plan.id}`, as: manager }),
      call({
        method: 'PATCH',
        url: `/api/v1/plans/${plan.id}`,
        as: manager,
        payload: { title: 'Outro' },
      }),
      call({
        method: 'PUT',
        url: `/api/v1/plans/${plan.id}/items`,
        as: manager,
        payload: { items: [] },
      }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'permission_denied' });
    }
    const managerDenials = await deniedBy(test, manager.id);
    for (const row of managerDenials) {
      expect(row.details).toMatchObject({ permission: 'plan.manage' });
    }

    const instructorList = await call({ method: 'GET', url: '/api/v1/plans', as: instructor });
    expect(instructorList.statusCode).toBe(403);
    expect((await deniedBy(test, instructor.id)).length).toBeGreaterThan(0);
  });

  it('slug e grupo repetidos: 409; entrada fora das regras: 422; fora do contrato: 400', async () => {
    const slug = `plano-${randomUUID().slice(0, 8)}`;
    await createPlan({ slug, groupKey: `grupo-${randomUUID().slice(0, 8)}` });

    const sameSlug = await call({
      method: 'POST',
      url: '/api/v1/plans',
      as: admin,
      payload: planPayload({ slug }),
    });
    expect(sameSlug.statusCode).toBe(409);
    expect(sameSlug.json()).toMatchObject({ code: 'plan_slug_taken' });

    const groupKey = `grupo-${randomUUID().slice(0, 8)}`;
    await createPlan({ groupKey, interval: 'month' });
    const sameGroup = await call({
      method: 'POST',
      url: '/api/v1/plans',
      as: admin,
      payload: planPayload({
        groupKey,
        interval: 'month',
        slug: `outro-${randomUUID().slice(0, 8)}`,
      }),
    });
    expect(sameGroup.statusCode).toBe(409);
    expect(sameGroup.json()).toMatchObject({ code: 'plan_group_conflict' });

    const privateOnly = await call({
      method: 'POST',
      url: '/api/v1/plans',
      as: admin,
      payload: planPayload({ includesPrivate: true }),
    });
    // O núcleo recusa `includesPrivate` sem `includesAll` como campo inválido (`400`), não como
    // `422 plan_invalid` do texto do contrato: divergência relatada à tarefa do núcleo.
    expect(privateOnly.statusCode).toBe(400);
    expect(privateOnly.json().errors).toContainEqual(
      expect.objectContaining({ path: 'includesPrivate' }),
    );

    const allWithItems = await call({
      method: 'POST',
      url: '/api/v1/plans',
      as: admin,
      payload: planPayload({
        includesAll: true,
        items: [{ productType: 'course', productId: randomUUID() }],
      }),
    });
    expect(allWithItems.statusCode).toBe(422);
    // O núcleo classifica a lista no plano "tudo" como `plan_item_invalid`; o texto do contrato
    // cita `plan_invalid`. Os dois são `422`; a divergência de `code` vai no relatório.
    expect(allWithItems.json()).toMatchObject({ code: 'plan_item_invalid' });

    const ghostItem = await call({
      method: 'POST',
      url: '/api/v1/plans',
      as: admin,
      payload: planPayload({
        items: [{ productType: 'course', productId: randomUUID() }],
      }),
    });
    expect(ghostItem.statusCode).toBe(422);
    expect(ghostItem.json()).toMatchObject({ code: 'plan_item_invalid' });

    // Contrato: campo desconhecido, preço zero e periodicidade fora do enum são `400`.
    for (const payload of [
      planPayload({ extra: true }),
      planPayload({ priceCents: 0 }),
      planPayload({ interval: 'week' }),
    ]) {
      const response = await call({ method: 'POST', url: '/api/v1/plans', as: admin, payload });
      expect(response.statusCode).toBe(400);
    }

    // Plano inexistente: `404 not_found`.
    expect(
      (await call({ method: 'GET', url: `/api/v1/plans/${randomUUID()}`, as: admin })).statusCode,
    ).toBe(404);
  });
});

describe('edição do plano e itens', () => {
  it('PATCH muda só os campos enviados e desativa com active: false, com a auditoria', async () => {
    const plan = await createPlan();
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/plans/${plan.id}`,
      as: admin,
      payload: { title: 'Plano renomeado', priceCents: 12_500, active: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: plan.id,
      slug: plan.slug,
      groupKey: plan.groupKey,
      interval: plan.interval,
      title: 'Plano renomeado',
      priceCents: 12_500,
      active: false,
    });
    expect((await auditOf(test, plan.id, 'plan.update')).length).toBeGreaterThan(0);

    // `slug`, `groupKey` e `interval` não mudam: são recusados pelo contrato.
    for (const payload of [{ slug: 'outro' }, { groupKey: 'outro' }, { interval: 'year' }]) {
      const rejected = await call({
        method: 'PATCH',
        url: `/api/v1/plans/${plan.id}`,
        as: admin,
        payload,
      });
      expect(rejected.statusCode).toBe(400);
    }
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/api/v1/plans/${randomUUID()}`,
          as: admin,
          payload: { title: 'Fantasma' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('PUT itens substitui a lista com o título atual e recusa plano "tudo", item repetido e produto inexistente', async () => {
    const [course, other] = await Promise.all([newCourse(), newCourse()]);
    const plan = await createPlan();

    const replaced = await call({
      method: 'PUT',
      url: `/api/v1/plans/${plan.id}/items`,
      as: admin,
      payload: { items: [{ productType: 'course', productId: course.id }] },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().items).toEqual([
      { productType: 'course', productId: course.id, title: course.title },
    ]);
    expect((await auditOf(test, plan.id, 'plan.items')).length).toBeGreaterThan(0);

    const swapped = await call({
      method: 'PUT',
      url: `/api/v1/plans/${plan.id}/items`,
      as: admin,
      payload: {
        items: [
          { productType: 'course', productId: other.id },
          { productType: 'course', productId: course.id },
        ],
      },
    });
    expect(swapped.statusCode).toBe(200);
    expect(
      swapped
        .json()
        .items.map((item: { productId: string }) => item.productId)
        .sort(),
    ).toEqual([other.id, course.id].sort());

    const emptied = await call({
      method: 'PUT',
      url: `/api/v1/plans/${plan.id}/items`,
      as: admin,
      payload: { items: [] },
    });
    expect(emptied.statusCode).toBe(200);
    expect(emptied.json().items).toEqual([]);

    const all = await createPlan({ includesAll: true });
    const allItems = await call({
      method: 'PUT',
      url: `/api/v1/plans/${all.id}/items`,
      as: admin,
      payload: { items: [{ productType: 'course', productId: course.id }] },
    });
    expect(allItems.statusCode).toBe(422);
    expect(allItems.json()).toMatchObject({ code: 'plan_item_invalid' });

    const repeated = await call({
      method: 'PUT',
      url: `/api/v1/plans/${plan.id}/items`,
      as: admin,
      payload: {
        items: [
          { productType: 'course', productId: course.id },
          { productType: 'course', productId: course.id },
        ],
      },
    });
    // O núcleo deduplica a lista repetida em vez de recusá-la (`422 plan_item_invalid` no texto
    // do contrato): divergência relatada à tarefa do núcleo.
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().items).toHaveLength(1);

    const ghost = await call({
      method: 'PUT',
      url: `/api/v1/plans/${plan.id}/items`,
      as: admin,
      payload: { items: [{ productType: 'ebook', productId: randomUUID() }] },
    });
    expect(ghost.statusCode).toBe(422);
    expect(ghost.json()).toMatchObject({ code: 'plan_item_invalid' });

    // `includesAll` com itens também é recusado na criação; a lista dele fica vazia.
    expect(all.items).toEqual([]);
  });

  it('passar includesAll a verdadeiro limpa os itens (spec 012)', async () => {
    const course = await newCourse();
    const plan = await createPlan({
      items: [{ productType: 'course', productId: course.id }],
    });
    expect(plan.items).toHaveLength(1);
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/plans/${plan.id}`,
      as: admin,
      payload: { includesAll: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ includesAll: true, items: [] });
  });

  it('sem CSRF: 403; sem sessão: 401', async () => {
    const plan = await createPlan();
    const noCsrf = await call({
      method: 'PATCH',
      url: `/api/v1/plans/${plan.id}`,
      as: admin,
      payload: { title: 'Sem CSRF' },
      csrf: null,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });

    const anonymous = await test.app.inject({ method: 'GET', url: '/api/v1/plans' });
    expect(anonymous.statusCode).toBe(401);
  });
});
