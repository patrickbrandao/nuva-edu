import { randomUUID } from 'node:crypto';
import {
  addCartItem,
  applyOrderPayment,
  createAccount,
  createOrder,
  type Database,
  type FakePaymentProvider,
  type PaymentMethod,
  saveMyBilling,
  setCartCoupon,
  type TaxIdType,
} from '@nuva-edu/core';
import { type Actor, callAs } from '../actors.ts';
import { type TestApp, uniqueEmail } from '../helpers.ts';

// Peças dos testes de vendas e pagamentos da admin-api (specs 011 e 013). Cursos, ebooks, pacotes
// e cupons nascem pelas rotas administrativas; os pedidos nascem pelo fechamento da cesta do
// núcleo (`createOrder`), como o classroom-api faz, com o `FakePaymentProvider`.

export const CURRENCY = 'BRL';
export const SAMPLE_CPF = '52998224725';
export const SAMPLE_CNPJ = '11222333000181';

export const RETURN_URLS = {
  success: 'https://classroom.example/pedidos/sucesso',
  pending: 'https://classroom.example/pedidos/pendente',
  failure: 'https://classroom.example/pedidos/falha',
};

export interface Buyer {
  id: string;
  email: string;
  fullName: string;
  taxIdType: TaxIdType;
  taxId: string;
}

export async function makeBuyer(
  test: TestApp,
  options: { fullName?: string; taxIdType?: TaxIdType; taxId?: string; emailPrefix?: string } = {},
): Promise<Buyer> {
  const email = uniqueEmail(options.emailPrefix ?? 'comprador');
  const fullName = options.fullName ?? 'Maria Compradora';
  const taxIdType = options.taxIdType ?? 'cpf';
  const taxId = options.taxId ?? SAMPLE_CPF;
  const id = await test.db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: fullName,
      password: null,
      role: 'student',
      emailVerified: true,
    }),
  );
  await saveMyBilling(test.db, id, { fullName, taxIdType, taxId });
  return { id, email, fullName, taxIdType, taxId };
}

export async function createPaidCourseAs(
  test: TestApp,
  admin: Actor,
  options: { title?: string; priceCents?: number; accessDays?: number | null } = {},
): Promise<{ id: string; slug: string; title: string; priceCents: number }> {
  const suffix = randomUUID().slice(0, 8);
  const title = options.title ?? `Curso Pago ${suffix}`;
  const priceCents = options.priceCents ?? 19_990;
  const created = await callAs(test, {
    method: 'POST',
    url: '/api/v1/courses',
    as: admin,
    payload: {
      title,
      accessMode: 'paid',
      priceCents,
      ...(options.accessDays === undefined ? {} : { accessDays: options.accessDays }),
    },
  });
  if (created.statusCode !== 201) {
    throw new Error(`POST /courses respondeu ${created.statusCode}: ${created.body}`);
  }
  const course = created.json() as { id: string; slug: string; title: string; version: number };

  // Curso publicado precisa de ao menos uma aula publicada.
  const modRes = await callAs(test, {
    method: 'POST',
    url: `/api/v1/courses/${course.id}/modules`,
    as: admin,
    payload: { title: 'Módulo 1' },
  });
  if (modRes.statusCode !== 201) {
    throw new Error(`POST /modules respondeu ${modRes.statusCode}: ${modRes.body}`);
  }
  const mod = modRes.json() as { id: string };
  const lessonRes = await callAs(test, {
    method: 'POST',
    url: `/api/v1/modules/${mod.id}/lessons`,
    as: admin,
    payload: {
      title: 'Aula 1',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      durationSeconds: 300,
    },
  });
  if (lessonRes.statusCode !== 201) {
    throw new Error(`POST /lessons respondeu ${lessonRes.statusCode}: ${lessonRes.body}`);
  }
  const lesson = lessonRes.json() as { id: string; version: number };
  const lessonPub = await callAs(test, {
    method: 'PATCH',
    url: `/api/v1/lessons/${lesson.id}`,
    as: admin,
    payload: { status: 'published', version: lesson.version },
  });
  if (lessonPub.statusCode !== 200) {
    throw new Error(`PATCH /lessons respondeu ${lessonPub.statusCode}: ${lessonPub.body}`);
  }

  const fresh = await callAs(test, {
    method: 'GET',
    url: `/api/v1/courses/${course.id}`,
    as: admin,
  });
  const pub = await callAs(test, {
    method: 'POST',
    url: `/api/v1/courses/${course.id}/publish`,
    as: admin,
    payload: { version: (fresh.json() as { version: number }).version },
  });
  if (pub.statusCode !== 200) {
    throw new Error(`POST /courses/publish respondeu ${pub.statusCode}: ${pub.body}`);
  }
  return { id: course.id, slug: course.slug, title: course.title, priceCents };
}

