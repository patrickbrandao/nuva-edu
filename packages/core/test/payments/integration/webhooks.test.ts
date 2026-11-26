import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  type Database,
  type FakePaymentProvider,
  getMyOrder,
  orderExternalReference,
  PaymentWebhookSignatureError,
  processPaymentWebhook,
  receivePaymentWebhook,
} from '../../../src/index.ts';
import { expectError, type TestUser } from '../../sales/fixtures.ts';
import {
  billingStudent,
  integrationProvider,
  makeAdmin,
  orphanPayment,
  pendingOrder,
  pendingSubscription,
} from './helpers.ts';

// Recepção e processamento do webhook (spec 013, "Webhook" e "Processamento no worker"): chave
// idempotente, assinatura inválida, valor divergente, recurso sem correspondência, falha
// transitória/definitiva e ordem de chegada.

let testDb: TestDatabase;
let db: Database;
let provider: FakePaymentProvider;
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
  student = await billingStudent(db);
});

async function eventRow(id: string) {
  return db.selectFrom('webhookEvents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function orderRow(id: string) {
  return db
    .selectFrom('orders')
    .select(['status', 'paidAt'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
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

async function queuedWebhookJobs(webhookEventId: string): Promise<number> {
  const row = await db
    .selectFrom('jobs')
    .select((expression) => expression.fn.countAll<number>().as('n'))
    .where('uniqueKey', '=', `payment.webhook:${webhookEventId}`)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

describe('recepção do webhook', () => {
  it('mesmo evento cinco vezes: um registro, uma tarefa e um único efeito', async () => {
    const order = await pendingOrder(db, provider, student);
    const approved = provider.approvePayment(order.payment.providerPaymentId, {
      method: 'card',
    });
    const webhook = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-repetido',
    });

    const first = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });
    expect(first.created).toBe(true);
    expect(first.event).toMatchObject({
      provider: 'fake',
      eventId: 'evt-repetido',
      resourceType: 'payment',
      resourceId: approved.providerPaymentId,
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const repeated = await receivePaymentWebhook(db, {
        provider,
        headers: webhook.headers,
        rawBody: webhook.rawBody,
      });
      expect(repeated).toMatchObject({
        webhookEventId: first.webhookEventId,
        created: false,
      });
    }
    expect(await queuedWebhookJobs(first.webhookEventId)).toBe(1);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const processed = await processPaymentWebhook(db, provider, first.webhookEventId);
      expect(processed.status).toBe('processed');
    }

    const event = await eventRow(first.webhookEventId);
    expect(event).toMatchObject({ status: 'processed', attempts: 1, error: null });
    expect(event.processedAt).toBeInstanceOf(Date);

    const orderAfter = await orderRow(order.orderId);
    expect(orderAfter.status).toBe('paid');
    expect(orderAfter.paidAt).toBeInstanceOf(Date);
    expect(await orderEntitlements(order.orderId)).toHaveLength(1);

    const payments = await db
      .selectFrom('payments')
      .select('id')
      .where('orderId', '=', order.orderId)
      .execute();
    expect(payments).toHaveLength(1);
  });

  it('assinatura inválida vira rejected sem ocupar a chave do evento válido', async () => {
    const order = await pendingOrder(db, provider, student);
    const approved = provider.approvePayment(order.payment.providerPaymentId);
    const invalid = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-assinatura',
      secret: 'outro-segredo',
    });

    const error = await expectError(
      receivePaymentWebhook(db, {
        provider,
        headers: invalid.headers,
        rawBody: invalid.rawBody,
      }),
      401,
      'payment_webhook_invalid_signature',
    );
    expect(error).toBeInstanceOf(PaymentWebhookSignatureError);

    const rejected = await db
      .selectFrom('webhookEvents')
      .selectAll()
      .where('eventId', '=', 'evt-assinatura')
      .where('status', '=', 'rejected')
      .executeTakeFirstOrThrow();
    expect(rejected).toMatchObject({
      provider: 'fake',
      eventId: 'evt-assinatura',
      resourceType: 'payment',
      resourceId: approved.providerPaymentId,
      status: 'rejected',
      attempts: 0,
      error: 'invalid_signature',
      processedAt: null,
    });

    // O evento válido com o mesmo identificador entra normalmente, apesar da rejeição anterior.
    const valid = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-assinatura',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: valid.headers,
      rawBody: valid.rawBody,
    });
    expect(received.created).toBe(true);
    expect(received.webhookEventId).not.toBe(rejected.id);

    // O rejeitado não aceita reprocessamento.
    const untouched = await processPaymentWebhook(db, provider, rejected.id);
    expect(untouched).toMatchObject({ status: 'rejected', applied: false });
    expect(await eventRow(rejected.id)).toMatchObject({
      status: 'rejected',
      attempts: 0,
      error: 'invalid_signature',
    });

    const processed = await processPaymentWebhook(db, provider, received.webhookEventId);
    expect(processed.status).toBe('processed');
    expect((await orderRow(order.orderId)).status).toBe('paid');
  });

  it('mesmo evento válido repetido não reativa o processamento concluído', async () => {
    const order = await pendingOrder(db, provider, student);
    const approved = provider.approvePayment(order.payment.providerPaymentId);
    const webhook = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-recebido',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });
    await processPaymentWebhook(db, provider, received.webhookEventId);

    const again = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });
    expect(again.created).toBe(false);
    expect(await queuedWebhookJobs(received.webhookEventId)).toBe(1);
    expect((await eventRow(received.webhookEventId)).attempts).toBe(1);
  });
});

