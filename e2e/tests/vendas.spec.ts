import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN_URL, CLASSROOM_URL, USES_LOCAL_COMPOSE } from '../support/env.ts';
import {
  adminCall,
  adminPage,
  createStaff,
  runTag,
  staffPage,
  studentPage,
} from '../support/fase2.ts';
import {
  CPF_TESTE,
  classroom,
  confirmAndBill,
  type Entitlement,
  type Order,
  orderStatus,
  type Product,
  paidBundle,
  paidCourse,
  reconcileFixture,
  sendWebhook,
  serviceLogs,
  simulate,
  startOrder,
} from '../support/vendas.ts';

test.skip(!USES_LOCAL_COMPOSE, 'O fluxo de vendas usa o simulador no Compose local.');
test.setTimeout(120_000);

test('compra pacote, confere webhook e cascata, exporta CSV e estorna sem perder concessão manual', async ({
  browser,
  request,
}) => {
  const started = new Date();
  const tag = runTag();
  const admin = await adminPage(browser);
  const { bundle, course, ebook } = await paidBundle(admin, tag);
  const coupon = `VENDA${tag.toUpperCase()}`;
  await adminCall(admin, 'POST', '/api/v1/coupons', {
    code: coupon,
    kind: 'percent',
    percentOff: 10,
  });
  const { student, page } = await studentPage(browser, `vendas-${tag}`);
  await confirmAndBill(page, student);
  const user = (await classroom<{ user: { id: string } }>(page, 'GET', '/session', 200)).user;
  const entitlements = () =>
    adminCall<{ items: Entitlement[] }>(admin, 'GET', `/api/v1/users/${user.id}/entitlements`);

  const submit = await startOrder(page, 'bundle', bundle.id, coupon);
  const key = randomUUID();
  const first = await submit(key);
  expect(await submit(key)).toEqual(first);
  expect(first.order).toMatchObject({ status: 'pending', totalCents: 5_400, discountCents: 600 });
  expect(first.checkoutUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/fake_checkout_/);

  const freshBundle = await adminCall<Product>(admin, 'GET', `/api/v1/bundles/${bundle.id}`);
  await adminCall(admin, 'PATCH', `/api/v1/bundles/${bundle.id}`, {
    version: freshBundle.version,
    priceCents: 7_000,
  });

  const valid = await simulate(request, 'approveOrder', first.order.id);
  const invalid = {
    ...valid,
    headers: { ...valid.headers, 'x-signature': 'ts=0,v1=invalid' },
  };
  const denied = await sendWebhook(request, invalid);
  expect(denied.status()).toBe(401);
  const missing = { ...valid, headers: { 'x-request-id': 'vendas-sem-assinatura' } };
  expect((await sendWebhook(request, missing)).status()).toBe(401);
  const id = JSON.parse(valid.rawBody).id;
  const trail = await adminCall<{
    items: Array<{ id: string; eventId: string; error: string; attempts: number }>;
  }>(admin, 'GET', '/api/v1/webhook-events?status=rejected');
  const rejected = trail.items.find((entry) => entry.eventId === id);
  expect(rejected).toMatchObject({ error: 'invalid_signature', attempts: 0 });
  if (!rejected) throw new Error('O aviso recusado não aparece na trilha.');
  expect(rejected).not.toHaveProperty('rawBody');
  expect(rejected).not.toHaveProperty('headers');
  await adminCall(admin, 'POST', `/api/v1/webhook-events/${rejected.id}/retry`, undefined, 409);
  expect((await classroom<Order>(page, 'GET', `/orders/${first.order.id}`, 200)).status).toBe(
    'pending',
  );

  for (let count = 0; count < 5; count += 1) {
    expect((await sendWebhook(request, valid)).status()).toBe(200);
  }
  await orderStatus(page, first.order.id, 'paid');
  const order = await adminCall<Order>(admin, 'GET', `/api/v1/orders/${first.order.id}`);
  expect(order.totalCents).toBe(5_400);
  expect(order.payments).toHaveLength(1);
  const { items } = await entitlements();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ source: 'order', state: 'active' });
  expect(items[0]?.children).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        product: expect.objectContaining({ id: course.id }),
        state: 'active',
      }),
      expect.objectContaining({
        product: expect.objectContaining({ id: ebook.id }),
        state: 'active',
      }),
    ]),
  );

  await page.goto(`${CLASSROOM_URL}/pedidos/${first.order.id}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  const confirmation = page
    .getByRole('region', { name: 'Estado do pagamento' })
    .getByRole('status');
  await expect(confirmation).toContainText('Pagamento confirmado');
  await expect(page.getByRole('definition').filter({ hasText: /^R\$\s*54,00$/ })).toBeVisible();
  const purchases = page.getByRole('main').getByRole('link', { name: 'Ver meus pedidos' });
  await purchases.focus();
  await expect(purchases).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Minhas compras' }),
  ).toBeVisible();

  const csvPath = `/api/v1/orders/export.csv?q=${encodeURIComponent(student.email)}`;
  const csv = await admin.request.get(`${ADMIN_URL}${csvPath}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const bytes = await csv.body();
  expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(bytes.toString()).toContain('54,00');
  expect(bytes.toString()).toContain(CPF_TESTE);
  const manager = await createStaff(admin, 'manager', `Gerente de vendas ${tag}`);
  const staff = await staffPage(browser, manager);
  const unauthorized = await staff.request.get(`${ADMIN_URL}${csvPath}`);
  expect(unauthorized.status()).toBe(403);
  const audit = await adminCall<{ items: unknown[] }>(
    admin,
    'GET',
    '/api/v1/audit?action=sales.export',
  );
  expect(audit.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ action: 'sales.export', outcome: 'denied' }),
    ]),
  );

  await adminCall(admin, 'POST', `/api/v1/users/${user.id}/entitlements`, {
    productType: 'course',
    productId: course.id,
    reason: 'Acesso adicional de teste',
  });
  const item = order.items[0];
  expect(item).toBeDefined();
  await adminCall(
    admin,
    'POST',
    `/api/v1/orders/${first.order.id}/refunds`,
    {
      reason: 'Ajuste parcial',
      items: [{ orderItemId: item?.id, amountCents: 400 }],
    },
    202,
  );
  await orderStatus(page, first.order.id, 'partially_refunded');
  await adminCall(
    admin,
    'POST',
    `/api/v1/orders/${first.order.id}/refunds`,
    {
      reason: 'Estorno do saldo',
    },
    202,
  );
  await orderStatus(page, first.order.id, 'refunded');
  const after = (await entitlements()).items;
  expect(after).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'order', state: 'revoked' }),
      expect.objectContaining({ source: 'grant', state: 'active' }),
    ]),
  );
  const logs = await serviceLogs(started);
  expect(logs).not.toContain(CPF_TESTE);
  expect(logs).not.toContain(valid.rawBody);
  expect(logs).not.toContain(valid.headers['x-signature']);
  const oldId = await reconcileFixture('purge_webhook', rejected.id);
  expect(oldId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(() => reconcileFixture('webhook_exists', oldId), { timeout: 20_000 })
    .toBe('absent');
  expect(await reconcileFixture('webhook_exists', rejected.id)).toBe('present');
});

