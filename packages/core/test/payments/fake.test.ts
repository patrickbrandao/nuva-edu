import { describe, expect, it } from 'vitest';
import {
  type CreateCheckoutInput,
  FakePaymentProvider,
  invalidWebhookSignature,
  isDomainError,
  orderExternalReference,
  PAYMENT_ERROR_CODES,
  PAYMENT_STATUSES,
  PAYMENT_WEBHOOK_MAX_AGE_MS,
  type PaymentProvider,
  parsePaymentExternalReference,
  SUBSCRIPTION_STATUSES,
  subscriptionExternalReference,
} from '../../src/index.ts';

const orderId = '2a4feec4-9f5c-4b30-94ad-91a9f26e5011';
const subscriptionId = 'c13a5d12-0c65-41ec-a53e-bb9cbdbb5012';

function checkoutInput(
  reference: CreateCheckoutInput['externalReference'] = orderExternalReference(orderId),
): CreateCheckoutInput {
  return {
    items: [
      { id: 'curso', title: 'Curso', quantity: 1, unitAmountCents: 7_000 },
      { id: 'ebook', title: 'Ebook', quantity: 2, unitAmountCents: 1_500 },
    ],
    totalCents: 10_000,
    currency: 'BRL',
    buyer: { name: 'Aluna Teste', email: 'aluna@example.com', taxId: '12345678909' },
    returnUrls: {
      success: 'https://classroom.example/pedidos/sucesso',
      pending: 'https://classroom.example/pedidos/pendente',
      failure: 'https://classroom.example/pedidos/falha',
    },
    externalReference: reference as `order:${string}`,
  };
}

async function rejects(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    return error;
  }
  throw new Error(`A operação deveria falhar com ${code}.`);
}

describe('contrato e referências do PaymentProvider', () => {
  it('declara todos os estados normalizados e uma única referência sem dados pessoais', () => {
    expect(PAYMENT_STATUSES).toEqual([
      'pending',
      'approved',
      'rejected',
      'canceled',
      'refunded',
      'partially_refunded',
      'charged_back',
    ]);
    expect(SUBSCRIPTION_STATUSES).toEqual(['pending', 'authorized', 'paused', 'canceled']);
    expect(parsePaymentExternalReference(orderExternalReference(orderId))).toEqual({
      kind: 'order',
      id: orderId,
      reference: `order:${orderId}`,
    });
    expect(parsePaymentExternalReference(subscriptionExternalReference(subscriptionId)).kind).toBe(
      'subscription',
    );
    expect(orderExternalReference(orderId)).not.toContain('aluna@example.com');
    expect(orderExternalReference(orderId.toUpperCase())).toBe(orderExternalReference(orderId));
    expect(() => orderExternalReference('aluna@example.com')).toThrow(/UUID/);
    expect(() => parsePaymentExternalReference('order:qualquer-coisa')).toThrow(
      /Referência externa/,
    );
  });

  it('o fake é determinístico e tem relógio e memória isolados por instância', async () => {
    const first = new FakePaymentProvider({ now: '2026-02-03T12:00:00Z' });
    const second = new FakePaymentProvider({ now: first.now });
    expect(first.now.toISOString()).toBe('2026-02-03T12:00:00.000Z');
    const a = await first.createCheckout(checkoutInput());
    const b = await second.createCheckout(checkoutInput());
    expect(a).toEqual(b);
    expect(a.providerCheckoutId).toBe('fake_checkout_000001');
    expect(first.advance(60_000).toISOString()).toBe('2026-02-03T12:01:00.000Z');
    expect(second.now.toISOString()).toBe('2026-02-03T12:00:00.000Z');
    await rejects(second.getPayment('fake_payment_000002'), 'not_found');
  });
});

