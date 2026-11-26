import { randomUUID } from 'node:crypto';
import {
  FakePaymentProvider,
  type PlanInterval,
  type SubscriptionLifecycleStatus,
  saveMyBilling,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  createUser,
  isolatedDatabase,
  type Reply,
  TEST_PASSWORD,
  type TestUser,
} from '../accounts.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

// Assinatura do aluno (spec 012; tarefa 554): vitrine, criação no provedor, consulta e
// cancelamento. Banco só deste arquivo; planos, itens e produtos são gravados direto nas tabelas
// (a escrita é da admin-api) e o provedor é o `fake`, sem rede. Toda rota é chamada pelo HTTP: a
// validação de resposta do contrato roda em cada uma, inclusive nos erros.

/** Documento do comprador; nunca pode aparecer em log nem em resposta da API. */
const TAX_ID = '52998224725';
const TAX_ID_OTHER = '11144477735';
const BILLING = { fullName: 'Assinante de Teste', taxIdType: 'cpf' as const, taxId: TAX_ID };

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;
let provider: FakePaymentProvider;

const replies: Reply[] = [];
function scan(reply: Reply): void {
  replies.push(reply);
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
  expect(reply.body).not.toContain(TAX_ID);
}

const browser = () => new Browser(test.app, scan);

function slug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 13)}`;
}

interface Plan {
  id: string;
  providerPlanId: string | null;
}

async function makePlan(input: {
  title: string;
  interval: PlanInterval;
  priceCents: number;
  active?: boolean;
  groupKey?: string;
}): Promise<Plan> {
  return test.db
    .insertInto('plans')
    .values({
      slug: slug('plano'),
      groupKey: input.groupKey ?? slug('grupo'),
      title: input.title,
      interval: input.interval,
      priceCents: input.priceCents,
      active: input.active ?? true,
      position: 0,
    })
    .returning(['id', 'providerPlanId'])
    .executeTakeFirstOrThrow();
}

interface CouponSeed {
  code: string;
  kind: 'percent' | 'fixed';
  percentOff?: number;
  amountOffCents?: number;
  appliesTo?: 'orders' | 'subscriptions' | 'both';
  active?: boolean;
  endsAt?: Date;
  maxUses?: number;
  usesCount?: number;
}

let admin: TestUser;
async function makeCoupon(input: CouponSeed): Promise<string> {
  const row = await test.db
    .insertInto('coupons')
    .values({
      code: input.code,
      kind: input.kind,
      percentOff: input.percentOff ?? null,
      amountOffCents: input.amountOffCents ?? null,
      appliesTo: input.appliesTo ?? 'subscriptions',
      active: input.active ?? true,
      endsAt: input.endsAt ?? null,
      maxUses: input.maxUses ?? null,
      usesCount: input.usesCount ?? 0,
      createdBy: admin.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Aluno pronto para assinar: e-mail confirmado, dados de comprador e sessão com CSRF. */
async function subscriber(taxId = TAX_ID): Promise<{ user: TestUser; browser: Browser }> {
  const user = await createUser(test.db);
  await saveMyBilling(test.db, user.id, { ...BILLING, taxId });
  const session = browser();
  expect((await session.login(user.email)).statusCode).toBe(200);
  return { user, browser: session };
}

interface SubscriptionSeed {
  userId: string;
  planId: string;
  status: SubscriptionLifecycleStatus;
  priceCents?: number;
  createdAt: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  graceUntil?: Date;
  canceledAt?: Date;
  cancelReason?: string;
  endedAt?: Date;
  providerSubscriptionId?: string | null;
}

async function makeSubscription(input: SubscriptionSeed): Promise<string> {
  const row = await test.db
    .insertInto('subscriptions')
    .values({
      userId: input.userId,
      planId: input.planId,
      status: input.status,
      priceCents: input.priceCents ?? 9900,
      currency: 'BRL',
      provider: 'fake',
      providerSubscriptionId: input.providerSubscriptionId ?? null,
      currentPeriodStart: input.currentPeriodStart ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      graceUntil: input.graceUntil ?? null,
      canceledAt: input.canceledAt ?? null,
      cancelReason: input.cancelReason ?? null,
      endedAt: input.endedAt ?? null,
      createdAt: input.createdAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const DAY = 86_400_000;

let courseId: string;
let monthly: Plan;
let yearly: Plan;
let inactive: Plan;

beforeAll(async () => {
  database = await isolatedDatabase();
  provider = new FakePaymentProvider({ currency: 'BRL' });
  provider.setNow('2026-03-01T12:00:00.000Z');
  test = createTestApp(
    { DATABASE_URL: database.url, NUVA_PAYMENT_PROVIDER: 'fake' },
    { paymentProvider: provider },
  );

  admin = await createUser(test.db, { role: 'admin' });
  const course = await test.db
    .insertInto('courses')
    .values({
      slug: slug('curso'),
      title: 'Curso do plano',
      summary: 'Resumo',
      accessMode: 'paid',
      priceCents: 9900,
      status: 'published',
      publishedAt: new Date(),
      level: 'beginner',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  courseId = course.id;

  monthly = await makePlan({ title: 'Mensal', interval: 'month', priceCents: 9900 });
  yearly = await makePlan({ title: 'Anual', interval: 'year', priceCents: 99000 });
  inactive = await makePlan({
    title: 'Desativado',
    interval: 'month',
    priceCents: 4900,
    active: false,
  });
  await test.db
    .insertInto('planItems')
    .values({ planId: monthly.id, productType: 'course', productId: courseId })
    .execute();
});

afterAll(async () => {
  expect(test.logText()).not.toContain(TEST_PASSWORD);
  expect(test.logText()).not.toContain(TAX_ID);
  expect(test.logText()).not.toContain(TAX_ID_OTHER);
  await test.close();
  await database.drop();
});

describe('POST /subscriptions (spec 012, "Assinar")', () => {
  it('sem sessão responde 401; sem CSRF, 403', async () => {
    const anonymous = await browser().request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('unauthenticated');

    const { browser: session } = await subscriber();
    const noCsrf = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
      csrf: false,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().code).toBe('csrf_token_invalid');
  });

  it('cria a assinatura em pending e devolve a URL do checkout do provedor', async () => {
    const { user, browser: session } = await subscriber();
    const reply = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    expect(reply.statusCode).toBe(201);
    const checkout = reply.json();
    expect(checkout.checkoutUrl).toMatch(
      /^https:\/\/checkout\.payment-fake\.test\/subscriptions\/fake_subscription_\d+$/,
    );
    expect(checkout.subscription).toMatchObject({
      status: 'pending',
      priceCents: 9900,
      currency: 'BRL',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      graceUntil: null,
      nextChargeAt: null,
      canceledAt: null,
      endedAt: null,
      payments: [],
      plan: { id: monthly.id, title: 'Mensal', interval: 'month' },
    });
    expect(checkout.subscription.plan.items).toEqual([
      { productType: 'course', productId: courseId, title: 'Curso do plano' },
    ]);

    const row = await test.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('id', '=', checkout.subscription.id)
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.provider).toBe('fake');
    expect(row.providerSubscriptionId).toMatch(/^fake_subscription_/);
    const plan = await test.db
      .selectFrom('plans')
      .select('providerPlanId')
      .where('id', '=', monthly.id)
      .executeTakeFirstOrThrow();
    expect(plan.providerPlanId).not.toBeNull();
  });

  it('recusa o mesmo plano enquanto a assinatura está pendente', async () => {
    const { browser: session } = await subscriber();
    const first = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: yearly.id },
    });
    expect(first.statusCode).toBe(201);
    const again = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: yearly.id },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('subscription_already_exists');
    // Outro plano é permitido (spec 012: uma por plano).
    const other = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    expect(other.statusCode).toBe(201);
  });

  it('plano inexistente ou inativo responde 404', async () => {
    const { browser: session } = await subscriber();
    const missing = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: randomUUID() },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('not_found');
    const off = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: inactive.id },
    });
    expect(off.statusCode).toBe(404);
  });

  it('e-mail não confirmado responde 403 email_not_verified', async () => {
    const user = await createUser(test.db, { verified: false });
    const session = browser();
    expect((await session.login(user.email)).statusCode).toBe(200);
    const reply = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    expect(reply.statusCode).toBe(403);
    expect(reply.json().code).toBe('email_not_verified');
  });

  it('sem nome e CPF/CNPJ responde 409 billing_required antes de cobrar', async () => {
    const user = await createUser(test.db);
    const session = browser();
    expect((await session.login(user.email)).statusCode).toBe(200);
    const reply = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    expect(reply.statusCode).toBe(409);
    expect(reply.json().code).toBe('billing_required');
    expect(await countSubscriptions(user.id)).toBe(0);
  });

  it('cupom de assinatura vale e reduz só a primeira cobrança', async () => {
    const code = `ASSINA${randomUUID().slice(0, 6).toUpperCase()}`;
    const couponId = await makeCoupon({ code, kind: 'percent', percentOff: 10 });
    const { user, browser: session } = await subscriber();
    const reply = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id, couponCode: code.toLowerCase() },
    });
    expect(reply.statusCode).toBe(201);
    const row = await test.db
      .selectFrom('subscriptions')
      .select(['id', 'couponId', 'providerSubscriptionId'])
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.couponId).toBe(couponId);
    // O desconto chega ao provedor como valor da primeira cobrança; a recorrência é cheia.
    const first = provider.authorizeSubscription(row.providerSubscriptionId as string);
    expect(first.amountCents).toBe(8910);
    const second = provider.renewSubscription(row.providerSubscriptionId as string);
    expect(second.amountCents).toBe(9900);
  });

  it('cupom inválido responde 422 coupon_invalid', async () => {
    const expired = await makeCoupon({
      code: `EXPIRA${randomUUID().slice(0, 6)}`,
      kind: 'fixed',
      amountOffCents: 500,
      endsAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const inactiveCoupon = await makeCoupon({
      code: `INATIVO${randomUUID().slice(0, 5)}`,
      kind: 'fixed',
      amountOffCents: 500,
      active: false,
    });
    const exhausted = await makeCoupon({
      code: `ESGOTADO${randomUUID().slice(0, 4)}`,
      kind: 'fixed',
      amountOffCents: 500,
      maxUses: 1,
      usesCount: 1,
    });
    const ordersOnly = await makeCoupon({
      code: `PEDIDO${randomUUID().slice(0, 6)}`,
      kind: 'fixed',
      amountOffCents: 500,
      appliesTo: 'orders',
    });
    const { user, browser: session } = await subscriber();
    for (const couponCode of [expired, inactiveCoupon, exhausted, ordersOnly, randomUUID()]) {
      const reply = await session.request('POST', '/api/v1/subscriptions', {
        payload: { planId: monthly.id, couponCode },
      });
      expect(reply.statusCode).toBe(422);
      expect(reply.json().code).toBe('coupon_invalid');
    }
    expect(await countSubscriptions(user.id)).toBe(0);
  });

  it('provedor indisponível responde 503 e não cria assinatura', async () => {
    const { user, browser: session } = await subscriber();
    // Plano ainda sem `providerPlanId`: o `ensurePlan` é chamado no checkout.
    const fresh = await makePlan({ title: 'Sem provedor', interval: 'month', priceCents: 6900 });
    provider.setUnavailable(true, ['ensurePlan']);
    try {
      const reply = await session.request('POST', '/api/v1/subscriptions', {
        payload: { planId: fresh.id },
      });
      expect(reply.statusCode).toBe(503);
      expect(reply.json().code).toBe('payment_provider_unavailable');
      expect(await countSubscriptions(user.id)).toBe(0);
    } finally {
      provider.setUnavailable(false);
    }

    // Falha na adesão depois de gravar a linha local: a linha é desfeita.
    const plan = await makePlan({ title: 'Outro mensal', interval: 'month', priceCents: 7900 });
    provider.setUnavailable(true, ['createSubscription']);
    try {
      const reply = await session.request('POST', '/api/v1/subscriptions', {
        payload: { planId: plan.id },
      });
      expect(reply.statusCode).toBe(503);
      expect(await countSubscriptions(user.id)).toBe(0);
    } finally {
      provider.setUnavailable(false);
    }
  });
});

async function countSubscriptions(userId: string): Promise<number> {
  const row = await test.db
    .selectFrom('subscriptions')
    .select(({ fn }) => [fn.countAll<string>().as('count')])
    .where('userId', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

describe('GET /me/subscriptions (spec 012, RF-08)', () => {
  let owner: TestUser;
  let session: Browser;
  let activeId: string;
  let pastDueId: string;
  let endedId: string;
  let expiredId: string;
  const start = new Date('2026-02-01T00:00:00.000Z');
  const end = new Date('2026-03-01T00:00:00.000Z');

  beforeAll(async () => {
    const ready = await subscriber();
    owner = ready.user;
    session = ready.browser;
    activeId = await makeSubscription({
      userId: owner.id,
      planId: monthly.id,
      status: 'active',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
    pastDueId = await makeSubscription({
      userId: owner.id,
      planId: yearly.id,
      status: 'past_due',
      priceCents: 99000,
      createdAt: new Date('2026-02-02T00:00:00.000Z'),
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      graceUntil: new Date('2026-02-04T00:00:00.000Z'),
    });
    endedId = await makeSubscription({
      userId: owner.id,
      planId: yearly.id,
      status: 'ended',
      priceCents: 99000,
      createdAt: new Date('2026-02-03T00:00:00.000Z'),
      endedAt: new Date('2026-02-03T00:00:00.000Z'),
    });
    expiredId = await makeSubscription({
      userId: owner.id,
      planId: monthly.id,
      status: 'expired',
      createdAt: new Date('2026-02-04T00:00:00.000Z'),
    });
  });

  it('sem sessão responde 401', async () => {
    const reply = await browser().request('GET', '/api/v1/me/subscriptions');
    expect(reply.statusCode).toBe(401);
  });

  it('lista da mais nova para a mais antiga, com o plano e o campo de cada estado', async () => {
    const reply = await session.request('GET', '/api/v1/me/subscriptions');
    expect(reply.statusCode).toBe(200);
    const page = reply.json();
    expect(page.items.map((item: { status: string }) => item.status)).toEqual([
      'expired',
      'ended',
      'past_due',
      'active',
    ]);
    expect(page.nextCursor).toBeNull();
    const byId = new Map(page.items.map((item: { id: string }) => [item.id, item]));
    expect(byId.get(activeId)).toMatchObject({
      priceCents: 9900,
      currentPeriodStart: start.toISOString(),
      currentPeriodEnd: end.toISOString(),
      nextChargeAt: end.toISOString(),
      graceUntil: null,
      canceledAt: null,
      endedAt: null,
      plan: { id: monthly.id, slug: expect.any(String), title: 'Mensal', interval: 'month' },
    });
    expect(byId.get(pastDueId)).toMatchObject({
      priceCents: 99000,
      graceUntil: '2026-02-04T00:00:00.000Z',
      nextChargeAt: null,
    });
    expect(byId.get(endedId)).toMatchObject({
      endedAt: '2026-02-03T00:00:00.000Z',
      nextChargeAt: null,
    });
    expect(byId.get(expiredId)).toMatchObject({
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextChargeAt: null,
    });
  });

  it('filtra por estado', async () => {
    const reply = await session.request('GET', '/api/v1/me/subscriptions?status=past_due');
    expect(reply.statusCode).toBe(200);
    expect(reply.json().items.map((item: { id: string }) => item.id)).toEqual([pastDueId]);
  });

  it('pagina por cursor sem repetir item', async () => {
    const first = await session.request('GET', '/api/v1/me/subscriptions?limit=2');
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await session.request(
      'GET',
      `/api/v1/me/subscriptions?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().nextCursor).toBeNull();
    const ids = [...first.json().items, ...second.json().items].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(ids)).toEqual(new Set([activeId, pastDueId, endedId, expiredId]));
  });

  it('cursor inválido responde 400', async () => {
    const reply = await session.request('GET', '/api/v1/me/subscriptions?cursor=xyz');
    expect(reply.statusCode).toBe(400);
  });

  it('e-mail não confirmado responde 403', async () => {
    const user = await createUser(test.db, { verified: false });
    const unverified = browser();
    expect((await unverified.login(user.email)).statusCode).toBe(200);
    const reply = await unverified.request('GET', '/api/v1/me/subscriptions');
    expect(reply.statusCode).toBe(403);
    expect(reply.json().code).toBe('email_not_verified');
  });

  it('a lista do aluno não traz assinatura de outra pessoa', async () => {
    const { browser: other } = await subscriber(TAX_ID_OTHER);
    const reply = await other.request('GET', '/api/v1/me/subscriptions');
    expect(reply.statusCode).toBe(200);
    expect(reply.json().items).toEqual([]);
  });
});

