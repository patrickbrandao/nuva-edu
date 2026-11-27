import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { CLASSROOM_URL, ROOT_DIR } from './env.ts';
import { adminCall, siteApi, videoUrl } from './fase2.ts';
import { linkIn, SUBJECTS, waitForMail } from './mailpit.ts';

const run = promisify(execFile);
export const CPF_TESTE = '52998224725';
const SIMULATOR = process.env.NUVA_E2E_PAYMENT_FAKE_URL ?? 'http://127.0.0.1:8092';

export interface Product {
  id: string;
  title: string;
  slug: string;
  version: number;
}

export interface Webhook {
  headers: Record<string, string>;
  rawBody: string;
  providerPaymentId: string;
}

export interface Entitlement {
  id: string;
  product: { id: string; type: string };
  source: string;
  state: string;
  children: Entitlement[];
}

export interface Order {
  id: string;
  status: string;
  totalCents: number;
  discountCents: number;
  refundedCents: number;
  provider: string;
  items: Array<{ id: string; productId: string; paidCents: number }>;
  payments: Array<{ id: string }>;
}

export async function classroom<T = unknown>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  status: number,
  data?: unknown,
): Promise<T> {
  const response = await siteApi(page, CLASSROOM_URL, method, `/api/v1${path}`, data);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function confirmAndBill(page: Page, student: { email: string; name: string }) {
  const mail = await waitForMail(student.email, SUBJECTS.verify);
  await page.goto(linkIn(mail, '/confirmar'));
  await expect
    .poll(
      async () => {
        const session = await page.request.get(`${CLASSROOM_URL}/api/v1/session`);
        return (await session.json()).user?.emailVerified;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await classroom(page, 'PUT', '/me/billing', 200, {
    fullName: student.name,
    taxIdType: 'cpf',
    taxId: CPF_TESTE,
  });
}

export async function paidCourse(admin: Page, tag: string) {
  const course = await adminCall<Product>(admin, 'POST', '/api/v1/courses', {
    title: `Curso de vendas ${tag}`,
    accessMode: 'paid',
    priceCents: 5_000,
  });
  const module = await adminCall<{ id: string }>(
    admin,
    'POST',
    `/api/v1/courses/${course.id}/modules`,
    { title: 'Aula do roteiro de vendas' },
  );
  const lesson = await adminCall<Product>(admin, 'POST', `/api/v1/modules/${module.id}/lessons`, {
    title: 'Primeira aula',
    videoUrl: videoUrl(tag),
  });
  await adminCall(admin, 'PATCH', `/api/v1/lessons/${lesson.id}`, {
    version: lesson.version,
    status: 'published',
  });
  await adminCall(admin, 'POST', `/api/v1/courses/${course.id}/publish`, undefined, 200);
  return { ...course, lessonId: lesson.id };
}

export async function paidBundle(admin: Page, tag: string) {
  const course = await paidCourse(admin, tag);
  const ebook = await adminCall<Product>(admin, 'POST', '/api/v1/ebooks', {
    title: `Ebook de vendas ${tag}`,
    accessMode: 'paid',
    priceCents: 1_000,
    fileUrl: `https://example.test/${tag}.pdf`,
  });
  await adminCall(admin, 'POST', `/api/v1/ebooks/${ebook.id}/publish`, undefined, 200);
  const bundle = await adminCall<Product>(admin, 'POST', '/api/v1/bundles', {
    title: `Pacote de vendas ${tag}`,
    accessMode: 'paid',
    priceCents: 6_000,
  });
  await adminCall(admin, 'PUT', `/api/v1/bundles/${bundle.id}/items`, {
    items: [
      { productType: 'course', productId: course.id },
      { productType: 'ebook', productId: ebook.id },
    ],
  });
  await adminCall(admin, 'POST', `/api/v1/bundles/${bundle.id}/publish`, undefined, 200);
  return { course, ebook, bundle };
}

export async function startOrder(
  page: Page,
  productType: string,
  productId: string,
  coupon?: string,
) {
  await classroom(page, 'POST', '/cart/items', 201, { productType, productId });
  if (coupon) await classroom(page, 'PUT', '/cart/coupon', 200, { code: coupon });
  const session = await page.request.get(`${CLASSROOM_URL}/api/v1/session`);
  const { csrfToken } = await session.json();
  return async (key: string) => {
    const response = await page.request.post(`${CLASSROOM_URL}/api/v1/orders`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': key },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { order: Order; checkoutUrl: string | null };
  };
}

export async function simulate(
  request: APIRequestContext,
  action:
    | 'approveOrder'
    | 'approveLateOrder'
    | 'authorizeSubscription'
    | 'renewSubscription'
    | 'refundPayment'
    | 'paymentWebhook',
  ...args: unknown[]
): Promise<Webhook> {
  const response = await request.post(`${SIMULATOR}/simulate/${action}`, { data: args });
  expect(response.status(), `simulador: ${action}`).toBe(200);
  return (await response.json()) as Webhook;
}

export function sendWebhook(request: APIRequestContext, notice: Webhook) {
  return request.post(`${CLASSROOM_URL}/api/v1/webhooks/mercadopago`, {
    headers: { ...notice.headers, 'Content-Type': 'application/json' },
    data: notice.rawBody,
  });
}

export async function orderStatus(page: Page, id: string, status: string) {
  await expect
    .poll(async () => (await classroom<Order>(page, 'GET', `/orders/${id}`, 200)).status, {
      timeout: 20_000,
      intervals: [350, 750, 1_500],
    })
    .toBe(status);
}

// Adianta só datas das fixtures. O worker real é quem consome a tarefa e muda o estado.
const RUN_TEST_CLOCK = `
import { createDatabase, enqueue, loadConfig } from '@nuva-edu/core';
const [action, id] = JSON.parse(process.argv[1]);
const config = loadConfig();
const db = createDatabase({ connectionString: config.databaseUrl });
try {
  const now = new Date();
  if (action === 'reconcile_order') {
    await db.updateTable('orders').set({ createdAt: new Date(now.getTime() - 180000) })
      .where('id', '=', id).where('status', '=', 'pending').execute();
  } else if (action === 'expire_order') {
    await db.updateTable('orders').set({
      createdAt: new Date(now.getTime() - 32 * 60000),
      expiresAt: new Date(now.getTime() - 60000),
    }).where('id', '=', id).where('status', '=', 'pending').execute();
  } else if (action === 'purge_webhook') {
    const cutoff = new Date(now.getTime() - (config.retention.webhookDays + 1) * 86400000);
    const { provider, resourceType, resourceId, error } = await db.selectFrom('webhookEvents')
      .select(['provider', 'resourceType', 'resourceId', 'error'])
      .where('id', '=', id).where('status', '=', 'rejected').executeTakeFirstOrThrow();
    const old = await db.insertInto('webhookEvents').values({
      provider, resourceType, resourceId, error, status: 'rejected', receivedAt: cutoff,
    }).returning('id').executeTakeFirstOrThrow();
    console.log(old.id);
  } else if (action === 'webhook_exists') {
    const row = await db.selectFrom('webhookEvents').select('id').where('id', '=', id).executeTakeFirst();
    console.log(row === undefined ? 'absent' : 'present');
  } else if (action === 'expire_grace' || action === 'end_canceled_period') {
    const expired = new Date(now.getTime() - 60000);
    const started = new Date(expired.getTime() - 60000);
    const grace = action === 'expire_grace';
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('subscriptions')
        .set(grace ? { graceUntil: expired } : { currentPeriodStart: started, currentPeriodEnd: expired })
        .where('id', '=', id).where('status', '=', grace ? 'past_due' : 'canceling').execute();
      await trx.updateTable('entitlements')
        .set({ startsAt: started, expiresAt: expired })
        .where('source', '=', 'subscription').where('sourceId', '=', id).execute();
    });
  } else {
    throw new Error('Ação de relógio desconhecida');
  }
  if (action !== 'webhook_exists') {
    await enqueue(db, action === 'purge_webhook' ? 'retention.purge' : 'payment.reconcile_orders', {});
  }
} finally {
  await db.destroy();
}
`;

export async function reconcileFixture(
  action:
    | 'reconcile_order'
    | 'expire_order'
    | 'expire_grace'
    | 'end_canceled_period'
    | 'purge_webhook'
    | 'webhook_exists',
  id: string,
) {
  const { stdout } = await run(
    process.execPath,
    [
      'scripts/dev.mjs',
      'compose',
      'exec',
      '-T',
      'worker',
      'node',
      '--input-type=module',
      '-e',
      RUN_TEST_CLOCK,
      JSON.stringify([action, id]),
    ],
    { cwd: ROOT_DIR, timeout: 20_000 },
  );
  return stdout.trim();
}

export async function serviceLogs(since: Date): Promise<string> {
  const { stdout, stderr } = await run(
    process.execPath,
    [
      'scripts/dev.mjs',
      'compose',
      'logs',
      '--no-color',
      '--since',
      since.toISOString(),
      'classroom-api',
      'admin-api',
      'worker',
    ],
    { cwd: ROOT_DIR, timeout: 20_000 },
  );
  return stdout + stderr;
}