describe('checkout, consulta e estados de pagamento', () => {
  it('cria checkout e pagamento pendente, aprova e encontra pela referência externa', async () => {
    const provider: PaymentProvider = new FakePaymentProvider();
    const checkout = await provider.createCheckout(checkoutInput());
    expect(checkout.checkoutUrl).toContain(checkout.providerCheckoutId);
    const [pending] = await provider.findPaymentsByReference(`order:${orderId}`);
    expect(pending).toMatchObject({
      providerPaymentId: 'fake_payment_000001',
      status: 'pending',
      amountCents: 10_000,
      refundedCents: 0,
      currency: 'BRL',
      method: 'other',
      externalReference: `order:${orderId}`,
    });
    if (pending === undefined) throw new Error('pagamento ausente');
    expect(await provider.getPayment(pending.providerPaymentId)).toEqual(pending);
    const fake = provider as FakePaymentProvider;
    const approved = fake.approvePayment(pending.providerPaymentId, { method: 'pix' });
    expect(approved).toMatchObject({ status: 'approved', paidAt: fake.now, method: 'pix' });
    expect(await provider.findPaymentsByReference(`order:${orderId}`)).toHaveLength(1);
    await rejects(
      provider.cancelCheckout(checkout.providerCheckoutId),
      PAYMENT_ERROR_CODES.invalidTransition,
    );
  });

  it('controla recusa e cancelamento idempotente, sem reabrir pagamento decidido', async () => {
    const fake = new FakePaymentProvider();
    const first = await fake.createCheckout(checkoutInput());
    const second = await fake.createCheckout(checkoutInput());
    expect(fake.rejectCheckout(second.providerCheckoutId).status).toBe('rejected');
    expect(await fake.cancelCheckout(first.providerCheckoutId)).toEqual({ confirmed: true });
    expect(await fake.cancelCheckout(first.providerCheckoutId)).toEqual({ confirmed: true });
    expect(
      (await fake.findPaymentsByReference(`order:${orderId}`)).map((payment) => payment.status),
    ).toEqual(['canceled', 'rejected']);
    expect(() => fake.approveCheckout(first.providerCheckoutId)).toThrow(/cancelado/);
    expect(() => fake.rejectCheckout(second.providerCheckoutId)).toThrow(/decisão/);
  });

  it('simula divergência de valor e devolve cópias que não alteram a memória', async () => {
    const fake = new FakePaymentProvider();
    await fake.createCheckout(checkoutInput());
    const approved = fake.approvePayment('fake_payment_000001', { amountCents: 9_999 });
    approved.amountCents = 1;
    approved.externalReference = subscriptionExternalReference(subscriptionId);
    expect(await fake.getPayment('fake_payment_000001')).toMatchObject({
      amountCents: 9_999,
      externalReference: `order:${orderId}`,
    });
  });

  it('faz reembolso parcial e total e controla chargeback', async () => {
    const fake = new FakePaymentProvider();
    await fake.createCheckout(checkoutInput());
    fake.approvePayment('fake_payment_000001');
    expect(await fake.refund('fake_payment_000001', 2_500)).toEqual({
      providerRefundId: 'fake_refund_000001',
      status: 'approved',
      amountCents: 2_500,
    });
    expect((await fake.getPayment('fake_payment_000001')).status).toBe('partially_refunded');
    expect(await fake.refund('fake_payment_000001', null)).toMatchObject({ amountCents: 7_500 });
    expect(await fake.getPayment('fake_payment_000001')).toMatchObject({
      status: 'refunded',
      refundedCents: 10_000,
    });
    await rejects(fake.refund('fake_payment_000001', null), PAYMENT_ERROR_CODES.invalidTransition);

    await fake.createCheckout(checkoutInput());
    fake.approvePayment('fake_payment_000002');
    expect(fake.chargebackPayment('fake_payment_000002')).toMatchObject({
      status: 'charged_back',
      rawStatus: 'charged_back',
    });
    await rejects(fake.refund('fake_payment_000002', 100), PAYMENT_ERROR_CODES.invalidTransition);
  });

  it('mantém reembolso pendente fora do saldo até a reconciliação concluir ou recusar', async () => {
    const fake = new FakePaymentProvider();
    await fake.createCheckout(checkoutInput());
    fake.approvePayment('fake_payment_000001');
    fake.setRefundOutcome('pending');
    const requested = await fake.refund('fake_payment_000001', 2_500);
    expect(requested).toMatchObject({ status: 'pending', amountCents: 2_500 });
    expect(await fake.getPayment('fake_payment_000001')).toMatchObject({
      status: 'approved',
      refundedCents: 0,
    });
    expect(fake.getRefund(requested.providerRefundId)).toMatchObject({ status: 'pending' });
    expect(fake.listRefunds('fake_payment_000001')).toHaveLength(1);
    // O pendente reserva saldo: não deixa reembolsar além do restante.
    await rejects(fake.refund('fake_payment_000001', 8_000), PAYMENT_ERROR_CODES.invalidRequest);
    const rejected = await fake.refund('fake_payment_000001', 1_000);
    expect(fake.rejectRefund(rejected.providerRefundId)).toMatchObject({ status: 'rejected' });
    expect(fake.approveRefund(requested.providerRefundId)).toMatchObject({
      status: 'approved',
      amountCents: 2_500,
    });
    expect(await fake.getPayment('fake_payment_000001')).toMatchObject({
      status: 'partially_refunded',
      refundedCents: 2_500,
    });
    // Concluir de novo não duplica o estorno.
    expect(fake.approveRefund(requested.providerRefundId)).toMatchObject({ status: 'approved' });
    expect((await fake.getPayment('fake_payment_000001')).refundedCents).toBe(2_500);
    expect(() => fake.getRefund('inexistente')).toThrow(/Reembolso/);
  });

  it('recusa valores inconsistentes e referência de assinatura no checkout avulso', async () => {
    const fake = new FakePaymentProvider();
    await rejects(
      fake.createCheckout({
        ...checkoutInput(),
        externalReference: subscriptionExternalReference(
          subscriptionId,
        ) as CreateCheckoutInput['externalReference'],
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      fake.createCheckout({ ...checkoutInput(), totalCents: 1 }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      fake.createCheckout({ ...checkoutInput(), items: [] }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      fake.createCheckout({ ...checkoutInput(), currency: 'USD' }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(fake.getPayment('inexistente'), 'not_found');
  });
});

describe('planos, assinaturas e renovação', () => {
  async function subscription(fake: FakePaymentProvider, discount = 1_000) {
    const plan = {
      title: 'Plano completo',
      amountCents: 5_000,
      currency: 'BRL',
      periodicity: { value: 1, unit: 'months' as const },
    };
    const expected = await fake.ensurePlan(plan);
    expect(await fake.ensurePlan({ ...plan, periodicity: { ...plan.periodicity } })).toEqual(
      expected,
    );
    const created = await fake.createSubscription({
      providerPlanId: expected.providerPlanId,
      buyer: { name: 'Aluna', email: 'aluna@example.com' },
      firstChargeDiscountCents: discount,
      returnUrls: checkoutInput().returnUrls,
      externalReference: subscriptionExternalReference(subscriptionId),
    });
    return { plan, expected, created };
  }

  it('reaproveita plano, autoriza a assinatura e aplica desconto só na primeira cobrança', async () => {
    const fake = new FakePaymentProvider({ now: '2026-01-31T00:00:00Z' });
    const { expected, created } = await subscription(fake);
    expect(expected.providerPlanId).toBe('fake_plan_000001');
    expect(created.checkoutUrl).toContain(created.providerSubscriptionId);
    expect(await fake.getSubscription(created.providerSubscriptionId)).toMatchObject({
      status: 'pending',
      nextBillingAt: null,
    });
    expect(fake.authorizeSubscription(created.providerSubscriptionId)).toMatchObject({
      amountCents: 4_000,
      status: 'approved',
      externalReference: `subscription:${subscriptionId}`,
    });
    const authorized = await fake.getSubscription(created.providerSubscriptionId);
    expect(authorized).toMatchObject({
      status: 'authorized',
      providerPlanId: expected.providerPlanId,
    });
    // Date#setUTCMonth trata o fim de janeiro sem usar relógio global.
    expect(authorized.currentPeriodEnd?.getTime()).toBeGreaterThan(
      authorized.currentPeriodStart?.getTime() ?? 0,
    );
    expect(fake.renewSubscription(created.providerSubscriptionId)).toMatchObject({
      amountCents: 5_000,
      status: 'approved',
    });
    expect(fake.pauseSubscription(created.providerSubscriptionId).status).toBe('paused');
    expect(
      fake.renewSubscription(created.providerSubscriptionId, { outcome: 'rejected' }),
    ).toMatchObject({ status: 'rejected', amountCents: 5_000 });
    expect((await fake.getSubscription(created.providerSubscriptionId)).status).toBe('paused');
    expect(await fake.cancelSubscription(created.providerSubscriptionId)).toEqual({
      confirmed: true,
    });
    expect(await fake.cancelSubscription(created.providerSubscriptionId)).toEqual({
      confirmed: true,
    });
    expect((await fake.getSubscription(created.providerSubscriptionId)).status).toBe('canceled');
    expect(await fake.findPaymentsByReference(`subscription:${subscriptionId}`)).toHaveLength(3);
  });

  it('valida plano e desconto, e cobre falha pendente na renovação', async () => {
    const fake = new FakePaymentProvider();
    await rejects(
      fake.createSubscription({
        providerPlanId: 'ausente',
        buyer: { name: 'A', email: 'a@b.c' },
        returnUrls: checkoutInput().returnUrls,
        externalReference: `subscription:${subscriptionId}`,
      }),
      'not_found',
    );
    const { created } = await subscription(fake, 0);
    fake.authorizeSubscription(created.providerSubscriptionId);
    expect(() => fake.authorizeSubscription(created.providerSubscriptionId)).toThrow(/pendente/);
    expect(
      fake.renewSubscription(created.providerSubscriptionId, { outcome: 'pending' }).status,
    ).toBe('pending');
    // Renovação pendente não pausa a assinatura: só a recusa faz isso.
    expect((await fake.getSubscription(created.providerSubscriptionId)).status).toBe('authorized');
    expect(() => fake.chargebackPayment('fake_payment_000002')).toThrow(/aprovado/);
  });

  it('calcula períodos em dias e anos no fuso UTC', async () => {
    const fake = new FakePaymentProvider({ now: '2026-03-10T00:00:00Z' });
    for (const [unit, expected] of [
      ['days', '2026-03-13T00:00:00.000Z'],
      ['years', '2029-03-10T00:00:00.000Z'],
    ] as const) {
      const plan = await fake.ensurePlan({
        title: `Plano ${unit}`,
        amountCents: 100,
        currency: 'BRL',
        periodicity: { value: 3, unit },
      });
      const created = await fake.createSubscription({
        providerPlanId: plan.providerPlanId,
        buyer: { name: 'A', email: 'a@b.c' },
        returnUrls: checkoutInput().returnUrls,
        externalReference: subscriptionExternalReference(subscriptionId),
      });
      fake.authorizeSubscription(created.providerSubscriptionId);
      const subscription = await fake.getSubscription(created.providerSubscriptionId);
      expect(subscription.currentPeriodEnd?.toISOString()).toBe(expected);
    }
  });

  it('recusa plano inválido e assinatura com referência ou URLs fora do formato', async () => {
    const fake = new FakePaymentProvider();
    await rejects(
      fake.ensurePlan({
        title: '',
        amountCents: 0,
        currency: 'BRL',
        periodicity: { value: 1, unit: 'months' },
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      fake.ensurePlan({
        title: 'Mensal',
        amountCents: 100,
        currency: 'USD',
        periodicity: { value: 1, unit: 'months' },
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    const plan = await fake.ensurePlan({
      title: 'Mensal',
      amountCents: 100,
      currency: 'BRL',
      periodicity: { value: 1, unit: 'months' },
    });
    const base = {
      providerPlanId: plan.providerPlanId,
      buyer: { name: 'A', email: 'a@b.c' },
      returnUrls: checkoutInput().returnUrls,
    };
    await rejects(
      fake.createSubscription({
        ...base,
        externalReference: orderExternalReference(orderId) as never,
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      fake.createSubscription({
        ...base,
        externalReference: `subscription:${subscriptionId}`,
        returnUrls: { ...base.returnUrls, success: 'não é url' },
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      fake.createSubscription({
        ...base,
        externalReference: `subscription:${subscriptionId}`,
        firstChargeDiscountCents: 101,
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
  });
});

describe('webhooks e indisponibilidade', () => {
  it('normaliza só os identificadores de um aviso assinado e aceita Headers ou objeto', async () => {
    const fake = new FakePaymentProvider();
    await fake.createCheckout(checkoutInput());
    const webhook = fake.paymentWebhook('fake_payment_000001', { eventId: 'evento-1' });
    const expected = {
      provider: 'fake',
      eventId: 'evento-1',
      resourceType: 'payment',
      resourceId: 'fake_payment_000001',
    };
    expect(await fake.parseWebhook(webhook)).toEqual(expected);
    expect(
      await fake.parseWebhook({
        ...webhook,
        headers: new Headers(webhook.headers as Record<string, string>),
      }),
    ).toEqual(expected);
    expect(webhook.rawBody).not.toContain('aluna@example.com');
  });

  it('aceita cabeçalho em lista com um valor e recusa lista ambígua', async () => {
    const fake = new FakePaymentProvider();
    await fake.createCheckout(checkoutInput());
    const webhook = fake.paymentWebhook('fake_payment_000001');
    const headers = webhook.headers as Record<string, string>;
    expect(
      await fake.parseWebhook({
        ...webhook,
        headers: {
          'x-request-id': [headers['x-request-id'] ?? ''],
          'x-signature': headers['x-signature'] ?? '',
        },
      }),
    ).toMatchObject({ resourceId: 'fake_payment_000001' });
    await rejects(
      fake.parseWebhook({
        ...webhook,
        headers: {
          'x-request-id': ['a', 'b'],
          'x-signature': headers['x-signature'] ?? '',
        },
      }),
      PAYMENT_ERROR_CODES.invalidSignature,
    );
  });

  it('recusa assinatura inválida, ausente, antiga e futura sem vazar segredo ou corpo', async () => {
    const fake = new FakePaymentProvider();
    await fake.createCheckout(checkoutInput());
    const webhook = fake.paymentWebhook('fake_payment_000001');
    for (const input of [
      { ...webhook, headers: {} },
      fake.paymentWebhook('fake_payment_000001', { secret: 'segredo-errado-super-secreto' }),
      fake.paymentWebhook('fake_payment_000001', {
        timestamp: fake.now.getTime() - PAYMENT_WEBHOOK_MAX_AGE_MS - 1,
      }),
      fake.paymentWebhook('fake_payment_000001', {
        timestamp: fake.now.getTime() + PAYMENT_WEBHOOK_MAX_AGE_MS + 1,
      }),
    ]) {
      const error = await rejects(fake.parseWebhook(input), PAYMENT_ERROR_CODES.invalidSignature);
      expect(error).toMatchObject({ status: 401 });
      expect(JSON.stringify(error)).not.toContain('segredo-errado-super-secreto');
    }
    expect(invalidWebhookSignature()).toBeInstanceOf(Error);
    await rejects(
      fake.parseWebhook({ ...webhook, rawBody: '{' }),
      PAYMENT_ERROR_CODES.invalidWebhook,
    );
    await rejects(
      fake.parseWebhook({
        ...webhook,
        rawBody: JSON.stringify({ id: 'x', type: 'unknown', data: { id: 'x' } }),
      }),
      PAYMENT_ERROR_CODES.invalidWebhook,
    );
    await rejects(
      fake.parseWebhook({ ...webhook, rawBody: 'x'.repeat(64 * 1024 + 1) }),
      PAYMENT_ERROR_CODES.invalidWebhook,
    );
  });

  it('aceita Uint8Array e webhook de assinatura e isola indisponibilidade por operação', async () => {
    const fake = new FakePaymentProvider();
    const plan = await fake.ensurePlan({
      title: 'Mensal',
      amountCents: 100,
      currency: 'BRL',
      periodicity: { value: 1, unit: 'months' },
    });
    const subscription = await fake.createSubscription({
      providerPlanId: plan.providerPlanId,
      buyer: { name: 'A', email: 'a@b.c' },
      returnUrls: checkoutInput().returnUrls,
      externalReference: `subscription:${subscriptionId}`,
    });
    const webhook = fake.subscriptionWebhook(subscription.providerSubscriptionId);
    expect(
      (await fake.parseWebhook({ ...webhook, rawBody: Buffer.from(webhook.rawBody as string) }))
        .resourceType,
    ).toBe('subscription');
    fake.setUnavailable(true, ['createCheckout']);
    const error = await rejects(
      fake.createCheckout(checkoutInput()),
      PAYMENT_ERROR_CODES.unavailable,
    );
    expect(error).toMatchObject({
      status: 503,
      detail: 'pagamento indisponível, tente em instantes',
    });
    expect(await fake.getSubscription(subscription.providerSubscriptionId)).toMatchObject({
      status: 'pending',
    });
    fake.setUnavailable(false);
    expect((await fake.createCheckout(checkoutInput())).providerCheckoutId).toBe(
      'fake_checkout_000001',
    );
    fake.setUnavailable(true);
    await rejects(fake.getPayment('nenhum'), PAYMENT_ERROR_CODES.unavailable);
  });
});
