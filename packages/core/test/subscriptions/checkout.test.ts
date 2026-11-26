import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeDatabase,
  createCoupon,
  createDatabase,
  createSubscriptionCheckout,
  type Database,
  IDEMPOTENCY_RETENTION_MS,
  IDEMPOTENCY_SCOPES,
  isProviderUnavailable,
} from '../../src/index.ts';
import {
  CURRENCY,
  expectError,
  makePlan,
  makeProvider,
  makeStaff,
  makeSubscriber,
  RETURN_URLS,
  staffRequest,
  type TestUser,
} from './fixtures.ts';

// Idempotência da criação de assinatura (`POST /subscriptions`; specs 003 e 012, task 718).

const KEY = 'assinatura-idempotente-0001';
const NOW = new Date('2026-03-01T10:00:00.000Z');

let testDb: TestDatabase;
let db: Database;
let admin: TestUser;
let subscriber: TestUser;

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
  subscriber = await makeSubscriber(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function subscriptionCount(userId = subscriber.id): Promise<number> {
  const row = await db
    .selectFrom('subscriptions')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('userId', '=', userId)
    .executeTakeFirstOrThrow();
  return row.n;
}

async function auditCount(): Promise<number> {
  const row = await db
    .selectFrom('auditLog')
    .select(sql<number>`count(*)::int`.as('n'))
    .executeTakeFirstOrThrow();
  return row.n;
}

async function storedKeys(userId = subscriber.id) {
  return db
    .selectFrom('idempotencyKeys')
    .select(['scope', 'key', 'responseStatus', 'completedAt'])
    .where('userId', '=', userId)
    .execute();
}

function spyProvider(provider: ReturnType<typeof makeProvider>) {
  const ensurePlan = vi.spyOn(provider, 'ensurePlan');
  const createSubscription = vi.spyOn(provider, 'createSubscription');
  return { provider, ensurePlan, createSubscription };
}

describe('idempotência na criação de assinatura', () => {
  it('a mesma chave devolve a mesma assinatura e URL sem segunda chamada ao provedor', async () => {
    const fake = makeProvider(NOW);
    const { provider, ensurePlan, createSubscription } = spyProvider(fake);
    const plan = await makePlan(db, admin, { priceCents: 9_900 });
    const auditsBefore = await auditCount();

    const input = {
      userId: subscriber.id,
      planId: plan.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    };

    const first = await createSubscriptionCheckout(db, input);
    const replay = await createSubscriptionCheckout(db, input);

    expect(replay).toEqual(first);
    expect(replay.subscription.id).toBe(first.subscription.id);
    expect(replay.checkoutUrl).toBe(first.checkoutUrl);
    expect(replay.subscription.createdAt).toBeInstanceOf(Date);
    expect(ensurePlan).toHaveBeenCalledTimes(1);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(await subscriptionCount()).toBe(1);
    expect(await auditCount()).toBe(auditsBefore);

    const keys = await storedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      scope: IDEMPOTENCY_SCOPES.subscriptionCreate,
      key: KEY,
      responseStatus: 201,
    });
    expect(keys[0]?.completedAt).toEqual(NOW);
  });

  it('normaliza cupom (maiúsculas e espaços) e planId na impressão digital', async () => {
    const fake = makeProvider(NOW);
    const { provider, createSubscription } = spyProvider(fake);
    const plan = await makePlan(db, admin, { priceCents: 10_000 });
    await createCoupon(db, staffRequest(admin), {
      code: 'BEMVINDO',
      kind: 'percent',
      percentOff: 20,
      appliesTo: 'subscriptions',
    });

    const first = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: plan.id.toUpperCase(),
      couponCode: '  bemvindo  ',
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });
    const replay = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: plan.id.toLowerCase(),
      couponCode: 'BEMVINDO',
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });

    expect(replay).toEqual(first);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(await subscriptionCount()).toBe(1);
  });

  it('trata ausência, nulo e texto em branco como o mesmo cupom vazio na impressão digital', async () => {
    const fake = makeProvider(NOW);
    const { provider, createSubscription } = spyProvider(fake);
    const plan = await makePlan(db, admin);

    const first = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: plan.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });
    const second = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: plan.id,
      couponCode: null,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });
    const third = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: plan.id,
      couponCode: '   ',
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(createSubscription).toHaveBeenCalledTimes(1);
  });

  it('a mesma chave com outro planId ou outro cupom responde 422 idempotency_key_reuse', async () => {
    const fake = makeProvider(NOW);
    const { provider, createSubscription } = spyProvider(fake);
    const planA = await makePlan(db, admin);
    const planB = await makePlan(db, admin);
    await createCoupon(db, staffRequest(admin), {
      code: 'CUPOM10',
      kind: 'percent',
      percentOff: 10,
      appliesTo: 'subscriptions',
    });

    await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: planA.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });

    await expectError(
      createSubscriptionCheckout(db, {
        userId: subscriber.id,
        planId: planB.id,
        provider,
        currency: CURRENCY,
        returnUrls: RETURN_URLS,
        now: NOW,
        idempotencyKey: KEY,
      }),
      422,
      'idempotency_key_reuse',
    );
    await expectError(
      createSubscriptionCheckout(db, {
        userId: subscriber.id,
        planId: planA.id,
        couponCode: 'CUPOM10',
        provider,
        currency: CURRENCY,
        returnUrls: RETURN_URLS,
        now: NOW,
        idempotencyKey: KEY,
      }),
      422,
      'idempotency_key_reuse',
    );

    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(await subscriptionCount()).toBe(1);
  });

  it('chave fora do contrato responde 400 validation_failed sem tocar no provedor', async () => {
    const fake = makeProvider(NOW);
    const { provider, createSubscription } = spyProvider(fake);
    const plan = await makePlan(db, admin);

    await expectError(
      createSubscriptionCheckout(db, {
        userId: subscriber.id,
        planId: plan.id,
        provider,
        currency: CURRENCY,
        returnUrls: RETURN_URLS,
        idempotencyKey: 'curta',
      }),
      400,
      'validation_failed',
    );

    expect(createSubscription).not.toHaveBeenCalled();
    expect(await subscriptionCount()).toBe(0);
  });

  it('provedor fora não cria assinatura e libera a chave para nova tentativa', async () => {
    const fake = makeProvider(NOW);
    const { provider, ensurePlan, createSubscription } = spyProvider(fake);
    const plan = await makePlan(db, admin);

    fake.setUnavailable(true, ['createSubscription']);
    try {
      const error = await createSubscriptionCheckout(db, {
        userId: subscriber.id,
        planId: plan.id,
        provider,
        currency: CURRENCY,
        returnUrls: RETURN_URLS,
        now: NOW,
        idempotencyKey: KEY,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(isProviderUnavailable(error)).toBe(true);
      expect(ensurePlan).toHaveBeenCalledTimes(1);
      expect(createSubscription).toHaveBeenCalledTimes(1);
      expect(await subscriptionCount()).toBe(0);
      expect(await storedKeys()).toHaveLength(0);
    } finally {
      fake.setUnavailable(false);
    }

    const retried = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: plan.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });

    expect(retried.subscription.status).toBe('pending');
    // `ensurePlan` da tentativa anterior já gravou `plans.provider_plan_id`.
    expect(ensurePlan).toHaveBeenCalledTimes(1);
    expect(createSubscription).toHaveBeenCalledTimes(2);
    expect(await subscriptionCount()).toBe(1);
    expect(await storedKeys()).toHaveLength(1);
  });

  it('duas requisições concorrentes com a mesma chave criam uma única assinatura', async () => {
    const provider = makeProvider(NOW);
    const originalCreate = provider.createSubscription.bind(provider);
    const createSubscription = vi
      .spyOn(provider, 'createSubscription')
      .mockImplementation(async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return originalCreate(input);
      });
    const plan = await makePlan(db, admin);

    const request = {
      userId: subscriber.id,
      planId: plan.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    };

    const [first, second] = await Promise.all([
      createSubscriptionCheckout(db, request),
      createSubscriptionCheckout(db, request),
    ]);

    expect(second).toEqual(first);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(await subscriptionCount()).toBe(1);
  });

  it('chave com mais de 24 h pode ser usada em outra assinatura e sem chave nada muda', async () => {
    const fake = makeProvider(NOW);
    const { provider, createSubscription } = spyProvider(fake);
    const planA = await makePlan(db, admin);
    const planB = await makePlan(db, admin);

    const first = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: planA.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
      idempotencyKey: KEY,
    });

    const after25h = new Date(NOW.getTime() + IDEMPOTENCY_RETENTION_MS + 60 * 60 * 1_000);
    const second = await createSubscriptionCheckout(db, {
      userId: subscriber.id,
      planId: planB.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: after25h,
      idempotencyKey: KEY,
    });
    expect(second.subscription.id).not.toBe(first.subscription.id);
    expect(createSubscription).toHaveBeenCalledTimes(2);

    // Sem chave: não grava em `idempotency_keys` e recusa duplicidade aberta com 409.
    const otherSubscriber = await makeSubscriber(db);
    await createSubscriptionCheckout(db, {
      userId: otherSubscriber.id,
      planId: planA.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
    });
    expect(await storedKeys(otherSubscriber.id)).toHaveLength(0);
    await expectError(
      createSubscriptionCheckout(db, {
        userId: otherSubscriber.id,
        planId: planA.id,
        provider,
        currency: CURRENCY,
        returnUrls: RETURN_URLS,
        now: NOW,
      }),
      409,
      'subscription_already_exists',
    );
  });
});
