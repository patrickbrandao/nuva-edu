import { randomUUID } from 'node:crypto';
import {
  addCartItem,
  createOrder,
  type Database,
  FakePaymentProvider,
  type JobOf,
  type JobType,
  orderExternalReference,
  receivePaymentWebhook,
  requestOrderRefund,
  saveMyBilling,
} from '@nuva-edu/core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createSalesHandlers } from '../../src/handlers/sales.ts';
import { purgeWebhookEvents } from '../../src/retention-sales.ts';
import { dueWindow } from '../../src/scheduler.ts';
import { SALES_RECURRING_JOBS } from '../../src/scheduler-sales.ts';
import { captureLogger, openDatabase } from '../helpers.ts';

const DAY = 86_400_000;
const MINUTE = 60_000;
const NOW = new Date();
const provider = new FakePaymentProvider({ currency: 'BRL' });
const signal = new AbortController().signal;
let db: Database;

beforeAll(() => {
  db = openDatabase();
  provider.setNow(NOW);
});
afterAll(() => db.destroy());

function handlers(now = NOW) {
  return createSalesHandlers({
    db,
    logger: captureLogger().logger,
    provider: () => provider,
    boletoDays: 3,
    graceDays: 3,
    now: () => now,
  });
}

function job<T extends JobType>(type: T, payload: JobOf<T>['payload'], attempts = 1): JobOf<T> {
  return { id: randomUUID(), type, payload, attempts, maxAttempts: 8 } as JobOf<T>;
}

