import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AdminOperations,
  type AdminPaths,
  type AdminSchemas,
  type ClassroomOperations,
  type ClassroomPaths,
  type ClassroomSchemas,
  createAdminClient,
  createClassroomClient,
} from '../src/index';

const BASE_URL = 'http://api.test';
const ID = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
const PAYMENT_ID = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f71';

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return respond(request);
  };
  return { fetch, requests };
}

const PUBLIC_PLAN: ClassroomSchemas['PublicPlan'] = {
  id: ID,
  slug: 'completo-mensal',
  title: 'Completo',
  description: null,
  interval: 'month',
  priceCents: 9900,
  includesAll: false,
  items: [{ productType: 'course', productId: ID, title: 'Curso' }],
  position: 0,
};

const CHARGE: ClassroomSchemas['SubscriptionCharge'] = {
  id: PAYMENT_ID,
  status: 'approved',
  method: 'card',
  amountCents: 9900,
  refundedCents: 0,
  currency: 'BRL',
  provider: 'mercadopago',
  providerPaymentId: '1234567890',
  paidAt: '2026-01-01T12:05:00.000Z',
  createdAt: '2026-01-01T12:00:00.000Z',
};

describe('planos e assinaturas do aluno (janela 560)', () => {
  it('expõe a vitrine, o checkout e a área do aluno', () => {
    for (const path of [
      '/api/v1/plans',
      '/api/v1/subscriptions',
      '/api/v1/me/subscriptions',
      '/api/v1/me/subscriptions/{id}',
      '/api/v1/me/subscriptions/{id}/cancel',
    ] as const) {
      expectTypeOf<ClassroomPaths>().toHaveProperty(path);
    }
    expectTypeOf<ClassroomPaths['/api/v1/plans']['get']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/subscriptions']['post']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/me/subscriptions']['get']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/me/subscriptions/{id}']['get']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/me/subscriptions/{id}/cancel']['post']>().not.toBeNever();
  });

  it('a vitrine agrupa os planos públicos por conteúdo e esconde os privados', () => {
    expectTypeOf<ClassroomSchemas['PlanCatalog']['groups']>().toEqualTypeOf<
      ClassroomSchemas['PlanGroup'][]
    >();
    expectTypeOf<ClassroomSchemas['PlanCatalog']['currency']>().toEqualTypeOf<string>();
    expectTypeOf<ClassroomSchemas['PlanGroup']['plans']>().toEqualTypeOf<
      ClassroomSchemas['PublicPlan'][]
    >();
    expectTypeOf<ClassroomSchemas['PublicPlan']['items']>().toEqualTypeOf<
      ClassroomSchemas['PlanItem'][]
    >();
    expectTypeOf<ClassroomSchemas['PublicPlan']['includesAll']>().toEqualTypeOf<boolean>();
    expectTypeOf<ClassroomSchemas['PublicPlan']>().not.toHaveProperty('includesPrivate');
    expectTypeOf<ClassroomSchemas['PlanInterval']>().toEqualTypeOf<'month' | 'year'>();
  });

  it('a vitrine é pública e lê os planos sem CSRF', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({ groups: [{ groupKey: 'completo', plans: [PUBLIC_PLAN] }], currency: 'BRL' }),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });

    const { data } = await api.GET('/api/v1/plans');

    expectTypeOf(data).toEqualTypeOf<ClassroomSchemas['PlanCatalog'] | undefined>();
    expect(data?.groups[0]?.groupKey).toBe('completo');
    const request = requests[0];
    if (!request) throw new Error('sem requisição');
    expect(request.method).toBe('GET');
    expect(request.url).toBe(`${BASE_URL}/api/v1/plans`);
    expect(request.headers.get('X-CSRF-Token')).toBeNull();
  });

  it('assinar manda plano e cupom opcional e devolve a URL do checkout', async () => {
    expectTypeOf<
      ClassroomOperations['createSubscription']['requestBody']['content']['application/json']['couponCode']
    >().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<
      ClassroomOperations['createSubscription']['responses'][201]['content']['application/json']
    >().toEqualTypeOf<ClassroomSchemas['SubscriptionCheckout']>();
    expectTypeOf<ClassroomSchemas['SubscriptionCheckout']['subscription']>().toEqualTypeOf<
      ClassroomSchemas['MySubscriptionDetail']
    >();
    expectTypeOf<ClassroomSchemas['SubscriptionCheckout']['checkoutUrl']>().toEqualTypeOf<string>();

    const { fetch, requests } = fakeFetch(() =>
      Response.json(
        {
          subscription: {
            id: ID,
            plan: PUBLIC_PLAN,
            status: 'pending',
            priceCents: 9900,
            currency: 'BRL',
            currentPeriodStart: null,
            currentPeriodEnd: null,
            graceUntil: null,
            nextChargeAt: null,
            canceledAt: null,
            endedAt: null,
            createdAt: '2026-01-01T12:00:00.000Z',
            payments: [],
          },
          checkoutUrl: 'https://pagamento.test/assinatura',
        },
        { status: 201 },
      ),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });

    const { data, response } = await api.POST('/api/v1/subscriptions', {
      body: { planId: ID, couponCode: 'BEMVINDO' },
    });

    expect(response.status).toBe(201);
    expect(data?.checkoutUrl).toBe('https://pagamento.test/assinatura');
    const request = requests[0];
    if (!request) throw new Error('sem requisição');
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`${BASE_URL}/api/v1/subscriptions`);
    expect(request.headers.get('X-CSRF-Token')).toBe('tok');
    expect(await request.json()).toEqual({ planId: ID, couponCode: 'BEMVINDO' });
  });

  it('as assinaturas do aluno vêm paginadas com filtro de estado', () => {
    expectTypeOf<
      NonNullable<ClassroomOperations['listMySubscriptions']['parameters']['query']>['status']
    >().toEqualTypeOf<ClassroomSchemas['SubscriptionStatus'] | undefined>();
    expectTypeOf<ClassroomSchemas['MySubscriptionPage']['items']>().toEqualTypeOf<
      ClassroomSchemas['MySubscriptionSummary'][]
    >();
    expectTypeOf<ClassroomSchemas['MySubscriptionPage']['nextCursor']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<ClassroomSchemas['MySubscriptionSummary']['plan']>().toEqualTypeOf<
      ClassroomSchemas['SubscriptionPlanRef']
    >();
    expectTypeOf<ClassroomSchemas['SubscriptionPlanRef']['slug']>().toEqualTypeOf<string>();
    expectTypeOf<ClassroomSchemas['SubscriptionStatus']>().toEqualTypeOf<
      'pending' | 'active' | 'past_due' | 'suspended' | 'canceling' | 'ended' | 'expired'
    >();
  });

  it('a próxima cobrança só existe em ativa e a carência é anulável', () => {
    expectTypeOf<ClassroomSchemas['MySubscriptionSummary']['nextChargeAt']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<ClassroomSchemas['MySubscriptionSummary']['graceUntil']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<ClassroomSchemas['MySubscriptionSummary']['endedAt']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<ClassroomSchemas['MySubscriptionDetail']['plan']>().toEqualTypeOf<
      ClassroomSchemas['PublicPlan']
    >();
    expectTypeOf<ClassroomSchemas['MySubscriptionDetail']['payments']>().toEqualTypeOf<
      ClassroomSchemas['SubscriptionCharge'][]
    >();
    expectTypeOf<ClassroomSchemas['SubscriptionCharge']['refundedCents']>().toEqualTypeOf<number>();
    expectTypeOf<ClassroomSchemas['SubscriptionCharge']['provider']>().toEqualTypeOf<
      'mercadopago' | 'fake'
    >();
  });

  it('a lista usa o filtro e a página seguinte por cursor', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({ items: [], nextCursor: 'cursor-1' }),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch });

    const { data } = await api.GET('/api/v1/me/subscriptions', {
      params: { query: { status: 'active', limit: 10 } },
    });

    expect(data?.nextCursor).toBe('cursor-1');
    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/me/subscriptions?status=active&limit=10`);
  });

  it('o detalhe traz as cobranças e o cancelamento é POST com CSRF', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({
        id: ID,
        plan: PUBLIC_PLAN,
        status: 'canceling',
        priceCents: 9900,
        currency: 'BRL',
        currentPeriodStart: '2026-01-01T12:00:00.000Z',
        currentPeriodEnd: '2026-02-01T12:00:00.000Z',
        graceUntil: null,
        nextChargeAt: null,
        canceledAt: '2026-01-10T09:00:00.000Z',
        endedAt: null,
        createdAt: '2026-01-01T12:00:00.000Z',
        payments: [CHARGE],
      }),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });

    const detail = await api.GET('/api/v1/me/subscriptions/{id}', {
      params: { path: { id: ID } },
    });
    expectTypeOf(detail.data).toEqualTypeOf<ClassroomSchemas['MySubscriptionDetail'] | undefined>();
    expect(detail.data?.payments[0]?.providerPaymentId).toBe('1234567890');

    const { data } = await api.POST('/api/v1/me/subscriptions/{id}/cancel', {
      params: { path: { id: ID } },
    });

    expect(data?.status).toBe('canceling');
    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/me/subscriptions/${ID}`);
    expect(requests[1]?.method).toBe('POST');
    expect(requests[1]?.url).toBe(`${BASE_URL}/api/v1/me/subscriptions/${ID}/cancel`);
    expect(requests[1]?.headers.get('X-CSRF-Token')).toBe('tok');
    expectTypeOf<
      ClassroomOperations['cancelMySubscription']['responses'][200]['content']['application/json']
    >().toEqualTypeOf<ClassroomSchemas['MySubscriptionDetail']>();
  });
});

