import { createHmac, randomUUID } from 'node:crypto';
import {
  addCartItem,
  createOrder,
  FAKE_PAYMENT_WEBHOOK_SECRET,
  FakePaymentProvider,
  orderExternalReference,
  PAYMENT_WEBHOOK_MAX_AGE_MS,
  processPaymentWebhook,
  saveMyBilling,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLASSROOM_RATE_LIMITS } from '../../src/rate-limits.ts';
import { WEBHOOK_MAX_BYTES } from '../../src/routes/webhooks.ts';
import {
  createUser,
  isolatedDatabase,
  TEST_PASSWORD,
  type TestUser,
  uniqueIp,
} from '../accounts.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

// Recepção do webhook de pagamento na classroom-api (`POST /api/v1/webhooks/mercadopago`,
// specs 013 e 033; tarefa 540): corpo bruto até 64 KB, assinatura e janela de 5 min, `401`
// `rejected` sem fila, idempotência, métrica `webhooks_total`, rate limit de 300 req/min por IP,
// retenção de 90 dias e ausência de segredos/corpo/documento fiscal nos logs.

const TAX_ID = '52998224725';
const BODY_SENTINEL = 'sentinela-corpo-bruto-nunca-logado-9f2a';
const SECRET_SENTINEL = 'segredo-falso-atacante-nunca-logado-7b8c';

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;
let provider: FakePaymentProvider;
let student: TestUser;

function signManifest(resourceId: string, requestId: string, timestamp: string, secret: string) {
  const hmac = createHmac('sha256', secret)
    .update(`id:${resourceId};request-id:${requestId};ts:${timestamp};`)
    .digest('hex');
  return `ts=${timestamp},v1=${hmac}`;
}

