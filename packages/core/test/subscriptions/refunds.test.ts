import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addCartItem,
  applyChargeback,
  applyOrderPayment,
  applyProviderPaymentRefund,
  applySubscriptionPayment,
  closeDatabase,
  createDatabase,
  createOrder,
  createSubscriptionCheckout,
  type Database,
  executeRefund,
  loadOrderRefunds,
  loadSubscriptionRefunds,
  orderExternalReference,
  type RefundView,
  requestOrderRefund,
  requestSubscriptionRefund,
  retryRefund,
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
  RETURN_URLS,
  staffRequest,
  type TestUser,
} from './fixtures.ts';

// Reembolso de pedido e de cobrança recorrente, retry e chargeback (specs 011 e 012).

let testDb: TestDatabase;
let db: Database;
let admin: TestUser;
let manager: TestUser;

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
});

interface PaidOrder {
  orderId: string;
  paymentId: string;
  courseIds: string[];
}

/** Pedido pago com um curso por item da cesta, confirmado pelo provedor fake. */
async function paidOrder(
  subscriber: TestUser,
  prices: readonly number[] = [4_900],
): Promise<PaidOrder> {
  const provider = makeProvider();
  const courseIds: string[] = [];
  for (const priceCents of prices) {
    const courseId = await makeCourse(db, { priceCents });
    courseIds.push(courseId);
    await addCartItem(db, subscriber.id, { productType: 'course', productId: courseId }, CURRENCY);
  }
  const { order } = await createOrder(db, {
    userId: subscriber.id,
    provider,
    currency: CURRENCY,
    returnUrls: RETURN_URLS,
  });
  const pending = first(await provider.findPaymentsByReference(orderExternalReference(order.id)));
  const payment = provider.approvePayment(pending.providerPaymentId, { method: 'card' });
  await applyOrderPayment(db, 'fake', payment);
  const stored = await db
    .selectFrom('payments')
    .select(['id', 'providerPaymentId'])
    .where('orderId', '=', order.id)
    .executeTakeFirstOrThrow();
  return { orderId: order.id, paymentId: stored.id, courseIds };
}

async function orderItemIds(orderId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('orderItems')
    .select('id')
    .where('orderId', '=', orderId)
    .orderBy('id')
    .execute();
  return rows.map((row) => row.id);
}

async function orderStatus(orderId: string): Promise<string> {
  const row = await db
    .selectFrom('orders')
    .select('status')
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  return row.status;
}

async function paymentStatus(paymentId: string): Promise<{ status: string; refunded: number }> {
  const row = await db
    .selectFrom('payments')
    .select(['status', 'refundedCents'])
    .where('id', '=', paymentId)
    .executeTakeFirstOrThrow();
  return { status: row.status, refunded: Number(row.refundedCents) };
}

async function activeEntitlements(userId: string, productId: string): Promise<number> {
  const row = await db
    .selectFrom('entitlements')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('userId', '=', userId)
    .where('productId', '=', productId)
    .where('revokedAt', 'is', null)
    .executeTakeFirstOrThrow();
  return row.n;
}

function refundQueued(refundId: string) {
  return db
    .selectFrom('jobs')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('type', '=', 'refund.execute')
    .where(sql<boolean>`payload->>'refundId' = ${refundId}`)
    .executeTakeFirstOrThrow()
    .then((row) => row.n);
}