test('fecha pedido de total zero e reconcilia compra sem webhook', async ({ browser, request }) => {
  const tag = runTag();
  const admin = await adminPage(browser);
  const courses = await Promise.all([paidCourse(admin, tag), paidCourse(admin, `${tag}-rec`)]);
  const [free, paid] = courses;
  const coupon = `ZERO${tag.toUpperCase()}`;
  await adminCall(admin, 'POST', '/api/v1/coupons', {
    code: coupon,
    kind: 'percent',
    percentOff: 100,
  });
  const { student, page } = await studentPage(browser, `zero-${tag}`);
  await confirmAndBill(page, student);

  const zeroCheckout = await (await startOrder(page, 'course', free.id, coupon))(randomUUID());
  expect(zeroCheckout).toMatchObject({
    order: { totalCents: 0, status: 'paid', provider: 'none' },
    checkoutUrl: null,
  });

  const freeOrder = await adminCall<Order>(admin, 'GET', `/api/v1/orders/${zeroCheckout.order.id}`);
  expect(freeOrder.payments).toEqual([]);

  const checkout = await (await startOrder(page, 'course', paid.id))(randomUUID());
  await simulate(request, 'approveOrder', checkout.order.id);
  await reconcileFixture('reconcile_order', checkout.order.id);
  await orderStatus(page, checkout.order.id, 'paid');
});