describe('GET /me/subscriptions/{id} (spec 012, RF-08)', () => {
  it('traz plano, período, carência e cobranças, da mais recente para a mais antiga', async () => {
    const { user, browser: session } = await subscriber();
    const id = await makeSubscription({
      userId: user.id,
      planId: monthly.id,
      status: 'active',
      currentPeriodStart: new Date('2026-02-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-03-01T00:00:00.000Z'),
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const payments = await test.db
      .insertInto('payments')
      .values([
        {
          subscriptionId: id,
          provider: 'fake',
          providerPaymentId: `fake_pay_${randomUUID()}`,
          status: 'approved',
          method: 'card',
          amountCents: 9900,
          currency: 'BRL',
          rawStatus: 'approved',
          paidAt: new Date('2026-02-01T00:00:00.000Z'),
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
        {
          subscriptionId: id,
          provider: 'fake',
          providerPaymentId: `fake_pay_${randomUUID()}`,
          status: 'rejected',
          method: 'pix',
          amountCents: 9900,
          currency: 'BRL',
          rawStatus: 'rejected',
          createdAt: new Date('2026-02-02T00:00:00.000Z'),
        },
      ])
      .returning('id')
      .execute();

    const reply = await session.request('GET', `/api/v1/me/subscriptions/${id}`);
    expect(reply.statusCode).toBe(200);
    const detail = reply.json();
    expect(detail).toMatchObject({
      id,
      status: 'active',
      priceCents: 9900,
      currency: 'BRL',
      nextChargeAt: '2026-03-01T00:00:00.000Z',
      plan: {
        id: monthly.id,
        title: 'Mensal',
        interval: 'month',
        priceCents: 9900,
        includesAll: false,
        items: [{ productType: 'course', productId: courseId, title: 'Curso do plano' }],
      },
    });
    expect(detail.payments.map((payment: { id: string }) => payment.id)).toEqual([
      payments[1]?.id,
      payments[0]?.id,
    ]);
    expect(detail.payments[0]).toMatchObject({
      status: 'rejected',
      method: 'pix',
      amountCents: 9900,
      refundedCents: 0,
      provider: 'fake',
      paidAt: null,
    });
  });

  it('assinatura de outra pessoa é 404; id malformado é 400', async () => {
    const { user } = await subscriber();
    const id = await makeSubscription({
      userId: user.id,
      planId: monthly.id,
      status: 'expired',
      createdAt: new Date(),
    });
    const { browser: other } = await subscriber(TAX_ID_OTHER);
    const forbidden = await other.request('GET', `/api/v1/me/subscriptions/${id}`);
    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.json().code).toBe('not_found');
    const malformed = await other.request('GET', '/api/v1/me/subscriptions/nao-e-uuid');
    expect(malformed.statusCode).toBe(400);
  });
});

describe('POST /me/subscriptions/{id}/cancel (spec 012, "Cancelamento pelo aluno")', () => {
  it('sem sessão responde 401; sem CSRF, 403', async () => {
    const anonymous = await browser().request(
      'POST',
      `/api/v1/me/subscriptions/${randomUUID()}/cancel`,
    );
    expect(anonymous.statusCode).toBe(401);
    const { browser: session } = await subscriber();
    const noCsrf = await session.request(
      'POST',
      `/api/v1/me/subscriptions/${randomUUID()}/cancel`,
      { csrf: false },
    );
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().code).toBe('csrf_token_invalid');
  });

  it('pending vira expired, cancela a adesão e libera assinar o mesmo plano', async () => {
    const { user, browser: session } = await subscriber();
    const created = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    expect(created.statusCode).toBe(201);
    const subscriptionId = created.json().subscription.id;
    const row = await test.db
      .selectFrom('subscriptions')
      .select('providerSubscriptionId')
      .where('id', '=', subscriptionId)
      .executeTakeFirstOrThrow();

    const reply = await session.request(
      'POST',
      `/api/v1/me/subscriptions/${subscriptionId}/cancel`,
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      id: subscriptionId,
      status: 'expired',
      canceledAt: expect.any(String),
      graceUntil: null,
      endedAt: null,
    });
    expect((await provider.getSubscription(row.providerSubscriptionId as string)).status).toBe(
      'canceled',
    );
    expect(await countSubscriptions(user.id)).toBe(1);

    const again = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    expect(again.statusCode).toBe(201);
  });

  it('active vira canceling, com acesso até o fim do período pago', async () => {
    const { user, browser: session } = await subscriber();
    const created = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: yearly.id },
    });
    const subscriptionId = created.json().subscription.id;
    const periodEnd = new Date(provider.now.getTime() + 30 * DAY);
    await test.db
      .updateTable('subscriptions')
      .set({ status: 'active', currentPeriodStart: provider.now, currentPeriodEnd: periodEnd })
      .where('id', '=', subscriptionId)
      .execute();
    const row = await test.db
      .selectFrom('subscriptions')
      .select('providerSubscriptionId')
      .where('id', '=', subscriptionId)
      .executeTakeFirstOrThrow();

    const reply = await session.request(
      'POST',
      `/api/v1/me/subscriptions/${subscriptionId}/cancel`,
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      status: 'canceling',
      currentPeriodEnd: periodEnd.toISOString(),
      graceUntil: null,
      nextChargeAt: null,
      canceledAt: expect.any(String),
    });
    expect((await provider.getSubscription(row.providerSubscriptionId as string)).status).toBe(
      'canceled',
    );
    expect(await countSubscriptions(user.id)).toBe(1);

    const twice = await session.request(
      'POST',
      `/api/v1/me/subscriptions/${subscriptionId}/cancel`,
    );
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('subscription_not_cancelable');
  });

  it('past_due vira canceling e encerra a carência', async () => {
    const { user, browser: session } = await subscriber();
    const id = await makeSubscription({
      userId: user.id,
      planId: yearly.id,
      status: 'past_due',
      priceCents: 99000,
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      graceUntil: new Date('2026-02-04T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const reply = await session.request('POST', `/api/v1/me/subscriptions/${id}/cancel`);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      status: 'canceling',
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
      graceUntil: null,
    });
  });

  it('suspended, canceling, ended e expired respondem 409', async () => {
    const { user, browser: session } = await subscriber();
    const base = {
      userId: user.id,
      planId: monthly.id,
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const ids = [
      await makeSubscription({
        ...base,
        status: 'suspended',
        graceUntil: new Date('2026-02-04T00:00:00.000Z'),
      }),
      await makeSubscription({
        ...base,
        status: 'canceling',
        canceledAt: new Date('2026-01-15T00:00:00.000Z'),
        cancelReason: 'Cancelada pelo aluno.',
      }),
      await makeSubscription({
        userId: user.id,
        planId: monthly.id,
        status: 'ended',
        endedAt: new Date('2026-02-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      await makeSubscription({
        userId: user.id,
        planId: monthly.id,
        status: 'expired',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ];
    for (const id of ids) {
      const reply = await session.request('POST', `/api/v1/me/subscriptions/${id}/cancel`);
      expect(reply.statusCode).toBe(409);
      expect(reply.json().code).toBe('subscription_not_cancelable');
    }
  });

  it('assinatura de outra pessoa responde 404', async () => {
    const { user } = await subscriber();
    const id = await makeSubscription({
      userId: user.id,
      planId: monthly.id,
      status: 'expired',
      createdAt: new Date(),
    });
    const { browser: other } = await subscriber(TAX_ID_OTHER);
    const reply = await other.request('POST', `/api/v1/me/subscriptions/${id}/cancel`);
    expect(reply.statusCode).toBe(404);
    expect(reply.json().code).toBe('not_found');
  });

  it('provedor sem confirmar responde 503 e não muda a assinatura', async () => {
    const { user, browser: session } = await subscriber();
    const created = await session.request('POST', '/api/v1/subscriptions', {
      payload: { planId: monthly.id },
    });
    const subscriptionId = created.json().subscription.id;
    await test.db
      .updateTable('subscriptions')
      .set({
        status: 'active',
        currentPeriodStart: provider.now,
        currentPeriodEnd: new Date(provider.now.getTime() + 30 * DAY),
      })
      .where('id', '=', subscriptionId)
      .execute();
    expect(await countSubscriptions(user.id)).toBe(1);

    provider.setUnavailable(true, ['cancelSubscription']);
    try {
      const reply = await session.request(
        'POST',
        `/api/v1/me/subscriptions/${subscriptionId}/cancel`,
      );
      expect(reply.statusCode).toBe(503);
      expect(reply.json().code).toBe('payment_provider_unavailable');
    } finally {
      provider.setUnavailable(false);
    }
    const row = await test.db
      .selectFrom('subscriptions')
      .select(['status', 'canceledAt'])
      .where('id', '=', subscriptionId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'active', canceledAt: null });
  });
});
