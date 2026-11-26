import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  countOpenSubscriptions,
  createDatabase,
  createPlan,
  type Database,
  findPlan,
  findPublicPlan,
  getPlan,
  listPlans,
  listPlansCoveringProduct,
  listPublicPlans,
  setPlanItems,
  updatePlan,
} from '../../src/index.ts';
import { makeCourse } from '../sales/fixtures.ts';
import {
  CURRENCY,
  expectError,
  first,
  makePlan,
  makeProvider,
  makeStaff,
  makeSubscriber,
  staffRequest,
  type TestUser,
} from './fixtures.ts';

// Planos e vitrine (spec 012, "Planos" e "Planos 'tudo, inclusive futuros'").

let testDb: TestDatabase;
let db: Database;
let admin: TestUser;
let manager: TestUser;
let student: TestUser;

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 4 });
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

beforeEach(async () => {
  admin = await makeStaff(db, 'admin');
  manager = await makeStaff(db, 'manager');
  student = await makeSubscriber(db);
});

/** Tarefas `entitlement.recompute` do plano na fila. */
async function planRecalculations(planId: string): Promise<number> {
  const rows = await db
    .selectFrom('jobs')
    .select(['payload'])
    .where('type', '=', 'entitlement.recompute')
    .execute();
  return rows.filter((row) => (row.payload as { productId?: string }).productId === planId).length;
}

/** Erro de regra do plano com `errors` apontando o campo do corpo recusado (contrato). */
async function expectPlanError(
  promise: Promise<unknown>,
  code: string,
  path: string,
): Promise<void> {
  const error = await expectError(promise, 422, code);
  expect((error as { errors?: { path: string }[] }).errors).toContainEqual(
    expect.objectContaining({ path }),
  );
}

