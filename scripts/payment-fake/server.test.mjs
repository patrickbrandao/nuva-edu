import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { FakePaymentProvider } from '../../packages/core/src/modules/payments/fake.ts';
import { createFakeServer } from './server.mjs';

test('controles aprovam o checkout compartilhado e geram um aviso verificável', async (t) => {
  const publicUrl = 'http://127.0.0.1:8092';
  const server = createFakeServer({ publicUrl });
  server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, args) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  const orderId = randomUUID();
  const returnUrl = 'http://classroom.localhost:8080/conta/compras';
  const checkout = await post('/rpc/createCheckout', [
    {
      items: [{ id: randomUUID(), title: 'Curso pago', quantity: 1, unitAmountCents: 500 }],
      totalCents: 500,
      currency: 'BRL',
      buyer: { name: 'Aluna', email: 'ana@example.test' },
      returnUrls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
      externalReference: `order:${orderId}`,
    },
  ]);
  assert.equal(checkout.status, 200);
  const { checkoutUrl } = await checkout.json();
  assert.equal(new URL(checkoutUrl).origin, publicUrl);

  const approved = await post('/simulate/approveOrder', [orderId, { method: 'pix' }]);
  assert.equal(approved.status, 200);
  const webhook = await approved.json();
  const parsed = await new FakePaymentProvider({ now: Date.now() }).parseWebhook(webhook);
  assert.equal(parsed.resourceId, webhook.providerPaymentId);
  const payment = await post('/rpc/getPayment', [parsed.resourceId]);
  assert.equal((await payment.json()).status, 'approved');
  assert.equal((await post('/rpc/setNow', [0])).status, 404);
});
