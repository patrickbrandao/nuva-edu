import { randomUUID } from 'node:crypto';
import {
  createTermsDraft,
  FakePaymentProvider,
  IDEMPOTENCY_SCOPES,
  orderExternalReference,
  publishTermsVersion,
  saveMyBilling,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  createUser,
  isolatedDatabase,
  type Reply,
  TEST_PASSWORD,
  type TestUser,
} from '../accounts.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

// Fechamento da cesta, idempotência, consulta e cancelamento de pedidos na classroom-api
// (specs 011 e 013; tarefas 540 e 711).

const TAX_ID = '52998224725';
const BILLING = { fullName: 'Compradora de Teste', taxIdType: 'cpf' as const, taxId: TAX_ID };

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;
let provider: FakePaymentProvider;
let admin: TestUser;

function scan(reply: Reply): void {
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
}

const browser = () => new Browser(test.app, scan);

function slug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

async function buyer(withBilling = true): Promise<{ user: TestUser; browser: Browser }> {
  const user = await createUser(test.db);
  if (withBilling) {
    await saveMyBilling(test.db, user.id, BILLING);
  }
  const session = browser();
  expect((await session.login(user.email)).statusCode).toBe(200);
  return { user, browser: session };
}

async function makeCourse(priceCents = 4_900, accessDays: number | null = 30): Promise<string> {
  const row = await test.db
    .insertInto('courses')
    .values({
      slug: slug('curso'),
      title: 'Curso Avulso',
      summary: 'Resumo',
      accessMode: 'paid',
      priceCents,
      accessDays,
      status: 'published',
      publishedAt: new Date(),
      level: 'beginner',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function addCourseToCart(session: Browser, courseId: string): Promise<void> {
  const reply = await session.request('POST', '/api/v1/cart/items', {
    payload: { productType: 'course', productId: courseId },
  });
  expect(reply.statusCode).toBe(201);
}

beforeAll(async () => {
  database = await isolatedDatabase();
  provider = new FakePaymentProvider({ currency: 'BRL' });
  test = createTestApp(
    { DATABASE_URL: database.url, NUVA_PAYMENT_PROVIDER: 'fake' },
    { paymentProvider: provider },
  );
  admin = await createUser(test.db, { role: 'admin' });
});

afterAll(async () => {
  const logs = test.logText();
  expect(logs).not.toContain(TEST_PASSWORD);
  expect(logs).not.toContain(TAX_ID);
  await test.close();
  await database.drop();
});

describe('POST /api/v1/orders: validações, congelamento, total zero e indisponibilidade', () => {
  it('aplica 401, CSRF, e-mail confirmado, billing_required, cart_empty, cart_invalid e limite de 3 pending', async () => {
    expect((await browser().request('POST', '/api/v1/orders')).statusCode).toBe(401);

    const unverifiedUser = await createUser(test.db, { verified: false });
    const unverified = browser();
    expect((await unverified.login(unverifiedUser.email)).statusCode).toBe(200);
    const unverifiedReply = await unverified.request('POST', '/api/v1/orders');
    expect(unverifiedReply.statusCode).toBe(403);
    expect(unverifiedReply.json().code).toBe('email_not_verified');

    const { browser: noBilling } = await buyer(false);
    expect((await noBilling.request('POST', '/api/v1/orders', { csrf: false })).statusCode).toBe(
      403,
    );
    const billingReply = await noBilling.request('POST', '/api/v1/orders');
    expect(billingReply.statusCode).toBe(409);
    expect(billingReply.json().code).toBe('billing_required');

    const { browser: session } = await buyer(true);
    const emptyReply = await session.request('POST', '/api/v1/orders');
    expect(emptyReply.statusCode).toBe(409);
    expect(emptyReply.json().code).toBe('cart_empty');

    // Produto despublicado após entrar na cesta: `409 cart_invalid` e a cesta permanece aberta.
    const unpublishedCourse = await makeCourse(3_900);
    await addCourseToCart(session, unpublishedCourse);
    await test.db
      .updateTable('courses')
      .set({ status: 'draft', publishedAt: null })
      .where('id', '=', unpublishedCourse)
      .execute();
    const invalidCart = await session.request('POST', '/api/v1/orders');
    expect(invalidCart.statusCode).toBe(409);
    expect(invalidCart.json().code).toBe('cart_invalid');
    const cartAfter = (await session.request('GET', '/api/v1/cart')).json();
    expect(cartAfter.items[0]).toMatchObject({ sellable: false, unsellableReason: 'unpublished' });
    await session.request('DELETE', `/api/v1/cart/items/${cartAfter.items[0].id as string}`);

    // Até 3 pedidos `pending`; o 4º falha com `order_pending_limit` até cancelar um.
    const pendingIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const courseId = await makeCourse(2_500 + index * 100);
      await addCourseToCart(session, courseId);
      const created = await session.request('POST', '/api/v1/orders');
      expect(created.statusCode).toBe(201);
      pendingIds.push(created.json().order.id as string);
    }
    const fourthCourse = await makeCourse(5_000);
    await addCourseToCart(session, fourthCourse);
    const blocked = await session.request('POST', '/api/v1/orders');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('order_pending_limit');

    const canceled = await session.request('POST', `/api/v1/orders/${pendingIds[0]}/cancel`);
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().status).toBe('canceled');

    const unblocked = await session.request('POST', '/api/v1/orders');
    expect(unblocked.statusCode).toBe(201);
  });

  it('congela preços no fechamento e não muda se o produto subir de preço depois', async () => {
    const { browser: session } = await buyer();
    const courseId = await makeCourse(4_900, 60);
    await addCourseToCart(session, courseId);

    const created = await session.request('POST', '/api/v1/orders');
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.checkoutUrl).toMatch(/^https:\/\/checkout\.payment-fake\.test\/fake_checkout_/);
    expect(body.order).toMatchObject({
      status: 'pending',
      subtotalCents: 4_900,
      discountCents: 0,
      totalCents: 4_900,
      currency: 'BRL',
      provider: 'fake',
      checkoutUrl: body.checkoutUrl,
      buyerName: 'Compradora de Teste',
      buyerTaxIdType: 'cpf',
      buyerTaxId: TAX_ID,
      payment: null,
    });
    expect(body.order.items[0]).toMatchObject({
      productId: courseId,
      unitPriceCents: 4_900,
      paidCents: 4_900,
      accessDays: 60,
    });
    expect((await session.request('GET', '/api/v1/cart')).json().items).toEqual([]);

    await test.db
      .updateTable('courses')
      .set({ priceCents: 19_900 })
      .where('id', '=', courseId)
      .execute();
    const reread = await session.request('GET', `/api/v1/orders/${body.order.id as string}`);
    expect(reread.statusCode).toBe(200);
    expect(reread.json().totalCents).toBe(4_900);
    expect(reread.json().items[0].unitPriceCents).toBe(4_900);
  });

  it('pedido de total zero nasce pago com provider none sem chamar o provedor, mesmo indisponível', async () => {
    const { user, browser: session } = await buyer();
    const courseId = await makeCourse(5_000, null);
    await addCourseToCart(session, courseId);
    const code = `ZERO-${randomUUID().slice(0, 6).toUpperCase()}`;
    await test.db
      .insertInto('coupons')
      .values({
        code,
        kind: 'percent',
        percentOff: 100,
        appliesTo: 'orders',
        active: true,
        createdBy: admin.id,
      })
      .execute();
    expect(
      (await session.request('PUT', '/api/v1/cart/coupon', { payload: { code } })).statusCode,
    ).toBe(200);

    provider.setUnavailable(true);
    try {
      const reply = await session.request('POST', '/api/v1/orders');
      expect(reply.statusCode).toBe(201);
      expect(reply.json()).toMatchObject({
        checkoutUrl: null,
        order: {
          status: 'paid',
          provider: 'none',
          checkoutUrl: null,
          totalCents: 0,
          discountCents: 5_000,
          couponCode: code,
        },
      });
    } finally {
      provider.setUnavailable(false);
    }

    const entitlements = await test.db
      .selectFrom('entitlements')
      .select('id')
      .where('userId', '=', user.id)
      .where('productId', '=', courseId)
      .where('revokedAt', 'is', null)
      .execute();
    expect(entitlements).toHaveLength(1);
  });

  it('provedor indisponível responde 503, preserva a cesta, deixa pedido draft oculto e mantém o site no ar', async () => {
    const { user, browser: session } = await buyer();
    const courseId = await makeCourse(6_500);
    await addCourseToCart(session, courseId);

    provider.setUnavailable(true, ['createCheckout']);
    try {
      const reply = await session.request('POST', '/api/v1/orders');
      expect(reply.statusCode).toBe(503);
      expect(reply.json()).toMatchObject({
        code: 'payment_provider_unavailable',
        detail: 'pagamento indisponível, tente em instantes',
      });
      // Outras rotas continuam respondendo normalmente (spec 013, RF-09).
      expect((await session.request('GET', '/api/v1/meta')).statusCode).toBe(200);
      expect((await session.request('GET', '/api/v1/cart')).json().items).toHaveLength(1);
    } finally {
      provider.setUnavailable(false);
    }

    const draft = await test.db
      .selectFrom('orders')
      .select(['id', 'status'])
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(draft.status).toBe('draft');
    expect((await session.request('GET', '/api/v1/orders')).json().items).toEqual([]);
    expect((await session.request('GET', `/api/v1/orders/${draft.id}`)).statusCode).toBe(404);
  });
});