describe('reembolso de pedido', () => {
  it('pede o total, executa no provedor e revoga os direitos, deixando o pedido reembolsado', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const paid = await paidOrder(subscriber);

    const requested = await requestOrderRefund(db, staffRequest(admin), {
      orderId: paid.orderId,
      reason: 'Aluno desistiu',
    });
    expect(requested).toMatchObject({
      status: 'requested',
      amountCents: 4_900,
      orderId: paid.orderId,
      paymentId: paid.paymentId,
      reason: 'Aluno desistiu',
      requestedBy: { name: 'Pessoa admin' },
    });
    expect(requested.items).toHaveLength(1);
    expect(await refundQueued(requested.id)).toBe(1);

    const done = await executeRefund(db, provider, requested.id);
    expect(done).toMatchObject({ status: 'done', providerRefundId: expect.any(String) });
    expect(done.doneAt).not.toBeNull();
    expect(await orderStatus(paid.orderId)).toBe('refunded');
    expect(await paymentStatus(paid.paymentId)).toEqual({ status: 'refunded', refunded: 4_900 });
    expect(await activeEntitlements(subscriber.id, first(paid.courseIds))).toBe(0);

    // A leitura devolve o reembolso do pedido.
    const list = await loadOrderRefunds(db, paid.orderId);
    expect(list.map((entry) => entry.id)).toContain(done.id);

    // Repetir não faz nada além de devolver o mesmo reembolso.
    const again = await executeRefund(db, provider, done.id);
    expect(again.status).toBe('done');
  });

  it('reembolso parcial revoga só o item estornado e mantém o resto do pedido', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const paid = await paidOrder(subscriber, [4_900, 2_900]);
    const [firstItem, secondItem] = await orderItemIds(paid.orderId);
    const courseA = paid.courseIds[0] as string;
    const courseB = paid.courseIds[1] as string;

    const refund = await requestOrderRefund(db, staffRequest(admin), {
      orderId: paid.orderId,
      reason: 'Um produto devolvido',
      items: [{ orderItemId: secondItem as string, amountCents: 2_900 }],
    });
    expect(refund.amountCents).toBe(2_900);
    expect(refund.items.map((item) => item.orderItemId)).toEqual([secondItem]);

    await executeRefund(db, provider, refund.id);
    expect(await orderStatus(paid.orderId)).toBe('partially_refunded');
    expect(await activeEntitlements(subscriber.id, courseA)).toBe(1);
    expect(await activeEntitlements(subscriber.id, courseB)).toBe(0);
    expect(await paymentStatus(paid.paymentId)).toEqual({
      status: 'partially_refunded',
      refunded: 2_900,
    });

    // O saldo restante ainda pode ser estornado e aí o pedido fecha.
    const rest = await requestOrderRefund(db, staffRequest(admin), {
      orderId: paid.orderId,
      reason: 'O resto também',
      items: [{ orderItemId: firstItem as string, amountCents: 4_900 }],
    });
    await executeRefund(db, provider, rest.id);
    expect(await orderStatus(paid.orderId)).toBe('refunded');
    expect(await paymentStatus(paid.paymentId)).toEqual({ status: 'refunded', refunded: 7_800 });
  });

  it('recusa quem não pode, motivo vazio, pedido não pago, item alheio e valor acima do pago', async () => {
    const subscriber = await makeSubscriber(db);
    const paid = await paidOrder(subscriber);
    const items = await orderItemIds(paid.orderId);
    const itemId = first(items);

    await expectError(
      requestOrderRefund(db, staffRequest(manager), { orderId: paid.orderId, reason: 'motivo' }),
      403,
      'permission_denied',
    );
    await expectError(
      requestOrderRefund(db, staffRequest(admin), { orderId: paid.orderId, reason: '' }),
      400,
      'validation_failed',
    );
    await expectError(
      requestOrderRefund(db, staffRequest(admin), {
        orderId: '00000000-0000-4000-8000-000000000000',
        reason: 'motivo',
      }),
      404,
      'not_found',
    );
    await expectError(
      requestOrderRefund(db, staffRequest(admin), {
        orderId: paid.orderId,
        reason: 'motivo',
        items: [],
      }),
      422,
      'refund_exceeds_paid',
    );
    await expectError(
      requestOrderRefund(db, staffRequest(admin), {
        orderId: paid.orderId,
        reason: 'motivo',
        items: [{ orderItemId: '00000000-0000-4000-8000-000000000000', amountCents: 100 }],
      }),
      422,
      'refund_exceeds_paid',
    );
    await expectError(
      requestOrderRefund(db, staffRequest(admin), {
        orderId: paid.orderId,
        reason: 'motivo',
        items: [{ orderItemId: itemId, amountCents: 5_000 }],
      }),
      422,
      'refund_exceeds_paid',
    );

    // Depois de reembolsado por inteiro, o pedido não é reembolsável de novo.
    const total = await requestOrderRefund(db, staffRequest(admin), {
      orderId: paid.orderId,
      reason: 'total',
    });
    await executeRefund(db, makeProvider(), total.id);
    await expectError(
      requestOrderRefund(db, staffRequest(admin), { orderId: paid.orderId, reason: 'outra vez' }),
      409,
      'order_not_refundable',
    );
  });

  it('falha do provedor deixa o reembolso falho e o retry o devolve à fila', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const paid = await paidOrder(subscriber);
    const refund = await requestOrderRefund(db, staffRequest(admin), {
      orderId: paid.orderId,
      reason: 'Primeira tentativa',
    });

    provider.setUnavailable(true, ['refund']);
    const failed = await executeRefund(db, provider, refund.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBeTruthy();
    // Nada muda no pedido enquanto o estorno não conclui.
    expect(await orderStatus(paid.orderId)).toBe('paid');

    provider.setUnavailable(false);
    await expectError(retryRefund(db, staffRequest(manager), refund.id), 403, 'permission_denied');
    const retried = await retryRefund(db, staffRequest(admin), refund.id);
    expect(retried).toMatchObject({ status: 'requested', error: null });
    expect(await refundQueued(refund.id)).toBe(1);

    const done = await executeRefund(db, provider, refund.id);
    expect(done.status).toBe('done');
    expect(await orderStatus(paid.orderId)).toBe('refunded');
    await expectError(retryRefund(db, staffRequest(admin), refund.id), 409, 'refund_not_retryable');
  });

  it('reembolso feito direto no provedor vira linha concluída ao aplicar o estado', async () => {
    const subscriber = await makeSubscriber(db);
    const paid = await paidOrder(subscriber, [4_900, 1_900]);

    // O painel do provedor estorna 2.000 e o webhook só atualiza `payments.refunded_cents`.
    await db
      .updateTable('payments')
      .set({ refundedCents: 2_000, status: 'partially_refunded' })
      .where('id', '=', paid.paymentId)
      .execute();
    await applyProviderPaymentRefund(db, paid.paymentId);

    const refunds = await loadOrderRefunds(db, paid.orderId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      status: 'done',
      amountCents: 2_000,
      reason: 'Estorno no provedor',
    });
    expect(refunds[0]?.items.reduce((total, item) => total + item.amountCents, 0)).toBe(2_000);
    expect(await orderStatus(paid.orderId)).toBe('partially_refunded');
  });

  it('chargeback do pedido encerra o acesso e marca o pedido como contestado', async () => {
    const subscriber = await makeSubscriber(db);
    const provider = makeProvider();
    const paid = await paidOrder(subscriber);
    const stored = await db
      .selectFrom('payments')
      .select('providerPaymentId')
      .where('id', '=', paid.paymentId)
      .executeTakeFirstOrThrow();
    provider.chargebackPayment(stored.providerPaymentId as string);

    await applyChargeback(db, paid.paymentId);
    expect(await orderStatus(paid.orderId)).toBe('chargeback');
    expect(await activeEntitlements(subscriber.id, first(paid.courseIds))).toBe(0);
  });
});

