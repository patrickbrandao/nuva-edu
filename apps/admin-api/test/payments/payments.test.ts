import { randomUUID } from 'node:crypto';
import {
  executeRefund,
  FakePaymentProvider,
  PaymentWebhookSignatureError,
  processPaymentWebhook,
  receivePaymentWebhook,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, auditOf, type CallOptions, callAs, createActor, deniedBy } from '../actors.ts';
import { createIsolatedDatabase, createTestApp, type TestApp } from '../helpers.ts';
import { CURRENCY, checkoutOrder, createPaidCourseAs, makeBuyer } from '../sales/fixtures.ts';
import { createPlanAs, makeSubscriber, subscribeAndActivate } from '../subscriptions/fixtures.ts';

// Pagamentos, avisos de webhook e estado da integração na admin-api (spec 013; specs 008, 028 e
// 033):
// - `/payments` e `/payments/{id}` (`sales.view`: gerente e admin);
// - `/webhook-events` e `/webhook-events/{id}/retry` (`ops.manage`: só admin; `rejected` sem
//   corpo/assinatura, fora da fila operacional e sem retry; só `failed` aceita reprocessamento);
// - `/settings/payments` (`settings.manage`: só admin; modo de teste, aviso em produção com token
//   de teste, última reconciliação e nenhum segredo em respostas ou logs).

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

