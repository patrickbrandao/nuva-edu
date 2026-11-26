import { describe, expect, it } from 'vitest';
import { isDomainError, PAYMENT_ERROR_CODES } from '../../../src/index.ts';
import {
  MERCADO_PAGO_WEBHOOK_MAX_BYTES,
  MercadoPagoPaymentProvider,
  type MercadoPagoPaymentProviderOptions,
} from '../../../src/modules/payments/mercadopago/index.ts';
import {
  ACCESS_TOKEN,
  NOTIFICATION_URL,
  NOW_MS,
  paymentWebhookBody,
  signedWebhook,
  WEBHOOK_SECRET,
} from './helpers.ts';

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
    return error as { code: string; status: number; title: string; detail?: string };
  }
  throw new Error(`O aviso deveria falhar com ${code}.`);
}

describe('webhook do Mercado Pago', () => {
  it('entrega só os identificadores de um aviso de pagamento válido', async () => {
    const body = paymentWebhookBody({ id: 987654, data: { id: 'pay-1' } });
    expect(await createProvider().parseWebhook(signedWebhook(body))).toEqual({
      provider: 'mercadopago',
      eventId: '987654',
      resourceType: 'payment',
      resourceId: 'pay-1',
    });
  });

  it('mapeia adesão para assinatura e cobrança recorrente para pagamento', async () => {
    const provider = createProvider();
    expect(
      await provider.parseWebhook(
        signedWebhook({
          id: 'evt-1',
          type: 'subscription_preapproval',
          action: 'updated',
          data: { id: 'sub-1' },
        }),
      ),
    ).toEqual({
      provider: 'mercadopago',
      eventId: 'evt-1',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });
    expect(
      await provider.parseWebhook(
        signedWebhook({
          id: 'evt-2',
          type: 'subscription_authorized_payment',
          action: 'created',
          data: { id: 'invoice-1' },
        }),
      ),
    ).toEqual({
      provider: 'mercadopago',
      eventId: 'evt-2',
      resourceType: 'payment',
      resourceId: 'invoice-1',
    });
  });

  it('aceita corpo em bytes, cabeçalhos como Headers e valores em lista', async () => {
    const body = paymentWebhookBody();
    const signed = signedWebhook(body);
    const rawBody = new TextEncoder().encode(signed.rawBody as string);
    const signature = (signed.headers as Record<string, string>)['x-signature'] as string;
    const requestId = (signed.headers as Record<string, string>)['x-request-id'] as string;
    const provider = createProvider();
    expect(
      await provider.parseWebhook({
        rawBody,
        headers: new Headers({ 'x-signature': signature, 'x-request-id': requestId }),
      }),
    ).toMatchObject({ eventId: '12345', resourceType: 'payment', resourceId: 'pay-1' });
    expect(
      await provider.parseWebhook({
        rawBody: signed.rawBody,
        headers: { 'X-Signature': [signature], 'X-Request-Id': [requestId] },
      }),
    ).toMatchObject({ eventId: '12345', resourceType: 'payment', resourceId: 'pay-1' });
  });

  it('recusa assinatura de outro segredo sem vazar segredo, token, corpo ou assinatura', async () => {
    const body = paymentWebhookBody();
    const signed = signedWebhook(body, { secret: 'outro-segredo' });
    const error = await rejects(
      createProvider().parseWebhook(signed),
      PAYMENT_ERROR_CODES.invalidSignature,
    );
    expect(error.status).toBe(401);
    const dump = `${error.title}\n${error.detail ?? ''}\n${JSON.stringify(error)}`;
    expect(dump).not.toContain(WEBHOOK_SECRET);
    expect(dump).not.toContain(ACCESS_TOKEN);
    expect(dump).not.toContain('outro-segredo');
    expect(dump).not.toContain('pay-1');
    expect(dump).not.toContain('v1=');
  });

  it('recusa cabeçalhos ausentes, vazios ou malformados', async () => {
    const rawBody = JSON.stringify(paymentWebhookBody());
    const provider = createProvider();
    const headersCases: Array<Record<string, string | string[]>> = [
      {},
      { 'x-signature': 'ts=1,v1=abc' },
      { 'x-request-id': 'req-1' },
      { 'x-signature': '', 'x-request-id': 'req-1' },
      { 'x-signature': '   ', 'x-request-id': 'req-1' },
      { 'x-signature': 'sem-formato', 'x-request-id': 'req-1' },
      { 'x-signature': 'ts=abc,v1=abc', 'x-request-id': 'req-1' },
      { 'x-signature': 'ts=1', 'x-request-id': 'req-1' },
      { 'x-signature': 'ts=1,v2=abc', 'x-request-id': 'req-1' },
      { 'x-signature': 'ts=1,v1=abc', 'x-request-id': '  ' },
      { 'x-signature': ['ts=1,v1=abc'], 'x-request-id': [] },
    ];
    for (const headers of headersCases) {
      await rejects(
        provider.parseWebhook({ rawBody, headers }),
        PAYMENT_ERROR_CODES.invalidSignature,
      );
    }
  });

  it('recusa carimbo fora dos 5 min, no passado ou no futuro', async () => {
    const body = paymentWebhookBody();
    const nowSeconds = Math.floor(NOW_MS / 1_000);
    const provider = createProvider();
    await rejects(
      provider.parseWebhook(signedWebhook(body, { timestampSeconds: nowSeconds - 301 })),
      PAYMENT_ERROR_CODES.invalidSignature,
    );
    await rejects(
      provider.parseWebhook(signedWebhook(body, { timestampSeconds: nowSeconds + 301 })),
      PAYMENT_ERROR_CODES.invalidSignature,
    );
    expect(
      await provider.parseWebhook(signedWebhook(body, { timestampSeconds: nowSeconds - 300 })),
    ).toMatchObject({ resourceId: 'pay-1' });
  });

  it('recusa corpo trocado depois da assinatura', async () => {
    const signed = signedWebhook(paymentWebhookBody({ data: { id: 'pay-1' } }));
    const tampered = JSON.stringify(paymentWebhookBody({ data: { id: 'pay-2' } }));
    await rejects(
      createProvider().parseWebhook({ ...signed, rawBody: tampered }),
      PAYMENT_ERROR_CODES.invalidSignature,
    );
  });

  it('recusa corpo grande demais antes de qualquer leitura', async () => {
    const oversized = 'x'.repeat(MERCADO_PAGO_WEBHOOK_MAX_BYTES + 1);
    await rejects(
      createProvider().parseWebhook({ rawBody: oversized, headers: {} }),
      PAYMENT_ERROR_CODES.invalidWebhook,
    );
  });

  it('recusa JSON inválido ou fora do formato esperado', async () => {
    const provider = createProvider();
    await rejects(
      provider.parseWebhook({ rawBody: 'não é json', headers: {} }),
      PAYMENT_ERROR_CODES.invalidWebhook,
    );
    const cases: Record<string, unknown>[] = [
      { id: 'evt-1', type: 'payment' },
      { type: 'payment', data: { id: 'pay-1' } },
      { id: 'evt-1', data: { id: 'pay-1' } },
      { id: 'evt-1', type: 'payment', data: {} },
      { id: 'evt-1', type: 'payment', data: { id: '' } },
      { id: 'evt-1', type: 'merchant_order', data: { id: 'pay-1' } },
      { id: 'evt-1', type: 'subscription_preapproval_plan', data: { id: 'plan-1' } },
      { id: '', type: 'payment', data: { id: 'pay-1' } },
    ];
    for (const body of cases) {
      await rejects(provider.parseWebhook(signedWebhook(body)), PAYMENT_ERROR_CODES.invalidWebhook);
    }
  });
});
