import { randomUUID } from 'node:crypto';
import {
  applySubscriptionPayment,
  createAccount,
  createSubscriptionCheckout,
  type Database,
  type FakePaymentProvider,
  type PlanInterval,
} from '@nuva-edu/core';
import { type Actor, callAs } from '../actors.ts';
import { type TestApp, uniqueEmail } from '../helpers.ts';

// Peças dos testes de planos e assinaturas da admin-api (spec 012). Os planos entram pela rota
// (`POST /plans`, dono da escrita no admin); a assinatura, pelo checkout do núcleo, porque o dono
// da criação é o classroom-api — aqui ela só precisa existir com estado e cobrança reais.

export const CURRENCY = 'BRL';

export const RETURN_URLS = {
  success: 'https://classroom.example/assinaturas/sucesso',
  pending: 'https://classroom.example/assinaturas/pendente',
  failure: 'https://classroom.example/assinaturas/falha',
};

export interface Subscriber {
  id: string;
  email: string;
}

/** Aluno com e-mail confirmado e dados de comprador (exigidos pelo checkout). */
export async function makeSubscriber(test: TestApp): Promise<Subscriber> {
  const email = uniqueEmail('assinante');
  const id = await test.db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: 'Assinante de Teste',
      password: null,
      role: 'student',
      emailVerified: true,
    }),
  );
  await test.db
    .updateTable('users')
    .set({ fullName: 'Assinante de Teste', taxIdType: 'cpf', taxId: '52998224725' })
    .where('id', '=', id)
    .execute();
  return { id, email };
}

export interface PlanPayload {
  slug?: string;
  groupKey?: string;
  title?: string;
  description?: string | null;
  interval?: PlanInterval;
  priceCents?: number;
  includesAll?: boolean;
  includesPrivate?: boolean;
  active?: boolean;
  position?: number;
  items?: { productType: 'course' | 'bundle' | 'ebook'; productId: string }[];
}

/** Plano criado pela rota do admin; títulos e grupos únicos no banco compartilhado. */
export async function createPlanAs(
  test: TestApp,
  actor: Actor,
  input: PlanPayload = {},
): Promise<Record<string, unknown> & { id: string; slug: string; title: string }> {
  const suffix = randomUUID().slice(0, 8);
  const response = await callAs(test, {
    method: 'POST',
    url: '/api/v1/plans',
    as: actor,
    payload: {
      groupKey: `grupo-${suffix}`,
      title: `Plano ${suffix}`,
      interval: 'month',
      priceCents: 9_900,
      ...input,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`POST /plans respondeu ${response.statusCode}: ${response.body}`);
  }
  return response.json();
}

export interface SubscriptionState {
  subscriptionId: string;
  providerSubscriptionId: string;
  /** A cobrança mais recente da assinatura. */
  paymentId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  graceUntil: Date | null;
}

/** Assina o plano e ativa com a primeira cobrança aprovada (fluxo do classroom + worker). */
export async function subscribeAndActivate(
  test: TestApp,
  provider: FakePaymentProvider,
  planId: string,
  subscriber: Subscriber,
  options: { now?: Date } = {},
): Promise<SubscriptionState> {
  const now = options.now ?? new Date('2026-03-01T00:00:00.000Z');
  const checkout = await createSubscriptionCheckout(test.db, {
    userId: subscriber.id,
    planId,
    provider,
    currency: CURRENCY,
    returnUrls: RETURN_URLS,
    now,
  });
  const providerSubscriptionId = await providerSubscriptionIdOf(test.db, checkout.subscription.id);
  provider.setNow(now);
  const first = provider.authorizeSubscription(providerSubscriptionId);
  await applySubscriptionPayment(test.db, 'fake', first, { graceDays: 3, now });
  return subscriptionState(test, checkout.subscription.id);
}

async function providerSubscriptionIdOf(db: Database, subscriptionId: string): Promise<string> {
  const row = await db
    .selectFrom('subscriptions')
    .select('providerSubscriptionId')
    .where('id', '=', subscriptionId)
    .executeTakeFirstOrThrow();
  if (row.providerSubscriptionId === null) {
    throw new Error('Assinatura do checkout sem identificador no provedor.');
  }
  return row.providerSubscriptionId;
}

/** Estado atual da assinatura e a cobrança mais recente, lidos do banco. */
export async function subscriptionState(
  test: TestApp,
  subscriptionId: string,
): Promise<SubscriptionState> {
  const subscription = await test.db
    .selectFrom('subscriptions')
    .select([
      'id',
      'status',
      'providerSubscriptionId',
      'currentPeriodStart',
      'currentPeriodEnd',
      'graceUntil',
    ])
    .where('id', '=', subscriptionId)
    .executeTakeFirstOrThrow();
  const payment = await test.db
    .selectFrom('payments')
    .select(['id'])
    .where('subscriptionId', '=', subscriptionId)
    .orderBy('paidAt', 'desc')
    .orderBy('createdAt', 'desc')
    .executeTakeFirst();
  return {
    subscriptionId: subscription.id,
    providerSubscriptionId: subscription.providerSubscriptionId as string,
    paymentId: payment?.id ?? '',
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart as Date,
    currentPeriodEnd: subscription.currentPeriodEnd as Date,
    graceUntil: subscription.graceUntil,
  };
}

/** Renovação recusada: `past_due` com carência de 3 dias a partir de `now`. */
export async function makePastDue(
  test: TestApp,
  provider: FakePaymentProvider,
  subscription: Pick<SubscriptionState, 'providerSubscriptionId'>,
  now: Date,
): Promise<void> {
  provider.setNow(now);
  const rejected = provider.renewSubscription(subscription.providerSubscriptionId, {
    outcome: 'rejected',
  });
  await applySubscriptionPayment(test.db, 'fake', rejected, { graceDays: 3, now });
}
