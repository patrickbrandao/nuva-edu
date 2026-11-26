import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  DomainError,
  invalidWebhookSignature,
  isDomainError,
  PAYMENT_ERROR_CODES,
  type PaymentProvider,
  type PaymentWebhookHeaders,
  PaymentWebhookSignatureError,
  receivePaymentWebhook,
  WEBHOOK_INVALID_SIGNATURE,
} from '@nuva-edu/core';
import type { PaymentRouteContext } from './context.ts';

/** Limite de 64 KB do corpo bruto do webhook (spec 013, "Webhook"). */
export const WEBHOOK_MAX_BYTES = 64 * 1024;

const WEBHOOK_OPERATION_ID = 'receiveMercadoPagoWebhook';

const rawBodies = new WeakMap<FastifyRequest, Buffer>();

function webhookTooLarge(): DomainError {
  return new DomainError({
    code: 'payload_too_large',
    status: 413,
    title: 'Corpo grande demais',
    detail: 'O corpo do aviso de pagamento passa do limite de 64 KB.',
  });
}

function singleHeaderValue(headers: PaymentWebhookHeaders, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  if (Array.isArray(entry)) {
    return entry.length === 1 && typeof entry[0] === 'string' && entry[0].trim() !== ''
      ? entry[0]
      : null;
  }
  return typeof entry === 'string' && entry.trim() !== '' ? entry : null;
}

/**
 * Confere o envelope de assinatura (`x-request-id` e `x-signature` com `ts` e `v1` hexadecimal)
 * antes do formato do aviso: requisição sem assinatura ou com cabeçalho malformado responde `401`
 * e grava `rejected` com identificadores nulos quando ausentes (spec 013, "Webhook").
 */
function hasSignatureEnvelope(headers: PaymentWebhookHeaders): boolean {
  const requestId = singleHeaderValue(headers, 'x-request-id');
  const signature = singleHeaderValue(headers, 'x-signature');
  if (requestId === null || signature === null) {
    return false;
  }
  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of signature.split(',')) {
    const [rawKey, rawValue] = part.trim().split('=', 2);
    if (rawKey === 'ts' && rawValue) ts = rawValue;
    if (rawKey === 'v1' && rawValue) v1 = rawValue;
  }
  return ts !== null && /^\d+$/.test(ts) && v1 !== null && /^[a-f0-9]{64}$/i.test(v1);
}

function guardSignatureHeaders(provider: PaymentProvider): PaymentProvider {
  return {
    get name() {
      return provider.name;
    },
    createCheckout: (input) => provider.createCheckout(input),
    getPayment: (id) => provider.getPayment(id),
    findPaymentsByReference: (reference) => provider.findPaymentsByReference(reference),
    cancelCheckout: (id) => provider.cancelCheckout(id),
    ensurePlan: (input) => provider.ensurePlan(input),
    createSubscription: (input) => provider.createSubscription(input),
    getSubscription: (id) => provider.getSubscription(id),
    cancelSubscription: (id) => provider.cancelSubscription(id),
    refund: (id, amountCents) => provider.refund(id, amountCents),
    getRefundStatus: (paymentId, refundId) => provider.getRefundStatus(paymentId, refundId),
    async parseWebhook(input) {
      if (!hasSignatureEnvelope(input.headers)) {
        throw invalidWebhookSignature();
      }
      return provider.parseWebhook(input);
    },
  };
}

/**
 * Recepção do webhook de pagamento (`POST /api/v1/webhooks/mercadopago`, spec 013 e spec 033).
 * Valida a assinatura sobre os bytes brutos exatos (até 64 KB), persiste em `webhook_events` de
 * forma idempotente e enfileira `payment.webhook`, sem consultar o provedor nem processar o
 * pagamento na resposta HTTP. Nenhum corpo, cabeçalho, assinatura ou segredo vai para o log.
 */
export function registerWebhookRoutes(app: FastifyInstance, ctx: PaymentRouteContext): void {
  const { db } = ctx;

  const webhooksTotal = app.metrics.counter({
    name: 'webhooks_total',
    help: 'Webhooks de pagamento recebidos, por provedor e desfecho.',
  });

  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.operation?.operationId !== WEBHOOK_OPERATION_ID) {
      return payload;
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > WEBHOOK_MAX_BYTES) {
      throw webhookTooLarge();
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      received += buffer.length;
      if (received > WEBHOOK_MAX_BYTES) {
        throw webhookTooLarge();
      }
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks);
    rawBodies.set(request, raw);
    return Readable.from(raw);
  });

  app.operation(
    WEBHOOK_OPERATION_ID,
    async (request, reply) => {
      const provider = ctx.paymentProvider();
      const rawBody = rawBodies.get(request) ?? Buffer.alloc(0);
      try {
        const result = await receivePaymentWebhook(db, {
          provider: guardSignatureHeaders(provider),
          headers: {
            'x-signature': request.headers['x-signature'],
            'x-request-id': request.headers['x-request-id'],
          },
          rawBody,
        });
        webhooksTotal.inc({
          provider: provider.name,
          outcome: result.created ? 'accepted' : 'duplicate',
        });
        reply.status(200);
        return undefined;
      } catch (error) {
        if (error instanceof PaymentWebhookSignatureError) {
          webhooksTotal.inc({ provider: provider.name, outcome: 'rejected' });
          request.log.warn(
            { provider: provider.name, reason: WEBHOOK_INVALID_SIGNATURE },
            'Webhook de pagamento recusado por assinatura inválida',
          );
        } else if (isDomainError(error) && error.code === PAYMENT_ERROR_CODES.invalidWebhook) {
          webhooksTotal.inc({ provider: provider.name, outcome: 'invalid' });
        }
        throw error;
      }
    },
    { bodyLimit: WEBHOOK_MAX_BYTES, noStore: true },
  );
}
