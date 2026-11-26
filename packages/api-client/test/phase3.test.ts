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

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return respond(request);
  };
  return { fetch, requests };
}

const ORDER: ClassroomSchemas['MyOrderDetail'] = {
  id: ID,
  number: 42,
  status: 'pending',
  subtotalCents: 19900,
  discountCents: 0,
  totalCents: 19900,
  currency: 'BRL',
  couponCode: null,
  buyerName: 'Ana Souza',
  buyerTaxIdType: 'cpf',
  buyerTaxId: '12345678901',
  provider: 'mercadopago',
  checkoutUrl: 'https://pagamento.test/checkout',
  createdAt: '2026-01-01T12:00:00.000Z',
  paidAt: null,
  expiresAt: '2026-01-01T12:30:00.000Z',
  items: [],
  payment: null,
};

describe('cesta, billing e pedidos do aluno (janela 510)', () => {
  it('expõe as rotas da cesta, do billing, dos pedidos e do webhook', () => {
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/cart');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/cart/items');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/cart/items/{id}');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/cart/coupon');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/me/billing');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/orders');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/orders/{id}');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/orders/{id}/cancel');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/webhooks/mercadopago');
  });

  it('o cupom entra por PUT e sai por DELETE, e o cancelamento é POST', () => {
    expectTypeOf<ClassroomPaths['/api/v1/cart/coupon']['put']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/cart/coupon']['delete']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/cart/items/{id}']['delete']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/orders']['post']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/orders/{id}/cancel']['post']>().not.toBeNever();
  });

  it('a cesta usa centavos inteiros e sinaliza o item que não pode ser vendido', () => {
    expectTypeOf<ClassroomSchemas['Cart']['subtotalCents']>().toEqualTypeOf<number>();
    expectTypeOf<ClassroomSchemas['Cart']['discountCents']>().toEqualTypeOf<number>();
    expectTypeOf<ClassroomSchemas['Cart']['totalCents']>().toEqualTypeOf<number>();
    expectTypeOf<ClassroomSchemas['Cart']['coupon']>().toEqualTypeOf<
      ClassroomSchemas['CartCoupon'] | null
    >();
    expectTypeOf<ClassroomSchemas['CartItem']['unitPriceCents']>().toEqualTypeOf<number | null>();
    expectTypeOf<ClassroomSchemas['CartItem']['unsellableReason']>().toEqualTypeOf<
      ClassroomSchemas['CartItemUnsellableReason'] | null
    >();
    expectTypeOf<ClassroomSchemas['CartItem']['unlocks']>().toEqualTypeOf<
      ClassroomSchemas['CartUnlock'][]
    >();
  });

  it('o billing guarda nome e documento anuláveis e diz quando está completo', () => {
    expectTypeOf<ClassroomSchemas['Billing']['fullName']>().toEqualTypeOf<string | null>();
    expectTypeOf<ClassroomSchemas['Billing']['taxId']>().toEqualTypeOf<string | null>();
    expectTypeOf<ClassroomSchemas['Billing']['taxIdType']>().toEqualTypeOf<
      ClassroomSchemas['TaxIdType'] | null
    >();
    expectTypeOf<ClassroomSchemas['Billing']['complete']>().toEqualTypeOf<boolean>();
  });

  it('o aluno não vê o estado draft e a cobrança é nula até existir', () => {
    expectTypeOf<ClassroomSchemas['OrderStatus']>().toEqualTypeOf<
      'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'canceled' | 'expired' | 'chargeback'
    >();
    expectTypeOf<ClassroomSchemas['MyOrderDetail']['payment']>().toEqualTypeOf<
      ClassroomSchemas['MyPayment'] | null
    >();
    expectTypeOf<ClassroomSchemas['MyOrderDetail']['checkoutUrl']>().toEqualTypeOf<string | null>();
    expectTypeOf<ClassroomSchemas['MyOrderPage']['items']>().toEqualTypeOf<
      ClassroomSchemas['MyOrderSummary'][]
    >();
    expectTypeOf<ClassroomSchemas['OrderCheckout']['order']>().toEqualTypeOf<
      ClassroomSchemas['MyOrderDetail']
    >();
  });

  it('fechar a cesta aceita Idempotency-Key e o webhook recebe a assinatura no cabeçalho', () => {
    expectTypeOf<
      NonNullable<ClassroomOperations['createOrder']['parameters']['header']>['Idempotency-Key']
    >().toEqualTypeOf<string | undefined>();
    expectTypeOf<
      NonNullable<
        ClassroomOperations['receiveMercadoPagoWebhook']['parameters']['header']
      >['x-signature']
    >().toEqualTypeOf<string | undefined>();
    expectTypeOf<ClassroomOperations['receiveMercadoPagoWebhook']['responses']>().toHaveProperty(
      401,
    );
  });

  it('cancelar o pedido envia CSRF e devolve o pedido já cancelado', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({ ...ORDER, status: 'canceled', checkoutUrl: null }),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });

    const { data, response } = await api.POST('/api/v1/orders/{id}/cancel', {
      params: { path: { id: ID } },
    });

    expectTypeOf(data).toEqualTypeOf<ClassroomSchemas['MyOrderDetail'] | undefined>();
    expect(response.status).toBe(200);
    expect(data?.status).toBe('canceled');
    const request = requests[0];
    if (!request) throw new Error('sem requisição');
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`http://api.test/api/v1/orders/${ID}/cancel`);
    expect(request.headers.get('X-CSRF-Token')).toBe('tok');
  });
});

