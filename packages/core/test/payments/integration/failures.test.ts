import { randomUUID } from 'node:crypto';
import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applySubscriptionPayment,
  closeDatabase,
  createDatabase,
  type Database,
  executeRefund,
  type FakePaymentProvider,
  processPaymentWebhook,
  receivePaymentWebhook,
  reconcilePendingOrders,
  reconcileRefunds,
  reconcileSubscriptions,
  requestSubscriptionRefund,
} from '../../../src/index.ts';
import { adminRequest, type TestUser } from '../../sales/fixtures.ts';
import {
  billingStudent,
  integrationProvider,
  makeAdmin,
  pendingOrder,
  pendingSubscription,
  SUBSCRIPTION_RETURN_URLS,
} from './helpers.ts';

// Caminhos de falha da recepção, do processamento e da reconciliação (spec 013, "Falhas"): evento
// de outro provedor, recurso ausente no provedor, provedor fora do ar (transitório até a última
// tentativa) e erro definitivo que a janela contabiliza sem repetir.

let testDb: TestDatabase;
let db: Database;
let provider: FakePaymentProvider;
let admin: TestUser;
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
  provider = integrationProvider();
  admin = await makeAdmin(db);
  student = await billingStudent(db);
});

interface WebhookSeed {
  provider?: 'mercadopago' | 'fake';
  eventId: string;
  resourceType: 'payment' | 'subscription' | null;
  resourceId: string | null;
}

async function seedReceivedWebhook(seed: WebhookSeed): Promise<string> {
  const row = await db
    .insertInto('webhookEvents')
    .values({
      provider: seed.provider ?? 'fake',
      eventId: seed.eventId,
      resourceType: seed.resourceType,
      resourceId: seed.resourceId,
      status: 'received',
      attempts: 0,
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function eventRow(id: string) {
  return db.selectFrom('webhookEvents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('eventos que o processamento recusa', () => {
  it('provedor diferente do evento vira failed sem consultar o provedor', async () => {
    const eventId = await seedReceivedWebhook({
      provider: 'mercadopago',
      eventId: 'evt-outro-provedor',
      resourceType: 'payment',
      resourceId: 'mp_payment_1',
    });
    const result = await processPaymentWebhook(db, provider, eventId);
    expect(result).toMatchObject({ status: 'failed', applied: false });
    expect(await eventRow(eventId)).toMatchObject({
      status: 'failed',
      error: 'provider_mismatch',
      processedAt: null,
      attempts: 1,
    });
  });

  it('recurso sem identificador vira failed com invalid_resource', async () => {
    const eventId = await seedReceivedWebhook({
      eventId: 'evt-sem-recurso',
      resourceType: null,
      resourceId: null,
    });
    const result = await processPaymentWebhook(db, provider, eventId);
    expect(result).toMatchObject({ status: 'failed', applied: false });
    expect((await eventRow(eventId)).error).toBe('invalid_resource');
  });

  it('recurso desconhecido é transitório até a última tentativa', async () => {
    const eventId = await seedReceivedWebhook({
      eventId: 'evt-recurso-sumiu',
      resourceType: 'payment',
      resourceId: 'fake_payment_999999',
    });

    await expect(processPaymentWebhook(db, provider, eventId)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await eventRow(eventId)).toMatchObject({ status: 'received', attempts: 1 });

    const failed = await processPaymentWebhook(db, provider, eventId, { finalAttempt: true });
    expect(failed).toMatchObject({ status: 'failed', applied: false });
    const row = await eventRow(eventId);
    expect(row).toMatchObject({ status: 'failed', error: 'provider_not_found' });
    expect(row.attempts).toBe(2);
  });

  it('assinatura do provedor sem correspondência local é ignorada', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const plan = await db
      .selectFrom('plans')
      .innerJoin('subscriptions', 'subscriptions.planId', 'plans.id')
      .select('plans.providerPlanId as providerPlanId')
      .where('subscriptions.id', '=', subscription.subscriptionId)
      .executeTakeFirstOrThrow();
    const orphan = await provider.createSubscription({
      providerPlanId: plan.providerPlanId as string,
      buyer: { name: 'Fantasma', email: 'fantasma@exemplo.test' },
      returnUrls: SUBSCRIPTION_RETURN_URLS,
      externalReference: `subscription:${randomUUID()}`,
    });
    const eventId = await seedReceivedWebhook({
      eventId: 'evt-assinatura-fantasma',
      resourceType: 'subscription',
      resourceId: orphan.providerSubscriptionId,
    });

    const result = await processPaymentWebhook(db, provider, eventId);
    expect(result).toMatchObject({ status: 'ignored', applied: false });
    expect(await eventRow(eventId)).toMatchObject({ status: 'ignored', error: null });
  });

  it('assinatura com provedor fora do ar espera a próxima tentativa ou falha na última', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const eventId = await seedReceivedWebhook({
      eventId: 'evt-assinatura-fora',
      resourceType: 'subscription',
      resourceId: subscription.providerSubscriptionId,
    });

    provider.setUnavailable(true, ['getSubscription']);
    await expect(processPaymentWebhook(db, provider, eventId)).rejects.toMatchObject({
      code: 'payment_provider_unavailable',
    });
    const failed = await processPaymentWebhook(db, provider, eventId, { finalAttempt: true });
    expect(failed.status).toBe('failed');
    expect((await eventRow(eventId)).error).toBe('payment_provider_unavailable');
  });
});

describe('recepção concorrente', () => {
  it('cinco entregas simultâneas criam um registro e uma tarefa', async () => {
    const order = await pendingOrder(db, provider, student);
    const approved = provider.approvePayment(order.payment.providerPaymentId);
    const webhook = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-concorrente',
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        receivePaymentWebhook(db, {
          provider,
          headers: webhook.headers,
          rawBody: webhook.rawBody,
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.webhookEventId)).size).toBe(1);

    const jobs = await db
      .selectFrom('jobs')
      .select('id')
      .where('uniqueKey', '=', `payment.webhook:${results[0]?.webhookEventId}`)
      .execute();
    expect(jobs).toHaveLength(1);
  });
});

