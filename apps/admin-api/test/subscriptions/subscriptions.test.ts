import { randomUUID } from 'node:crypto';
import {
  createSubscriptionCheckout,
  executeRefund,
  FakePaymentProvider,
  type RefundView,
  refundExecuteKey,
  suspendExpiredSubscriptions,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, auditOf, type CallOptions, callAs, createActor, deniedBy } from '../actors.ts';
import { createTestApp, type TestApp } from '../helpers.ts';
import {
  CURRENCY,
  createPlanAs,
  makePastDue,
  makeSubscriber,
  RETURN_URLS,
  subscribeAndActivate,
} from './fixtures.ts';

// Assinaturas pela admin-api (spec 012, "Interfaces e contratos", "Cancelamento" e "Reembolso de
// cobrança"; specs 008, 013 e 028). O dono da escrita é o classroom-api/worker: aqui a assinatura
// nasce pelo checkout do núcleo e é consultada, cancelada e reembolsada pela equipe. Um único
// `FakePaymentProvider` no arquivo porque o fake numera planos e adesões a partir de zero e o banco
// dos testes é compartilhado entre os arquivos.

const provider = new FakePaymentProvider({ currency: CURRENCY });
const test: TestApp = createTestApp({}, { paymentProvider: provider });
afterAll(() => test.close());

let admin: Actor;
let manager: Actor;
let instructor: Actor;

beforeAll(async () => {
  [admin, manager, instructor] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
  ]);
});

const call = (options: CallOptions) => callAs(test, options);

const NOW = new Date('2026-03-01T00:00:00.000Z');
const DAY = 86_400_000;

/** Plano criado pela rota do admin; depois a assinatura, pelo checkout do núcleo. */
async function planWithSubscription(priceCents = 9_900) {
  const plan = await createPlanAs(test, admin, { priceCents });
  const subscriber = await makeSubscriber(test);
  const subscription = await subscribeAndActivate(test, provider, plan.id, subscriber, {
    now: NOW,
  });
  return { plan, subscriber, subscription };
}