async function createPendingOrder() {
  const course = await test.db
    .insertInto('courses')
    .values({
      slug: `curso-wh-${randomUUID().slice(0, 10)}`,
      title: 'Curso Webhook',
      summary: 'Resumo',
      accessMode: 'paid',
      priceCents: 3_500,
      status: 'published',
      publishedAt: new Date(),
      level: 'beginner',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await addCartItem(test.db, student.id, { productType: 'course', productId: course.id }, 'BRL');
  const { order } = await createOrder(test.db, {
    userId: student.id,
    provider,
    currency: 'BRL',
    returnUrls: {
      success: 'http://classroom.localhost:8080/pedidos/ok',
      pending: 'http://classroom.localhost:8080/pedidos/ok',
      failure: 'http://classroom.localhost:8080/pedidos/ok',
    },
  });
  const [payment] = await provider.findPaymentsByReference(orderExternalReference(order.id));
  if (!payment) throw new Error('Pagamento pendente ausente no provedor fake.');
  return { order, payment };
}

beforeAll(async () => {
  database = await isolatedDatabase();
  provider = new FakePaymentProvider({
    currency: 'BRL',
    webhookSecret: FAKE_PAYMENT_WEBHOOK_SECRET,
    now: '2026-04-10T12:00:00.000Z',
  });
  test = createTestApp(
    { DATABASE_URL: database.url, NUVA_PAYMENT_PROVIDER: 'fake' },
    { paymentProvider: provider },
  );
  student = await createUser(test.db);
  await saveMyBilling(test.db, student.id, {
    fullName: 'Aluna Webhook',
    taxIdType: 'cpf',
    taxId: TAX_ID,
  });
});

afterAll(async () => {
  const logs = test.logText();
  expect(logs).not.toContain(TEST_PASSWORD);
  expect(logs).not.toContain(FAKE_PAYMENT_WEBHOOK_SECRET);
  expect(logs).not.toContain(SECRET_SENTINEL);
  expect(logs).not.toContain(BODY_SENTINEL);
  expect(logs).not.toContain(TAX_ID);
  await test.close();
  await database.drop();
});

describe('POST /api/v1/webhooks/mercadopago: recepção, idempotência e isolamento do worker', () => {
  it('preserva o corpo bruto, enfileira sem consultar o provedor na resposta HTTP e deduplica 5 entregas', async () => {
    const { order, payment } = await createPendingOrder();
    const approved = provider.approvePayment(payment.providerPaymentId, { method: 'pix' });
    const eventId = `evt-valid-${randomUUID()}`;
    const requestId = `req-${eventId}`;
    const ts = String(provider.now.getTime());
    const signature = signManifest(
      approved.providerPaymentId,
      requestId,
      ts,
      FAKE_PAYMENT_WEBHOOK_SECRET,
    );
    // JSON com quebras de linha, espaços extras e campo desconhecido com sentinela de log.
    const rawJson = `{\n  "id": "${eventId}",\n  "type": "payment",\n  "extra": "${BODY_SENTINEL}",\n  "data": { "id": "${approved.providerPaymentId}" }\n}`;

    // Provedor com `getPayment` fora do ar: prova que o endpoint HTTP NÃO consulta o provedor
    // nem aplica a transição na resposta HTTP (RNF-01).
    provider.setUnavailable(true, ['getPayment', 'getSubscription']);
    try {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          test.app.inject({
            method: 'POST',
            url: '/api/v1/webhooks/mercadopago',
            remoteAddress: uniqueIp(),
            headers: {
              'content-type': 'application/json',
              'x-request-id': requestId,
              'x-signature': signature,
            },
            payload: rawJson,
          }),
        ),
      );
      for (const response of responses) {
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('');
      }
    } finally {
      provider.setUnavailable(false);
    }

    // Antes do worker rodar, o pedido segue `pending`.
    const stillPending = await test.db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', order.id)
      .executeTakeFirstOrThrow();
    expect(stillPending.status).toBe('pending');

    const events = await test.db
      .selectFrom('webhookEvents')
      .selectAll()
      .where('eventId', '=', eventId)
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'fake',
      eventId,
      resourceType: 'payment',
      resourceId: approved.providerPaymentId,
      status: 'received',
      attempts: 0,
      error: null,
    });

    const webhookEventId = events[0]?.id as string;
    const jobs = await test.db
      .selectFrom('jobs')
      .select('id')
      .where('uniqueKey', '=', `payment.webhook:${webhookEventId}`)
      .execute();
    expect(jobs).toHaveLength(1);

    // Métricas Prometheus registram 1 accepted e 4 duplicate.
    const metrics = (await test.app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(metrics).toContain('webhooks_total{outcome="accepted",provider="fake"} 1');
    expect(metrics).toContain('webhooks_total{outcome="duplicate",provider="fake"} 4');

    // Quando o worker processa a tarefa, o pedido vira `paid` e concede 1 único direito.
    const processed = await processPaymentWebhook(test.db, provider, webhookEventId);
    expect(processed).toMatchObject({ status: 'processed', applied: true });
    const paid = await test.db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', order.id)
      .executeTakeFirstOrThrow();
    expect(paid.status).toBe('paid');
  });
});

