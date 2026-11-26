import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyProviderSubscriptionState,
  applySubscriptionPayment,
  cancelAdminSubscription,
  cancelMySubscription,
  closeDatabase,
  createCoupon,
  createDatabase,
  createSubscriptionCheckout,
  type Database,
  endCancelingSubscriptions,
  endSuspendedSubscriptions,
  expirePendingSubscriptions,
  getAdminSubscription,
  getMySubscription,
  hasActiveSubscription,
  listAdminSubscriptions,
  listMySubscriptions,
  orderExternalReference,
  suspendExpiredSubscriptions,
} from '../../src/index.ts';
import { makeCourse } from '../sales/fixtures.ts';
import {
  CURRENCY,
  expectError,
  makePlan,
  makeProvider,
  makeStaff,
  makeStudentWithoutBilling,
  makeSubscriber,
  makeUnverified,
  RETURN_URLS,
  staffRequest,
  type TestUser,
} from './fixtures.ts';

// Checkout, ativação, renovação, carência, suspensão, cancelamento e reconciliação (spec 012).

const DAY = 86_400_000;
let testDb: TestDatabase;
let db: Database;
let admin: TestUser;

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
});

async function checkout(
  provider: ReturnType<typeof makeProvider>,
  subscriber: TestUser,
  planId: string,
  options: { couponCode?: string; now?: Date } = {},
): Promise<{ subscriptionId: string; providerSubscriptionId: string }> {
  const result = await createSubscriptionCheckout(db, {
    userId: subscriber.id,
    planId,
    provider,
    currency: CURRENCY,
    returnUrls: RETURN_URLS,
    ...(options.couponCode === undefined ? {} : { couponCode: options.couponCode }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const row = await db
    .selectFrom('subscriptions')
    .select('providerSubscriptionId')
    .where('id', '=', result.subscription.id)
    .executeTakeFirstOrThrow();
  return {
    subscriptionId: result.subscription.id,
    providerSubscriptionId: row.providerSubscriptionId as string,
  };
}

interface SubscriptionRow {
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  endedAt: Date | null;
  canceledAt: Date | null;
  priceCents: string | number | bigint;
}

async function readSubscription(id: string): Promise<SubscriptionRow> {
  return db
    .selectFrom('subscriptions')
    .select([
      'status',
      'currentPeriodStart',
      'currentPeriodEnd',
      'graceUntil',
      'endedAt',
      'canceledAt',
      'priceCents',
    ])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

async function subscriptionEntitlements(subscriptionId: string) {
  return db
    .selectFrom('entitlements')
    .select(['id', 'productId', 'revokedAt', 'expiresAt'])
    .where('source', '=', 'subscription')
    .where('sourceId', '=', subscriptionId)
    .execute();
}

describe('checkout da assinatura', () => {
  it('cria a assinatura pending com o preço do plano e devolve a URL do provedor', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(new Date('2026-01-01T00:00:00Z'));
    const plan = await makePlan(db, admin, { priceCents: 9_900 });
    const result = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: plan.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result.checkoutUrl).toContain('https://checkout.payment-fake.test/');
    expect(result.subscription).toMatchObject({
      status: 'pending',
      priceCents: 9_900,
      currency: CURRENCY,
      nextChargeAt: null,
    });
    const row = await readSubscription(result.subscription.id);
    expect(Number(row.priceCents)).toBe(9_900);
  });

  it('recusa o mesmo plano duas vezes, plano inativo, e-mail não confirmado e sem cobrança', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const plan = await makePlan(db, admin);
    await checkout(provider, subscriber, plan.id);

    await expectError(checkout(provider, subscriber, plan.id), 409, 'subscription_already_exists');

    const inactive = await makePlan(db, admin, { active: false });
    await expectError(checkout(provider, subscriber, inactive.id), 404, 'not_found');

    const unverified = await makeUnverified(db);
    await expectError(checkout(provider, unverified, plan.id), 403, 'email_not_verified');

    const noBilling = await makeStudentWithoutBilling(db);
    await expectError(checkout(provider, noBilling, plan.id), 409, 'billing_required');
  });

  it('aplica o cupom só na primeira cobrança; a seguinte é pelo preço cheio', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(new Date('2026-01-01T00:00:00Z'));
    const plan = await makePlan(db, admin, { priceCents: 10_000 });
    const coupon = await createCoupon(db, staffRequest(admin), {
      code: 'METADE',
      kind: 'percent',
      percentOff: 50,
      appliesTo: 'subscriptions',
    });
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
      {
        couponCode: 'METADE',
      },
    );
    const stored = await db
      .selectFrom('subscriptions')
      .select(['couponId'])
      .where('id', '=', subscriptionId)
      .executeTakeFirstOrThrow();
    expect(stored.couponId).toBe(coupon.id);

    const firstPayment = provider.authorizeSubscription(providerSubscriptionId);
    expect(firstPayment.amountCents).toBe(5_000);
    await applySubscriptionPayment(db, 'fake', firstPayment, { graceDays: 3 });

    const couponAfter = await db
      .selectFrom('coupons')
      .select('usesCount')
      .where('id', '=', coupon.id)
      .executeTakeFirstOrThrow();
    expect(couponAfter.usesCount).toBe(1);

    provider.setNow('2026-02-01T00:00:00Z');
    const renewal = provider.renewSubscription(providerSubscriptionId);
    expect(renewal.amountCents).toBe(10_000);
  });

  it('recusa cupom que não vale para assinatura', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const plan = await makePlan(db, admin);
    await createCoupon(db, staffRequest(admin), {
      code: 'SO-PEDIDO',
      kind: 'fixed',
      amountOffCents: 1_000,
      appliesTo: 'orders',
    });
    await expectError(
      checkout(provider, subscriber, plan.id, { couponCode: 'SO-PEDIDO' }),
      422,
      'coupon_invalid',
    );
    await expectError(
      checkout(provider, subscriber, plan.id, { couponCode: 'NAO-EXISTE' }),
      422,
      'coupon_invalid',
    );
  });
});