describe('planos e assinaturas do admin (janela 560)', () => {
  it('expõe o CRUD de planos, os itens e as assinaturas', () => {
    for (const path of [
      '/api/v1/plans',
      '/api/v1/plans/{id}',
      '/api/v1/plans/{id}/items',
      '/api/v1/subscriptions',
      '/api/v1/subscriptions/{id}',
      '/api/v1/subscriptions/{id}/cancel',
      '/api/v1/subscriptions/{id}/payments/{paymentId}/refund',
    ] as const) {
      expectTypeOf<AdminPaths>().toHaveProperty(path);
    }
    expectTypeOf<AdminPaths['/api/v1/plans']['get']>().not.toBeNever();
    expectTypeOf<AdminPaths['/api/v1/plans']['post']>().not.toBeNever();
    expectTypeOf<AdminPaths['/api/v1/plans/{id}']['patch']>().not.toBeNever();
    expectTypeOf<AdminPaths['/api/v1/plans/{id}/items']['put']>().not.toBeNever();
    expectTypeOf<AdminPaths['/api/v1/subscriptions/{id}/cancel']['post']>().not.toBeNever();
    expectTypeOf<
      AdminPaths['/api/v1/subscriptions/{id}/payments/{paymentId}/refund']['post']
    >().not.toBeNever();
  });

  it('o plano diz preço, origem no provedor e quantas assinaturas o vinculam', () => {
    expectTypeOf<AdminSchemas['Plan']['providerPlanId']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminSchemas['Plan']['subscriptionCount']>().toEqualTypeOf<number>();
    expectTypeOf<AdminSchemas['Plan']['items']>().toEqualTypeOf<AdminSchemas['PlanItem'][]>();
    expectTypeOf<AdminSchemas['PlanPage']['items']>().toEqualTypeOf<AdminSchemas['Plan'][]>();
    expectTypeOf<AdminSchemas['PlanInterval']>().toEqualTypeOf<ClassroomSchemas['PlanInterval']>();
  });

  it('a criação aceita slug, itens e padrões; a edição não muda a identidade', () => {
    type Create = AdminOperations['createPlan']['requestBody']['content']['application/json'];
    expectTypeOf<Create['slug']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Create['items']>().toEqualTypeOf<AdminSchemas['PlanItemInput'][]>();
    expectTypeOf<Create['includesPrivate']>().toEqualTypeOf<boolean>();
    expectTypeOf<AdminSchemas['PlanUpdate']>().toHaveProperty('priceCents');
    expectTypeOf<AdminSchemas['PlanUpdate']>().not.toHaveProperty('slug');
    expectTypeOf<AdminSchemas['PlanUpdate']>().not.toHaveProperty('groupKey');
    expectTypeOf<AdminSchemas['PlanUpdate']>().not.toHaveProperty('interval');
    expectTypeOf<AdminSchemas['PlanItemsUpdate']['items']>().toEqualTypeOf<
      AdminSchemas['PlanItemInput'][]
    >();
  });

  it('a lista de planos filtra por busca, situação, periodicidade e grupo', () => {
    type Query = NonNullable<AdminOperations['listPlans']['parameters']['query']>;
    expectTypeOf<Query['q']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Query['active']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Query['interval']>().toEqualTypeOf<AdminSchemas['PlanInterval'] | undefined>();
    expectTypeOf<Query['groupKey']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Query['cursor']>().toEqualTypeOf<string | undefined>();
  });

  it('editar o plano e trocar os itens enviam CSRF', async () => {
    const { fetch, requests } = fakeFetch(() => Response.json({}));
    const api = createAdminClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });

    await api.PATCH('/api/v1/plans/{id}', {
      params: { path: { id: ID } },
      body: { priceCents: 12900, active: false },
    });
    await api.PUT('/api/v1/plans/{id}/items', {
      params: { path: { id: ID } },
      body: { items: [{ productType: 'bundle', productId: ID }] },
    });

    expect(requests[0]?.method).toBe('PATCH');
    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/plans/${ID}`);
    expect(requests[0]?.headers.get('X-CSRF-Token')).toBe('tok');
    expect(await requests[0]?.json()).toEqual({ priceCents: 12900, active: false });
    expect(requests[1]?.method).toBe('PUT');
    expect(requests[1]?.url).toBe(`${BASE_URL}/api/v1/plans/${ID}/items`);
    expect(await requests[1]?.json()).toEqual({
      items: [{ productType: 'bundle', productId: ID }],
    });
  });

  it('a assinatura no admin tem assinante, plano atual e cobranças', () => {
    expectTypeOf<AdminSchemas['AdminSubscriptionPage']['items']>().toEqualTypeOf<
      AdminSchemas['AdminSubscriptionSummary'][]
    >();
    expectTypeOf<AdminSchemas['AdminSubscriptionSummary']['subscriber']>().toEqualTypeOf<
      AdminSchemas['Subscriber']
    >();
    expectTypeOf<AdminSchemas['AdminSubscriptionDetail']['plan']>().toEqualTypeOf<
      AdminSchemas['Plan']
    >();
    expectTypeOf<AdminSchemas['AdminSubscriptionDetail']['payments']>().toEqualTypeOf<
      AdminSchemas['PaymentDetail'][]
    >();
    expectTypeOf<AdminSchemas['AdminSubscriptionDetail']['couponCode']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<AdminSchemas['AdminSubscriptionDetail']['currentPeriodPaymentId']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<AdminSchemas['AdminSubscriptionDetail']['cancelReason']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<AdminSchemas['Subscriber']>().not.toHaveProperty('taxId');
    expectTypeOf<AdminSchemas['SubscriptionStatus']>().toEqualTypeOf<
      ClassroomSchemas['SubscriptionStatus']
    >();
  });

  it('a consulta de assinaturas filtra por período, estado, plano e assinante', () => {
    type Query = NonNullable<AdminOperations['listSubscriptions']['parameters']['query']>;
    expectTypeOf<Query['from']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Query['to']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Query['status']>().toEqualTypeOf<AdminSchemas['SubscriptionStatus'] | undefined>();
    expectTypeOf<Query['planId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Query['userId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Query['q']>().toEqualTypeOf<string | undefined>();
  });

  it('o admin cancela com motivo e recebe o detalhe', async () => {
    type Body = AdminOperations['cancelSubscription']['requestBody']['content']['application/json'];
    expectTypeOf<Body['reason']>().toEqualTypeOf<string>();
    expectTypeOf<
      AdminOperations['cancelSubscription']['responses'][200]['content']['application/json']
    >().toEqualTypeOf<AdminSchemas['AdminSubscriptionDetail']>();

    const { fetch, requests } = fakeFetch(() => Response.json({ status: 'canceling' }));
    const api = createAdminClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });

    const { data } = await api.POST('/api/v1/subscriptions/{id}/cancel', {
      params: { path: { id: ID } },
      body: { reason: 'pedido do aluno' },
    });

    expect(data?.status).toBe('canceling');
    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/subscriptions/${ID}/cancel`);
    expect(requests[0]?.headers.get('X-CSRF-Token')).toBe('tok');
    expect(await requests[0]?.json()).toEqual({ reason: 'pedido do aluno' });
  });

  it('o reembolso da cobrança aceita valor parcial, Idempotency-Key e responde 202', () => {
    type Body =
      AdminOperations['requestSubscriptionRefund']['requestBody']['content']['application/json'];
    expectTypeOf<Body['reason']>().toEqualTypeOf<string>();
    expectTypeOf<Body['amountCents']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<
      NonNullable<
        AdminOperations['requestSubscriptionRefund']['parameters']['header']
      >['Idempotency-Key']
    >().toEqualTypeOf<string | undefined>();
    expectTypeOf<
      AdminOperations['requestSubscriptionRefund']['responses'][202]['content']['application/json']
    >().toEqualTypeOf<AdminSchemas['Refund']>();
    expectTypeOf<AdminOperations['requestSubscriptionRefund']['responses']>().not.toHaveProperty(
      201,
    );
  });

  it('pedir o reembolso manda os motivos, o valor e a chave de idempotência', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({ id: PAYMENT_ID, status: 'requested', amountCents: 4900 }, { status: 202 }),
    );
    const api = createAdminClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });

    const { data, response } = await api.POST(
      '/api/v1/subscriptions/{id}/payments/{paymentId}/refund',
      {
        params: { path: { id: ID, paymentId: PAYMENT_ID } },
        headers: { 'Idempotency-Key': 'refund-1' },
        body: { reason: 'cobrança duplicada', amountCents: 4900 },
      },
    );

    expect(response.status).toBe(202);
    expect(data?.status).toBe('requested');
    const request = requests[0];
    if (!request) throw new Error('sem requisição');
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      `${BASE_URL}/api/v1/subscriptions/${ID}/payments/${PAYMENT_ID}/refund`,
    );
    expect(request.headers.get('X-CSRF-Token')).toBe('tok');
    expect(request.headers.get('Idempotency-Key')).toBe('refund-1');
    expect(await request.json()).toEqual({ reason: 'cobrança duplicada', amountCents: 4900 });
  });
});