interface ActiveSubscription {
  subscriptionId: string;
  planId: string;
  userId: string;
  paymentId: string;
  courseId: string;
}

async function activeSubscription(
  now = new Date('2026-01-01T00:00:00Z'),
): Promise<ActiveSubscription> {
  const subscriber = await makeSubscriber(db);
  const provider = makeProvider(now);
  const courseId = await makeCourse(db);
  const plan = await makePlan(db, admin, {
    items: [{ productType: 'course', productId: courseId }],
  });
  const { subscription } = await createSubscriptionCheckout(db, {
    userId: subscriber.id,
    planId: plan.id,
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
  const payment = provider.authorizeSubscription(row.providerSubscriptionId as string);
  await applySubscriptionPayment(db, 'fake', payment, { now, graceDays: 3 });
  const stored = await db
    .selectFrom('payments')
    .select('id')
    .where('subscriptionId', '=', subscription.id)
    .executeTakeFirstOrThrow();
  return {
    subscriptionId: subscription.id,
    planId: plan.id,
    userId: subscriber.id,
    paymentId: stored.id,
    courseId,
  };
}

async function subscriptionStatus(id: string): Promise<string> {
  const row = await db
    .selectFrom('subscriptions')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.status;
}

describe('reembolso de cobrança recorrente', () => {
  it('estorno total do período em curso encerra a assinatura e revoga os direitos', async () => {
    const provider = makeProvider();
    const active = await activeSubscription();
    const refund = await requestSubscriptionRefund(db, staffRequest(admin), {
      subscriptionId: active.subscriptionId,
      paymentId: active.paymentId,
      reason: 'Reembolso pedido pelo aluno',
    });
    expect(refund).toMatchObject({
      orderId: null,
      items: [],
      amountCents: 9_900,
      status: 'requested',
    });

    const done = await executeRefund(db, provider, refund.id);
    expect(done.status).toBe('done');
    expect(await subscriptionStatus(active.subscriptionId)).toBe('ended');
    expect(await activeEntitlements(active.userId, active.courseId)).toBe(0);
    expect(await paymentStatus(active.paymentId)).toEqual({ status: 'refunded', refunded: 9_900 });
  });

  it('estorno parcial não encerra; o que fecha o saldo encerra', async () => {
    const provider = makeProvider();
    const active = await activeSubscription();
    const partial = await requestSubscriptionRefund(db, staffRequest(admin), {
      subscriptionId: active.subscriptionId,
      paymentId: active.paymentId,
      reason: 'Cortesia parcial',
      amountCents: 4_000,
    });
    await executeRefund(db, provider, partial.id);
    expect(await subscriptionStatus(active.subscriptionId)).toBe('active');
    expect(await activeEntitlements(active.userId, active.courseId)).toBe(1);

    const rest = await requestSubscriptionRefund(db, staffRequest(admin), {
      subscriptionId: active.subscriptionId,
      paymentId: active.paymentId,
      reason: 'O restante',
    });
    expect(rest.amountCents).toBe(5_900);
    await executeRefund(db, provider, rest.id);
    expect(await subscriptionStatus(active.subscriptionId)).toBe('ended');
  });

  it('recusa cobrança de outra assinatura, valor inválido e cobrança não aprovada', async () => {
    const provider = makeProvider();
    const active = await activeSubscription();
    const other = await activeSubscription();

    await expectError(
      requestSubscriptionRefund(db, staffRequest(manager), {
        subscriptionId: active.subscriptionId,
        paymentId: active.paymentId,
        reason: 'motivo',
      }),
      403,
      'permission_denied',
    );
    await expectError(
      requestSubscriptionRefund(db, staffRequest(admin), {
        subscriptionId: active.subscriptionId,
        paymentId: other.paymentId,
        reason: 'motivo',
      }),
      404,
      'not_found',
    );
    await expectError(
      requestSubscriptionRefund(db, staffRequest(admin), {
        subscriptionId: active.subscriptionId,
        paymentId: active.paymentId,
        reason: 'motivo',
        amountCents: 0,
      }),
      400,
      'validation_failed',
    );
    await expectError(
      requestSubscriptionRefund(db, staffRequest(admin), {
        subscriptionId: active.subscriptionId,
        paymentId: active.paymentId,
        reason: 'motivo',
        amountCents: 10_000,
      }),
      422,
      'refund_exceeds_paid',
    );

    // Cobrança recusada não é reembolsável.
    const rejected = await db
      .insertInto('payments')
      .values({
        orderId: null,
        subscriptionId: active.subscriptionId,
        provider: 'fake',
        providerPaymentId: 'fake_payment_rejeitada',
        status: 'rejected',
        amountCents: 9_900,
        refundedCents: 0,
        currency: CURRENCY,
        method: 'card',
        rawStatus: 'rejected',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expectError(
      requestSubscriptionRefund(db, staffRequest(admin), {
        subscriptionId: active.subscriptionId,
        paymentId: rejected.id,
        reason: 'motivo',
      }),
      409,
      'payment_not_refundable',
    );
    void provider;
  });

  it('estorno em período passado não encerra a assinatura', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const provider = makeProvider(now);
    const active = await activeSubscription(now);

    // Renova: a primeira cobrança deixa de ser a do período em curso.
    provider.setNow('2026-02-01T00:00:00Z');
    const providerRow = await db
      .selectFrom('subscriptions')
      .select('providerSubscriptionId')
      .where('id', '=', active.subscriptionId)
      .executeTakeFirstOrThrow();
    const renewal = provider.renewSubscription(providerRow.providerSubscriptionId as string);
    await applySubscriptionPayment(db, 'fake', renewal, {
      now: new Date('2026-02-01T00:00:00Z'),
      graceDays: 3,
    });

    const refund = await requestSubscriptionRefund(db, staffRequest(admin), {
      subscriptionId: active.subscriptionId,
      paymentId: active.paymentId,
      reason: 'Período antigo',
    });
    await executeRefund(db, provider, refund.id);
    expect(await subscriptionStatus(active.subscriptionId)).toBe('active');
    expect(await activeEntitlements(active.userId, active.courseId)).toBe(1);
  });

  it('chargeback da cobrança recorrente encerra na hora e revoga os direitos', async () => {
    const provider = makeProvider();
    const active = await activeSubscription();
    const stored = await db
      .selectFrom('payments')
      .select('providerPaymentId')
      .where('id', '=', active.paymentId)
      .executeTakeFirstOrThrow();
    provider.chargebackPayment(stored.providerPaymentId as string);

    await applyChargeback(db, active.paymentId);
    expect(await subscriptionStatus(active.subscriptionId)).toBe('ended');
    expect(await activeEntitlements(active.userId, active.courseId)).toBe(0);
  });

  it('agrupa os reembolsos das cobranças recorrentes por cobrança', async () => {
    const provider = makeProvider();
    const active = await activeSubscription();
    const firstRefund = await requestSubscriptionRefund(db, staffRequest(admin), {
      subscriptionId: active.subscriptionId,
      paymentId: active.paymentId,
      reason: 'Um',
      amountCents: 1_000,
    });
    const secondRefund = await requestSubscriptionRefund(db, staffRequest(admin), {
      subscriptionId: active.subscriptionId,
      paymentId: active.paymentId,
      reason: 'Dois',
      amountCents: 2_000,
    });
    await executeRefund(db, provider, firstRefund.id);
    await executeRefund(db, provider, secondRefund.id);

    const grouped = await loadSubscriptionRefunds(db, [active.paymentId]);
    const list: RefundView[] = grouped.get(active.paymentId) ?? [];
    expect(list.map((entry) => entry.amountCents).sort()).toEqual([1_000, 2_000]);
    expect(await loadSubscriptionRefunds(db, [])).toEqual(new Map());
  });
});
