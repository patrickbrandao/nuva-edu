import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applySubscriptionPayment,
  cancelMySubscription,
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
  DAY,
  integrationProvider,
  makeAdmin,
  pendingOrder,
  pendingSubscription,
} from './helpers.ts';

// Reconciliação periódica e regras de ciclo de vida que o webhook também usa (specs 012 e 013):
// webhook perdido, assinatura pausada/cancelada, reembolso pendente ou recusado e a aprovação
// tardia que não reativa uma assinatura cancelada pelo aluno.

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

async function orderStatus(orderId: string): Promise<string> {
  const row = await db
    .selectFrom('orders')
    .select('status')
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  return row.status;
}

async function orderEntitlements(orderId: string) {
  return db
    .selectFrom('entitlements')
    .innerJoin('orderItems', 'orderItems.id', 'entitlements.sourceId')
    .select(['entitlements.id', 'entitlements.revokedAt'])
    .where('entitlements.source', '=', 'order')
    .where('orderItems.orderId', '=', orderId)
    .execute();
}

async function subscriptionStatus(subscriptionId: string): Promise<string> {
  const row = await db
    .selectFrom('subscriptions')
    .select('status')
    .where('id', '=', subscriptionId)
    .executeTakeFirstOrThrow();
  return row.status;
}

async function subscriptionEntitlements(subscriptionId: string) {
  return db
    .selectFrom('entitlements')
    .select(['id', 'revokedAt'])
    .where('source', '=', 'subscription')
    .where('sourceId', '=', subscriptionId)
    .execute();
}

async function subscriptionPaymentId(subscriptionId: string): Promise<string> {
  const row = await db
    .selectFrom('payments')
    .select('id')
    .where('subscriptionId', '=', subscriptionId)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function paymentStatus(paymentId: string): Promise<{ status: string; refunded: number }> {
  const row = await db
    .selectFrom('payments')
    .select(['status', 'refundedCents'])
    .where('id', '=', paymentId)
    .executeTakeFirstOrThrow();
  return { status: row.status, refunded: Number(row.refundedCents) };
}

async function activate(
  subscriptionId: string,
  providerSubscriptionId: string,
): Promise<{ paymentId: string; providerPaymentId: string }> {
  const payment = provider.authorizeSubscription(providerSubscriptionId);
  await applySubscriptionPayment(db, 'fake', payment, { graceDays: 3 });
  return {
    paymentId: await subscriptionPaymentId(subscriptionId),
    providerPaymentId: payment.providerPaymentId,
  };
}

describe('reconciliação de pedidos', () => {
  it('webhook perdido: a cobrança aprovada é aplicada em até 5 min', async () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const order = await pendingOrder(db, provider, student, { now: startedAt });
    provider.approvePayment(order.payment.providerPaymentId, { method: 'card' });

    // Ainda dentro dos 2 min: nada a fazer.
    const early = await reconcilePendingOrders(db, provider, {
      now: new Date(startedAt.getTime() + 60_000),
    });
    expect(early.checked).toBe(0);
    expect(await orderStatus(order.orderId)).toBe('pending');

    const result = await reconcilePendingOrders(db, provider, {
      now: new Date(startedAt.getTime() + 3 * 60_000),
    });
    expect(result.applied).toBe(1);
    expect(await orderStatus(order.orderId)).toBe('paid');
    expect(await orderEntitlements(order.orderId)).toHaveLength(1);

    // Repetir a varredura não concede de novo.
    await reconcilePendingOrders(db, provider, {
      now: new Date(startedAt.getTime() + 4 * 60_000),
    });
    expect(await orderEntitlements(order.orderId)).toHaveLength(1);
  });

  it('pedido sem pagamento no provedor continua pending', async () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const order = await pendingOrder(db, provider, student, { now: startedAt });
    const result = await reconcilePendingOrders(db, provider, {
      now: new Date(startedAt.getTime() + 3 * 60_000),
    });
    expect(result.checked).toBe(1);
    expect(result.applied).toBe(0);
    expect(await orderStatus(order.orderId)).toBe('pending');
  });
});

describe('reconciliação de assinaturas', () => {
  it('provedor pausado leva a past_due; cancelado encerra e revoga', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    await activate(subscription.subscriptionId, subscription.providerSubscriptionId);

    provider.pauseSubscription(subscription.providerSubscriptionId);
    const paused = await reconcileSubscriptions(db, provider);
    expect(paused.applied).toBe(1);
    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('past_due');

    provider.cancelSubscription(subscription.providerSubscriptionId);
    const canceled = await reconcileSubscriptions(db, provider);
    expect(canceled.applied).toBe(1);
    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('ended');
    const entitlements = await subscriptionEntitlements(subscription.subscriptionId);
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it('provedor autorizado à frente avança o período sem ativar sozinho', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    await activate(subscription.subscriptionId, subscription.providerSubscriptionId);

    provider.advance(31 * DAY);
    provider.renewSubscription(subscription.providerSubscriptionId);
    const result = await reconcileSubscriptions(db, provider);
    expect(result.applied).toBe(1);
    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('active');
  });
});