describe('processamento do webhook', () => {
  it('pagamento com valor diferente do pedido falha com amount_mismatch e não libera acesso', async () => {
    const order = await pendingOrder(db, provider, student);
    const divergent = provider.approvePayment(order.payment.providerPaymentId, {
      amountCents: order.totalCents + 100,
    });
    const webhook = provider.paymentWebhook(divergent.providerPaymentId, {
      eventId: 'evt-divergente',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });

    const processed = await processPaymentWebhook(db, provider, received.webhookEventId);
    expect(processed).toMatchObject({ status: 'failed', applied: false });

    const event = await eventRow(received.webhookEventId);
    expect(event).toMatchObject({
      status: 'failed',
      error: 'amount_mismatch',
      processedAt: null,
    });
    expect((await orderRow(order.orderId)).status).toBe('pending');
    expect(await orderEntitlements(order.orderId)).toHaveLength(0);

    // A cobrança fica visível ao admin mesmo com o valor divergente.
    const payment = await db
      .selectFrom('payments')
      .select(['status', 'amountCents'])
      .where('orderId', '=', order.orderId)
      .executeTakeFirstOrThrow();
    expect(Number(payment.amountCents)).toBe(order.totalCents + 100);
  });

  it('cobrança sem pedido local é ignorada', async () => {
    const orphan = await orphanPayment(provider);
    const webhook = provider.paymentWebhook(orphan.providerPaymentId, {
      eventId: 'evt-sem-dono',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });

    const processed = await processPaymentWebhook(db, provider, received.webhookEventId);
    expect(processed).toMatchObject({ status: 'ignored', applied: false });

    const event = await eventRow(received.webhookEventId);
    expect(event).toMatchObject({ status: 'ignored', error: null });
    expect(event.processedAt).toBeInstanceOf(Date);
  });

  it('falha transitória mantém o evento recebido e a última tentativa o marca failed', async () => {
    const order = await pendingOrder(db, provider, student);
    const approved = provider.approvePayment(order.payment.providerPaymentId);
    const webhook = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-transitoria',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });

    provider.setUnavailable(true, ['getPayment']);
    await expect(
      processPaymentWebhook(db, provider, received.webhookEventId),
    ).rejects.toMatchObject({ code: 'payment_provider_unavailable' });
    expect(await eventRow(received.webhookEventId)).toMatchObject({
      status: 'received',
      attempts: 1,
      error: null,
    });

    provider.setUnavailable(false);
    const processed = await processPaymentWebhook(db, provider, received.webhookEventId);
    expect(processed.status).toBe('processed');
    expect((await eventRow(received.webhookEventId)).attempts).toBe(2);
    expect((await orderRow(order.orderId)).status).toBe('paid');

    // Outra entrega, agora na última tentativa da fila.
    const otherOrder = await pendingOrder(db, provider, student);
    const otherPayment = provider.approvePayment(otherOrder.payment.providerPaymentId);
    const otherWebhook = provider.paymentWebhook(otherPayment.providerPaymentId, {
      eventId: 'evt-ultima',
    });
    const otherReceived = await receivePaymentWebhook(db, {
      provider,
      headers: otherWebhook.headers,
      rawBody: otherWebhook.rawBody,
    });
    provider.setUnavailable(true, ['getPayment']);
    const failed = await processPaymentWebhook(db, provider, otherReceived.webhookEventId, {
      finalAttempt: true,
    });
    expect(failed).toMatchObject({ status: 'failed', applied: false });
    expect((await eventRow(otherReceived.webhookEventId)).error).toBe(
      'payment_provider_unavailable',
    );
    expect((await orderRow(otherOrder.orderId)).status).toBe('pending');
  });

  it('reembolso e aprovação fora de ordem terminam no estado final do provedor', async () => {
    const order = await pendingOrder(db, provider, student);
    const approved = provider.approvePayment(order.payment.providerPaymentId);
    await provider.refund(approved.providerPaymentId, null);

    const approvalWebhook = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-aprovacao',
    });
    const refundWebhook = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: 'evt-reembolso',
    });
    const approval = await receivePaymentWebhook(db, {
      provider,
      headers: approvalWebhook.headers,
      rawBody: approvalWebhook.rawBody,
    });
    const refund = await receivePaymentWebhook(db, {
      provider,
      headers: refundWebhook.headers,
      rawBody: refundWebhook.rawBody,
    });

    // O reembolso é processado antes da aprovação; o provedor já está `refunded`.
    expect((await processPaymentWebhook(db, provider, refund.webhookEventId)).status).toBe(
      'processed',
    );
    expect((await orderRow(order.orderId)).status).toBe('refunded');
    expect((await orderEntitlements(order.orderId)).every((row) => row.revokedAt !== null)).toBe(
      true,
    );

    expect((await processPaymentWebhook(db, provider, approval.webhookEventId)).status).toBe(
      'processed',
    );
    expect((await orderRow(order.orderId)).status).toBe('refunded');

    const refunds = await db
      .selectFrom('refunds')
      .select(['status', 'amountCents'])
      .where('orderId', '=', order.orderId)
      .execute();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ status: 'done' });
    expect(Number(refunds[0]?.amountCents)).toBe(order.totalCents);
  });

  it('webhook de pagamento de assinatura ativa e de assinatura cancelada encerra', async () => {
    const admin = await makeAdmin(db);
    const subscriber = await billingStudent(db);
    const subscription = await pendingSubscription(db, provider, admin, subscriber);
    const firstPayment = provider.authorizeSubscription(subscription.providerSubscriptionId);

    const paymentWebhook = provider.paymentWebhook(firstPayment.providerPaymentId, {
      eventId: 'evt-assinatura-ativa',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: paymentWebhook.headers,
      rawBody: paymentWebhook.rawBody,
    });
    await processPaymentWebhook(db, provider, received.webhookEventId);

    const active = await db
      .selectFrom('subscriptions')
      .select('status')
      .where('id', '=', subscription.subscriptionId)
      .executeTakeFirstOrThrow();
    expect(active.status).toBe('active');

    provider.cancelSubscription(subscription.providerSubscriptionId);
    const canceledWebhook = provider.subscriptionWebhook(subscription.providerSubscriptionId, {
      eventId: 'evt-assinatura-cancelada',
    });
    const canceled = await receivePaymentWebhook(db, {
      provider,
      headers: canceledWebhook.headers,
      rawBody: canceledWebhook.rawBody,
    });
    await processPaymentWebhook(db, provider, canceled.webhookEventId);

    const ended = await db
      .selectFrom('subscriptions')
      .select(['status', 'endedAt'])
      .where('id', '=', subscription.subscriptionId)
      .executeTakeFirstOrThrow();
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it('a URL do checkout fica no pedido para a consulta posterior', async () => {
    const order = await pendingOrder(db, provider, student);
    const detail = await getMyOrder(db, student.id, order.orderId);
    expect(detail.checkoutUrl).toContain('https://checkout.payment-fake.test/');

    provider.approvePayment(order.payment.providerPaymentId);
    const webhook = provider.paymentWebhook(order.payment.providerPaymentId, {
      eventId: 'evt-url',
    });
    const received = await receivePaymentWebhook(db, {
      provider,
      headers: webhook.headers,
      rawBody: webhook.rawBody,
    });
    await processPaymentWebhook(db, provider, received.webhookEventId);

    const paid = await getMyOrder(db, student.id, order.orderId);
    expect(paid.status).toBe('paid');
    expect(paid.checkoutUrl).toBeNull();
    expect(orderExternalReference(order.orderId)).toBe(`order:${order.orderId}`);
  });
});