async function insertUser(role: 'admin' | 'student') {
  return db
    .insertInto('users')
    .values({
      email: `${randomUUID()}@escola.test`,
      name: 'Pessoa de teste',
      role,
      emailVerifiedAt: NOW,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

async function purchase(age = 0) {
  const buyer = await insertUser('student');
  await saveMyBilling(db, buyer.id, {
    fullName: 'Compradora de teste',
    taxIdType: 'cpf',
    taxId: '52998224725',
  });
  const course = await db
    .insertInto('courses')
    .values({
      slug: `curso-${randomUUID()}`,
      title: 'Curso pago',
      accessMode: 'paid',
      priceCents: 4_900,
      status: 'published',
      publishedAt: NOW,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await addCartItem(db, buyer.id, { productType: 'course', productId: course.id }, 'BRL');
  const url = 'http://classroom.localhost:8080/conta/compras';
  const createdAt = new Date(NOW.getTime() - age);
  const { order } = await createOrder(db, {
    userId: buyer.id,
    currency: 'BRL',
    provider,
    returnUrls: { success: url, pending: url, failure: url },
    now: createdAt,
  });
  const storedOrder = await db
    .updateTable('orders')
    .set({ createdAt })
    .where('id', '=', order.id)
    .returning('providerCheckoutId')
    .executeTakeFirstOrThrow();
  const [payment] = await provider.findPaymentsByReference(orderExternalReference(order.id));
  if (!payment || !storedOrder.providerCheckoutId) throw new Error('Checkout simulado ausente');
  return {
    courseId: course.id,
    buyerId: buyer.id,
    orderId: order.id,
    checkoutId: storedOrder.providerCheckoutId,
    paymentId: payment.providerPaymentId,
  };
}

async function findOrder(id: string) {
  return db.selectFrom('orders').select('status').where('id', '=', id).executeTakeFirstOrThrow();
}

async function eventFor(paymentId: string) {
  const webhook = provider.paymentWebhook(paymentId, { eventId: randomUUID() });
  const event = await receivePaymentWebhook(db, { provider, ...webhook, now: NOW });
  return job('payment.webhook', { webhookEventId: event.webhookEventId });
}

async function eventRow(id: string) {
  return db
    .selectFrom('webhookEvents')
    .select(['status', 'error', 'attempts'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

it('repete webhook e liberação sem duplicar direitos ou reabrir um pedido estornado', async () => {
  const sale = await purchase();
  provider.approvePayment(sale.paymentId);
  const webhook = await eventFor(sale.paymentId);
  const saleHandlers = handlers();
  const fulfill = job('order.fulfill', { orderId: sale.orderId });
  await saleHandlers['payment.webhook'](webhook, { signal });
  await saleHandlers['payment.webhook'](webhook, { signal });
  await saleHandlers['order.fulfill'](fulfill, { signal });
  expect(await findOrder(sale.orderId)).toEqual({ status: 'paid' });
  expect(await eventRow(webhook.payload.webhookEventId)).toMatchObject({ attempts: 1 });

  const admin = await insertUser('admin');
  const refund = await requestOrderRefund(
    db,
    {
      actor: { id: admin.id, role: 'admin' },
      context: { ip: '127.0.0.1', requestId: randomUUID() },
    },
    { orderId: sale.orderId, reason: 'Pedido de estorno' },
  );
  const execute = job('refund.execute', { refundId: refund.id });
  await saleHandlers['refund.execute'](execute, { signal });
  await saleHandlers['refund.execute'](execute, { signal });
  await saleHandlers['order.fulfill'](fulfill, { signal });
  expect(await findOrder(sale.orderId)).toEqual({ status: 'refunded' });
  expect(provider.listRefunds(sale.paymentId)).toHaveLength(1);
  const rights = await db
    .selectFrom('entitlements')
    .select('revokedAt')
    .where('userId', '=', sale.buyerId)
    .where('productId', '=', sale.courseId)
    .execute();
  expect(rights).toEqual([{ revokedAt: expect.any(Date) }]);
});

it('busca o estado atual mesmo com entrega de reembolso antes da aprovação', async () => {
  const sale = await purchase();
  provider.approvePayment(sale.paymentId);
  const approval = await eventFor(sale.paymentId);
  await provider.refund(sale.paymentId, null);
  const refund = await eventFor(sale.paymentId);
  const handle = handlers()['payment.webhook'];
  await handle(refund, { signal });
  await handle(approval, { signal });
  expect(await findOrder(sale.orderId)).toEqual({ status: 'refunded' });
});

it('deixa evento recebido em falha transitória e registra falha na última tentativa', async () => {
  const sale = await purchase();
  const webhook = await eventFor(sale.paymentId);
  const handle = handlers()['payment.webhook'];
  provider.setUnavailable(true, ['getPayment']);
  try {
    await expect(handle(webhook, { signal })).rejects.toMatchObject({
      code: 'payment_provider_unavailable',
    });
    expect(await eventRow(webhook.payload.webhookEventId)).toMatchObject({ status: 'received' });
    await handle({ ...webhook, attempts: webhook.maxAttempts }, { signal });
    expect(await eventRow(webhook.payload.webhookEventId)).toEqual({
      status: 'failed',
      error: 'payment_provider_unavailable',
      attempts: 2,
    });
  } finally {
    provider.setUnavailable(false);
  }
});

it('valor aprovado divergente não libera o pedido e é registrado no evento', async () => {
  const sale = await purchase();
  const approved = provider.approvePayment(sale.paymentId);
  const webhook = await eventFor(sale.paymentId);
  const original = provider.getPayment.bind(provider);
  const read = vi.spyOn(provider, 'getPayment').mockImplementationOnce(async (id) => ({
    ...(await original(id)),
    amountCents: approved.amountCents - 1,
  }));
  try {
    await handlers()['payment.webhook'](webhook, { signal });
  } finally {
    read.mockRestore();
  }
  expect(await eventRow(webhook.payload.webhookEventId)).toMatchObject({
    status: 'failed',
    error: 'amount_mismatch',
  });
  expect(await findOrder(sale.orderId)).toEqual({ status: 'pending' });
});

it('reconcilia webhook perdido, cancela vencido e mantém o boleto dentro do prazo', async () => {
  const approved = await purchase(3 * MINUTE);
  const expired = await purchase(31 * MINUTE);
  const boleto = await purchase(31 * MINUTE);
  provider.approvePayment(approved.paymentId);
  const read = provider.findPaymentsByReference.bind(provider);
  const spy = vi
    .spyOn(provider, 'findPaymentsByReference')
    .mockImplementation(async (reference) =>
      (await read(reference)).map((payment) =>
        payment.providerPaymentId === boleto.paymentId ? { ...payment, method: 'boleto' } : payment,
      ),
    );
  try {
    await handlers()['payment.reconcile_orders'](job('payment.reconcile_orders', {}), { signal });
  } finally {
    spy.mockRestore();
  }
  expect(await findOrder(approved.orderId)).toEqual({ status: 'paid' });
  expect(await findOrder(expired.orderId)).toEqual({ status: 'expired' });
  expect(await provider.getPayment(expired.paymentId)).toMatchObject({ status: 'canceled' });
  expect(await findOrder(boleto.orderId)).toEqual({ status: 'pending' });
});

it('programa as janelas de reconciliação de cinco e trinta minutos em UTC', () => {
  const now = new Date('2026-11-26T22:18:00.000Z');
  expect(
    SALES_RECURRING_JOBS.map(({ schedule }) => dueWindow(schedule, now, 'America/Sao_Paulo')),
  ).toEqual(['2026-11-26T22:15', '2026-11-26T22:00']);
});

it('expurga metadados antigos de webhook em lotes, inclusive rejeitados', async () => {
  const eventId = randomUUID();
  const rows = await db
    .insertInto('webhookEvents')
    .values([
      {
        provider: 'fake',
        eventId,
        status: 'rejected',
        error: 'invalid_signature',
        receivedAt: new Date(NOW.getTime() - 91 * DAY),
      },
      {
        provider: 'fake',
        eventId,
        status: 'processed',
        processedAt: new Date(NOW.getTime() - 91 * DAY),
        receivedAt: new Date(NOW.getTime() - 91 * DAY),
      },
      {
        provider: 'fake',
        eventId: randomUUID(),
        status: 'rejected',
        error: 'invalid_signature',
        receivedAt: new Date(NOW.getTime() - 89 * DAY),
      },
    ])
    .returning('id')
    .execute();
  expect(await purgeWebhookEvents(db, { now: NOW, days: 90, batchSize: 1 })).toBe(2);
  const remaining = await db
    .selectFrom('webhookEvents')
    .select('id')
    .where(
      'id',
      'in',
      rows.map((row) => row.id),
    )
    .execute();
  expect(remaining).toEqual([rows[2]]);
});