describe('ativação, renovação e carência', () => {
  it('ativa no pagamento aprovado, concede direitos e é idempotente', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(new Date('2026-01-01T00:00:00Z'));
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      priceCents: 9_900,
      items: [{ productType: 'course', productId: courseId }],
    });
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
    );

    const payment = provider.authorizeSubscription(providerSubscriptionId);
    const applied = await applySubscriptionPayment(db, 'fake', payment, { graceDays: 3 });
    expect(applied).toMatchObject({
      previousStatus: 'pending',
      status: 'active',
      changed: true,
      granted: 1,
    });

    const row = await readSubscription(subscriptionId);
    expect(row.status).toBe('active');
    expect(row.currentPeriodEnd?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    const entitlements = await subscriptionEntitlements(subscriptionId);
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]).toMatchObject({
      productId: courseId,
      revokedAt: null,
      // Fim do período mais os três dias de carência.
      expiresAt: new Date('2026-02-04T00:00:00.000Z'),
    });

    // Repetir a mesma cobrança não cria direito nem conta o cupom de novo.
    const again = await applySubscriptionPayment(db, 'fake', payment, { graceDays: 3 });
    expect(again.granted).toBe(0);
    expect(await subscriptionEntitlements(subscriptionId)).toHaveLength(1);
    expect(await hasActiveSubscription(db, subscriber.id, { planId: plan.id })).toBe(true);
  });

  it('renova adiantando o período e estende os direitos', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(new Date('2026-01-01T00:00:00Z'));
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
    );
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(providerSubscriptionId),
      {
        graceDays: 3,
      },
    );

    provider.setNow('2026-02-01T00:00:00Z');
    const renewal = provider.renewSubscription(providerSubscriptionId);
    const applied = await applySubscriptionPayment(db, 'fake', renewal, { graceDays: 3 });
    expect(applied).toMatchObject({ previousStatus: 'active', status: 'active', changed: false });

    const row = await readSubscription(subscriptionId);
    expect(row.currentPeriodStart?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(row.currentPeriodEnd?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    const entitlements = await subscriptionEntitlements(subscriptionId);
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]?.expiresAt).toEqual(new Date('2026-03-04T00:00:00.000Z'));
  });

  it('cobrança recusada abre a carência de 3 dias e o fim dela suspende e revoga', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(new Date('2026-01-01T00:00:00Z'));
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
    );
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(providerSubscriptionId),
      {
        graceDays: 3,
      },
    );

    provider.setNow('2026-02-01T00:00:00Z');
    const rejected = provider.renewSubscription(providerSubscriptionId, { outcome: 'rejected' });
    const applied = await applySubscriptionPayment(db, 'fake', rejected, {
      now: new Date('2026-02-01T00:00:00Z'),
      graceDays: 3,
    });
    expect(applied).toMatchObject({ previousStatus: 'active', status: 'past_due' });
    const pastDue = await readSubscription(subscriptionId);
    expect(pastDue.graceUntil?.toISOString()).toBe('2026-02-04T00:00:00.000Z');

    const suspended = await suspendExpiredSubscriptions(db, {
      now: new Date('2026-02-04T00:00:00Z'),
      graceDays: 3,
    });
    expect(suspended).toBe(1);
    expect((await readSubscription(subscriptionId)).status).toBe('suspended');
    const entitlements = await subscriptionEntitlements(subscriptionId);
    expect(entitlements.every((entry) => entry.revokedAt !== null)).toBe(true);
    expect(await hasActiveSubscription(db, subscriber.id, { planId: plan.id })).toBe(false);
  });

  it('pagamento após suspensão abre um novo período e concede os direitos de novo', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(new Date('2026-01-01T00:00:00Z'));
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
    );
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(providerSubscriptionId),
      {
        graceDays: 3,
      },
    );
    provider.setNow('2026-02-01T00:00:00Z');
    await applySubscriptionPayment(
      db,
      'fake',
      provider.renewSubscription(providerSubscriptionId, { outcome: 'rejected' }),
      { now: new Date('2026-02-01T00:00:00Z'), graceDays: 3 },
    );
    await suspendExpiredSubscriptions(db, { now: new Date('2026-02-04T00:00:00Z'), graceDays: 3 });

    provider.setNow('2026-03-05T00:00:00Z');
    const payment = provider.renewSubscription(providerSubscriptionId, { outcome: 'approved' });
    const applied = await applySubscriptionPayment(db, 'fake', payment, {
      now: new Date('2026-03-05T00:00:00Z'),
      graceDays: 3,
    });
    expect(applied).toMatchObject({ previousStatus: 'suspended', status: 'active', granted: 1 });
    const row = await readSubscription(subscriptionId);
    expect(row.currentPeriodStart?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(row.currentPeriodEnd?.toISOString()).toBe('2026-04-05T00:00:00.000Z');
    expect(await hasActiveSubscription(db, subscriber.id, { planId: plan.id })).toBe(true);
  });

  it('expira a pending sem pagamento e encerra a suspensa há 30 dias', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(new Date('2026-01-01T00:00:00Z'));
    const plan = await makePlan(db, admin);
    const { subscriptionId } = await checkout(provider, subscriber, plan.id);
    const expired = await expirePendingSubscriptions(db, provider, {
      now: new Date(Date.now() + 3600_000),
    });
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await readSubscription(subscriptionId)).status).toBe('expired');

    const graceOld = new Date(Date.now() - 40 * DAY);
    const suspended = await db
      .insertInto('subscriptions')
      .values({
        userId: subscriber.id,
        planId: plan.id,
        status: 'suspended',
        priceCents: 9_900,
        currency: CURRENCY,
        provider: 'fake',
        graceUntil: graceOld,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const ended = await endSuspendedSubscriptions(db, provider, { now: new Date() });
    expect(ended).toBeGreaterThanOrEqual(1);
    const row = await readSubscription(suspended.id);
    expect(row.status).toBe('ended');
    expect(row.endedAt).not.toBeNull();
  });
});

