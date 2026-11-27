import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { isDomainError } from '../../packages/core/src/errors/domain-error.ts';
import { FakePaymentProvider } from '../../packages/core/src/modules/payments/fake.ts';
import { orderExternalReference } from '../../packages/core/src/modules/payments/references.ts';

const BODY_LIMIT = 256 * 1024;
const PROVIDER_METHODS = [
  'createCheckout',
  'getPayment',
  'findPaymentsByReference',
  'cancelCheckout',
  'ensurePlan',
  'createSubscription',
  'getSubscription',
  'cancelSubscription',
  'refund',
  'getRefundStatus',
];

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readArguments(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) return null;
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return Array.isArray(input) ? input : null;
  } catch {
    return null;
  }
}

export function createFakeServer({ publicUrl, currency = 'BRL' }) {
  const fake = new FakePaymentProvider({
    checkoutBaseUrl: publicUrl,
    currency,
    instanceId: randomUUID().replaceAll('-', ''),
  });
  async function delivery(payment, options) {
    return {
      providerPaymentId: payment.providerPaymentId,
      ...fake.paymentWebhook(payment.providerPaymentId, options),
    };
  }

  const simulate = {
    async approveOrder(orderId, options) {
      const [pending] = await fake.findPaymentsByReference(orderExternalReference(orderId));
      if (!pending) return null;
      return delivery(fake.approvePayment(pending.providerPaymentId, options));
    },
    async approveLateOrder(orderId, options) {
      const payments = await fake.findPaymentsByReference(orderExternalReference(orderId));
      const canceled = payments.find((payment) => payment.status === 'canceled');
      if (!canceled) return null;
      return delivery(fake.approveLatePayment(canceled.providerPaymentId, options));
    },
    authorizeSubscription: (id, options) => delivery(fake.authorizeSubscription(id, options)),
    renewSubscription: (id, options) => delivery(fake.renewSubscription(id, options)),
    async paymentWebhook(id, options) {
      const payment = await fake.getPayment(id);
      return delivery(payment, options);
    },
    async refundPayment(id, cents = null) {
      await fake.refund(id, cents);
      return delivery(await fake.getPayment(id));
    },
  };

  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && path === '/healthz') {
      return send(response, 200, { status: 'ok' });
    }
    // O navegador pode seguir o link retornado no checkout. A aprovação usa o controle local.
    if (
      request.method === 'GET' &&
      /^\/(subscriptions\/)?fake_(checkout|subscription)_(?:[a-z0-9]{1,48}_)?\d+$/.test(path)
    ) {
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return response.end('Checkout de teste. Use o simulador local para confirmar o pagamento.');
    }

    const match = /^\/(rpc|simulate)\/([A-Za-z]+)$/.exec(path);
    const [, group, method] = match ?? [];
    const handler =
      group === 'rpc' && PROVIDER_METHODS.includes(method)
        ? fake[method].bind(fake)
        : group === 'simulate' && Object.hasOwn(simulate, method)
          ? simulate[method]
          : undefined;
    if (request.method !== 'POST' || handler === undefined) {
      return send(response, 404, { code: 'not_found' });
    }

    try {
      const args = await readArguments(request);
      if (args === null) return send(response, 400, { code: 'validation_failed' });
      fake.setNow(Date.now());
      const result = await handler(...args);
      return result === null
        ? send(response, 404, { code: 'not_found' })
        : send(response, 200, result);
    } catch (error) {
      return isDomainError(error)
        ? send(response, error.status, { code: error.code })
        : send(response, 500, { code: 'internal_error' });
    }
  });
}

if (import.meta.main) {
  if (process.env.NUVA_ENV === 'production') {
    throw new Error('O simulador de pagamentos é restrito a desenvolvimento e teste.');
  }
  const server = createFakeServer({
    publicUrl: process.env.PAYMENT_FAKE_PUBLIC_URL || 'http://127.0.0.1:8092',
    currency: process.env.NUVA_CURRENCY || 'BRL',
  });
  server.listen(8092, '0.0.0.0');
}