describe('vendas, cupons, reembolsos e pagamentos do admin (janela 510)', () => {
  it('expõe as rotas de pedidos, cupons, pagamentos, webhooks e configuração', () => {
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/orders');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/orders/export.csv');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/orders/{id}');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/orders/{id}/refunds');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/refunds/{id}/retry');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/coupons');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/coupons/{id}');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/payments');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/payments/{id}');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/webhook-events');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/webhook-events/{id}/retry');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/settings/payments');
    expectTypeOf<AdminPaths['/api/v1/coupons/{id}']['patch']>().not.toBeNever();
    expectTypeOf<AdminPaths['/api/v1/refunds/{id}/retry']['post']>().not.toBeNever();
  });

  it('a lista de pedidos soma o filtro inteiro e só o detalhe traz o documento fiscal', () => {
    expectTypeOf<AdminSchemas['OrderSummaryPage']['totals']>().toEqualTypeOf<
      AdminSchemas['OrderTotals']
    >();
    expectTypeOf<AdminSchemas['OrderSummary']['buyer']>().toEqualTypeOf<
      AdminSchemas['OrderBuyer']
    >();
    expectTypeOf<AdminSchemas['OrderDetail']['buyer']>().toEqualTypeOf<
      AdminSchemas['OrderBuyerDetail']
    >();
    expectTypeOf<AdminSchemas['OrderBuyer']>().not.toHaveProperty('taxId');
    expectTypeOf<AdminSchemas['OrderStatus']>().toEqualTypeOf<
      | 'draft'
      | 'pending'
      | 'paid'
      | 'partially_refunded'
      | 'refunded'
      | 'canceled'
      | 'expired'
      | 'chargeback'
    >();
  });

  it('o CSV volta como texto, com os mesmos filtros da lista', async () => {
    const { fetch, requests } = fakeFetch(
      () =>
        new Response('order_id;order_number\r\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        }),
    );
    const api = createAdminClient({ baseUrl: BASE_URL, fetch });

    // A resposta vem em fluxo, sem `Content-Length`: sem `parseAs: 'text'` o cliente tentaria
    // JSON.parse no CSV.
    const { data } = await api.GET('/api/v1/orders/export.csv', {
      params: { query: { from: '2026-01-01T00:00:00.000Z', status: 'paid' } },
      parseAs: 'text',
    });

    expectTypeOf(data).toEqualTypeOf<string | undefined>();
    expect(data).toContain('order_id');
    expect(requests[0]?.url).toBe(
      'http://api.test/api/v1/orders/export.csv?from=2026-01-01T00%3A00%3A00.000Z&status=paid',
    );
  });

  it('o reembolso escolhe itens ou o pedido inteiro e responde 202', () => {
    type Body = AdminOperations['requestOrderRefund']['requestBody']['content']['application/json'];
    expectTypeOf<Body['items']>().toEqualTypeOf<
      AdminSchemas['RefundItemInput'][] | null | undefined
    >();
    expectTypeOf<
      AdminOperations['requestOrderRefund']['responses'][202]['content']['application/json']
    >().toEqualTypeOf<AdminSchemas['Refund']>();
    expectTypeOf<
      AdminOperations['retryRefund']['responses'][202]['content']['application/json']
    >().toEqualTypeOf<AdminSchemas['Refund']>();
    expectTypeOf<AdminSchemas['RefundStatus']>().toEqualTypeOf<'requested' | 'done' | 'failed'>();
  });

  it('cupom percentual e fixo têm um campo nulo cada', () => {
    expectTypeOf<AdminSchemas['CouponKind']>().toEqualTypeOf<'percent' | 'fixed'>();
    expectTypeOf<AdminSchemas['CouponInput']['percentOff']>().toEqualTypeOf<
      number | null | undefined
    >();
    expectTypeOf<AdminSchemas['CouponInput']['amountOffCents']>().toEqualTypeOf<
      number | null | undefined
    >();
    expectTypeOf<AdminSchemas['CouponUpdate']>().toHaveProperty('products');
  });

  it('a cobrança e o reembolso já aceitam assinatura e pedido nulos', () => {
    expectTypeOf<AdminSchemas['Payment']['subscriptionId']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminSchemas['Payment']['orderId']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminSchemas['Refund']['orderId']>().toEqualTypeOf<string | null | undefined>();
  });

  it('a fila de webhooks separa failed de rejected e a configuração diz o provedor', () => {
    expectTypeOf<
      NonNullable<AdminOperations['listWebhookEvents']['parameters']['query']>['status']
    >().toEqualTypeOf<'failed' | 'rejected' | undefined>();
    expectTypeOf<AdminSchemas['WebhookEventStatus']>().toEqualTypeOf<
      'received' | 'rejected' | 'processed' | 'ignored' | 'failed'
    >();
    expectTypeOf<AdminSchemas['PaymentSettings']['provider']>().toEqualTypeOf<
      'mercadopago' | 'fake'
    >();
    expectTypeOf<AdminSchemas['PaymentSettings']['testMode']>().toEqualTypeOf<boolean>();
  });
});