describe('cancelamento', () => {
  async function activeSubscription(now: Date) {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(now);
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    const ids = await checkout(provider, subscriber, plan.id, { now });
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(ids.providerSubscriptionId),
      {
        now,
        graceDays: 3,
      },
    );
    return { subscriber, provider, plan, ...ids };
  }

  it('aluno cancela a pending e ela vira expired, liberando o plano', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const plan = await makePlan(db, admin);
    const { subscriptionId } = await checkout(provider, subscriber, plan.id);
    const result = await cancelMySubscription(db, provider, subscriber.id, subscriptionId, {
      now: new Date('2026-01-01T01:00:00Z'),
    });
    expect(result.status).toBe('expired');
    expect(result.canceledAt).not.toBeNull();
    // Pode assinar o mesmo plano de novo.
    await checkout(provider, subscriber, plan.id);
  });

  it('aluno cancela a ativa e o acesso vai só até o fim do período', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const { subscriber, provider, subscriptionId } = await activeSubscription(now);
    const result = await cancelMySubscription(db, provider, subscriber.id, subscriptionId, {
      now: new Date('2026-01-10T00:00:00Z'),
    });
    expect(result.status).toBe('canceling');
    const entitlements = await subscriptionEntitlements(subscriptionId);
    expect(entitlements[0]?.expiresAt).toEqual(new Date('2026-02-01T00:00:00.000Z'));

    // Repetir o cancelamento já não vale.
    await expectError(
      cancelMySubscription(db, provider, subscriber.id, subscriptionId),
      409,
      'subscription_not_cancelable',
    );

    const ended = await endCancelingSubscriptions(db, { now: new Date('2026-02-02T00:00:00Z') });
    expect(ended).toBeGreaterThanOrEqual(1);
    expect((await readSubscription(subscriptionId)).status).toBe('ended');
  });

  it('admin cancela a suspensa encerrando na hora; pending e gestor não podem', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const manager = await makeStaff(db, 'manager');
    const plan = await makePlan(db, admin);
    const pending = await checkout(provider, subscriber, plan.id);
    await expectError(
      cancelAdminSubscription(
        db,
        provider,
        staffRequest(manager),
        pending.subscriptionId,
        'motivo',
      ),
      403,
      'permission_denied',
    );
    await expectError(
      cancelAdminSubscription(db, provider, staffRequest(admin), pending.subscriptionId, 'motivo'),
      409,
      'subscription_not_cancelable',
    );

    const suspendedSubscriber = await makeSubscriber(db);
    const suspended = await db
      .insertInto('subscriptions')
      .values({
        userId: suspendedSubscriber.id,
        planId: plan.id,
        status: 'suspended',
        priceCents: 9_900,
        currency: CURRENCY,
        provider: 'fake',
        graceUntil: new Date('2026-01-05T00:00:00Z'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const detail = await cancelAdminSubscription(
      db,
      provider,
      staffRequest(admin),
      suspended.id,
      'Fraude confirmada',
    );
    expect(detail.status).toBe('ended');
    expect(detail.cancelReason).toBe('Fraude confirmada');
  });
});