async function detail(id: string) {
  const response = await call({ method: 'GET', url: `/api/v1/subscriptions/${id}`, as: admin });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe('consulta de assinaturas', () => {
  it('lista e detalha a assinatura com plano, período e cobranças, e esconde o documento fiscal', async () => {
    const { plan, subscriber, subscription } = await planWithSubscription();

    const listed = await call({
      method: 'GET',
      url: `/api/v1/subscriptions?planId=${plan.id}`,
      as: manager,
    });
    expect(listed.statusCode).toBe(200);
    const page = listed.json();
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
    const summary = page.items[0];
    expect(summary).toMatchObject({
      id: subscription.subscriptionId,
      subscriber: { id: subscriber.id, email: subscriber.email },
      plan: { id: plan.id, title: plan.title, interval: 'month' },
      status: 'active',
      priceCents: 9_900,
      currency: CURRENCY,
      cancelReason: null,
      endedAt: null,
    });
    // `nextChargeAt` é o fim do período em `active`; o documento fiscal não aparece.
    expect(summary.nextChargeAt).toBe(summary.currentPeriodEnd);
    expect(new Date(summary.currentPeriodEnd).getTime()).toBe(
      subscription.currentPeriodEnd.getTime(),
    );
    expect(JSON.stringify(page)).not.toContain('52998224725');
    expect(JSON.stringify(page)).not.toContain('taxId');

    const one = await detail(subscription.subscriptionId);
    expect(one).toMatchObject({
      id: subscription.subscriptionId,
      status: 'active',
      provider: 'fake',
      providerSubscriptionId: subscription.providerSubscriptionId,
      couponCode: null,
      currentPeriodPaymentId: subscription.paymentId,
    });
    expect(one.plan).toMatchObject({ id: plan.id, priceCents: 9_900, items: [] });
    expect(one.payments).toHaveLength(1);
    expect(one.payments[0]).toMatchObject({
      id: subscription.paymentId,
      orderId: null,
      orderNumber: null,
      subscriptionId: subscription.subscriptionId,
      provider: 'fake',
      status: 'approved',
      amountCents: 9_900,
      refundedCents: 0,
      refunds: [],
    });
    expect(JSON.stringify(one)).not.toContain('52998224725');

    // Busca por e-mail do assinante e filtro por estado.
    const byEmail = await call({
      method: 'GET',
      url: `/api/v1/subscriptions?q=${encodeURIComponent(subscriber.email)}`,
      as: admin,
    });
    expect(byEmail.json().items.map((item: { id: string }) => item.id)).toEqual([
      subscription.subscriptionId,
    ]);
    const ended = await call({
      method: 'GET',
      url: `/api/v1/subscriptions?status=ended&planId=${plan.id}`,
      as: admin,
    });
    expect(ended.json().items).toEqual([]);

    expect(
      (await call({ method: 'GET', url: `/api/v1/subscriptions/${randomUUID()}`, as: admin }))
        .statusCode,
    ).toBe(404);
  });

  it('instrutor recebe 403 nas duas rotas, com a negação na auditoria', async () => {
    const { subscription } = await planWithSubscription();
    for (const url of [
      '/api/v1/subscriptions',
      `/api/v1/subscriptions/${subscription.subscriptionId}`,
    ]) {
      const response = await call({ method: 'GET', url, as: instructor });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'permission_denied' });
    }
    const denials = await deniedBy(test, instructor.id);
    expect(denials.length).toBeGreaterThan(0);
    for (const row of denials) {
      expect(row.details).toMatchObject({ permission: 'sales.view' });
    }
  });

  it('o preço contratado não muda com o preço do plano; a contagem de assinaturas é do plano', async () => {
    const { plan, subscription } = await planWithSubscription(5_000);
    const patched = await call({
      method: 'PATCH',
      url: `/api/v1/plans/${plan.id}`,
      as: admin,
      payload: { priceCents: 15_000 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().priceCents).toBe(15_000);
    expect(patched.json().subscriptionCount).toBe(1);

    const one = await detail(subscription.subscriptionId);
    expect(one.priceCents).toBe(5_000);
    expect(one.plan.priceCents).toBe(15_000);
  });
});

describe('cancelamento administrativo', () => {
  it('active vai a canceling, cancela no provedor e audita com o motivo', async () => {
    const { subscription } = await planWithSubscription();
    const response = await call({
      method: 'POST',
      url: `/api/v1/subscriptions/${subscription.subscriptionId}/cancel`,
      as: admin,
      payload: { reason: 'Pedido do aluno' },
    });
    expect(response.statusCode).toBe(200);
    const canceled = response.json();
    expect(canceled).toMatchObject({
      id: subscription.subscriptionId,
      status: 'canceling',
      cancelReason: 'Pedido do aluno',
      nextChargeAt: null,
    });
    expect(canceled.canceledAt).not.toBeNull();
    expect(canceled.endedAt).toBeNull();
    // O acesso segue até o fim do período já pago.
    expect(canceled.currentPeriodEnd).toBe(subscription.currentPeriodEnd.toISOString());

    const providerSubscription = await provider.getSubscription(
      subscription.providerSubscriptionId,
    );
    expect(providerSubscription.status).toBe('canceled');

    const audit = await auditOf(test, subscription.subscriptionId, 'subscription.cancel');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: admin.id, targetType: 'subscription' });
    expect(audit[0]?.details).toMatchObject({
      reason: 'Pedido do aluno',
      previousStatus: 'active',
      status: 'canceling',
    });
  });

  it('past_due vai a canceling encerrando a carência; suspended encerra na hora', async () => {
    const late = await planWithSubscription();
    await makePastDue(test, provider, late.subscription, new Date(NOW.getTime() + 31 * DAY));
    const pastDue = await call({
      method: 'POST',
      url: `/api/v1/subscriptions/${late.subscription.subscriptionId}/cancel`,
      as: admin,
      payload: { reason: 'Recusa do cartão' },
    });
    expect(pastDue.statusCode).toBe(200);
    expect(pastDue.json()).toMatchObject({ status: 'canceling', graceUntil: null });

    const lost = await planWithSubscription();
    await makePastDue(test, provider, lost.subscription, new Date(NOW.getTime() + 31 * DAY));
    await suspendExpiredSubscriptions(test.db, {
      now: new Date(NOW.getTime() + 40 * DAY),
      graceDays: 3,
    });
    const suspended = await detail(lost.subscription.subscriptionId);
    expect(suspended.status).toBe('suspended');

    const response = await call({
      method: 'POST',
      url: `/api/v1/subscriptions/${lost.subscription.subscriptionId}/cancel`,
      as: admin,
      payload: { reason: 'Sem pagamento' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ended', cancelReason: 'Sem pagamento' });
    expect(response.json().endedAt).not.toBeNull();
  });

  it('pending responde 409 subscription_not_cancelable; sem motivo ou gerente: 400 e 403', async () => {
    const plan = await createPlanAs(test, admin);
    const subscriber = await makeSubscriber(test);
    // Checkout sem pagamento aprovado: a assinatura fica `pending`.
    const checkout = await createSubscriptionCheckout(test.db, {
      userId: subscriber.id,
      planId: plan.id,
      provider,
      currency: CURRENCY,
      returnUrls: RETURN_URLS,
      now: NOW,
    });
    const pending = await call({
      method: 'POST',
      url: `/api/v1/subscriptions/${checkout.subscription.id}/cancel`,
      as: admin,
      payload: { reason: 'Desisti' },
    });
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toMatchObject({ code: 'subscription_not_cancelable' });

    const { subscription } = await planWithSubscription();
    const noReason = await call({
      method: 'POST',
      url: `/api/v1/subscriptions/${subscription.subscriptionId}/cancel`,
      as: admin,
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);

    const byManager = await call({
      method: 'POST',
      url: `/api/v1/subscriptions/${subscription.subscriptionId}/cancel`,
      as: manager,
      payload: { reason: 'Gerente tentando' },
    });
    expect(byManager.statusCode).toBe(403);
    expect(byManager.json()).toMatchObject({ code: 'permission_denied' });
    expect((await detail(subscription.subscriptionId)).status).toBe('active');
  });

  it('provedor fora do ar: 503 payment_provider_unavailable e nada muda', async () => {
    const { subscription } = await planWithSubscription();
    provider.setUnavailable(true, ['cancelSubscription']);
    try {
      const response = await call({
        method: 'POST',
        url: `/api/v1/subscriptions/${subscription.subscriptionId}/cancel`,
        as: admin,
        payload: { reason: 'Tentar' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'payment_provider_unavailable' });
    } finally {
      provider.setUnavailable(false);
    }
    const one = await detail(subscription.subscriptionId);
    expect(one.status).toBe('active');
    expect(one.canceledAt).toBeNull();
    expect(await auditOf(test, subscription.subscriptionId, 'subscription.cancel')).toHaveLength(0);
  });
});

describe('reembolso de cobrança recorrente', () => {
  async function requestRefund(
    subscriptionId: string,
    paymentId: string,
    payload: Record<string, unknown> = { reason: 'Cobrança indevida' },
    headers: Record<string, string> = {},
  ) {
    return call({
      method: 'POST',
      url: `/api/v1/subscriptions/${subscriptionId}/payments/${paymentId}/refund`,
      as: admin,
      payload,
      headers,
    });
  }

  it('202 com o reembolso requested, auditoria e execução que encerra a assinatura', async () => {
    const { subscription } = await planWithSubscription();
    const response = await requestRefund(subscription.subscriptionId, subscription.paymentId, {
      reason: 'Cobrança indevida',
    });
    expect(response.statusCode).toBe(202);
    const refund: RefundView = response.json();
    expect(refund).toMatchObject({
      orderId: null,
      paymentId: subscription.paymentId,
      items: [],
      amountCents: 9_900,
      reason: 'Cobrança indevida',
      status: 'requested',
      providerRefundId: null,
      error: null,
      requestedBy: { id: admin.id, name: 'Pessoa de Teste' },
      doneAt: null,
    });
    expect(refund.createdAt).toMatch(/Z$/);

    const audit = await auditOf(test, subscription.subscriptionId, 'refund.request');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: admin.id, targetType: 'subscription' });
    expect(audit[0]?.details).toMatchObject({
      refundId: refund.id,
      paymentId: subscription.paymentId,
    });

    const done = await executeRefund(test.db, provider, refund.id);
    expect(done.status).toBe('done');

    const one = await detail(subscription.subscriptionId);
    expect(one.status).toBe('ended');
    expect(one.endedAt).not.toBeNull();
    expect(one.payments[0]).toMatchObject({ refundedCents: 9_900, status: 'refunded' });
    expect(one.payments[0].refunds[0]).toMatchObject({ id: refund.id, status: 'done' });
  });

  it('reembolso parcial devolve o valor e a assinatura segue ativa', async () => {
    const { subscription } = await planWithSubscription();
    const response = await requestRefund(subscription.subscriptionId, subscription.paymentId, {
      reason: 'Parte do período',
      amountCents: 1_000,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ amountCents: 1_000, status: 'requested' });

    const done = await executeRefund(test.db, provider, response.json().id);
    expect(done.status).toBe('done');

    const one = await detail(subscription.subscriptionId);
    expect(one.status).toBe('active');
    expect(one.payments[0]).toMatchObject({ refundedCents: 1_000, status: 'partially_refunded' });
  });

  it('acima do saldo: 422; cobrança de outra assinatura: 404; já reembolsada: 409', async () => {
    const first = await planWithSubscription();
    const second = await planWithSubscription();

    const above = await requestRefund(
      first.subscription.subscriptionId,
      first.subscription.paymentId,
      {
        reason: 'Demais',
        amountCents: 9_901,
      },
    );
    expect(above.statusCode).toBe(422);
    expect(above.json()).toMatchObject({ code: 'refund_exceeds_paid' });

    const foreign = await requestRefund(
      second.subscription.subscriptionId,
      first.subscription.paymentId,
    );
    expect(foreign.statusCode).toBe(404);

    const ghost = await requestRefund(first.subscription.subscriptionId, randomUUID());
    expect(ghost.statusCode).toBe(404);

    const full = await requestRefund(
      first.subscription.subscriptionId,
      first.subscription.paymentId,
    );
    expect(full.statusCode).toBe(202);
    await executeRefund(test.db, provider, full.json().id);

    const again = await requestRefund(
      first.subscription.subscriptionId,
      first.subscription.paymentId,
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'payment_not_refundable' });
  });

  it('chave repetida em paralelo devolve o mesmo reembolso, com uma tarefa e uma auditoria', async () => {
    const { subscription } = await planWithSubscription();
    const headers = { 'Idempotency-Key': randomUUID() };
    const submit = (amountCents: number) =>
      requestRefund(
        subscription.subscriptionId,
        subscription.paymentId,
        { reason: 'Cobrança indevida', amountCents },
        headers,
      );

    const [first, concurrent] = await Promise.all([submit(1_000), submit(1_000)]);
    expect(first.statusCode).toBe(202);
    expect(concurrent.statusCode).toBe(202);
    expect(concurrent.json()).toEqual(first.json());

    const replay = await submit(1_000);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(first.json());

    const changed = await submit(2_000);
    expect(changed.statusCode).toBe(422);
    expect(changed.json()).toMatchObject({ code: 'idempotency_key_reuse' });

    const { id } = first.json<RefundView>();
    const refunds = await test.db
      .selectFrom('refunds')
      .select('id')
      .where('paymentId', '=', subscription.paymentId)
      .execute();
    expect(refunds).toEqual([{ id }]);
    const jobs = await test.db
      .selectFrom('jobs')
      .select('id')
      .where('type', '=', 'refund.execute')
      .where('uniqueKey', '=', refundExecuteKey(id))
      .execute();
    expect(jobs).toHaveLength(1);
    expect(await auditOf(test, subscription.subscriptionId, 'refund.request')).toHaveLength(1);
  });

  it('gerente e instrutor recebem 403 (order.refund); sem CSRF: 403', async () => {
    const { subscription } = await planWithSubscription();
    for (const actor of [manager, instructor]) {
      const response = await call({
        method: 'POST',
        url: `/api/v1/subscriptions/${subscription.subscriptionId}/payments/${subscription.paymentId}/refund`,
        as: actor,
        payload: { reason: 'Sem permissão' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'permission_denied' });
    }
    expect((await deniedBy(test, manager.id)).length).toBeGreaterThan(0);

    const noCsrf = await call({
      method: 'POST',
      url: `/api/v1/subscriptions/${subscription.subscriptionId}/payments/${subscription.paymentId}/refund`,
      as: admin,
      payload: { reason: 'Sem CSRF' },
      csrf: null,
    });
    expect(noCsrf.statusCode).toBe(403);
  });
});
