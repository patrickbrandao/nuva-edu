import type { AdminSchemas } from '@nuva-edu/api-client/admin';

export const WEBHOOK_ID = '0193a5b2-0000-7000-8000-0000000000e1';

/** Estado da integração de pagamento, como `GET /settings/payments` devolve. */
export function paymentSettings(
  overrides: Partial<AdminSchemas['PaymentSettings']> = {},
): AdminSchemas['PaymentSettings'] {
  return {
    provider: 'mercadopago',
    testMode: false,
    productionWarning: false,
    lastReconciliationAt: '2026-11-24T12:00:00Z',
    ...overrides,
  };
}

/** Um aviso de webhook, como `GET /webhook-events` devolve. */
export function webhookEvent(
  overrides: Partial<AdminSchemas['WebhookEvent']> = {},
): AdminSchemas['WebhookEvent'] {
  return {
    id: WEBHOOK_ID,
    provider: 'mercadopago',
    eventId: 'evt-1',
    resourceType: 'payment',
    resourceId: 'mp-123',
    status: 'failed',
    attempts: 8,
    error: 'amount_mismatch',
    receivedAt: '2026-11-24T12:00:00Z',
    processedAt: null,
    ...overrides,
  };
}