describe('consultas e reconciliação', () => {
  it('lista as assinaturas do aluno e esconde a de outro aluno', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const subscriber = await makeSubscriber(db);
    const other = await makeSubscriber(db);
    const provider = makeProvider(now);
    const plan = await makePlan(db, admin);
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
      {
        now,
      },
    );
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(providerSubscriptionId),
      {
        now,
        graceDays: 3,
      },
    );

    const page = await listMySubscriptions(db, subscriber.id);
    expect(page.items.map((item) => item.id)).toContain(subscriptionId);
    const detail = await getMySubscription(db, subscriber.id, subscriptionId);
    expect(detail.status).toBe('active');
    expect(detail.payments).toHaveLength(1);
    expect(detail.nextChargeAt).toEqual(new Date('2026-02-01T00:00:00Z'));
    await expectError(getMySubscription(db, other.id, subscriptionId), 404, 'not_found');
  });

  it('admin lista e lê com filtro; instrutor não consulta', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(now);
    const instructor = await makeStaff(db, 'instructor');
    const manager = await makeStaff(db, 'manager');
    const plan = await makePlan(db, admin);
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
      {
        now,
      },
    );
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(providerSubscriptionId),
      {
        now,
        graceDays: 3,
      },
    );

    const page = await listAdminSubscriptions(db, staffRequest(manager), {
      planId: plan.id,
      status: 'active',
    });
    expect(page.items.map((item) => item.id)).toContain(subscriptionId);
    await expectError(
      listAdminSubscriptions(db, staffRequest(instructor), {}),
      403,
      'permission_denied',
    );

    const detail = await getAdminSubscription(db, staffRequest(admin), subscriptionId);
    expect(detail.payments).toHaveLength(1);
    expect(detail.currentPeriodPaymentId).toBe(detail.payments[0]?.id);
  });

  it('reconciliação encerra quando o provedor cancelou e avança o período perdido', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(now);
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
      {
        now,
      },
    );
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(providerSubscriptionId),
      {
        now,
        graceDays: 3,
      },
    );

    // Renovação no provedor sem webhook: a reconciliação traz o período novo.
    provider.setNow('2026-02-01T00:00:00Z');
    provider.renewSubscription(providerSubscriptionId);
    const state = await provider.getSubscription(providerSubscriptionId);
    const reconciled = await applyProviderSubscriptionState(db, state, {
      now: new Date('2026-02-01T00:00:00Z'),
      graceDays: 3,
    });
    expect(reconciled.status).toBe('active');
    expect(reconciled.extended).toBeGreaterThanOrEqual(1);
    expect((await readSubscription(subscriptionId)).currentPeriodEnd?.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );

    // Cancelamento no provedor sem webhook: a reconciliação encerra.
    await provider.cancelSubscription(providerSubscriptionId);
    const canceled = await provider.getSubscription(providerSubscriptionId);
    const ended = await applyProviderSubscriptionState(db, canceled, { now: new Date() });
    expect(ended.status).toBe('ended');
    expect((await readSubscription(subscriptionId)).status).toBe('ended');
  });
});