test('renova uma assinatura, preserva carência e suspende o acesso ao vencer', async ({
  browser,
  request,
}) => {
  const tag = runTag();
  const admin = await adminPage(browser);
  const course = await paidCourse(admin, `${tag}-assinatura`);
  const plan = await adminCall<Product>(admin, 'POST', '/api/v1/plans', {
    title: `Plano de vendas ${tag}`,
    groupKey: `vendas-${tag}`,
    interval: 'month',
    priceCents: 3_000,
    items: [{ productType: 'course', productId: course.id }],
  });
  const { student, page } = await studentPage(browser, `assinatura-${tag}`);
  await confirmAndBill(page, student);
  const checkout = await classroom<{ subscription: { id: string }; checkoutUrl: string }>(
    page,
    'POST',
    '/subscriptions',
    201,
    { planId: plan.id },
  );
  const id = checkout.subscription.id;
  const providerId = new URL(checkout.checkoutUrl).pathname.split('/').at(-1);
  const read = () =>
    classroom<{ status: string; currentPeriodEnd: string; graceUntil: string | null }>(
      page,
      'GET',
      `/me/subscriptions/${id}`,
      200,
    );
  const wait = (status: string) =>
    expect.poll(async () => (await read()).status, { timeout: 20_000 }).toBe(status);

  expect(
    (
      await sendWebhook(request, await simulate(request, 'authorizeSubscription', providerId))
    ).status(),
  ).toBe(200);
  await wait('active');
  const firstPeriod = Date.parse((await read()).currentPeriodEnd);
  const renewed = await simulate(request, 'renewSubscription', providerId, { outcome: 'approved' });
  expect((await sendWebhook(request, renewed)).status()).toBe(200);
  await expect
    .poll(async () => Date.parse((await read()).currentPeriodEnd))
    .toBeGreaterThan(firstPeriod);
  const refused = await simulate(request, 'renewSubscription', providerId, { outcome: 'rejected' });
  expect((await sendWebhook(request, refused)).status()).toBe(200);
  await wait('past_due');
  expect((await read()).graceUntil).not.toBeNull();
  await classroom(page, 'GET', `/lessons/${course.lessonId}`, 200);
  await reconcileFixture('expire_grace', id);
  await wait('suspended');
  await classroom(page, 'GET', `/lessons/${course.lessonId}`, 403);
  await classroom(page, 'POST', `/me/subscriptions/${id}/cancel`, 409);

  const secondStudent = await studentPage(browser, `cancelamento-${tag}`);
  await confirmAndBill(secondStudent.page, secondStudent.student);
  const join = () =>
    classroom<{ subscription: { id: string }; checkoutUrl: string }>(
      secondStudent.page,
      'POST',
      '/subscriptions',
      201,
      { planId: plan.id },
    );
  const cancel = (id: string) =>
    classroom<{ status: string }>(
      secondStudent.page,
      'POST',
      `/me/subscriptions/${id}/cancel`,
      200,
    );
  const pending = await join();
  expect(await cancel(pending.subscription.id)).toMatchObject({ status: 'expired' });
  const next = await join();
  const nextProviderId = new URL(next.checkoutUrl).pathname.split('/').at(-1);
  expect(
    (
      await sendWebhook(request, await simulate(request, 'authorizeSubscription', nextProviderId))
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await classroom<{ status: string }>(
            secondStudent.page,
            'GET',
            `/me/subscriptions/${next.subscription.id}`,
            200,
          )
        ).status,
    )
    .toBe('active');
  expect(await cancel(next.subscription.id)).toMatchObject({ status: 'canceling' });
  await classroom(secondStudent.page, 'GET', `/lessons/${course.lessonId}`, 200);
});

test('expira pedido, libera pagamento tardio e aplica avisos fora de ordem', async ({
  browser,
  request,
}) => {
  const tag = runTag();
  const admin = await adminPage(browser);
  const course = await paidCourse(admin, `${tag}-expira`);
  const { student, page } = await studentPage(browser, `expira-${tag}`);
  await confirmAndBill(page, student);

  const expired = await (await startOrder(page, 'course', course.id))(randomUUID());
  await reconcileFixture('expire_order', expired.order.id);
  await orderStatus(page, expired.order.id, 'expired');
  await classroom(page, 'GET', `/lessons/${course.lessonId}`, 403);

  const late = await simulate(request, 'approveLateOrder', expired.order.id, { method: 'pix' });
  expect((await sendWebhook(request, late)).status()).toBe(200);
  await orderStatus(page, expired.order.id, 'paid');
  await classroom(page, 'GET', `/lessons/${course.lessonId}`, 200);
  const lateAudit = await adminCall<{ items: unknown[] }>(
    admin,
    'GET',
    `/api/v1/audit?action=order.paid_late&targetType=order&targetId=${expired.order.id}`,
  );
  expect(lateAudit.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ action: 'order.paid_late', targetId: expired.order.id }),
    ]),
  );

  const refundedCourse = await paidCourse(admin, `${tag}-fora-de-ordem`);
  const second = await (await startOrder(page, 'course', refundedCourse.id))(randomUUID());
  const approval = await simulate(request, 'approveOrder', second.order.id);
  const refund = await simulate(request, 'refundPayment', approval.providerPaymentId);
  expect((await sendWebhook(request, refund)).status()).toBe(200);
  await orderStatus(page, second.order.id, 'refunded');
  expect((await sendWebhook(request, approval)).status()).toBe(200);
  await orderStatus(page, second.order.id, 'refunded');
  await classroom(page, 'GET', `/lessons/${refundedCourse.lessonId}`, 403);
});
