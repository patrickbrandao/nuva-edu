import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDomainError,
  orderExternalReference,
  PAYMENT_ERROR_CODES,
  subscriptionExternalReference,
} from '../../../src/index.ts';
import {
  MERCADO_PAGO_RETRY_DELAYS_MS,
  MERCADO_PAGO_TIMEOUT_MS,
  MercadoPagoPaymentProvider,
  type MercadoPagoPaymentProviderOptions,
} from '../../../src/modules/payments/mercadopago/index.ts';
import {
  ACCESS_TOKEN,
  callBody,
  checkoutInput,
  installFetch,
  jsonResponse,
  NOTIFICATION_URL,
  NOW_MS,
  ORDER_ID,
  paymentFixture,
  planFixture,
  preferenceFixture,
  SUBSCRIPTION_ID,
  subscriptionFixture,
  WEBHOOK_SECRET,
} from './helpers.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function createProvider(overrides: Partial<MercadoPagoPaymentProviderOptions> = {}) {
  return new MercadoPagoPaymentProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    notificationUrl: NOTIFICATION_URL,
    now: () => NOW_MS,
    sleep: async () => {},
    ...overrides,
  });
}

async function rejects(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    return error as { code: string; message: string; detail?: string; cause?: unknown };
  }
  throw new Error(`A operação deveria falhar com ${code}.`);
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`A chamada ${index} não aconteceu.`);
  }
  return value;
}

function subscriptionInput() {
  return {
    providerPlanId: 'plan-1',
    buyer: { name: 'Aluna Teste', email: 'aluna@example.com' },
    returnUrls: checkoutInput().returnUrls,
    externalReference: `subscription:${SUBSCRIPTION_ID}` as const,
  };
}