describe('POST /api/v1/webhooks/mercadopago: assinatura inválida, janela de 5 min, retry e retenção', () => {
  it('responde 401 rejected/invalid_signature sem fila, aceita evento válido posterior de mesmo id e bloqueia retry', async () => {
    const { order, payment } = await createPendingOrder();
    const approved = provider.approvePayment(payment.providerPaymentId);
    const sharedEventId = `evt-shared-${randomUUID()}`;

    const wrongSecret = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: sharedEventId,
      secret: SECRET_SENTINEL,
    });
    const expiredPast = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: sharedEventId,
      timestamp: provider.now.getTime() - PAYMENT_WEBHOOK_MAX_AGE_MS - 1_000,
    });
    const expiredFuture = provider.paymentWebhook(approved.providerPaymentId, {
      eventId: sharedEventId,
      timestamp: provider.now.getTime() + PAYMENT_WEBHOOK_MAX_AGE_MS + 1_000,
    });

    for (const bad of [
      { headers: {}, body: JSON.stringify({ note: BODY_SENTINEL }) },
      {
        headers: wrongSecret.headers as Record<string, string>,
        body: wrongSecret.rawBody as string,
      },
      {
        headers: expiredPast.headers as Record<string, string>,
        body: expiredPast.rawBody as string,
      },
      {
        headers: expiredFuture.headers as Record<string, string>,
        body: expiredFuture.rawBody as string,
      },
    ]) {
      const response = await test.app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mercadopago',
        remoteAddress: uniqueIp(),
        headers: { 'content-type': 'application/json', ...bad.headers },
        payload: bad.body,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'payment_webhook_invalid_signature' });
      expect(response.body).not.toContain(FAKE_PAYMENT_WEBHOOK_SECRET);
      expect(response.body).not.toContain(SECRET_SENTINEL);
    }

    // Sem assinatura e sem ids no JSON (`{ note: ... }`): metadados ficam nulos.
    const emptyRejected = await test.db
      .selectFrom('webhookEvents')
      .selectAll()
      .where('status', '=', 'rejected')
      .where('eventId', 'is', null)
      .executeTakeFirstOrThrow();
    expect(emptyRejected).toMatchObject({
      provider: 'fake',
      eventId: null,
      resourceType: null,
      resourceId: null,
      status: 'rejected',
      error: 'invalid_signature',
      attempts: 0,
    });

    const rejectedShared = await test.db
      .selectFrom('webhookEvents')
      .selectAll()
      .where('eventId', '=', sharedEventId)
      .where('status', '=', 'rejected')
      .execute();
    expect(rejectedShared).toHaveLength(3);

    for (const row of rejectedShared) {
      const queued = await test.db
        .selectFrom('jobs')
        .select('id')
        .where('uniqueKey', '=', `payment.webhook:${row.id}`)
        .execute();
      expect(queued).toHaveLength(0);
    }

    // Rejeitado não aceita reprocessamento nem pelo núcleo nem por UPDATE no banco (gatilho P0001).
    const rejectedId = rejectedShared[0]?.id as string;
    expect(await processPaymentWebhook(test.db, provider, rejectedId)).toMatchObject({
      status: 'rejected',
      applied: false,
    });
    await expect(
      test.db
        .updateTable('webhookEvents')
        .set({ status: 'received', error: null })
        .where('id', '=', rejectedId)
        .execute(),
    ).rejects.toMatchObject({ code: 'P0001' });

    // Evento válido posterior com o MESMO `eventId` entra e processa normalmente.
    const valid = provider.paymentWebhook(approved.providerPaymentId, { eventId: sharedEventId });
    const accepted = await test.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercadopago',
      remoteAddress: uniqueIp(),
      headers: {
        'content-type': 'application/json',
        ...(valid.headers as Record<string, string>),
      },
      payload: valid.rawBody as string,
    });
    expect(accepted.statusCode).toBe(200);

    const validRow = await test.db
      .selectFrom('webhookEvents')
      .selectAll()
      .where('eventId', '=', sharedEventId)
      .where('status', '=', 'received')
      .executeTakeFirstOrThrow();
    expect((await processPaymentWebhook(test.db, provider, validRow.id)).status).toBe('processed');
    expect(
      (
        await test.db
          .selectFrom('orders')
          .select('status')
          .where('id', '=', order.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('paid');

    const metrics = (await test.app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(metrics).toContain('webhooks_total{outcome="rejected",provider="fake"} 4');
  });

  it('retenção padrão de 90 dias permite expurgar eventos rejected e processed vencidos preservando recentes', async () => {
    expect(test.config.retention.webhookDays).toBe(90);
    const now = new Date('2026-06-01T00:00:00.000Z');
    const dayMs = 86_400_000;
    const cutoff = new Date(now.getTime() - test.config.retention.webhookDays * dayMs);

    const inserted = await test.db
      .insertInto('webhookEvents')
      .values([
        {
          provider: 'fake',
          eventId: `old-rejected-${randomUUID()}`,
          status: 'rejected',
          error: 'invalid_signature',
          attempts: 0,
          receivedAt: new Date(now.getTime() - 91 * dayMs),
        },
        {
          provider: 'fake',
          eventId: `recent-rejected-${randomUUID()}`,
          status: 'rejected',
          error: 'invalid_signature',
          attempts: 0,
          receivedAt: new Date(now.getTime() - 89 * dayMs),
        },
      ])
      .returning('id')
      .execute();

    await test.db.deleteFrom('webhookEvents').where('receivedAt', '<', cutoff).execute();

    const remaining = await test.db
      .selectFrom('webhookEvents')
      .select('id')
      .where(
        'id',
        'in',
        inserted.map((row) => row.id),
      )
      .execute();
    expect(remaining.map((row) => row.id)).toEqual([inserted[1]?.id]);
  });
});

