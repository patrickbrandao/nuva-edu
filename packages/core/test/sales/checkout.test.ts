import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addCartItem,
  applyOrderPayment,
  cancelMyOrder,
  closeDatabase,
  createCoupon,
  createDatabase,
  createOrder,
  type Database,
  expirePendingOrders,
  FakePaymentProvider,
  getAdminOrder,
  getMyOrder,
  isProviderUnavailable,
  listAdminOrders,
  listMyOrders,
  orderExternalReference,
  redact,
} from '../../src/index.ts';
import {
  adminRequest,
  expectError,
  first,
  makeCourse,
  makeUser,
  type TestUser,
} from './fixtures.ts';

// Fechamento do pedido, confirmação idempotente do pagamento e estado do pedido (specs 011 e 013).

const CURRENCY = 'BRL';
const RETURN_URLS = {
  success: 'https://classroom.example/pedidos/sucesso',
  pending: 'https://classroom.example/pedidos/pendente',
  failure: 'https://classroom.example/pedidos/falha',
};

let testDb: TestDatabase;
let db: Database;
let student: TestUser;
let provider: FakePaymentProvider;

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
  student = await makeUser(db, 'student', {
    billing: { fullName: 'Compradora de Teste', taxIdType: 'cpf', taxId: '52998224725' },
  });
  provider = new FakePaymentProvider({ currency: CURRENCY });
});

async function withCourseInCart(priceCents = 4_900): Promise<string> {
  const courseId = await makeCourse(db, { priceCents, accessDays: 30 });
  await addCartItem(db, student.id, { productType: 'course', productId: courseId }, CURRENCY);
  return courseId;
}

async function approvedPayment(orderId: string) {
  const pending = first(await provider.findPaymentsByReference(orderExternalReference(orderId)));
  return provider.approvePayment(pending.providerPaymentId, { method: 'card' });
}

describe('fechamento do pedido', () => {
  it('exige os dados do comprador antes da cesta', async () => {
    const noBilling = await makeUser(db);
    await expectError(
      createOrder(db, {
        userId: noBilling.id,
        provider,
        currency: CURRENCY,
        returnUrls: RETURN_URLS,
      }),
      409,
      'billing_required',
    );
  });

  it('recusa cesta vazia', async () => {
    await expectError(
      createOrder(db, {
        userId: student.id,
        provider,
        currency: CURRENCY,
        returnUrls: RETURN_URLS,
      }),
      409,
      'cart_empty',
    );
  });

  it('congela preços, esvazia a cesta e devolve a URL do checkout', async () => {
    const courseId = await withCourseInCart(4_900);
    const result = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: (orderId) => ({ ...RETURN_URLS, success: `${RETURN_URLS.success}/${orderId}` }),
    });
    expect(result.checkoutUrl).toContain('https://checkout.payment-fake.test/');
    expect(result.order.status).toBe('pending');
    expect(result.order.items[0]).toMatchObject({
      productId: courseId,
      unitPriceCents: 4_900,
      accessDays: 30,
    });
    expect(result.order.payment).toBeNull();

    const cart = await db
      .selectFrom('cartItems')
      .select('id')
      .where(
        'cartId',
        '=',
        (
          await db
            .selectFrom('carts')
            .select('id')
            .where('userId', '=', student.id)
            .executeTakeFirstOrThrow()
        ).id,
      )
      .execute();
    expect(cart).toHaveLength(0);
  });

  it('provedor fora deixa o pedido draft e a cesta intacta', async () => {
    await withCourseInCart();
    provider.setUnavailable(true, ['createCheckout']);
    const error = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(isProviderUnavailable(error)).toBe(true);
    expect(error).toMatchObject({ status: 503, code: 'payment_provider_unavailable' });

    const drafts = await db
      .selectFrom('orders')
      .select('id')
      .where('userId', '=', student.id)
      .where('status', '=', 'draft')
      .execute();
    expect(drafts).toHaveLength(1);
    const cart = await db
      .selectFrom('carts')
      .innerJoin('cartItems', 'cartItems.cartId', 'carts.id')
      .select('cartItems.id')
      .where('carts.userId', '=', student.id)
      .execute();
    expect(cart).toHaveLength(1);
  });

  it('pedido de total zero nasce pago, conta o cupom e libera o acesso', async () => {
    const admin = await makeUser(db, 'admin');
    const courseId = await makeCourse(db, { priceCents: 4_900 });
    await addCartItem(db, student.id, { productType: 'course', productId: courseId }, CURRENCY);
    const coupon = await createCoupon(db, adminRequest(admin), {
      code: 'TUDOGRATIS',
      kind: 'percent',
      percentOff: 100,
      appliesTo: 'orders',
    });
    await db
      .updateTable('carts')
      .set({ couponId: coupon.id })
      .where('userId', '=', student.id)
      .execute();

    const result = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    expect(result.checkoutUrl).toBeNull();
    expect(result.order).toMatchObject({ status: 'paid', totalCents: 0, couponCode: 'TUDOGRATIS' });

    const uses = await db
      .selectFrom('coupons')
      .select('usesCount')
      .where('id', '=', coupon.id)
      .executeTakeFirstOrThrow();
    expect(uses.usesCount).toBe(1);
    expect(await entitlementCount(student.id, courseId)).toBe(1);
  });
});

