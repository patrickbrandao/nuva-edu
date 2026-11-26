import { randomUUID } from 'node:crypto';
import {
  addCartItem,
  createOrder,
  createSubscriptionCheckout,
  type Database,
  type FakePaymentProvider,
  orderExternalReference,
  type ProviderPayment,
} from '../../../src/index.ts';
import { makeCourse, makeUser, type TestUser } from '../../sales/fixtures.ts';
import {
  makePlan,
  makeProvider,
  makeStaff,
  CURRENCY as PROVIDER_CURRENCY,
} from '../../subscriptions/fixtures.ts';

// Peças dos testes de integração de pagamentos: pedido `pending` com a cobrança do fake e
// assinatura `pending` com a adesão do fake. O provedor é um só por arquivo (a chave do plano no
// provedor é única) e o relógio é reposicionado em cada teste.

export const CURRENCY = PROVIDER_CURRENCY;
export const DAY = 86_400_000;

export const ORDER_RETURN_URLS = {
  success: 'https://classroom.example/pedidos/sucesso',
  pending: 'https://classroom.example/pedidos/pendente',
  failure: 'https://classroom.example/pedidos/falha',
};

export const SUBSCRIPTION_RETURN_URLS = {
  success: 'https://classroom.example/assinaturas/sucesso',
  pending: 'https://classroom.example/assinaturas/pendente',
  failure: 'https://classroom.example/assinaturas/falha',
};

/** Provedor do arquivo, com o relógio no instante dado e os controles zerados. */
export function integrationProvider(now: string | Date = '2026-01-01T00:00:00.000Z') {
  const provider = makeProvider(now instanceof Date ? now : new Date(now));
  provider.setUnavailable(false);
  provider.setRefundOutcome('approved');
  return provider;
}

export function billingStudent(db: Database): Promise<TestUser> {
  return makeUser(db, 'student', {
    billing: { fullName: 'Compradora de Teste', taxIdType: 'cpf', taxId: '52998224725' },
  });
}

export function makeAdmin(db: Database): Promise<TestUser> {
  return makeStaff(db, 'admin');
}

export interface PendingOrder {
  orderId: string;
  totalCents: number;
  payment: ProviderPayment;
}

/** Cria um pedido `pending` e devolve a cobrança pendente que o fake criou no checkout. */
export async function pendingOrder(
  db: Database,
  provider: FakePaymentProvider,
  student: TestUser,
  options: { priceCents?: number; now?: Date } = {},
): Promise<PendingOrder> {
  const priceCents = options.priceCents ?? 4_900;
  const courseId = await makeCourse(db, { priceCents, accessDays: 30 });
  await addCartItem(db, student.id, { productType: 'course', productId: courseId }, CURRENCY);
  const result = await createOrder(db, {
    userId: student.id,
    provider,
    currency: CURRENCY,
    returnUrls: ORDER_RETURN_URLS,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  // `created_at` tem padrão `now()` no banco; o teste reposiciona para o relógio do provedor,
  // que é o usado nas janelas de reconciliação.
  if (options.now !== undefined) {
    await db
      .updateTable('orders')
      .set({ createdAt: options.now })
      .where('id', '=', result.order.id)
      .execute();
  }
  const payments = await provider.findPaymentsByReference(orderExternalReference(result.order.id));
  const payment = payments[0];
  if (!payment) throw new Error('O fake não criou a cobrança do pedido.');
  return { orderId: result.order.id, totalCents: priceCents, payment };
}

/** Cobrança avulsa cujo pedido não existe no banco, para o evento sem correspondência. */
export async function orphanPayment(provider: FakePaymentProvider): Promise<ProviderPayment> {
  const checkout = await provider.createCheckout({
    items: [{ id: randomUUID(), title: 'Curso fantasma', quantity: 1, unitAmountCents: 1_000 }],
    totalCents: 1_000,
    currency: CURRENCY,
    buyer: { name: 'Compradora Fantasma', email: 'fantasma@exemplo.test' },
    returnUrls: ORDER_RETURN_URLS,
    externalReference: orderExternalReference(randomUUID()),
  });
  return provider.approveCheckout(checkout.providerCheckoutId);
}

export interface PendingSubscription {
  subscriptionId: string;
  providerSubscriptionId: string;
}

/** Assina um plano novo, deixando a assinatura `pending` e a adesão no fake. */
export async function pendingSubscription(
  db: Database,
  provider: FakePaymentProvider,
  admin: TestUser,
  subscriber: TestUser,
  options: { priceCents?: number; couponCode?: string; now?: Date } = {},
): Promise<PendingSubscription> {
  // O plano leva um curso, para a ativação conceder os direitos que os testes conferem.
  const courseId = await makeCourse(db, { priceCents: 1_000, accessDays: 30 });
  const plan = await makePlan(db, admin, {
    priceCents: options.priceCents ?? 9_900,
    items: [{ productType: 'course', productId: courseId }],
  });
  const result = await createSubscriptionCheckout(db, {
    userId: subscriber.id,
    planId: plan.id,
    provider,
    currency: CURRENCY,
    returnUrls: SUBSCRIPTION_RETURN_URLS,
    ...(options.couponCode === undefined ? {} : { couponCode: options.couponCode }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const row = await db
    .selectFrom('subscriptions')
    .select('providerSubscriptionId')
    .where('id', '=', result.subscription.id)
    .executeTakeFirstOrThrow();
  return {
    subscriptionId: result.subscription.id,
    providerSubscriptionId: row.providerSubscriptionId as string,
  };
}