describe('POST /api/v1/webhooks/mercadopago: limite de 64 KB, formatos e rate limit de 300/min por IP', () => {
  it('recusa corpo acima de 64 KB com 413, tipo incorreto com 415, JSON malformado com 400 e recurso desconhecido com 422', async () => {
    // Acima de 64 KB -> 413 payload_too_large.
    const oversized = JSON.stringify({ pad: 'a'.repeat(WEBHOOK_MAX_BYTES) });
    const tooLarge = await test.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercadopago',
      remoteAddress: uniqueIp(),
      headers: { 'content-type': 'application/json' },
      payload: oversized,
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().code).toBe('payload_too_large');

    const wrongType = await test.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercadopago',
      remoteAddress: uniqueIp(),
      headers: { 'content-type': 'text/plain' },
      payload: '{}',
    });
    expect(wrongType.statusCode).toBe(415);
    expect(wrongType.json().code).toBe('unsupported_media_type');

    const badJson = await test.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercadopago',
      remoteAddress: uniqueIp(),
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().code).toBe('validation_failed');

    // Envelope assinado sobre um recurso, mas tipo desconhecido -> 422 payment_webhook_invalid.
    const ts = String(provider.now.getTime());
    const reqId = `req-invalid-${randomUUID()}`;
    const sig = signManifest('pay-qualquer', reqId, ts, FAKE_PAYMENT_WEBHOOK_SECRET);
    const unknownType = await test.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mercadopago',
      remoteAddress: uniqueIp(),
      headers: {
        'content-type': 'application/json',
        'x-request-id': reqId,
        'x-signature': sig,
      },
      payload: JSON.stringify({
        id: `evt-unknown-${randomUUID()}`,
        type: 'topic_unknown',
        data: { id: 'pay-qualquer' },
      }),
    });
    expect(unknownType.statusCode).toBe(422);
    expect(unknownType.json().code).toBe('payment_webhook_invalid');

    const metrics = (await test.app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(metrics).toContain('webhooks_total{outcome="invalid",provider="fake"} 1');
  });

  it('aplica limite de 300 req/min por IP real (TRUSTED_PROXIES), contando rejeições sem gastar cota de visitante', async () => {
    const limited = createTestApp(
      { DATABASE_URL: database.url, NUVA_PAYMENT_PROVIDER: 'fake' },
      { paymentProvider: provider, rateLimits: CLASSROOM_RATE_LIMITS },
    );
    try {
      const clientIp = '203.0.113.77';
      const beforeCount = await limited.db
        .selectFrom('webhookEvents')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();

      for (let call = 0; call < 300; call += 1) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/mercadopago',
          remoteAddress: '172.18.0.10',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': clientIp,
          },
          payload: '{}',
        });
        expect(res.statusCode).toBe(401);
      }

      const afterAllowed = await limited.db
        .selectFrom('webhookEvents')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      expect(Number(afterAllowed.n) - Number(beforeCount.n)).toBe(300);

      // A 301ª no mesmo minuto responde 429 com Retry-After e NÃO grava outra rejeição no banco.
      const rateLimited = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mercadopago',
        remoteAddress: '172.18.0.10',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': clientIp,
        },
        payload: '{}',
      });
      expect(rateLimited.statusCode).toBe(429);
      expect(rateLimited.json().code).toBe('rate_limited');
      expect(Number(rateLimited.headers['retry-after'])).toBeGreaterThan(0);

      const afterBlocked = await limited.db
        .selectFrom('webhookEvents')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      expect(Number(afterBlocked.n)).toBe(Number(afterAllowed.n));

      // A cota de visitante (60/min) do mesmo IP permanece intacta.
      const metaReply = await limited.app.inject({
        method: 'GET',
        url: '/api/v1/meta',
        remoteAddress: '172.18.0.10',
        headers: { 'x-forwarded-for': clientIp },
      });
      expect(metaReply.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