describe('POST /api/v1/orders com Idempotency-Key (task 711)', () => {
  it('repetição devolve o mesmo pedido (201) sem segundo checkout no provedor nem segunda tarefa na fila', async () => {
    const { user, browser: session } = await buyer();
    const courseId = await makeCourse(7_500);
    await addCourseToCart(session, courseId);
    const key = `idem-paid-${randomUUID()}`;

    const first = await session.request('POST', '/api/v1/orders', {
      headers: { 'idempotency-key': key },
    });
    expect(first.statusCode).toBe(201);

    // Mesmo acrescentando outro item à cesta depois, repetir a chave devolve o primeiro pedido.
    const extraCourse = await makeCourse(2_000);
    await addCourseToCart(session, extraCourse);

    const replay = await session.request('POST', '/api/v1/orders', {
      headers: { 'idempotency-key': key },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());

    const orders = await test.db
      .selectFrom('orders')
      .select('id')
      .where('userId', '=', user.id)
      .execute();
    expect(orders).toHaveLength(1);
    expect(
      await provider.findPaymentsByReference(orderExternalReference(first.json().order.id)),
    ).toHaveLength(1);
    expect((await session.request('GET', '/api/v1/cart')).json().items).toHaveLength(1);

    // Em pedido de total zero (que enfileira `notify` de compra aprovada), repetir não cria 2ª tarefa.
    const { user: freeUser, browser: freeSession } = await buyer();
    const freeCourse = await makeCourse(0);
    await addCourseToCart(freeSession, freeCourse);
    const freeKey = `idem-free-${randomUUID()}`;

    const freeFirst = await freeSession.request('POST', '/api/v1/orders', {
      headers: { 'idempotency-key': freeKey },
    });
    const freeReplay = await freeSession.request('POST', '/api/v1/orders', {
      headers: { 'idempotency-key': freeKey },
    });
    expect(freeFirst.statusCode).toBe(201);
    expect(freeReplay.statusCode).toBe(201);
    expect(freeReplay.json().order.id).toBe(freeFirst.json().order.id);

    const notifyJobs = await test.db
      .selectFrom('jobs')
      .select(['id', 'payload'])
      .where('type', '=', 'notify')
      .execute();
    const forFreeUser = notifyJobs.filter((job) => {
      const payload = job.payload as { userId?: string; type?: string } | null;
      return payload?.userId === freeUser.id && payload?.type === 'access.granted';
    });
    expect(forFreeUser).toHaveLength(1);
  });

  it('mesma chave com impressão digital divergente responde 422 idempotency_key_reuse; chave fora do formato é 400', async () => {
    const { user, browser: session } = await buyer();
    const courseId = await makeCourse(4_500);
    await addCourseToCart(session, courseId);

    for (const invalidKey of ['curta', 'x'.repeat(129), 'chave com espaco']) {
      const bad = await session.request('POST', '/api/v1/orders', {
        headers: { 'idempotency-key': invalidKey },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe('validation_failed');
    }

    const reusedKey = `idem-conflict-${randomUUID()}`;
    await test.db
      .insertInto('idempotencyKeys')
      .values({
        scope: IDEMPOTENCY_SCOPES.orderCreate,
        userId: user.id,
        key: reusedKey,
        requestHash: '0'.repeat(64),
        responseStatus: 201,
        responseBody: JSON.stringify({ order: { id: randomUUID() }, checkoutUrl: null }),
        createdAt: new Date(),
        completedAt: new Date(),
      })
      .execute();

    const conflict = await session.request('POST', '/api/v1/orders', {
      headers: { 'idempotency-key': reusedKey },
    });
    expect(conflict.statusCode).toBe(422);
    expect(conflict.json().code).toBe('idempotency_key_reuse');
  });

  it('provedor fora com Idempotency-Key libera a chave para nova tentativa', async () => {
    const { browser: session } = await buyer();
    const courseId = await makeCourse(3_200);
    await addCourseToCart(session, courseId);
    const key = `idem-503-${randomUUID()}`;

    provider.setUnavailable(true, ['createCheckout']);
    const failed = await session.request('POST', '/api/v1/orders', {
      headers: { 'idempotency-key': key },
    });
    expect(failed.statusCode).toBe(503);
    provider.setUnavailable(false);

    const retried = await session.request('POST', '/api/v1/orders', {
      headers: { 'idempotency-key': key },
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json().order.status).toBe('pending');
  });
});

describe('listagem, detalhe, cancelamento no provedor e trava de termos', () => {
  it('lista com paginação e filtro, cancela o checkout no provedor e recusa cancelar duas vezes', async () => {
    const { browser: session } = await buyer();
    const c1 = await makeCourse(2_000);
    await addCourseToCart(session, c1);
    const first = (await session.request('POST', '/api/v1/orders')).json().order;

    const c2 = await makeCourse(0);
    await addCourseToCart(session, c2);
    const paidOrder = (await session.request('POST', '/api/v1/orders')).json().order;

    const page1 = await session.request('GET', '/api/v1/orders?limit=1');
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(1);
    expect(page1.json().nextCursor).toEqual(expect.any(String));

    const page2 = await session.request(
      'GET',
      `/api/v1/orders?limit=1&cursor=${encodeURIComponent(page1.json().nextCursor as string)}`,
    );
    expect(page2.statusCode).toBe(200);
    expect(new Set([page1.json().items[0].id, page2.json().items[0].id])).toEqual(
      new Set([first.id, paidOrder.id]),
    );

    const paidOnly = await session.request('GET', '/api/v1/orders?status=paid');
    expect(paidOnly.json().items.map((item: { id: string }) => item.id)).toEqual([paidOrder.id]);

    // Cancelar pedido `pending` também cancela a preferência no provedor; não cancela `paid`.
    const canceled = await session.request('POST', `/api/v1/orders/${first.id as string}/cancel`);
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json()).toMatchObject({ id: first.id, status: 'canceled', checkoutUrl: null });
    const providerPayments = await provider.findPaymentsByReference(
      orderExternalReference(first.id as string),
    );
    expect(providerPayments[0]?.status).toBe('canceled');

    const twice = await session.request('POST', `/api/v1/orders/${first.id as string}/cancel`);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('order_not_cancelable');

    const cancelPaid = await session.request(
      'POST',
      `/api/v1/orders/${paidOrder.id as string}/cancel`,
    );
    expect(cancelPaid.statusCode).toBe(409);
    expect(cancelPaid.json().code).toBe('order_not_cancelable');

    // Outra conta vê 404.
    const { browser: stranger } = await buyer();
    expect((await stranger.request('GET', `/api/v1/orders/${first.id as string}`)).statusCode).toBe(
      404,
    );
    expect(
      (await stranger.request('POST', `/api/v1/orders/${first.id as string}/cancel`)).statusCode,
    ).toBe(404);
  });

  it('bloqueia escritas de vendas quando há nova versão vigente dos termos pendente de aceite', async () => {
    const isolated = await isolatedDatabase();
    const termsApp = createTestApp(
      { DATABASE_URL: isolated.url, NUVA_PAYMENT_PROVIDER: 'fake' },
      { paymentProvider: provider },
    );
    try {
      const student = await createUser(termsApp.db);
      const client = new Browser(termsApp.app, scan);
      expect((await client.login(student.email)).statusCode).toBe(200);

      const draft = await createTermsDraft(termsApp.db, {
        document: 'terms',
        bodyMd: '# Termos atualizados',
        requiresReacceptance: true,
      });
      await termsApp.db
        .transaction()
        .execute((trx) => publishTermsVersion(trx, draft.id, { origin: 'cli' }));

      const blocked = await client.request('POST', '/api/v1/orders');
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().code).toBe('terms_acceptance_pending');
    } finally {
      await termsApp.close();
      await isolated.drop();
    }
  });
});