describe('criar e ler planos', () => {
  it('admin cria com itens, slug gerado de group_key/interval, e o manager não cria', async () => {
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      groupKey: 'completo',
      interval: 'year',
      title: 'Completo anual',
      items: [{ productType: 'course', productId: courseId }],
    });
    expect(plan.slug).toBe('completo-year');

    const loaded = await getPlan(db, staffRequest(admin), plan.id);
    expect(loaded).toMatchObject({
      groupKey: 'completo',
      interval: 'year',
      priceCents: 9_900,
      active: true,
      subscriptionCount: 0,
    });
    expect(loaded.items).toEqual([
      { productType: 'course', productId: courseId, title: expect.any(String) },
    ]);

    await expectError(getPlan(db, staffRequest(manager), plan.id), 403, 'permission_denied');
    await expectError(
      getPlan(db, staffRequest(admin), '00000000-0000-4000-8000-000000000000'),
      404,
      'not_found',
    );
  });

  it('recusa slug repetido e grupo com a mesma periodicidade', async () => {
    const created = await makePlan(db, admin, { groupKey: 'anual', interval: 'year' });
    await expectError(
      makePlan(db, admin, { groupKey: 'outro', interval: 'month', slug: created.slug }),
      409,
      'plan_slug_taken',
    );
    await expectError(
      makePlan(db, admin, { groupKey: 'anual', interval: 'year', slug: 'anual-year-2' }),
      409,
      'plan_group_conflict',
    );
    // Mesmo grupo, outra periodicidade: permitido (alternância mensal/anual).
    const monthly = await makePlan(db, admin, { groupKey: 'anual', interval: 'month' });
    expect(monthly.id).not.toBe(created.id);
  });

  it('recusa entrada inválida, as regras do plano e o item repetido', async () => {
    await expectPlanError(
      makePlan(db, admin, { includesPrivate: true }),
      'plan_invalid',
      'body.includesPrivate',
    );
    await expectError(makePlan(db, admin, { priceCents: 0 }), 400, 'validation_failed');
    const courseId = await makeCourse(db);
    await expectPlanError(
      makePlan(db, admin, {
        includesAll: true,
        items: [{ productType: 'course', productId: courseId }],
      }),
      'plan_invalid',
      'body.items',
    );
    await expectError(
      makePlan(db, admin, {
        items: [{ productType: 'course', productId: '00000000-0000-4000-8000-000000000000' }],
      }),
      422,
      'plan_item_invalid',
    );
    // Item repetido é recusado, não deduplicado (contrato de `POST /plans`).
    await expectError(
      makePlan(db, admin, {
        items: [
          { productType: 'course', productId: courseId },
          { productType: 'course', productId: courseId },
        ],
      }),
      422,
      'plan_item_invalid',
    );
    // Regressão dos válidos: lista sem repetição e plano "tudo" com a lista vazia.
    const valid = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    expect((await findPlan(db, valid.id))?.items.map((item) => item.productId)).toEqual([courseId]);
    const all = await makePlan(db, admin, { groupKey: 'tudo-valido', includesAll: true });
    expect((await findPlan(db, all.id))?.items).toEqual([]);
  });

  it('lista com filtros e paginação por position', async () => {
    const a = await makePlan(db, admin, {
      groupKey: 'vitrine-a',
      title: 'Paginação Alfa',
      position: 1,
    });
    const b = await makePlan(db, admin, {
      groupKey: 'vitrine-b',
      title: 'Paginação Beta',
      position: 2,
    });
    await makePlan(db, admin, {
      groupKey: 'vitrine-c',
      title: 'Paginação Gama',
      active: false,
      position: 3,
    });

    const all = await listPlans(db, staffRequest(admin), { groupKey: 'vitrine-a' });
    expect(all.items.map((plan) => plan.id)).toEqual([a.id]);

    const active = await listPlans(db, staffRequest(admin), {
      q: 'Paginação',
      active: true,
      limit: 1,
    });
    expect(active.items).toHaveLength(1);
    expect(active.nextCursor).not.toBeNull();
    const next = await listPlans(db, staffRequest(admin), {
      q: 'Paginação',
      active: true,
      limit: 1,
      cursor: active.nextCursor,
    });
    expect(next.items).toHaveLength(1);
    expect([active.items[0]?.id, next.items[0]?.id].sort()).toEqual([a.id, b.id].sort());

    const search = await listPlans(db, staffRequest(admin), { q: 'Beta' });
    expect(search.items.map((plan) => plan.id)).toEqual([b.id]);

    await expectError(
      listPlans(db, staffRequest(admin), { interval: 'semana' }),
      400,
      'validation_failed',
    );
  });

  it('vitrine agrupa por grupo, ordena mensal antes do anual e esconde inativos/private', async () => {
    const published = await makeCourse(db);
    const draft = await makeCourse(db, { published: false });
    const plan = await makePlan(db, admin, {
      groupKey: 'vitrine-grupo',
      interval: 'year',
      items: [
        { productType: 'course', productId: published },
        { productType: 'course', productId: draft },
      ],
    });
    await makePlan(db, admin, { groupKey: 'vitrine-grupo', interval: 'month', active: false });

    const groups = await listPublicPlans(db);
    const group = first(groups.filter((entry) => entry.groupKey === 'vitrine-grupo'));
    expect(group.plans.map((entry) => entry.interval)).toEqual(['year']);
    const publicPlan = first(group.plans);
    expect(publicPlan.id).toBe(plan.id);
    // O curso em rascunho não aparece na vitrine.
    expect(publicPlan.items.map((item) => item.productId)).toEqual([published]);
    expect(publicPlan).not.toHaveProperty('includesPrivate');

    const detail = await findPublicPlan(db, plan.id);
    expect(detail?.items.map((item) => item.productId)).toEqual([published]);
  });

  it('plano "tudo" lista os produtos publicados e não tem itens explícitos', async () => {
    const course = await makeCourse(db);
    const plan = await makePlan(db, admin, { groupKey: 'tudo', includesAll: true });
    const loaded = await findPlan(db, plan.id);
    expect(loaded?.includesAll).toBe(true);
    expect(loaded?.items).toEqual([]);
    const covering = await listPlansCoveringProduct(db, 'course', course);
    expect(covering).toContain(plan.id);
  });
});

