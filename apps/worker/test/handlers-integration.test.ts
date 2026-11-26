import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  createSubscriptionCheckout,
  type Database,
  FakePaymentProvider,
  type JobOf,
  type JobType,
  receivePaymentWebhook,
  saveMyBilling,
} from '@nuva-edu/core';
import { createTestDatabase, parseDatabaseUrl, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHandlers } from '../src/handlers.ts';
import { captureLogger, handlerDependencies, testDatabaseUrl } from './helpers.ts';

const DAY = 86_400_000;
const start = new Date();
let now = start;
const plus = (milliseconds: number) => new Date(start.getTime() + milliseconds);
let database: TestDatabase;
let db: Database;
const provider = new FakePaymentProvider({ currency: 'BRL' });
const signal = new AbortController().signal;

beforeAll(async () => {
  const config = parseDatabaseUrl(testDatabaseUrl());
  const baseName = config.database.slice(0, config.database.indexOf('_test_'));
  database = await createTestDatabase({ config, baseName });
  db = createDatabase({ connectionString: database.url, maxConnections: 4 });
  provider.setNow(start);
});

afterAll(async () => {
  await db?.destroy();
  await database?.drop();
});

function job<T extends JobType>(type: T, payload: JobOf<T>['payload']): JobOf<T> {
  return { id: randomUUID(), type, payload, attempts: 1, maxAttempts: 8 } as JobOf<T>;
}

function handlers() {
  const logger = captureLogger().logger;
  return createHandlers(
    handlerDependencies(db, logger, {
      payment: {
        provider: () => provider,
        boletoDays: 3,
        graceDays: 3,
        webhookDays: 90,
        now: () => now,
      },
    }),
  );
}

async function course() {
  return db
    .insertInto('courses')
    .values({
      slug: `curso-${randomUUID()}`,
      title: 'Curso do plano',
      accessMode: 'paid',
      priceCents: 1_000,
      status: 'published',
      publishedAt: start,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

async function subscribe() {
  const user = await db
    .insertInto('users')
    .values({
      email: `${randomUUID()}@escola.test`,
      name: 'Pessoa assinante',
      emailVerifiedAt: start,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await saveMyBilling(db, user.id, {
    fullName: 'Pessoa assinante',
    taxIdType: 'cpf',
    taxId: '52998224725',
  });
  const slug = `plano-${randomUUID()}`;
  const plan = await db
    .insertInto('plans')
    .values({
      slug,
      groupKey: slug,
      title: 'Plano',
      interval: 'month',
      priceCents: 1_000,
      active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const product = await course();
  await db
    .insertInto('planItems')
    .values({ planId: plan.id, productType: 'course', productId: product.id })
    .execute();
  const url = 'http://classroom.localhost:8080/conta/compras';
  const { subscription } = await createSubscriptionCheckout(db, {
    userId: user.id,
    planId: plan.id,
    provider,
    currency: 'BRL',
    returnUrls: { success: url, pending: url, failure: url },
    now,
  });
  const row = await db
    .selectFrom('subscriptions')
    .select('providerSubscriptionId')
    .where('id', '=', subscription.id)
    .executeTakeFirstOrThrow();
  if (!row.providerSubscriptionId) throw new Error('Adesão simulada ausente');
  return {
    id: subscription.id,
    userId: user.id,
    planId: plan.id,
    courseId: product.id,
    remoteId: row.providerSubscriptionId,
  };
}

async function status(id: string) {
  return db
    .selectFrom('subscriptions')
    .select(['status', 'currentPeriodEnd', 'graceUntil'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

async function event(paymentId: string) {
  const webhook = provider.paymentWebhook(paymentId, { eventId: randomUUID() });
  const stored = await receivePaymentWebhook(db, { provider, ...webhook, now });
  return job('payment.webhook', { webhookEventId: stored.webhookEventId });
}

async function activeCourseIds(userId: string) {
  const rows = await db
    .selectFrom('entitlements')
    .select('productId')
    .where('source', '=', 'subscription')
    .where('userId', '=', userId)
    .where('revokedAt', 'is', null)
    .where('expiresAt', '>', now)
    .orderBy('productId')
    .execute();
  return rows.map((row) => row.productId);
}

it('ativa, renova, recalcula o plano, aplica carência e suspende no próximo ciclo local', async () => {
  const subscription = await subscribe();
  const worker = handlers();
  const activate = provider.authorizeSubscription(subscription.remoteId);
  const first = await event(activate.providerPaymentId);
  await worker['payment.webhook']?.(first, { signal });
  const original = await status(subscription.id);
  expect(original.status).toBe('active');
  expect(await activeCourseIds(subscription.userId)).toEqual([subscription.courseId]);

  now = original.currentPeriodEnd ?? plus(31 * DAY);
  provider.setNow(now);
  const renewal = provider.renewSubscription(subscription.remoteId, { outcome: 'approved' });
  const renewalEvent = await event(renewal.providerPaymentId);
  await worker['payment.webhook']?.(renewalEvent, { signal });
  await worker['payment.webhook']?.(renewalEvent, { signal });
  const renewed = await status(subscription.id);
  expect(renewed.status).toBe('active');
  expect(renewed.currentPeriodEnd?.getTime()).toBeGreaterThan(now.getTime());

  const added = await course();
  await db
    .updateTable('planItems')
    .set({ productId: added.id })
    .where('planId', '=', subscription.planId)
    .execute();
  await worker['entitlement.recompute'](
    job('entitlement.recompute', { productType: 'plan', productId: subscription.planId }),
    { signal },
  );
  expect(await activeCourseIds(subscription.userId)).toEqual([added.id]);

  now = renewed.currentPeriodEnd ?? plus(62 * DAY);
  provider.setNow(now);
  const refused = provider.renewSubscription(subscription.remoteId, { outcome: 'rejected' });
  await worker['payment.webhook']?.(await event(refused.providerPaymentId), { signal });
  const delinquent = await status(subscription.id);
  expect(delinquent.status).toBe('past_due');
  expect(await activeCourseIds(subscription.userId)).toEqual([added.id]);

  now = new Date((delinquent.graceUntil ?? now).getTime() + 1);
  expect(await activeCourseIds(subscription.userId)).toEqual([]);
  await worker['payment.reconcile_orders']?.(job('payment.reconcile_orders', {}), { signal });
  expect((await status(subscription.id)).status).toBe('suspended');
});

it('expira checkout sem aviso e aplica a cobrança já aprovada quando o aviso chega', async () => {
  now = plus(80 * DAY);
  provider.setNow(now);
  const subscription = await subscribe();
  const paid = provider.authorizeSubscription(subscription.remoteId);
  await db
    .updateTable('subscriptions')
    .set({ createdAt: new Date(now.getTime() - 31 * 60_000) })
    .where('id', '=', subscription.id)
    .execute();
  const worker = handlers();
  await worker['payment.reconcile_orders']?.(job('payment.reconcile_orders', {}), { signal });
  expect((await status(subscription.id)).status).toBe('expired');
  await worker['payment.webhook']?.(await event(paid.providerPaymentId), { signal });
  expect((await status(subscription.id)).status).toBe('active');
  expect(await activeCourseIds(subscription.userId)).toEqual([subscription.courseId]);
});