describe('confirmação do pagamento', () => {
  it('marca o pedido pago, libera a cascata e é idempotente', async () => {
    const courseId = await withCourseInCart(4_900);
    const { order } = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    const payment = await approvedPayment(order.id);

    const first = await applyOrderPayment(db, 'fake', payment);
    expect(first).toMatchObject({
      previousStatus: 'pending',
      status: 'paid',
      changed: true,
      granted: 1,
    });
    expect(await entitlementCount(student.id, courseId)).toBe(1);

    const second = await applyOrderPayment(db, 'fake', payment);
    expect(second).toMatchObject({ status: 'paid', changed: false, granted: 0 });
    expect(await entitlementCount(student.id, courseId)).toBe(1);

    const detail = await getMyOrder(db, student.id, order.id);
    expect(detail.status).toBe('paid');
    expect(detail.payment).toMatchObject({ status: 'approved', method: 'card' });

    const emails = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM email_outbox
       WHERE user_id = ${student.id} AND type = 'access.granted'`.execute(db);
    expect(emails.rows[0]?.n).toBe(1);
  });

  it('registra a cobrança mesmo quando o valor diverge do total', async () => {
    await withCourseInCart(4_900);
    const { order } = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    const pending = first(await provider.findPaymentsByReference(orderExternalReference(order.id)));
    const divergent = provider.approvePayment(pending.providerPaymentId, { amountCents: 1_000 });

    await expectError(applyOrderPayment(db, 'fake', divergent), 422, 'payment_amount_mismatch');

    const stored = await db
      .selectFrom('payments')
      .select(['status', 'amountCents'])
      .where('orderId', '=', order.id)
      .executeTakeFirstOrThrow();
    expect({ status: stored.status, amount: Number(stored.amountCents) }).toEqual({
      status: 'approved',
      amount: 1_000,
    });
    expect((await getMyOrder(db, student.id, order.id)).status).toBe('pending');
  });

  it('pagamento recusado não muda o pedido', async () => {
    await withCourseInCart();
    const { order } = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    const pending = first(await provider.findPaymentsByReference(orderExternalReference(order.id)));
    const rejected = provider.rejectPayment(pending.providerPaymentId, { method: 'pix' });

    const applied = await applyOrderPayment(db, 'fake', rejected);
    expect(applied).toMatchObject({ status: 'pending', changed: false });
    const detail = await getMyOrder(db, student.id, order.id);
    expect(detail.status).toBe('pending');
    expect(detail.payment).toMatchObject({ status: 'rejected', method: 'pix' });
  });

  it('aceita pagamento tardio de pedido vencido e audita', async () => {
    await withCourseInCart();
    const { order } = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    // Vence o pedido pelo relógio do banco.
    await db
      .updateTable('orders')
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where('id', '=', order.id)
      .execute();
    const expired = await expirePendingOrders(db);
    expect(expired).toContain(order.id);
    expect((await getMyOrder(db, student.id, order.id)).status).toBe('expired');

    const payment = await approvedPayment(order.id);
    const late = await applyOrderPayment(db, 'fake', payment);
    expect(late).toMatchObject({ previousStatus: 'expired', status: 'paid', changed: true });

    const audit = await sql<{ action: string }>`
      SELECT action FROM audit_log WHERE target_id = ${order.id} AND action = 'order.paid_late'`.execute(
      db,
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('recusa cobrança de pedido inexistente', async () => {
    const ghost = {
      providerPaymentId: 'fake_payment_999999',
      status: 'approved' as const,
      amountCents: 100,
      refundedCents: 0,
      currency: CURRENCY,
      method: 'card' as const,
      externalReference: orderExternalReference('11111111-1111-4111-8111-111111111111'),
      rawStatus: 'approved',
      paidAt: new Date(),
    };
    await expectError(applyOrderPayment(db, 'fake', ghost), 404, 'not_found');
  });
});

describe('cancelamento e listagem', () => {
  it('cancela o pedido pending e não cancela duas vezes', async () => {
    await withCourseInCart();
    const { order } = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    const canceled = await cancelMyOrder(db, student.id, order.id);
    expect(canceled.status).toBe('canceled');
    await expectError(cancelMyOrder(db, student.id, order.id), 409, 'order_not_cancelable');
  });

  it('lista os pedidos do aluno sem os draft', async () => {
    await withCourseInCart();
    await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    const page = await listMyOrders(db, student.id, {});
    expect(page.items).toHaveLength(1);
    expect(first(page.items).number).toBeGreaterThan(0);
  });

  it('a equipe vê o pedido e filtra a lista', async () => {
    const admin = await makeUser(db, 'admin');
    const courseId = await withCourseInCart();
    const { order } = await createOrder(db, {
      userId: student.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
    });
    const detail = await getAdminOrder(db, adminRequest(admin), order.id);
    expect(detail).toMatchObject({ id: order.id, buyer: { name: 'Compradora de Teste' } });
    expect(detail.buyer.taxId).toBe('52998224725');

    const filtered = await listAdminOrders(db, adminRequest(admin), {
      productType: 'course',
      productId: courseId,
    });
    expect(filtered.items.map((item) => item.id)).toContain(order.id);

    await expectError(listAdminOrders(db, adminRequest(student), {}), 403, 'permission_denied');
  });
});

describe('documento do comprador nos logs', () => {
  it('mascara o CPF/CNPJ mesmo em campos fora da lista proibida', () => {
    const logged = redact({
      buyerTaxId: '52998224725',
      detail: 'cobrança do CPF 529.982.247-25 recusada',
      buyerTaxIdType: 'cnpj',
      empresa: '12.ABC.345/01DE-35',
    });
    const text = JSON.stringify(logged);
    expect(text).not.toContain('52998224725');
    expect(text).not.toContain('529.982.247-25');
    expect(text).not.toContain('12.ABC.345/01DE-35');
    expect(text).toContain('[REDACTED]');
  });
});

async function entitlementCount(userId: string, productId: string): Promise<number> {
  const row = await db
    .selectFrom('entitlements')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('userId', '=', userId)
    .where('productId', '=', productId)
    .where('revokedAt', 'is', null)
    .executeTakeFirstOrThrow();
  return row.n;
}
