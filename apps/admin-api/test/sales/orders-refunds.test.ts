import { randomUUID } from 'node:crypto';
import { addCartItem, createOrder, executeRefund, FakePaymentProvider } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, auditOf, type CallOptions, callAs, createActor, deniedBy } from '../actors.ts';
import { createIsolatedDatabase, createTestApp, type TestApp } from '../helpers.ts';
import {
  CURRENCY,
  checkoutOrder,
  createPaidCourseAs,
  createPaidEbookAs,
  makeBuyer,
  RETURN_URLS,
  SAMPLE_CNPJ,
  SAMPLE_CPF,
} from './fixtures.ts';

// Pedidos e reembolsos na admin-api (spec 011; specs 003, 008, 010, 013, 028 e 033; task 711):
// lista com filtros e totais sem `taxId`, detalhe com documento fiscal, reembolso parcial/total
// com revogação só do item reembolsado, `Idempotency-Key` (repetição devolve o mesmo `Refund`
// `202` com um único `refund.execute`; corpo diferente responde `422 idempotency_key_reuse`),
// falha do provedor com `retry` e ausência total de CPF/CNPJ nos logs.

const provider = new FakePaymentProvider({ currency: CURRENCY });
let database: Awaited<ReturnType<typeof createIsolatedDatabase>>;
let test: TestApp;

afterAll(async () => {
  await test?.close();
  await database?.drop();
});

let admin: Actor;
let manager: Actor;
let instructor: Actor;
let student: Actor;

beforeAll(async () => {
  // Cada fake começa com os mesmos identificadores de cobrança e adesão.
  database = await createIsolatedDatabase();
  test = createTestApp(
    { DATABASE_URL: database.url, NUVA_PAYMENT_PROVIDER: 'fake' },
    { paymentProvider: provider },
  );
  [admin, manager, instructor, student] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
    createActor(test, 'student'),
  ]);
});

const call = (options: CallOptions) => callAs(test, options);