describe('checkout no Mercado Pago', () => {
  it('cria a preferência com itens, pagador e referência sem dados de cartão', async () => {
    const { calls } = installFetch(() =>
      jsonResponse(
        preferenceFixture({ init_point: 'https://mercadopago.example/checkout/pref-1' }),
      ),
    );
    const provider = createProvider();
    expect(await provider.createCheckout(checkoutInput())).toEqual({
      checkoutUrl: 'https://mercadopago.example/checkout/pref-1',
      providerCheckoutId: 'pref-1',
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error('chamada ausente');
    expect(call).toMatchObject({ path: '/checkout/preferences/', method: 'POST' });
    expect(call.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(call.headers['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    const body = callBody(call);
    expect(body.items).toEqual([
      {
        id: 'curso',
        title: 'Curso',
        quantity: 1,
        unit_price: 70,
        currency_id: 'BRL',
      },
      {
        id: 'ebook',
        title: 'Ebook',
        quantity: 2,
        unit_price: 15,
        currency_id: 'BRL',
      },
    ]);
    expect(body.payer).toEqual({
      name: 'Aluna Teste',
      email: 'aluna@example.com',
      identification: { type: 'CPF', number: '12345678909' },
    });
    expect(body.external_reference).toBe(`order:${ORDER_ID}`);
    expect(body.notification_url).toBe(NOTIFICATION_URL);
    expect(body.back_urls).toEqual(checkoutInput().returnUrls);
    expect(body.auto_return).toBe('approved');
    expect(JSON.stringify(body)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(body)).not.toMatch(/card|token/i);
  });

  it('usa CNPJ e aceita comprador sem documento fiscal', async () => {
    const { calls } = installFetch(() => jsonResponse(preferenceFixture()));
    const provider = createProvider();
    await provider.createCheckout({
      ...checkoutInput(),
      buyer: { name: 'Escola', email: 'escola@example.com', taxId: '12.345.678/0001-90' },
    });
    expect(callBody(at(calls, 0)).payer).toMatchObject({
      identification: { type: 'CNPJ', number: '12345678000190' },
    });

    await provider.createCheckout({
      ...checkoutInput(),
      buyer: { name: 'Aluna', email: 'aluna@example.com', taxId: null },
    });
    expect(callBody(at(calls, 1)).payer).toEqual({
      name: 'Aluna',
      email: 'aluna@example.com',
    });
  });

  it('recusa entrada inválida antes de chamar o provedor', async () => {
    const { fetchMock } = installFetch(() => jsonResponse(preferenceFixture()));
    const provider = createProvider();
    await rejects(
      provider.createCheckout({ ...checkoutInput(), totalCents: 9_999 }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      provider.createCheckout({ ...checkoutInput(), items: [] }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      provider.createCheckout({
        ...checkoutInput(),
        externalReference: subscriptionExternalReference(SUBSCRIPTION_ID) as ReturnType<
          typeof orderExternalReference
        >,
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      provider.createCheckout({
        ...checkoutInput(),
        buyer: { name: 'Aluna', email: 'aluna@example.com', taxId: '123' },
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      provider.createCheckout({
        ...checkoutInput(),
        returnUrls: { ...checkoutInput().returnUrls, success: 'javascript:alert(1)' },
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      provider.createCheckout({ ...checkoutInput(), currency: 'real' }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('repete erro 5xx com 1 s, 4 s e 16 s sem vazar token, segredo ou corpo', async () => {
    const sleep = vi.fn(async (_milliseconds: number) => {});
    const { calls } = installFetch(() =>
      jsonResponse(
        { message: `corpo-interno ${ACCESS_TOKEN} ${WEBHOOK_SECRET}`, error: 'internal' },
        500,
      ),
    );
    const error = await rejects(
      createProvider({ sleep }).createCheckout(checkoutInput()),
      PAYMENT_ERROR_CODES.unavailable,
    );
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      MERCADO_PAGO_RETRY_DELAYS_MS[0],
      MERCADO_PAGO_RETRY_DELAYS_MS[1],
      MERCADO_PAGO_RETRY_DELAYS_MS[2],
    ]);
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((call) => call.headers['x-idempotency-key'])).size).toBe(1);
    const dump = `${error.message}\n${error.detail ?? ''}\n${JSON.stringify(error.cause)}\n${JSON.stringify(error)}`;
    expect(dump).not.toContain(ACCESS_TOKEN);
    expect(dump).not.toContain(WEBHOOK_SECRET);
    expect(dump).not.toContain('corpo-interno');
  });

  it('traduz credenciais inválidas em indisponibilidade sem repetir', async () => {
    const sleep = vi.fn(async (_milliseconds: number) => {});
    const { calls } = installFetch(() => jsonResponse({ message: `token ${ACCESS_TOKEN}` }, 401));
    const error = await rejects(
      createProvider({ sleep }).createCheckout(checkoutInput()),
      PAYMENT_ERROR_CODES.unavailable,
    );
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(`${error.message}${error.detail ?? ''}`).not.toContain(ACCESS_TOKEN);
  });

  it('traduz recusa 4xx em requisição inválida sem repetir', async () => {
    const sleep = vi.fn(async (_milliseconds: number) => {});
    installFetch(() => jsonResponse({ message: 'invalid' }, 400));
    await rejects(
      createProvider({ sleep }).createCheckout(checkoutInput()),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it('expira o checkout preservando os itens e a mesma chave entre tentativas', async () => {
    let attempts = 0;
    const sleep = vi.fn(async (_milliseconds: number) => {});
    const { calls } = installFetch((call) => {
      if (call.method === 'GET') {
        return jsonResponse(preferenceFixture({ expires: false }));
      }
      attempts += 1;
      return attempts < 3
        ? jsonResponse({ message: 'internal' }, 500)
        : jsonResponse(preferenceFixture({ expires: true }));
    });
    expect(await createProvider({ sleep }).cancelCheckout('pref-1')).toEqual({ confirmed: true });
    const puts = calls.filter((call) => call.method === 'PUT');
    expect(puts).toHaveLength(3);
    expect(new Set(puts.map((call) => call.headers['x-idempotency-key'])).size).toBe(1);
    const body = callBody(at(puts, 0));
    expect(body.expires).toBe(true);
    expect(body.items).toEqual(preferenceFixture().items);
    expect(new Date(String(body.expiration_date_to)).getTime()).toBeLessThan(NOW_MS);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('confirma o cancelamento do checkout já expirado sem atualizar', async () => {
    const { calls } = installFetch(() =>
      jsonResponse(
        preferenceFixture({
          expires: true,
          expiration_date_to: new Date(NOW_MS - 60_000).toISOString(),
        }),
      ),
    );
    expect(await createProvider().cancelCheckout('pref-1')).toEqual({ confirmed: true });
    expect(calls).toHaveLength(1);
  });

  it('interrompe a chamada após 10 s e tenta de novo', async () => {
    vi.useFakeTimers();
    const { calls } = installFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const provider = createProvider();
    const assertion = expect(provider.getPayment('pay-1')).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.unavailable,
    });
    await vi.advanceTimersByTimeAsync(MERCADO_PAGO_TIMEOUT_MS * 5);
    await assertion;
    expect(calls).toHaveLength(4);
  });
});

describe('consulta de pagamentos', () => {
  it('traduz o estado, o valor, o método e a data de aprovação', async () => {
    installFetch(() =>
      jsonResponse(
        paymentFixture({
          status: 'approved',
          transaction_amount: 123.45,
          transaction_amount_refunded: 23.45,
          payment_type_id: 'pix',
          payment_method_id: 'pix',
          external_reference: `order:${ORDER_ID}`,
          card: { last_four_digits: '1234' },
          payer: { email: 'aluna@example.com' },
        }),
      ),
    );
    expect(await createProvider().getPayment('pay-1')).toEqual({
      providerPaymentId: 'pay-1',
      status: 'partially_refunded',
      amountCents: 12_345,
      refundedCents: 2_345,
      currency: 'BRL',
      method: 'pix',
      externalReference: `order:${ORDER_ID}`,
      rawStatus: 'approved',
      paidAt: new Date('2026-03-01T12:00:00.000Z'),
    });
  });

  it.each([
    ['pending', 0, 'pending'],
    ['in_process', 0, 'pending'],
    ['approved', 0, 'approved'],
    ['approved', 10_000, 'refunded'],
    ['refunded', 10_000, 'refunded'],
    ['rejected', 0, 'rejected'],
    ['cancelled', 0, 'canceled'],
    ['charged_back', 0, 'charged_back'],
  ] as const)('normaliza %s com %i centavos reembolsados', async (status, refunded, expected) => {
    installFetch(() =>
      jsonResponse(
        paymentFixture({
          status,
          transaction_amount_refunded: refunded / 100,
        }),
      ),
    );
    expect(await createProvider().getPayment('pay-1')).toMatchObject({
      status: expected,
      rawStatus: status,
    });
  });

  it('busca pela referência externa com paginação e ordem', async () => {
    const { calls } = installFetch(() =>
      jsonResponse({
        paging: { total: 2, limit: 50, offset: 0 },
        results: [
          paymentFixture({ id: 'pay-2', status: 'pending' }),
          paymentFixture({ id: 'pay-1', status: 'approved' }),
        ],
      }),
    );
    const payments = await createProvider().findPaymentsByReference(
      orderExternalReference(ORDER_ID),
    );
    expect(payments.map((payment) => [payment.providerPaymentId, payment.status])).toEqual([
      ['pay-2', 'pending'],
      ['pay-1', 'approved'],
    ]);
    const url = new URL(at(calls, 0).url);
    expect(url.pathname).toBe('/v1/payments/search');
    expect(url.searchParams.get('external_reference')).toBe(`order:${ORDER_ID}`);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('sort')).toBe('date_created');
    expect(url.searchParams.get('criteria')).toBe('desc');
  });

  it('devolve lista vazia quando a busca não encontra pagamentos', async () => {
    installFetch(() => jsonResponse({ results: null }));
    expect(
      await createProvider().findPaymentsByReference(orderExternalReference(ORDER_ID)),
    ).toEqual([]);
  });

  it('traduz 404 em não encontrado', async () => {
    installFetch(() => jsonResponse({ message: 'not found' }, 404));
    await rejects(createProvider().getPayment('pay-1'), 'not_found');
  });

  it('encontra a cobrança recorrente pelo id da fatura autorizada', async () => {
    const { calls } = installFetch((call) => {
      if (call.path === '/v1/payments/999') {
        return jsonResponse({ message: 'not found' }, 404);
      }
      if (call.path === '/authorized_payments/999') {
        return jsonResponse({ id: '999', payment: { id: '777' } });
      }
      return jsonResponse(
        paymentFixture({
          id: '777',
          external_reference: `subscription:${SUBSCRIPTION_ID}`,
        }),
      );
    });
    const payment = await createProvider().getPayment('999');
    expect(payment).toMatchObject({
      providerPaymentId: '777',
      externalReference: `subscription:${SUBSCRIPTION_ID}`,
      status: 'approved',
    });
    expect(calls.map((call) => call.path)).toEqual([
      '/v1/payments/999',
      '/authorized_payments/999',
      '/v1/payments/777',
    ]);
  });

  it('não aceita fatura autorizada sem pagamento associado', async () => {
    installFetch((call) =>
      call.path.startsWith('/v1/payments/')
        ? jsonResponse({ message: 'not found' }, 404)
        : jsonResponse({ id: '999' }),
    );
    await rejects(createProvider().getPayment('999'), 'not_found');
  });
});

describe('planos e assinaturas', () => {
  const planInput = {
    title: 'Plano completo',
    amountCents: 5_000,
    currency: 'BRL',
    periodicity: { value: 1, unit: 'months' as const },
  };

  it('reaproveita o plano existente com o mesmo título, valor e periodicidade', async () => {
    const { calls } = installFetch(() =>
      jsonResponse({ paging: { total: 2, limit: 50, offset: 0 }, results: [planFixture()] }),
    );
    expect(await createProvider().ensurePlan(planInput)).toEqual({ providerPlanId: 'plan-1' });
    expect(calls).toHaveLength(1);
    expect(at(calls, 0).method).toBe('GET');
    expect(at(calls, 0).path).toBe('/preapproval_plan/search');
    expect(new URL(at(calls, 0).url).searchParams.get('q')).toBe('Plano completo');
  });

  it('cria o plano quando nenhum corresponde, convertendo anos em meses', async () => {
    const { calls } = installFetch((call) => {
      if (call.method === 'GET') {
        return jsonResponse({ results: [planFixture({ id: 'plan-antigo', reason: 'Outro' })] });
      }
      return jsonResponse({ id: 'plan-novo' });
    });
    expect(
      await createProvider().ensurePlan({
        ...planInput,
        periodicity: { value: 2, unit: 'years' },
      }),
    ).toEqual({ providerPlanId: 'plan-novo' });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    const body = callBody(at(calls, 1));
    expect(body).toEqual({
      reason: 'Plano completo',
      back_url: NOTIFICATION_URL,
      auto_recurring: {
        frequency: 24,
        frequency_type: 'months',
        transaction_amount: 50,
        currency_id: 'BRL',
      },
    });
    expect(at(calls, 1).headers['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('percorre as páginas da busca de planos', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      planFixture({ id: `plan-${index}`, reason: 'Outro' }),
    );
    const { calls } = installFetch((call) => {
      const offset = Number(new URL(call.url).searchParams.get('offset') ?? '0');
      if (offset === 0) {
        return jsonResponse({ paging: { total: 51, limit: 50, offset }, results: firstPage });
      }
      return jsonResponse({
        paging: { total: 51, limit: 50, offset },
        results: [planFixture({ id: 'plan-51' })],
      });
    });
    expect(await createProvider().ensurePlan(planInput)).toEqual({ providerPlanId: 'plan-51' });
    expect(calls).toHaveLength(2);
  });

  it('recusa plano com valor ou periodicidade inválidos', async () => {
    const { fetchMock } = installFetch(() => jsonResponse({ results: [] }));
    const provider = createProvider();
    await rejects(
      provider.ensurePlan({ ...planInput, amountCents: 0 }),
      'payment_provider_invalid_request',
    );
    await rejects(
      provider.ensurePlan({ ...planInput, periodicity: { value: 0, unit: 'months' } }),
      'payment_provider_invalid_request',
    );
    await rejects(
      provider.ensurePlan({
        ...planInput,
        periodicity: { value: 1, unit: 'weeks' as 'days' },
      }),
      'payment_provider_invalid_request',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cria a adesão pendente a partir do plano e devolve a URL de autorização', async () => {
    const { calls } = installFetch((call) => {
      if (call.path === '/preapproval_plan/plan-1') {
        return jsonResponse(planFixture());
      }
      return jsonResponse({
        id: 'sub-1',
        init_point: 'https://mercadopago.example/subscriptions/checkout?preapproval_id=sub-1',
      });
    });
    expect(await createProvider().createSubscription(subscriptionInput())).toEqual({
      checkoutUrl: 'https://mercadopago.example/subscriptions/checkout?preapproval_id=sub-1',
      providerSubscriptionId: 'sub-1',
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /preapproval_plan/plan-1',
      'POST /preapproval/',
    ]);
    const body = callBody(at(calls, 1));
    expect(body).toEqual({
      preapproval_plan_id: 'plan-1',
      reason: 'Plano completo',
      external_reference: `subscription:${SUBSCRIPTION_ID}`,
      payer_email: 'aluna@example.com',
      back_url: checkoutInput().returnUrls.success,
      status: 'pending',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 50,
        currency_id: 'BRL',
      },
    });
    expect(body).not.toHaveProperty('card_token_id');
    expect(at(calls, 1).headers['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reutiliza a chave idempotente nas tentativas da criação da adesão', async () => {
    let attempts = 0;
    const sleep = vi.fn(async (_milliseconds: number) => {});
    const { calls } = installFetch((call) => {
      if (call.method === 'GET') {
        return jsonResponse(planFixture());
      }
      attempts += 1;
      if (attempts < 3) {
        return jsonResponse({ message: 'internal' }, 500);
      }
      return jsonResponse({ id: 'sub-1', init_point: 'https://mercadopago.example/sub/1' });
    });
    expect(await createProvider({ sleep }).createSubscription(subscriptionInput())).toEqual({
      checkoutUrl: 'https://mercadopago.example/sub/1',
      providerSubscriptionId: 'sub-1',
    });
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((call) => call.headers['x-idempotency-key'])).size).toBe(1);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('recusa desconto na primeira cobrança e assinatura com referência de pedido', async () => {
    const { fetchMock } = installFetch(() => jsonResponse(planFixture()));
    const provider = createProvider();
    await rejects(
      provider.createSubscription({ ...subscriptionInput(), firstChargeDiscountCents: 1_000 }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      provider.createSubscription({ ...subscriptionInput(), firstChargeDiscountCents: -1 }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    await rejects(
      provider.createSubscription({
        ...subscriptionInput(),
        externalReference: orderExternalReference(ORDER_ID) as ReturnType<
          typeof subscriptionExternalReference
        >,
      }),
      PAYMENT_ERROR_CODES.invalidRequest,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa adesão sem URL de autorização', async () => {
    installFetch((call) =>
      call.method === 'GET' ? jsonResponse(planFixture()) : jsonResponse({ id: 'sub-1' }),
    );
    await rejects(
      createProvider().createSubscription(subscriptionInput()),
      'payment_provider_unavailable',
    );
  });

  it('consulta a assinatura com estado, plano, período e próxima cobrança', async () => {
    installFetch(() => jsonResponse(subscriptionFixture()));
    expect(await createProvider().getSubscription('sub-1')).toEqual({
      providerSubscriptionId: 'sub-1',
      providerPlanId: 'plan-1',
      status: 'authorized',
      externalReference: `subscription:${SUBSCRIPTION_ID}`,
      currentPeriodStart: new Date('2026-03-01T12:00:00.000Z'),
      currentPeriodEnd: new Date('2026-04-01T12:00:00.000Z'),
      nextBillingAt: new Date('2026-04-01T12:00:00.000Z'),
    });
  });

  it('cancela a assinatura de forma idempotente', async () => {
    const { calls } = installFetch((call) => {
      if (call.method === 'GET') {
        return jsonResponse(subscriptionFixture());
      }
      return jsonResponse({ id: 'sub-1', status: 'canceled' });
    });
    const provider = createProvider();
    expect(await provider.cancelSubscription('sub-1')).toEqual({ confirmed: true });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /preapproval/sub-1',
      'PUT /preapproval/sub-1',
    ]);
    expect(callBody(at(calls, 1))).toEqual({ status: 'cancelled' });
  });

  it('não repete o cancelamento de assinatura já cancelada', async () => {
    const { calls } = installFetch(() =>
      jsonResponse(subscriptionFixture({ status: 'cancelled' })),
    );
    expect(await createProvider().cancelSubscription('sub-1')).toEqual({ confirmed: true });
    expect(calls).toHaveLength(1);
  });

  it('reutiliza a chave idempotente nas tentativas do cancelamento', async () => {
    let attempts = 0;
    const sleep = vi.fn(async (_milliseconds: number) => {});
    const { calls } = installFetch((call) => {
      if (call.method === 'GET') {
        return jsonResponse(subscriptionFixture());
      }
      attempts += 1;
      return attempts < 3
        ? jsonResponse({ message: 'internal' }, 500)
        : jsonResponse({ id: 'sub-1', status: 'canceled' });
    });
    expect(await createProvider({ sleep }).cancelSubscription('sub-1')).toEqual({
      confirmed: true,
    });
    const puts = calls.filter((call) => call.method === 'PUT');
    expect(puts).toHaveLength(3);
    expect(new Set(puts.map((call) => call.headers['x-idempotency-key'])).size).toBe(1);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('traduz assinatura ou plano inexistente em não encontrado', async () => {
    installFetch(() => jsonResponse({ message: 'not found' }, 404));
    await rejects(createProvider().getSubscription('sub-1'), 'not_found');
    await rejects(createProvider().createSubscription(subscriptionInput()), 'not_found');
  });
});

describe('reembolsos', () => {
  it('faz reembolso parcial com valor em reais e chave idempotente', async () => {
    const { calls } = installFetch(() =>
      jsonResponse({ id: 'refund-1', status: 'approved', amount: 25.5 }),
    );
    expect(await createProvider().refund('pay-1', 2_550)).toEqual({
      providerRefundId: 'refund-1',
      status: 'approved',
      amountCents: 2_550,
    });
    const call = calls[0];
    if (call === undefined) throw new Error('chamada ausente');
    expect(call).toMatchObject({ method: 'POST', path: '/v1/payments/pay-1/refunds' });
    expect(callBody(call)).toEqual({ amount: 25.5 });
    expect(call.headers['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('faz reembolso total quando o valor é nulo', async () => {
    const { calls } = installFetch(() =>
      jsonResponse({ id: 'refund-1', status: 'pending', amount: 100 }),
    );
    expect(await createProvider().refund('pay-1', null)).toEqual({
      providerRefundId: 'refund-1',
      status: 'pending',
      amountCents: 10_000,
    });
    expect(callBody(at(calls, 0))).toEqual({});
  });

  it('reutiliza a chave idempotente nas tentativas do reembolso', async () => {
    let attempts = 0;
    const sleep = vi.fn(async (_milliseconds: number) => {});
    const { calls } = installFetch(() => {
      attempts += 1;
      return attempts < 2
        ? jsonResponse({ message: 'internal' }, 500)
        : jsonResponse({ id: 'refund-1', status: 'approved', amount: 100 });
    });
    await createProvider({ sleep }).refund('pay-1', null);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers['x-idempotency-key']).toBe(calls[1]?.headers['x-idempotency-key']);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('normaliza estado do reembolso e valor ausente', async () => {
    installFetch(() => jsonResponse({ id: 'refund-1', status: 'rejected' }));
    expect(await createProvider().refund('pay-1', 500)).toEqual({
      providerRefundId: 'refund-1',
      status: 'rejected',
      amountCents: 500,
    });
  });

  it('recusa valor inválido sem chamar o provedor', async () => {
    const { fetchMock } = installFetch(() => jsonResponse({ id: 'refund-1' }));
    const provider = createProvider();
    await rejects(provider.refund('pay-1', 0), 'payment_provider_invalid_request');
    await rejects(provider.refund('pay-1', -1), 'payment_provider_invalid_request');
    await rejects(provider.refund('pay-1', 1.5), 'payment_provider_invalid_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('traduz reembolso inexistente em não encontrado', async () => {
    installFetch(() => jsonResponse({ message: 'not found' }, 404));
    await rejects(createProvider().refund('pay-1', null), 'not_found');
  });
});

describe('configuração do adaptador', () => {
  it('recusa opções vazias ou URLs não HTTP sem repetir os valores', () => {
    expect(
      () =>
        new MercadoPagoPaymentProvider({
          accessToken: '',
          webhookSecret: WEBHOOK_SECRET,
          notificationUrl: NOTIFICATION_URL,
        }),
    ).toThrow(/accessToken/);
    expect(
      () =>
        new MercadoPagoPaymentProvider({
          accessToken: ACCESS_TOKEN,
          webhookSecret: '',
          notificationUrl: NOTIFICATION_URL,
        }),
    ).toThrow(/webhookSecret/);
    expect(
      () =>
        new MercadoPagoPaymentProvider({
          accessToken: ACCESS_TOKEN,
          webhookSecret: WEBHOOK_SECRET,
          notificationUrl: 'ftp://classroom.example/webhook',
        }),
    ).toThrow(/notificationUrl/);
    expect(
      () =>
        new MercadoPagoPaymentProvider({
          accessToken: ACCESS_TOKEN,
          webhookSecret: WEBHOOK_SECRET,
          notificationUrl: NOTIFICATION_URL,
          planBackUrl: 'javascript:alert(1)',
        }),
    ).toThrow(/planBackUrl/);
  });

  it('expõe o nome do provedor e usa a URL de retorno padrão do plano', async () => {
    const { calls } = installFetch((call) =>
      call.method === 'GET' ? jsonResponse({ results: [] }) : jsonResponse({ id: 'plan-1' }),
    );
    const provider = createProvider();
    expect(provider.name).toBe('mercadopago');
    await provider.ensurePlan({
      title: 'Plano',
      amountCents: 1_000,
      currency: 'BRL',
      periodicity: { value: 1, unit: 'days' },
    });
    expect(callBody(at(calls, 1)).back_url).toBe(NOTIFICATION_URL);
  });
});