export async function createPaidEbookAs(
  test: TestApp,
  admin: Actor,
  options: { title?: string; priceCents?: number } = {},
): Promise<{ id: string; title: string; priceCents: number }> {
  const suffix = randomUUID().slice(0, 8);
  const title = options.title ?? `Ebook Pago ${suffix}`;
  const priceCents = options.priceCents ?? 4_990;
  const created = await callAs(test, {
    method: 'POST',
    url: '/api/v1/ebooks',
    as: admin,
    payload: {
      title,
      accessMode: 'paid',
      priceCents,
      fileUrl: 'https://cdn.example.com/ebook.pdf',
    },
  });
  if (created.statusCode !== 201) {
    throw new Error(`POST /ebooks respondeu ${created.statusCode}: ${created.body}`);
  }
  const ebook = created.json() as { id: string; title: string; version: number };
  const pub = await callAs(test, {
    method: 'POST',
    url: `/api/v1/ebooks/${ebook.id}/publish`,
    as: admin,
    payload: { version: ebook.version },
  });
  if (pub.statusCode !== 200) {
    throw new Error(`POST /ebooks/publish respondeu ${pub.statusCode}: ${pub.body}`);
  }
  return { id: ebook.id, title: ebook.title, priceCents };
}

export interface PurchaseOptions {
  buyer: Buyer;
  items: { productType: 'course' | 'bundle' | 'ebook'; productId: string }[];
  couponCode?: string;
  approve?: boolean;
  method?: PaymentMethod;
  now?: Date;
}

export interface PurchasedOrder {
  orderId: string;
  orderNumber: number;
  providerCheckoutId: string | null;
  paymentId: string | null;
  providerPaymentId: string | null;
}

export async function checkoutOrder(
  db: Database,
  provider: FakePaymentProvider,
  options: PurchaseOptions,
): Promise<PurchasedOrder> {
  const now = options.now ?? new Date('2026-04-10T12:00:00.000Z');
  for (const item of options.items) {
    await addCartItem(db, options.buyer.id, item, CURRENCY);
  }
  if (options.couponCode !== undefined) {
    await setCartCoupon(db, options.buyer.id, options.couponCode, CURRENCY);
  }
  const checkout = await createOrder(db, {
    userId: options.buyer.id,
    provider,
    currency: CURRENCY,
    returnUrls: RETURN_URLS,
    now,
  });
  const row = await db
    .selectFrom('orders')
    .select(['id', 'number', 'providerCheckoutId', 'status'])
    .where('id', '=', checkout.order.id)
    .executeTakeFirstOrThrow();

  if (options.approve && row.providerCheckoutId !== null) {
    provider.setNow(now);
    const approved = provider.approveCheckout(row.providerCheckoutId, {
      method: options.method ?? 'pix',
    });
    await applyOrderPayment(db, 'fake', approved, { now });
    const paymentRow = await db
      .selectFrom('payments')
      .select('id')
      .where('orderId', '=', row.id)
      .orderBy('createdAt', 'desc')
      .executeTakeFirstOrThrow();
    return {
      orderId: row.id,
      orderNumber: Number(row.number),
      providerCheckoutId: row.providerCheckoutId,
      paymentId: paymentRow.id,
      providerPaymentId: approved.providerPaymentId,
    };
  }

  return {
    orderId: row.id,
    orderNumber: Number(row.number),
    providerCheckoutId: row.providerCheckoutId,
    paymentId: null,
    providerPaymentId: null,
  };
}
