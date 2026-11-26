import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createPaymentProvider, loadConfig, orderExternalReference } from '../../src/index.ts';
import { FakePaymentProvider } from '../../src/modules/payments/fake.ts';
import type { CreateCheckoutInput } from '../../src/modules/payments/types.ts';

afterEach(() => vi.unstubAllGlobals());

it('dois clientes do fake remoto consultam o mesmo checkout e recebem datas como Date', async () => {
  const fake = new FakePaymentProvider({ currency: 'BRL' });
  const config = loadConfig({
    env: {
      DATABASE_URL: 'postgres://nuva_edu:pw@db:5432/nuva_edu',
      NUVA_ENV: 'test',
      NUVA_PAYMENT_PROVIDER: 'fake',
      NUVA_PAYMENT_FAKE_URL: 'http://payment-fake:8092',
    },
  });
  const checkoutClient = createPaymentProvider(config);
  const workerClient = createPaymentProvider(config);
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const args = JSON.parse(String(init.body));
    if (url.endsWith('/rpc/createCheckout')) {
      return Response.json(await fake.createCheckout(args[0] as CreateCheckoutInput));
    }
    if (url.endsWith('/rpc/getPayment')) {
      return Response.json(await fake.getPayment(args[0] as string));
    }
    return Response.json({ code: 'not_found' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const url = 'http://classroom.localhost:8080/conta/compras';
  const checkout = await checkoutClient.createCheckout({
    items: [{ id: randomUUID(), title: 'Curso', quantity: 1, unitAmountCents: 1_000 }],
    totalCents: 1_000,
    currency: 'BRL',
    buyer: { name: 'Pessoa de teste', email: 'aluno@escola.test' },
    returnUrls: { success: url, pending: url, failure: url },
    externalReference: orderExternalReference(randomUUID()),
  });
  const paid = fake.approveCheckout(checkout.providerCheckoutId);
  expect(await workerClient.getPayment(paid.providerPaymentId)).toEqual(paid);
  expect(fetchMock.mock.calls.map(([address]) => address)).toEqual([
    'http://payment-fake:8092/rpc/createCheckout',
    'http://payment-fake:8092/rpc/getPayment',
  ]);
});
