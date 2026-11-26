import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
import type {
  ParsePaymentWebhookInput,
  PaymentWebhookHeaders,
} from '../../../src/modules/payments/types.ts';

export const ACCESS_TOKEN = 'TEST-ACCESS-TOKEN-NAO-VAZAR';
export const WEBHOOK_SECRET = 'SEGREDO-WEBHOOK-NAO-VAZAR';
export const NOTIFICATION_URL = 'https://classroom.example/api/v1/webhooks/mercadopago';
export const ORDER_ID = '2a4feec4-9f5c-4b30-94ad-91a9f26e5011';
export const SUBSCRIPTION_ID = 'c13a5d12-0c65-41ec-a53e-bb9cbdbb5012';
export const NOW_MS = Date.parse('2026-03-01T12:00:00.000Z');

export interface FetchCall {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | null | undefined;
}

export function installFetch(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>,
): { calls: FetchCall[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const call: FetchCall = {
        url,
        path: new URL(url).pathname,
        method: init?.method ?? 'GET',
        headers: normalizeHeaders(init?.headers),
        body: typeof init?.body === 'string' ? init.body : undefined,
        signal: init?.signal,
      };
      calls.push(call);
      return handler(call, calls.length - 1);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function callBody(call: FetchCall): Record<string, unknown> {
  if (call.body === undefined) {
    throw new Error(`A chamada ${call.method} ${call.path} não tem corpo.`);
  }
  return JSON.parse(call.body) as Record<string, unknown>;
}

export function checkoutInput() {
  return {
    items: [
      { id: 'curso', title: 'Curso', quantity: 1, unitAmountCents: 7_000 },
      { id: 'ebook', title: 'Ebook', quantity: 2, unitAmountCents: 1_500 },
    ],
    totalCents: 10_000,
    currency: 'BRL',
    buyer: {
      name: 'Aluna Teste',
      email: 'aluna@example.com',
      taxId: '123.456.789-09',
    },
    returnUrls: {
      success: 'https://classroom.example/pedidos/sucesso',
      pending: 'https://classroom.example/pedidos/pendente',
      failure: 'https://classroom.example/pedidos/falha',
    },
    externalReference: `order:${ORDER_ID}` as const,
  };
}

export function paymentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pay-1',
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: 100,
    transaction_amount_refunded: 0,
    currency_id: 'BRL',
    payment_type_id: 'credit_card',
    payment_method_id: 'visa',
    external_reference: `order:${ORDER_ID}`,
    date_approved: '2026-03-01T12:00:00.000Z',
    ...overrides,
  };
}

export function planFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'plan-1',
    reason: 'Plano completo',
    status: 'active',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: 50,
      currency_id: 'BRL',
    },
    ...overrides,
  };
}

export function subscriptionFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'sub-1',
    preapproval_plan_id: 'plan-1',
    status: 'authorized',
    external_reference: `subscription:${SUBSCRIPTION_ID}`,
    next_payment_date: '2026-04-01T12:00:00.000Z',
    summarized: { last_charged_date: '2026-03-01T12:00:00.000Z' },
    ...overrides,
  };
}

export function preferenceFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'pref-1',
    init_point: 'https://mercadopago.example/checkout/pref-1',
    sandbox_init_point: 'https://sandbox.mercadopago.example/checkout/pref-1',
    items: [{ id: 'curso', title: 'Curso', quantity: 1, unit_price: 100, currency_id: 'BRL' }],
    expires: false,
    ...overrides,
  };
}

export function hmac(secret: string, manifest: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

export function webhookManifest(dataId: string | undefined, requestId: string, ts: string): string {
  const parts: string[] = [];
  if (dataId !== undefined && dataId !== '') {
    parts.push(`id:${dataId}`);
  }
  parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return `${parts.join(';')};`;
}

export interface WebhookFixtureOptions {
  timestampSeconds?: number;
  requestId?: string;
  secret?: string;
  signature?: string;
  rawBody?: string;
  headers?: PaymentWebhookHeaders;
}

export function signedWebhook(
  body: Record<string, unknown>,
  options: WebhookFixtureOptions = {},
): ParsePaymentWebhookInput {
  const timestamp = String(options.timestampSeconds ?? Math.floor(NOW_MS / 1_000));
  const requestId = options.requestId ?? 'req-1';
  const secret = options.secret ?? WEBHOOK_SECRET;
  const data = body.data;
  const dataId =
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    (typeof data.id === 'string' || typeof data.id === 'number')
      ? String(data.id)
      : undefined;
  const signature =
    options.signature ?? hmac(secret, webhookManifest(dataId, requestId, timestamp));
  return {
    headers: options.headers ?? {
      'x-signature': `ts=${timestamp},v1=${signature}`,
      'x-request-id': requestId,
    },
    rawBody: options.rawBody ?? JSON.stringify(body),
  };
}

export function paymentWebhookBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 12345,
    live_mode: false,
    type: 'payment',
    action: 'payment.created',
    data: { id: 'pay-1' },
    ...overrides,
  };
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (headers === undefined || headers === null) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers as Array<[string, string]>);
  }
  if (typeof headers === 'object') {
    return Object.fromEntries(
      Object.entries(headers as Record<string, unknown>).map(([key, value]) => [
        key.toLowerCase(),
        String(value),
      ]),
    );
  }
  return {};
}