async function hasActiveEntitlement(
  userId: string,
  productType: string,
  productId: string,
): Promise<boolean> {
  const row = await test.db
    .selectFrom('entitlements')
    .select('id')
    .where('userId', '=', userId)
    .where('productType', '=', productType)
    .where('productId', '=', productId)
    .where('revokedAt', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

describe('consulta de pedidos e dados fiscais', () => {
  it('gerente e admin listam com filtros e totais sem taxId; detalhe traz taxId e preços congelados', async () => {
    const course = await createPaidCourseAs(test, admin, {
      title: 'Curso Congelado',
      priceCents: 20_000,
    });
    const ebook = await createPaidEbookAs(test, admin, {
      title: 'Ebook Apoio',
      priceCents: 5_000,
    });
    const couponCode = `DESC-${randomUUID().slice(0, 6).toUpperCase()}`;
    const couponRes = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code: couponCode, kind: 'percent', percentOff: 10 },
    });
    const couponId = couponRes.json().id as string;

    const buyer = await makeBuyer(test, {
      fullName: 'Carlos Fiscal',
      taxIdType: 'cpf',
      taxId: SAMPLE_CPF,
      emailPrefix: 'carlos-fiscal',
    });
    const purchased = await checkoutOrder(test.db, provider, {
      buyer,
      items: [
        { productType: 'course', productId: course.id },
        { productType: 'ebook', productId: ebook.id },
      ],
      couponCode,
      approve: true,
      method: 'pix',
      now: new Date('2026-05-10T10:00:00.000Z'),
    });

    // Mudar o preço do curso depois não muda o pedido já criado (spec 011, RF-02).
    const courseGet = await call({
      method: 'GET',
      url: `/api/v1/courses/${course.id}`,
      as: admin,
    });
    await call({
      method: 'PATCH',
      url: `/api/v1/courses/${course.id}`,
      as: admin,
      payload: { priceCents: 99_000, version: courseGet.json().version },
    });

    const listRes = await call({
      method: 'GET',
      url: `/api/v1/orders?couponId=${couponId}&productType=course&productId=${course.id}&q=${encodeURIComponent(buyer.email)}`,
      as: manager,
    });
    expect(listRes.statusCode).toBe(200);
    const page = listRes.json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: purchased.orderId,
      number: purchased.orderNumber,
      status: 'paid',
      buyer: { id: buyer.id, name: 'Carlos Fiscal', email: buyer.email },
      itemCount: 2,
      subtotalCents: 25_000,
      discountCents: 2_500,
      refundedCents: 0,
      totalCents: 22_500,
      currency: CURRENCY,
      couponCode,
      provider: 'fake',
      paymentMethod: 'pix',
    });
    expect(page.totals).toEqual({
      subtotalCents: 25_000,
      discountCents: 2_500,
      refundedCents: 0,
      totalCents: 22_500,
      netCents: 22_500,
    });
    // `taxId` nunca sai na listagem.
    expect(JSON.stringify(page)).not.toContain(SAMPLE_CPF);
    expect(JSON.stringify(page)).not.toContain('taxId');

    // Filtro incompleto por produto responde `400`.
    expect(
      (
        await call({
          method: 'GET',
          url: '/api/v1/orders?productType=course',
          as: manager,
        })
      ).statusCode,
    ).toBe(400);

    // Detalhe traz o documento fiscal (gerente e admin) e os preços congelados.
    const detailRes = await call({
      method: 'GET',
      url: `/api/v1/orders/${purchased.orderId}`,
      as: manager,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.buyer).toEqual({
      id: buyer.id,
      name: 'Carlos Fiscal',
      email: buyer.email,
      taxIdType: 'cpf',
      taxId: SAMPLE_CPF,
    });
    expect(detail.subtotalCents).toBe(25_000);
    expect(detail.totalCents).toBe(22_500);
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]).toMatchObject({
      id: purchased.paymentId,
      orderId: purchased.orderId,
      orderNumber: purchased.orderNumber,
      subscriptionId: null,
      method: 'pix',
      status: 'approved',
      amountCents: 22_500,
    });

    expect(
      (await call({ method: 'GET', url: `/api/v1/orders/${randomUUID()}`, as: admin })).statusCode,
    ).toBe(404);
  });

  it('pedido de valor zero nasce pago com provider none; falha do provedor preserva a cesta e deixa draft visível ao admin', async () => {
    const course = await createPaidCourseAs(test, admin, { priceCents: 10_000 });
    const freeCode = `CEM-${randomUUID().slice(0, 6).toUpperCase()}`;
    await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code: freeCode, kind: 'percent', percentOff: 100 },
    });

    const freeBuyer = await makeBuyer(test, { taxIdType: 'cnpj', taxId: SAMPLE_CNPJ });
    const freeOrder = await checkoutOrder(test.db, provider, {
      buyer: freeBuyer,
      items: [{ productType: 'course', productId: course.id }],
      couponCode: freeCode,
      approve: false,
    });
    const freeDetail = (
      await call({ method: 'GET', url: `/api/v1/orders/${freeOrder.orderId}`, as: admin })
    ).json();
    expect(freeDetail).toMatchObject({
      status: 'paid',
      totalCents: 0,
      provider: 'none',
      payments: [],
    });

    // Provedor indisponível no checkout: `503`, cesta preservada e pedido `draft` visível em `status=draft`.
    const retryBuyer = await makeBuyer(test);
    await addCartItem(
      test.db,
      retryBuyer.id,
      { productType: 'course', productId: course.id },
      CURRENCY,
    );
    provider.setUnavailable(true, ['createCheckout']);
    try {
      await expect(
        createOrder(test.db, {
          userId: retryBuyer.id,
          provider,
          currency: CURRENCY,
          returnUrls: RETURN_URLS,
        }),
      ).rejects.toMatchObject({ code: 'payment_provider_unavailable', status: 503 });
    } finally {
      provider.setUnavailable(false);
    }

    const drafts = await call({
      method: 'GET',
      url: `/api/v1/orders?status=draft&q=${encodeURIComponent(retryBuyer.email)}`,
      as: admin,
    });
    expect(drafts.statusCode).toBe(200);
    expect(drafts.json().items).toHaveLength(1);
    expect(drafts.json().items[0].status).toBe('draft');

    const cartItems = await test.db
      .selectFrom('carts')
      .innerJoin('cartItems', 'cartItems.cartId', 'carts.id')
      .select('cartItems.productId')
      .where('carts.userId', '=', retryBuyer.id)
      .execute();
    expect(cartItems.map((row) => row.productId)).toEqual([course.id]);
  });

  it('instrutor e aluno recebem 403 auditado ao listar ou abrir pedido', async () => {
    const course = await createPaidCourseAs(test, admin);
    const buyer = await makeBuyer(test);
    const purchased = await checkoutOrder(test.db, provider, {
      buyer,
      items: [{ productType: 'course', productId: course.id }],
      approve: true,
    });

    for (const actor of [instructor, student]) {
      const listRes = await call({ method: 'GET', url: '/api/v1/orders', as: actor });
      expect(listRes.statusCode).toBe(403);
      expect(listRes.json()).toMatchObject({ code: 'permission_denied' });

      const getRes = await call({
        method: 'GET',
        url: `/api/v1/orders/${purchased.orderId}`,
        as: actor,
      });
      expect(getRes.statusCode).toBe(403);
      expect((await deniedBy(test, actor.id)).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('reembolsos, idempotência e retry', () => {
  it('reembolsa um item entre dois (partially_refunded), revoga só ele e depois reembolsa o restante', async () => {
    const courseA = await createPaidCourseAs(test, admin, {
      title: 'Curso A',
      priceCents: 12_000,
    });
    const courseB = await createPaidCourseAs(test, admin, {
      title: 'Curso B',
      priceCents: 8_000,
    });
    const buyer = await makeBuyer(test);
    const purchased = await checkoutOrder(test.db, provider, {
      buyer,
      items: [
        { productType: 'course', productId: courseA.id },
        { productType: 'course', productId: courseB.id },
      ],
      approve: true,
    });

    expect(await hasActiveEntitlement(buyer.id, 'course', courseA.id)).toBe(true);
    expect(await hasActiveEntitlement(buyer.id, 'course', courseB.id)).toBe(true);

    const beforeDetail = (
      await call({ method: 'GET', url: `/api/v1/orders/${purchased.orderId}`, as: admin })
    ).json();
    const itemA = beforeDetail.items.find(
      (item: { productId: string }) => item.productId === courseA.id,
    );

    const partialRes = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      payload: {
        reason: 'Desistência do Curso A',
        items: [{ orderItemId: itemA.id, amountCents: 12_000 }],
      },
    });
    expect(partialRes.statusCode).toBe(202);
    const partialRefund = partialRes.json();
    expect(partialRefund).toMatchObject({
      orderId: purchased.orderId,
      paymentId: purchased.paymentId,
      amountCents: 12_000,
      reason: 'Desistência do Curso A',
      status: 'requested',
      items: [{ orderItemId: itemA.id, title: 'Curso A', amountCents: 12_000 }],
    });

    await executeRefund(test.db, provider, partialRefund.id);

    expect(await hasActiveEntitlement(buyer.id, 'course', courseA.id)).toBe(false);
    expect(await hasActiveEntitlement(buyer.id, 'course', courseB.id)).toBe(true);

    const afterPartial = (
      await call({ method: 'GET', url: `/api/v1/orders/${purchased.orderId}`, as: admin })
    ).json();
    expect(afterPartial.status).toBe('partially_refunded');
    expect(afterPartial.refundedCents).toBe(12_000);

    // Reembolso do saldo restante (`items: null`).
    const restRes = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      payload: { reason: 'Saldo restante', items: null },
    });
    expect(restRes.statusCode).toBe(202);
    expect(restRes.json().amountCents).toBe(8_000);
    await executeRefund(test.db, provider, restRes.json().id);

    expect(await hasActiveEntitlement(buyer.id, 'course', courseB.id)).toBe(false);
    const afterFull = (
      await call({ method: 'GET', url: `/api/v1/orders/${purchased.orderId}`, as: admin })
    ).json();
    expect(afterFull.status).toBe('refunded');
    expect(afterFull.refundedCents).toBe(20_000);
  });

  it('Idempotency-Key repete o mesmo Refund (202) com um único refund.execute, e recusa corpo diferente com 422 idempotency_key_reuse', async () => {
    const course = await createPaidCourseAs(test, admin, { priceCents: 15_000 });
    const buyer = await makeBuyer(test);
    const purchased = await checkoutOrder(test.db, provider, {
      buyer,
      items: [{ productType: 'course', productId: course.id }],
      approve: true,
    });
    const otherBuyer = await makeBuyer(test);
    const otherPurchased = await checkoutOrder(test.db, provider, {
      buyer: otherBuyer,
      items: [{ productType: 'course', productId: course.id }],
      approve: true,
    });

    const idempotencyKey = `idem-${randomUUID()}`;
    const first = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      headers: { 'idempotency-key': idempotencyKey },
      payload: { reason: 'Solicitado no chamado #42' },
    });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json();

    const second = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      headers: { 'idempotency-key': idempotencyKey },
      payload: { reason: 'Solicitado no chamado #42' },
    });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(firstBody);

    // Uma única linha em `refunds`, uma única auditoria e um único `refund.execute` na fila.
    const refundRows = await test.db
      .selectFrom('refunds')
      .selectAll()
      .where('orderId', '=', purchased.orderId)
      .execute();
    expect(refundRows).toHaveLength(1);

    const jobs = await test.db
      .selectFrom('jobs')
      .selectAll()
      .where('type', '=', 'refund.execute')
      .where('uniqueKey', '=', `refund.execute:${firstBody.id}`)
      .execute();
    expect(jobs).toHaveLength(1);

    expect(await auditOf(test, purchased.orderId, 'refund.request')).toHaveLength(1);

    // Mesma chave com motivo diferente no mesmo pedido: `422 idempotency_key_reuse`.
    const differentReason = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      headers: { 'idempotency-key': idempotencyKey },
      payload: { reason: 'Outro motivo' },
    });
    expect(differentReason.statusCode).toBe(422);
    expect(differentReason.json()).toMatchObject({ code: 'idempotency_key_reuse' });

    // Mesma chave em outro pedido: `422 idempotency_key_reuse`.
    const differentTarget = await call({
      method: 'POST',
      url: `/api/v1/orders/${otherPurchased.orderId}/refunds`,
      as: admin,
      headers: { 'idempotency-key': idempotencyKey },
      payload: { reason: 'Solicitado no chamado #42' },
    });
    expect(differentTarget.statusCode).toBe(422);
    expect(differentTarget.json()).toMatchObject({ code: 'idempotency_key_reuse' });
  });

  it('falha do provedor mantém o acesso e permite retry (202); estados inválidos, valores acima do pago e gerente recebem 409/422/403', async () => {
    const course = await createPaidCourseAs(test, admin, { priceCents: 10_000 });
    const buyer = await makeBuyer(test);
    const purchased = await checkoutOrder(test.db, provider, {
      buyer,
      items: [{ productType: 'course', productId: course.id }],
      approve: true,
    });
    const orderDetail = (
      await call({ method: 'GET', url: `/api/v1/orders/${purchased.orderId}`, as: admin })
    ).json();
    const itemId = orderDetail.items[0].id as string;

    // Acima do pago: `422 refund_exceeds_paid`.
    const tooMuch = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      payload: {
        reason: 'Acima do pago',
        items: [{ orderItemId: itemId, amountCents: 10_001 }],
      },
    });
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json()).toMatchObject({ code: 'refund_exceeds_paid' });

    // Pedido `pending` não reembolsa: `409 order_not_refundable`.
    const pendingBuyer = await makeBuyer(test);
    const pendingOrder = await checkoutOrder(test.db, provider, {
      buyer: pendingBuyer,
      items: [{ productType: 'course', productId: course.id }],
      approve: false,
    });
    const notPaid = await call({
      method: 'POST',
      url: `/api/v1/orders/${pendingOrder.orderId}/refunds`,
      as: admin,
      payload: { reason: 'Ainda não pago' },
    });
    expect(notPaid.statusCode).toBe(409);
    expect(notPaid.json()).toMatchObject({ code: 'order_not_refundable' });

    // Reembolso criado quando o provedor falha na execução: fica `failed` e o direito permanece.
    const reqRes = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      payload: { reason: 'Falha temporária' },
    });
    expect(reqRes.statusCode).toBe(202);
    const refundId = reqRes.json().id as string;

    // `requested` não aceita retry: `409 refund_not_retryable`.
    const retryWhileRequested = await call({
      method: 'POST',
      url: `/api/v1/refunds/${refundId}/retry`,
      as: admin,
    });
    expect(retryWhileRequested.statusCode).toBe(409);
    expect(retryWhileRequested.json()).toMatchObject({ code: 'refund_not_retryable' });

    provider.setUnavailable(true, ['refund']);
    try {
      const failedExec = await executeRefund(test.db, provider, refundId);
      expect(failedExec.status).toBe('failed');
      expect(failedExec.error).not.toBeNull();
    } finally {
      provider.setUnavailable(false);
    }
    expect(await hasActiveEntitlement(buyer.id, 'course', course.id)).toBe(true);

    // Gerente e instrutor não reembolsam nem repetem: `403` auditado.
    for (const actor of [manager, instructor]) {
      const deniedReq = await call({
        method: 'POST',
        url: `/api/v1/orders/${purchased.orderId}/refunds`,
        as: actor,
        payload: { reason: 'Sem permissão' },
      });
      expect(deniedReq.statusCode).toBe(403);
      const deniedRetry = await call({
        method: 'POST',
        url: `/api/v1/refunds/${refundId}/retry`,
        as: actor,
      });
      expect(deniedRetry.statusCode).toBe(403);
    }

    // Retry pelo admin devolve `202` em `requested`, audita e conclui no worker.
    const retried = await call({
      method: 'POST',
      url: `/api/v1/refunds/${refundId}/retry`,
      as: admin,
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({ id: refundId, status: 'requested', error: null });
    expect(await auditOf(test, refundId, 'refund.retry')).toHaveLength(1);

    const completed = await executeRefund(test.db, provider, refundId);
    expect(completed.status).toBe('done');
    expect(await hasActiveEntitlement(buyer.id, 'course', course.id)).toBe(false);

    // `done` e inexistente não aceitam retry.
    expect(
      (await call({ method: 'POST', url: `/api/v1/refunds/${refundId}/retry`, as: admin }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call({ method: 'POST', url: `/api/v1/refunds/${randomUUID()}/retry`, as: admin }))
        .statusCode,
    ).toBe(404);

    // Nenhum documento fiscal aparece nos logs (spec 011 e spec 033, RNF-02).
    const logs = test.logText();
    expect(logs).not.toContain(SAMPLE_CPF);
    expect(logs).not.toContain(SAMPLE_CNPJ);
  });
});