describe('reconciliação com falhas', () => {
  it('provedor fora do ar interrompe a varredura de pedidos', async () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    await pendingOrder(db, provider, student, { now: startedAt });
    provider.setUnavailable(true, ['findPaymentsByReference']);
    await expect(
      reconcilePendingOrders(db, provider, {
        now: new Date(startedAt.getTime() + 3 * 60_000),
      }),
    ).rejects.toMatchObject({ code: 'payment_provider_unavailable' });
  });

  it('divergência de valor é contabilizada como falha definitiva', async () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const order = await pendingOrder(db, provider, student, { now: startedAt });
    provider.approvePayment(order.payment.providerPaymentId, {
      amountCents: order.totalCents + 500,
    });
    const result = await reconcilePendingOrders(db, provider, {
      now: new Date(startedAt.getTime() + 3 * 60_000),
    });
    // O pedido do teste anterior continua `pending` e também é examinado; só este falha.
    expect(result).toMatchObject({ applied: 0, failed: 1 });
    const row = await db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', order.orderId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('assinatura com identificador desconhecido é ignorada e provedor fora interrompe', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const payment = provider.authorizeSubscription(subscription.providerSubscriptionId);
    await applySubscriptionPayment(db, 'fake', payment, { now: provider.now });

    await db
      .updateTable('subscriptions')
      .set({ providerSubscriptionId: 'fake_subscription_999999' })
      .where('id', '=', subscription.subscriptionId)
      .execute();
    const ignored = await reconcileSubscriptions(db, provider);
    expect(ignored).toMatchObject({ checked: 1, ignored: 1, failed: 0 });

    provider.setUnavailable(true, ['getSubscription']);
    await expect(reconcileSubscriptions(db, provider)).rejects.toMatchObject({
      code: 'payment_provider_unavailable',
    });
  });

  it('estorno desconhecido no provedor vira failed; provedor fora interrompe', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const firstPayment = provider.authorizeSubscription(subscription.providerSubscriptionId);
    await applySubscriptionPayment(db, 'fake', firstPayment, { now: provider.now });
    const storedPayment = await db
      .selectFrom('payments')
      .select('id')
      .where('subscriptionId', '=', subscription.subscriptionId)
      .executeTakeFirstOrThrow();

    const requestedAt = new Date('2026-01-02T00:00:00.000Z');
    provider.setRefundOutcome('pending');
    const refund = await requestSubscriptionRefund(db, adminRequest(admin), {
      subscriptionId: subscription.subscriptionId,
      paymentId: storedPayment.id,
      reason: 'Estorno para reconciliar',
      amountCents: 1_000,
      now: requestedAt,
    });
    await executeRefund(db, provider, refund.id, { now: requestedAt });
    await db
      .updateTable('refunds')
      .set({ providerRefundId: 'fake_refund_999999' })
      .where('id', '=', refund.id)
      .execute();

    const result = await reconcileRefunds(db, provider, {
      now: new Date(requestedAt.getTime() + 6 * 60_000),
    });
    expect(result).toMatchObject({ checked: 1, failed: 1 });
    expect(
      await db
        .selectFrom('refunds')
        .select(['status', 'error'])
        .where('id', '=', refund.id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ status: 'failed' });

    // Um novo reembolso pendente, agora com o provedor fora do ar, interrompe a varredura.
    provider.setRefundOutcome('pending');
    const second = await requestSubscriptionRefund(db, adminRequest(admin), {
      subscriptionId: subscription.subscriptionId,
      paymentId: storedPayment.id,
      reason: 'Estorno com provedor fora',
      amountCents: 500,
      now: requestedAt,
    });
    await executeRefund(db, provider, second.id, { now: requestedAt });
    provider.setUnavailable(true, ['getRefundStatus']);
    await expect(
      reconcileRefunds(db, provider, {
        now: new Date(requestedAt.getTime() + 6 * 60_000),
      }),
    ).rejects.toMatchObject({ code: 'payment_provider_unavailable' });
  });
});
