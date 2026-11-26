import { describe, expect, it } from 'vitest';
import {
  fromCents,
  mapPaymentMethod,
  mapPaymentStatus,
  mapRefundStatus,
  mapSubscriptionStatus,
  paymentExternalReference,
  paymentId,
  toCents,
  toDate,
  toProviderPayment,
  toProviderSubscription,
} from '../../../src/modules/payments/mercadopago/index.ts';
import { ORDER_ID, paymentFixture, SUBSCRIPTION_ID, subscriptionFixture } from './helpers.ts';

describe('mapeamento do Mercado Pago para a porta', () => {
  it('converte centavos sem perder fração e limita valores inválidos', () => {
    expect(toCents(100.01)).toBe(10_001);
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-3)).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
    expect(fromCents(10_001)).toBe(100.01);
    expect(fromCents(1)).toBe(0.01);
  });

  it('normaliza estados de pagamento, inclusive estorno registrado sobre approved', () => {
    expect(mapPaymentStatus('approved', 0, 10_000)).toBe('approved');
    expect(mapPaymentStatus('approved', 2_500, 10_000)).toBe('partially_refunded');
    expect(mapPaymentStatus('approved', 10_000, 10_000)).toBe('refunded');
    expect(mapPaymentStatus('refunded', 10_000, 10_000)).toBe('refunded');
    expect(mapPaymentStatus('charged_back', 0, 10_000)).toBe('charged_back');
    expect(mapPaymentStatus('rejected', 0, 10_000)).toBe('rejected');
    expect(mapPaymentStatus('cancelled', 0, 10_000)).toBe('canceled');
    expect(mapPaymentStatus('canceled', 0, 10_000)).toBe('canceled');
    for (const status of ['pending', 'in_process', 'in_mediation', 'authorized']) {
      expect(mapPaymentStatus(status, 0, 10_000)).toBe('pending');
    }
    expect(mapPaymentStatus('estado_novo', 0, 10_000)).toBe('pending');
    expect(mapPaymentStatus(null, 0, 10_000)).toBe('pending');
  });

  it('reconhece cartão, Pix, boleto e o restante', () => {
    expect(mapPaymentMethod('credit_card', 'visa')).toBe('card');
    expect(mapPaymentMethod('debit_card', 'master')).toBe('card');
    expect(mapPaymentMethod('prepaid_card', 'visa')).toBe('card');
    expect(mapPaymentMethod('pix', 'pix')).toBe('pix');
    expect(mapPaymentMethod(null, 'pix')).toBe('pix');
    expect(mapPaymentMethod('ticket', 'bolboretodo')).toBe('boleto');
    expect(mapPaymentMethod(null, 'boleto')).toBe('boleto');
    expect(mapPaymentMethod('account_money', 'account_money')).toBe('other');
  });

  it('normaliza estados de assinatura e reembolso', () => {
    expect(mapSubscriptionStatus('authorized')).toBe('authorized');
    expect(mapSubscriptionStatus('paused')).toBe('paused');
    expect(mapSubscriptionStatus('cancelled')).toBe('canceled');
    expect(mapSubscriptionStatus('canceled')).toBe('canceled');
    expect(mapSubscriptionStatus('pending')).toBe('pending');
    expect(mapSubscriptionStatus('desconhecido')).toBe('pending');
    expect(mapSubscriptionStatus(null)).toBe('pending');

    expect(mapRefundStatus('approved')).toBe('approved');
    expect(mapRefundStatus('pending')).toBe('pending');
    expect(mapRefundStatus('in_process')).toBe('pending');
    expect(mapRefundStatus('rejected')).toBe('rejected');
    expect(mapRefundStatus('failed')).toBe('rejected');
    expect(mapRefundStatus('cancelled')).toBe('rejected');
    expect(mapRefundStatus(null)).toBe('pending');
  });

  it('lê datas ISO e devolve nulo para valores inválidos', () => {
    expect(toDate('2026-03-01T12:00:00.000Z')?.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(toDate(null)).toBeNull();
    expect(toDate('não é data')).toBeNull();
    expect(toDate({})).toBeNull();
  });

  it('exige e normaliza referências externas e identificadores', () => {
    expect(paymentExternalReference(`order:${ORDER_ID}`)).toBe(`order:${ORDER_ID}`);
    expect(paymentExternalReference(`subscription:${SUBSCRIPTION_ID}`)).toBe(
      `subscription:${SUBSCRIPTION_ID}`,
    );
    expect(() => paymentExternalReference(null)).toThrow(/referência externa/);
    expect(() => paymentExternalReference('aluna@example.com')).toThrow(/Referência externa/);
    expect(paymentId('pay-1')).toBe('pay-1');
    expect(paymentId(42)).toBe('42');
    expect(() => paymentId(null)).toThrow(/indisponível/);
  });

  it('traduz o pagamento do provedor sem copiar campos sensíveis', () => {
    expect(
      toProviderPayment(
        paymentFixture({
          id: 99,
          transaction_amount: 80,
          transaction_amount_refunded: 20,
          payment_type_id: 'pix',
          payment_method_id: 'pix',
          card: { last_four_digits: '1234' },
          payer: { email: 'aluna@example.com' },
        }),
      ),
    ).toMatchObject({
      providerPaymentId: '99',
      status: 'partially_refunded',
      amountCents: 8_000,
      refundedCents: 2_000,
      currency: 'BRL',
      method: 'pix',
      externalReference: `order:${ORDER_ID}`,
      rawStatus: 'approved',
      paidAt: new Date('2026-03-01T12:00:00.000Z'),
    });
    const payment = toProviderPayment(paymentFixture());
    expect(Object.keys(payment).sort()).toEqual([
      'amountCents',
      'currency',
      'externalReference',
      'method',
      'paidAt',
      'providerPaymentId',
      'rawStatus',
      'refundedCents',
      'status',
    ]);
  });

  it('recusa pagamento sem valor, moeda ou referência', () => {
    expect(() => toProviderPayment(paymentFixture({ transaction_amount: 0 }))).toThrow(
      /indisponível/,
    );
    expect(() => toProviderPayment(paymentFixture({ currency_id: null }))).toThrow(/indisponível/);
    expect(() => toProviderPayment(paymentFixture({ external_reference: null }))).toThrow(
      /referência externa/,
    );
  });

  it('traduz a assinatura com plano, período e próxima cobrança', () => {
    expect(toProviderSubscription(subscriptionFixture())).toMatchObject({
      providerSubscriptionId: 'sub-1',
      providerPlanId: 'plan-1',
      status: 'authorized',
      externalReference: `subscription:${SUBSCRIPTION_ID}`,
      currentPeriodStart: new Date('2026-03-01T12:00:00.000Z'),
      currentPeriodEnd: new Date('2026-04-01T12:00:00.000Z'),
      nextBillingAt: new Date('2026-04-01T12:00:00.000Z'),
    });
    expect(
      toProviderSubscription(
        subscriptionFixture({
          next_payment_date: null,
          summarized: null,
          status: 'pending',
        }),
      ),
    ).toMatchObject({
      status: 'pending',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingAt: null,
    });
  });

  it('recusa assinatura sem plano ou com referência de pedido', () => {
    expect(() =>
      toProviderSubscription(subscriptionFixture({ preapproval_plan_id: null })),
    ).toThrow(/indisponível/);
    expect(() =>
      toProviderSubscription(subscriptionFixture({ external_reference: `order:${ORDER_ID}` })),
    ).toThrow(/subscription:<uuid>/);
  });
});