describe('reconciliação de reembolsos', () => {
  it('reembolso pendente aprovado conclui e mantém a assinatura no estorno parcial', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber, {
      priceCents: 10_000,
    });
    const { paymentId } = await activate(
      subscription.subscriptionId,
      subscription.providerSubscriptionId,
    );

    const requestedAt = new Date('2026-01-02T00:00:00.000Z');
    provider.setRefundOutcome('pending');
    const refund = await requestSubscriptionRefund(db, adminRequest(admin), {
      subscriptionId: subscription.subscriptionId,
      paymentId,
      reason: 'Cortesia parcial',
      amountCents: 2_500,
      now: requestedAt,
    });
    await executeRefund(db, provider, refund.id, { now: requestedAt });
    const pending = await db
      .selectFrom('refunds')
      .select(['status', 'providerRefundId'])
      .where('id', '=', refund.id)
      .executeTakeFirstOrThrow();
    expect(pending.status).toBe('requested');
    expect(pending.providerRefundId).not.toBeNull();

    // Antes dos 5 min, a janela ainda não olha o reembolso.
    const early = await reconcileRefunds(db, provider, {
      now: new Date(requestedAt.getTime() + 60_000),
    });
    expect(early.checked).toBe(0);

    provider.approveRefund(pending.providerRefundId as string);
    const result = await reconcileRefunds(db, provider, {
      now: new Date(requestedAt.getTime() + 6 * 60_000),
    });
    expect(result.applied).toBe(1);

    const done = await db
      .selectFrom('refunds')
      .select(['status', 'doneAt'])
      .where('id', '=', refund.id)
      .executeTakeFirstOrThrow();
    expect(done.status).toBe('done');
    expect(done.doneAt).toBeInstanceOf(Date);
    expect(await paymentStatus(paymentId)).toEqual({
      status: 'partially_refunded',
      refunded: 2_500,
    });
    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('active');
  });

  it('reembolso recusado pelo provedor vira failed', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const { paymentId } = await activate(
      subscription.subscriptionId,
      subscription.providerSubscriptionId,
    );

    const requestedAt = new Date('2026-01-02T00:00:00.000Z');
    provider.setRefundOutcome('pending');
    const refund = await requestSubscriptionRefund(db, adminRequest(admin), {
      subscriptionId: subscription.subscriptionId,
      paymentId,
      reason: 'Recusa do provedor',
      amountCents: 1_000,
      now: requestedAt,
    });
    await executeRefund(db, provider, refund.id, { now: requestedAt });
    const stored = await db
      .selectFrom('refunds')
      .select('providerRefundId')
      .where('id', '=', refund.id)
      .executeTakeFirstOrThrow();
    provider.rejectRefund(stored.providerRefundId as string);

    const result = await reconcileRefunds(db, provider, {
      now: new Date(requestedAt.getTime() + 6 * 60_000),
    });
    expect(result.failed).toBe(1);
    const failed = await db
      .selectFrom('refunds')
      .select(['status', 'error'])
      .where('id', '=', refund.id)
      .executeTakeFirstOrThrow();
    expect(failed.status).toBe('failed');
    expect(failed.error).toBeTruthy();
    expect(await paymentStatus(paymentId)).toEqual({ status: 'approved', refunded: 0 });
    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('active');
  });

  it('reembolso pedido sem execução volta para a fila', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const { paymentId } = await activate(
      subscription.subscriptionId,
      subscription.providerSubscriptionId,
    );
    const requestedAt = new Date('2026-01-02T00:00:00.000Z');
    const refund = await requestSubscriptionRefund(db, adminRequest(admin), {
      subscriptionId: subscription.subscriptionId,
      paymentId,
      reason: 'Fila perdida',
      amountCents: 1_000,
      now: requestedAt,
    });

    // A tarefa original ainda está na fila; a janela não cria uma segunda.
    const result = await reconcileRefunds(db, provider, {
      now: new Date(requestedAt.getTime() + 6 * 60_000),
    });
    expect(result.checked).toBe(1);
    const jobs = await db
      .selectFrom('jobs')
      .select('id')
      .where('uniqueKey', '=', `refund.execute:${refund.id}`)
      .execute();
    expect(jobs).toHaveLength(1);
  });
});

describe('ciclo de vida da assinatura com pagamento tardio', () => {
  it('aprovação depois do cancelamento da pending não reativa', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const payment = provider.authorizeSubscription(subscription.providerSubscriptionId);

    // O aluno cancela antes de o webhook da primeira cobrança chegar.
    await cancelMySubscription(db, provider, subscriber.id, subscription.subscriptionId);
    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('expired');

    const webhook = provider.paymentWebhook(payment.providerPaymentId, {
      eventId: 'evt-tardia',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });
    await processPaymentWebhook(db, provider, received.webhookEventId);

    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('expired');
    expect(await subscriptionEntitlements(subscription.subscriptionId)).toHaveLength(0);
    // O dinheiro aprovado continua registrado para análise e reembolso.
    const stored = await db
      .selectFrom('payments')
      .select('status')
      .where('subscriptionId', '=', subscription.subscriptionId)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('approved');
  });

  it('pending vencida por prazo ainda ativa com a cobrança aprovada', async () => {
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const payment = provider.authorizeSubscription(subscription.providerSubscriptionId);
    await db
      .updateTable('subscriptions')
      .set({ status: 'expired' })
      .where('id', '=', subscription.subscriptionId)
      .execute();

    const webhook = provider.paymentWebhook(payment.providerPaymentId, {
      eventId: 'evt-vencida',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });
    await processPaymentWebhook(db, provider, received.webhookEventId);

    expect(await subscriptionStatus(subscription.subscriptionId)).toBe('active');
    expect(await subscriptionEntitlements(subscription.subscriptionId)).toHaveLength(1);
  });
});
