import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applySubscriptionPayment,
  closeDatabase,
  createDatabase,
  createSubscriptionCheckout,
  type Database,
  enqueuePlansCoveringProduct,
  recalculatePlanSubscriptions,
  setPlanItems,
} from '../../src/index.ts';
import { makeCourse } from '../sales/fixtures.ts';
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

// Direitos da assinatura e recálculo do plano (spec 012, "Planos 'tudo, inclusive futuros'").

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

async function subscribe(planId: string, now = new Date('2026-01-01T00:00:00Z')) {
  const subscriber = await makeSubscriber(db);
  const provider = makeProvider(now);
  const { subscription } = await createSubscriptionCheckout(db, {
    userId: subscriber.id,
    planId,
    provider,
    currency: CURRENCY,
    returnUrls: RETURN_URLS,
    now,
  });
  const row = await db
    .selectFrom('subscriptions')
    .select('providerSubscriptionId')
    .where('id', '=', subscription.id)
    .executeTakeFirstOrThrow();
  await applySubscriptionPayment(
    db,
    'fake',
    provider.authorizeSubscription(row.providerSubscriptionId as string),
    { now, graceDays: 3 },
  );
  return { subscriptionId: subscription.id, userId: subscriber.id };
}

async function activeRoots(subscriptionId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('entitlements')
    .select(['productId'])
    .where('source', '=', 'subscription')
    .where('sourceId', '=', subscriptionId)
    .where('revokedAt', 'is', null)
    .orderBy('productId')
    .execute();
  return rows.map((row) => row.productId);
}

describe('recálculo do plano', () => {
  it('troca de itens revoga o removido e concede o novo nas assinaturas do plano', async () => {
    const courseA = await makeCourse(db);
    const courseB = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseA }],
    });
    const first = await subscribe(plan.id);
    const second = await subscribe(plan.id);

    await setPlanItems(db, staffRequest(admin), plan.id, [
      { productType: 'course', productId: courseB },
    ]);
    // Dois por lote: exercita a paginação por cursor.
    const result = await recalculatePlanSubscriptions(db, plan.id, { batchSize: 1 });
    expect(result).toMatchObject({ subscriptions: 2, granted: 2, revoked: 2 });

    for (const subscription of [first, second]) {
      expect(await activeRoots(subscription.subscriptionId)).toEqual([courseB]);
    }
    // Repetir não muda nada.
    const again = await recalculatePlanSubscriptions(db, plan.id);
    expect(again).toMatchObject({ subscriptions: 2, granted: 0, revoked: 0 });
  });

  it('plano "tudo" concede o produto publicado depois e revoga o despublicado', async () => {
    const plan = await makePlan(db, admin, { groupKey: 'tudo-futuro', includesAll: true });
    const { subscriptionId } = await subscribe(plan.id);
    const before = await activeRoots(subscriptionId);

    const courseId = await makeCourse(db, { published: false });
    expect(before).not.toContain(courseId);
    await db
      .updateTable('courses')
      .set({ status: 'published', publishedAt: new Date() })
      .where('id', '=', courseId)
      .execute();

    const plans = await enqueuePlansCoveringProduct(db, 'course', courseId);
    expect(plans).toContain(plan.id);
    const queued = await db
      .selectFrom('jobs')
      .select(['payload'])
      .where('type', '=', 'entitlement.recompute')
      .execute();
    expect(
      queued.filter((job) => {
        const payload = job.payload as { productType?: string; productId?: string };
        return payload.productType === 'plan' && payload.productId === plan.id;
      }),
    ).toHaveLength(1);

    const granted = await recalculatePlanSubscriptions(db, plan.id);
    expect(granted.granted).toBe(1);
    expect(await activeRoots(subscriptionId)).toContain(courseId);

    // Despublicado, o plano "tudo" não cobre mais: o direito sai no recálculo.
    await db.updateTable('courses').set({ status: 'draft' }).where('id', '=', courseId).execute();
    const revoked = await recalculatePlanSubscriptions(db, plan.id);
    expect(revoked.revoked).toBe(1);
    expect(await activeRoots(subscriptionId)).not.toContain(courseId);
  });

  it('assinatura suspensa fica fora do recálculo e plano inválido é recusado', async () => {
    const courseId = await makeCourse(db);
    const plan = await makePlan(db, admin, {
      items: [{ productType: 'course', productId: courseId }],
    });
    const { subscriptionId } = await subscribe(plan.id);
    await db
      .updateTable('subscriptions')
      .set({ status: 'suspended', graceUntil: new Date('2026-01-05T00:00:00Z') })
      .where('id', '=', subscriptionId)
      .execute();

    const result = await recalculatePlanSubscriptions(db, plan.id);
    expect(result).toMatchObject({ subscriptions: 0, granted: 0, revoked: 0 });
    await expectError(recalculatePlanSubscriptions(db, 'não-é-uuid'), 400, 'validation_failed');
  });
});