describe('consulta de cobranças (/payments)', () => {
  it('lista cobranças de pedido e assinatura com filtros e cursor, detalha com reembolsos e bloqueia instrutor/aluno', async () => {
    const course = await createPaidCourseAs(test, admin, {
      title: 'Curso Cobrança',
      priceCents: 14_000,
    });
    const buyer = await makeBuyer(test);
    const orderPurchase = await checkoutOrder(test.db, provider, {
      buyer,
      items: [{ productType: 'course', productId: course.id }],
      approve: true,
      method: 'pix',
      now: new Date('2026-08-01T10:00:00.000Z'),
    });

    const plan = await createPlanAs(test, admin, { priceCents: 7_900 });
    const subscriber = await makeSubscriber(test);
    const subState = await subscribeAndActivate(test, provider, plan.id, subscriber, {
      now: new Date('2026-08-02T10:00:00.000Z'),
    });

    // Reembolso no pedido para conferir `refunds` em `GET /payments/{id}`.
    const refundRes = await call({
      method: 'POST',
      url: `/api/v1/orders/${orderPurchase.orderId}/refunds`,
      as: admin,
      payload: { reason: 'Parcial na cobrança' },
    });
    expect(refundRes.statusCode).toBe(202);
    await executeRefund(test.db, provider, refundRes.json().id);

    const byOrder = await call({
      method: 'GET',
      url: `/api/v1/payments?orderId=${orderPurchase.orderId}&method=pix&provider=fake`,
      as: manager,
    });
    expect(byOrder.statusCode).toBe(200);
    expect(byOrder.json().items).toHaveLength(1);
    expect(byOrder.json().items[0]).toMatchObject({
      id: orderPurchase.paymentId,
      orderId: orderPurchase.orderId,
      orderNumber: orderPurchase.orderNumber,
      subscriptionId: null,
      provider: 'fake',
      status: 'refunded',
      method: 'pix',
      amountCents: 14_000,
      refundedCents: 14_000,
    });

    const bySub = await call({
      method: 'GET',
      url: `/api/v1/payments?subscriptionId=${subState.subscriptionId}&status=approved`,
      as: admin,
    });
    expect(bySub.statusCode).toBe(200);
    expect(bySub.json().items).toHaveLength(1);
    expect(bySub.json().items[0]).toMatchObject({
      id: subState.paymentId,
      orderId: null,
      orderNumber: null,
      subscriptionId: subState.subscriptionId,
      status: 'approved',
      amountCents: 7_900,
    });

    // Paginação por cursor.
    const p1 = await call({ method: 'GET', url: '/api/v1/payments?limit=1', as: manager });
    expect(p1.statusCode).toBe(200);
    expect(p1.json().items).toHaveLength(1);
    expect(p1.json().nextCursor).not.toBeNull();
    const p2 = await call({
      method: 'GET',
      url: `/api/v1/payments?limit=1&cursor=${encodeURIComponent(p1.json().nextCursor)}`,
      as: manager,
    });
    expect(p2.statusCode).toBe(200);
    expect(p2.json().items[0].id).not.toBe(p1.json().items[0].id);

    // Detalhe da cobrança traz `rawStatus` e os reembolsos com o título congelado do item.
    const detailRes = await call({
      method: 'GET',
      url: `/api/v1/payments/${orderPurchase.paymentId}`,
      as: manager,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json()).toMatchObject({
      id: orderPurchase.paymentId,
      orderNumber: orderPurchase.orderNumber,
      status: 'refunded',
      refunds: [
        {
          id: refundRes.json().id,
          status: 'done',
          items: [{ title: 'Curso Cobrança', amountCents: 14_000 }],
        },
      ],
    });

    expect(
      (await call({ method: 'GET', url: `/api/v1/payments/${randomUUID()}`, as: admin }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call({ method: 'GET', url: '/api/v1/payments?cursor=invalido', as: admin }))
        .statusCode,
    ).toBe(400);

    for (const actor of [instructor, student]) {
      expect((await call({ method: 'GET', url: '/api/v1/payments', as: actor })).statusCode).toBe(
        403,
      );
      expect(
        (
          await call({
            method: 'GET',
            url: `/api/v1/payments/${orderPurchase.paymentId}`,
            as: actor,
          })
        ).statusCode,
      ).toBe(403);
    }
  });
});

describe('eventos de webhook (/webhook-events)', () => {
  it('rejected fica sem corpo, fora da fila operacional e sem retry; evento válido de mesmo id entra e failed aceita reprocessamento auditado', async () => {
    const course = await createPaidCourseAs(test, admin, { priceCents: 10_000 });
    const buyer = await makeBuyer(test);
    const pendingOrder = await checkoutOrder(test.db, provider, {
      buyer,
      items: [{ productType: 'course', productId: course.id }],
      approve: false,
      now: new Date('2026-08-10T12:00:00.000Z'),
    });

    provider.setNow(new Date('2026-08-10T12:01:00.000Z'));
    const approved = provider.approveCheckout(pendingOrder.providerCheckoutId as string, {
      amountCents: 9_500, // Divergência de valor -> `failed` com `amount_mismatch` no worker.
    });
    const eventId = `evt-${randomUUID()}`;
    const signed = provider.paymentWebhook(approved.providerPaymentId, {
      eventId,
      secret: 'segredo-falso-invalido',
    });

    // 1. Assinatura inválida: grava `rejected` sem corpo/assinatura e sem fila.
    await expect(
      receivePaymentWebhook(test.db, {
        provider,
        headers: signed.headers,
        rawBody: `${(signed.rawBody as string).slice(0, -1)},"campoSecreto":"NAO_GUARDAR_CORPO"}`,
        now: new Date('2026-08-10T12:01:05.000Z'),
      }),
    ).rejects.toBeInstanceOf(PaymentWebhookSignatureError);

    const rejectedList = await call({
      method: 'GET',
      url: '/api/v1/webhook-events?status=rejected',
      as: admin,
    });
    expect(rejectedList.statusCode).toBe(200);
    const rejectedEvent = rejectedList
      .json()
      .items.find((item: { eventId: string }) => item.eventId === eventId);
    expect(rejectedEvent).toMatchObject({
      provider: 'fake',
      eventId,
      resourceType: 'payment',
      resourceId: approved.providerPaymentId,
      status: 'rejected',
      attempts: 0,
      error: 'invalid_signature',
      processedAt: null,
    });
    expect(JSON.stringify(rejectedList.json())).not.toContain('NAO_GUARDAR_CORPO');
    expect(JSON.stringify(rejectedList.json())).not.toContain('segredo-falso-invalido');

    // `rejected` não aparece na fila padrão (`status=failed`) e nunca aceita reprocessamento.
    const defaultQueueBefore = await call({
      method: 'GET',
      url: '/api/v1/webhook-events',
      as: admin,
    });
    expect(
      defaultQueueBefore.json().items.some((item: { id: string }) => item.id === rejectedEvent.id),
    ).toBe(false);

    const retryRejected = await call({
      method: 'POST',
      url: `/api/v1/webhook-events/${rejectedEvent.id}/retry`,
      as: admin,
    });
    expect(retryRejected.statusCode).toBe(409);
    expect(retryRejected.json()).toMatchObject({ code: 'webhook_event_not_retryable' });

    // 2. Evento válido posterior com o MESMO `eventId` entra normalmente; ao falhar por
    // `amount_mismatch`, aparece em `status=failed` e aceita `retry`.
    const validSigned = provider.paymentWebhook(approved.providerPaymentId, {
      eventId,
    });
    const received = await receivePaymentWebhook(test.db, {
      provider,
      headers: validSigned.headers,
      rawBody: validSigned.rawBody,
      now: new Date('2026-08-10T12:02:00.000Z'),
    });
    expect(received.created).toBe(true);

    // Enquanto `received`, não aceita retry (`409`).
    const retryReceived = await call({
      method: 'POST',
      url: `/api/v1/webhook-events/${received.webhookEventId}/retry`,
      as: admin,
    });
    expect(retryReceived.statusCode).toBe(409);
    expect(retryReceived.json()).toMatchObject({ code: 'webhook_event_not_retryable' });

    const processed = await processPaymentWebhook(test.db, provider, received.webhookEventId);
    expect(processed.status).toBe('failed');

    const failedList = await call({
      method: 'GET',
      url: '/api/v1/webhook-events',
      as: admin,
    });
    expect(failedList.statusCode).toBe(200);
    const failedEvent = failedList
      .json()
      .items.find((item: { id: string }) => item.id === received.webhookEventId);
    expect(failedEvent).toMatchObject({
      id: received.webhookEventId,
      status: 'failed',
      attempts: 1,
      error: 'amount_mismatch',
    });

    // Conclui a tarefa anterior de `payment.webhook` (como o worker faz ao esgotar tentativas) e
    // reprocessa pela rota do admin.
    await test.db
      .updateTable('jobs')
      .set({ status: 'done', finishedAt: new Date() })
      .where('uniqueKey', '=', `payment.webhook:${received.webhookEventId}`)
      .execute();

    const retried = await call({
      method: 'POST',
      url: `/api/v1/webhook-events/${received.webhookEventId}/retry`,
      as: admin,
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({
      id: received.webhookEventId,
      status: 'received',
      attempts: 0,
      error: null,
      processedAt: null,
    });

    const retryAudit = await auditOf(test, received.webhookEventId, 'webhook_event.retry');
    expect(retryAudit).toHaveLength(1);
    expect(retryAudit[0]?.details).toMatchObject({ previousError: 'amount_mismatch' });

    const queuedJob = await test.db
      .selectFrom('jobs')
      .selectAll()
      .where('uniqueKey', '=', `payment.webhook:${received.webhookEventId}`)
      .where('status', '=', 'queued')
      .executeTakeFirst();
    expect(queuedJob).toBeDefined();

    expect(
      (
        await call({
          method: 'POST',
          url: `/api/v1/webhook-events/${randomUUID()}/retry`,
          as: admin,
        })
      ).statusCode,
    ).toBe(404);

    // Só `admin` (`ops.manage`): gerente, instrutor e aluno recebem `403` auditado.
    for (const actor of [manager, instructor, student]) {
      const listDenied = await call({ method: 'GET', url: '/api/v1/webhook-events', as: actor });
      expect(listDenied.statusCode).toBe(403);
      const retryDenied = await call({
        method: 'POST',
        url: `/api/v1/webhook-events/${received.webhookEventId}/retry`,
        as: actor,
      });
      expect(retryDenied.statusCode).toBe(403);
      expect((await deniedBy(test, actor.id)).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('configuração e indicador de pagamento (/settings/payments)', () => {
  it('indica o fake, a última reconciliação e restringe o acesso ao admin', async () => {
    const initial = await call({
      method: 'GET',
      url: '/api/v1/settings/payments',
      as: admin,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({
      provider: 'fake',
      testMode: true,
      productionWarning: false,
      lastReconciliationAt: null,
    });

    // Registra uma reconciliação concluída e confere `lastReconciliationAt`.
    const finishedAt = new Date('2026-08-15T03:05:00.000Z');
    await test.db
      .insertInto('jobs')
      .values({
        type: 'payment.reconcile_orders',
        payload: '{}',
        status: 'done',
        priority: 10,
        maxAttempts: 3,
        finishedAt,
      })
      .execute();

    const afterReconcile = await call({
      method: 'GET',
      url: '/api/v1/settings/payments',
      as: admin,
    });
    expect(afterReconcile.json()).toEqual({
      provider: 'fake',
      testMode: true,
      productionWarning: false,
      lastReconciliationAt: finishedAt.toISOString(),
    });

    // Gerente, instrutor e aluno recebem `403` (`settings.manage`).
    for (const actor of [manager, instructor, student]) {
      const denied = await call({
        method: 'GET',
        url: '/api/v1/settings/payments',
        as: actor,
      });
      expect(denied.statusCode).toBe(403);
    }
  });

  it.each([
    { mode: 'teste', accessToken: 'TEST-segredo-acesso-mp-998877', testMode: true },
    { mode: 'ativo', accessToken: 'APP_USR-credencial-real-mp-776655', testMode: false },
  ])(
    'indica o modo $mode em produção e protege as credenciais',
    { timeout: 15_000 },
    async ({ accessToken, testMode }) => {
      const publicKey = 'chave-publica-mp-112233';
      const webhookSecret = 'whsec-segredo-webhook-mp-445566';
      const production = createTestApp(
        {
          NUVA_ENV: 'production',
          SESSION_SECRET: 's'.repeat(48),
          NUVA_ADMIN_URL: 'https://edu-admin.escola.example',
          NUVA_CLASSROOM_URL: 'https://classroom.escola.example',
          NUVA_PAYMENT_PROVIDER: 'mercadopago',
          MP_ACCESS_TOKEN: accessToken,
          MP_PUBLIC_KEY: publicKey,
          MP_WEBHOOK_SECRET: webhookSecret,
          SMTP_HOST: 'smtp.escola.example',
          SMTP_FROM: 'escola@escola.example',
        },
        { listenUserEvents: false },
      );
      try {
        const admin = await createActor(production, 'admin');
        const response = await callAs(production, {
          method: 'GET',
          url: '/api/v1/settings/payments',
          as: admin,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          provider: 'mercadopago',
          testMode,
          productionWarning: testMode,
        });
        for (const secret of [accessToken, publicKey, webhookSecret]) {
          expect(response.body).not.toContain(secret);
          expect(production.logText()).not.toContain(secret);
        }
      } finally {
        await production.close();
      }
    },
  );
});