describe('editar plano', () => {
  async function subscribeDirect(planId: string): Promise<void> {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-02-01T00:00:00Z');
    await db
      .insertInto('subscriptions')
      .values({
        userId: student.id,
        planId,
        status: 'active',
        priceCents: 9_900,
        currency: 'BRL',
        provider: 'fake',
        currentPeriodStart: start,
        currentPeriodEnd: end,
      })
      .execute();
  }

  it('mudar preço preserva o preço contratado e não enfileira recálculo', async () => {
    const plan = await makePlan(db, admin, { priceCents: 9_900 });
    await subscribeDirect(plan.id);

    const updated = await updatePlan(db, staffRequest(admin), plan.id, { priceCents: 12_900 });
    expect(updated.priceCents).toBe(12_900);

    const subscription = await db
      .selectFrom('subscriptions')
      .select(['priceCents'])
      .where('planId', '=', plan.id)
      .executeTakeFirstOrThrow();
    expect(Number(subscription.priceCents)).toBe(9_900);
    expect(await planRecalculations(plan.id)).toBe(0);
    expect(await countOpenSubscriptions(db, plan.id)).toBe(1);
  });

  it('ligar "tudo" limpa os itens e enfileira o recálculo das assinaturas', async () => {
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    const updated = await updatePlan(db, staffRequest(admin), plan.id, {
      includesAll: true,
      includesPrivate: true,
    });
    expect(updated.includesAll).toBe(true);
    expect(updated.includesPrivate).toBe(true);
    expect(updated.items).toEqual([]);
    expect(await planRecalculations(plan.id)).toBe(1);
  });

  it('troca itens, recusa repetido e plano "tudo", e recalcula só quando muda', async () => {
    const courseA = await makeCourse(db);
    const courseB = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseA }],
    });
    const changed = await setPlanItems(db, staffRequest(admin), plan.id, [
      { productType: 'course', productId: courseB },
    ]);
    expect(changed.items.map((item) => item.productId)).toEqual([courseB]);
    expect(await planRecalculations(plan.id)).toBe(1);

    // Repetir a mesma lista não cria outra tarefa.
    await setPlanItems(db, staffRequest(admin), plan.id, [
      { productType: 'course', productId: courseB },
    ]);
    expect(await planRecalculations(plan.id)).toBe(1);

    // Item repetido é recusado, não deduplicado (contrato de `PUT /plans/{id}/items`).
    await expectError(
      setPlanItems(db, staffRequest(admin), plan.id, [
        { productType: 'course', productId: courseB },
        { productType: 'course', productId: courseB },
      ]),
      422,
      'plan_item_invalid',
    );
    expect((await findPlan(db, plan.id))?.items.map((item) => item.productId)).toEqual([courseB]);

    const all = await makePlan(db, admin, { groupKey: 'tudo-itens', includesAll: true });
    await expectPlanError(
      setPlanItems(db, staffRequest(admin), all.id, [
        { productType: 'course', productId: courseA },
      ]),
      'plan_invalid',
      'body.items',
    );
  });

  it('PATCH recusa `includesPrivate` sem `includesAll` como `422 plan_invalid`', async () => {
    const plan = await makePlan(db, admin);
    await expectPlanError(
      updatePlan(db, staffRequest(admin), plan.id, { includesPrivate: true }),
      'plan_invalid',
      'body.includesPrivate',
    );
    // Regressão: ligar os dois juntos continua valendo.
    const updated = await updatePlan(db, staffRequest(admin), plan.id, {
      includesAll: true,
      includesPrivate: true,
    });
    expect(updated).toMatchObject({ includesAll: true, includesPrivate: true });
  });
});

describe('plano no provedor', () => {
  it('cria no provedor e distingue planos locais de mesmo título e preço', async () => {
    const provider = makeProvider();
    const options = { provider, currency: CURRENCY };
    const title = 'Plano idêntico';
    const a = await createPlan(
      db,
      staffRequest(admin),
      { groupKey: 'identico-a', slug: 'identico-a', title, interval: 'month', priceCents: 9_900 },
      options,
    );
    const b = await createPlan(
      db,
      staffRequest(admin),
      { groupKey: 'identico-b', slug: 'identico-b', title, interval: 'month', priceCents: 9_900 },
      options,
    );
    expect(a.providerPlanId).toMatch(/^fake_plan_/);
    expect(b.providerPlanId).toMatch(/^fake_plan_/);
    expect(a.providerPlanId).not.toBe(b.providerPlanId);
  });

  it('provedor fora do ar não impede o plano; mudar o preço cria outro plano no provedor', async () => {
    const provider = makeProvider();
    provider.setUnavailable(true, ['ensurePlan']);
    const created = await createPlan(
      db,
      staffRequest(admin),
      {
        groupKey: 'provedor-fora',
        slug: 'provedor-fora',
        title: 'Provedor fora',
        interval: 'month',
        priceCents: 9_900,
      },
      { provider, currency: CURRENCY },
    );
    expect(created.providerPlanId).toBeNull();

    provider.setUnavailable(false);
    const updated = await updatePlan(
      db,
      staffRequest(admin),
      created.id,
      { priceCents: 12_900 },
      { provider, currency: CURRENCY },
    );
    expect(updated.providerPlanId).toMatch(/^fake_plan_/);

    // Sem provedor, editar o preço não toca no identificador do provedor.
    const noProvider = await updatePlan(db, staffRequest(admin), created.id, {
      priceCents: 13_900,
    });
    expect(noProvider.providerPlanId).toBe(updated.providerPlanId);
  });
});