describe('reconciliação e cobranças sem efeito', () => {
  it('provedor pausado abre a carência, provedor atrasado não mexe no período', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(now);
    const plan = await makePlan(db, admin);
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
      {
        now,
      },
    );
    await applySubscriptionPayment(
      db,
      'fake',
      provider.authorizeSubscription(providerSubscriptionId),
      {
        now,
        graceDays: 3,
      },
    );

    const paused = provider.pauseSubscription(providerSubscriptionId);
    const applied = await applyProviderSubscriptionState(db, paused, {
      now: new Date('2026-01-20T00:00:00Z'),
      graceDays: 3,
    });
    expect(applied).toMatchObject({ previousStatus: 'active', status: 'past_due', changed: true });
    expect((await readSubscription(subscriptionId)).graceUntil?.toISOString()).toBe(
      '2026-01-23T00:00:00.000Z',
    );

    // O provedor ainda mostra o período antigo: a reconciliação não volta o período.
    const behind = await provider.getSubscription(providerSubscriptionId);
    const before = await readSubscription(subscriptionId);
    const kept = await applyProviderSubscriptionState(
      db,
      { ...behind, status: 'authorized', currentPeriodEnd: new Date('2025-12-01T00:00:00Z') },
      { now: new Date('2026-01-20T00:00:00Z'), graceDays: 3 },
    );
    expect(kept).toMatchObject({ status: 'past_due', changed: false, extended: 0 });
    expect((await readSubscription(subscriptionId)).currentPeriodEnd).toEqual(
      before.currentPeriodEnd,
    );
  });

  it('cobrança cancelada não muda nada e assinatura cancelando só registra a cobrança', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(now);
    const plan = await makePlan(db, admin);
    const { subscriptionId, providerSubscriptionId } = await checkout(
      provider,
      subscriber,
      plan.id,
      {
        now,
      },
    );
    const first = provider.authorizeSubscription(providerSubscriptionId);
    await applySubscriptionPayment(db, 'fake', first, { now, graceDays: 3 });

    const canceled = await applySubscriptionPayment(
      db,
      'fake',
      { ...(await provider.getPayment(first.providerPaymentId)), status: 'canceled' },
      { now, graceDays: 3 },
    );
    expect(canceled).toMatchObject({ status: 'active', changed: false, granted: 0 });

    // A assinatura já está cancelando (o provedor segue ativo até o fim do período).
    await db
      .updateTable('subscriptions')
      .set({
        status: 'canceling',
        canceledAt: new Date('2026-01-10T00:00:00Z'),
        cancelReason: 'teste',
      })
      .where('id', '=', subscriptionId)
      .execute();

    provider.setNow('2026-02-01T00:00:00Z');
    const renewal = provider.renewSubscription(providerSubscriptionId);
    const applied = await applySubscriptionPayment(db, 'fake', renewal, {
      now: new Date('2026-02-01T00:00:00Z'),
      graceDays: 3,
    });
    expect(applied).toMatchObject({
      previousStatus: 'canceling',
      status: 'canceling',
      changed: false,
    });
    const stored = await db
      .selectFrom('payments')
      .select('id')
      .where('providerPaymentId', '=', renewal.providerPaymentId)
      .executeTakeFirst();
    expect(stored).toBeDefined();
  });

  it('estorno e chargeback chegam pela cobrança e encerram a assinatura', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider(now);
    const plan = await makePlan(db, admin);
    const backed = await checkout(provider, subscriber, plan.id, { now });
    const backedFirst = provider.authorizeSubscription(backed.providerSubscriptionId);
    await applySubscriptionPayment(db, 'fake', backedFirst, { now, graceDays: 3 });

    await provider.refund(backedFirst.providerPaymentId, null);
    const refunded = await provider.getPayment(backedFirst.providerPaymentId);
    const applied = await applySubscriptionPayment(db, 'fake', refunded, { now, graceDays: 3 });
    expect(applied.status).toBe('ended');
    expect((await readSubscription(backed.subscriptionId)).status).toBe('ended');

    const charged = await checkout(provider, subscriber, plan.id, { now });
    const chargedFirst = provider.authorizeSubscription(charged.providerSubscriptionId);
    await applySubscriptionPayment(db, 'fake', chargedFirst, { now, graceDays: 3 });
    provider.chargebackPayment(chargedFirst.providerPaymentId);
    const chargeback = await provider.getPayment(chargedFirst.providerPaymentId);
    const result = await applySubscriptionPayment(db, 'fake', chargeback, { now, graceDays: 3 });
    expect(result.status).toBe('ended');
    expect((await readSubscription(charged.subscriptionId)).status).toBe('ended');
  });

  it('recusa cobrança e assinatura que não são de uma assinatura local', async () => {
    const subscriber = await makeSubscriber(db);
    expect(subscriber.id).toBeTruthy();
    const ghost = {
      providerPaymentId: 'fake_payment_ghost',
      status: 'approved' as const,
      amountCents: 100,
      refundedCents: 0,
      currency: CURRENCY,
      method: 'card' as const,
      externalReference: orderExternalReference('11111111-1111-4111-8111-111111111111'),
      rawStatus: 'approved',
      paidAt: new Date(),
    };
    await expectError(
      applySubscriptionPayment(db, 'fake', ghost),
      422,
      'payment_provider_invalid_transition',
    );
  });
});
