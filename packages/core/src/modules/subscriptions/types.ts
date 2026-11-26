// Tipos, constantes e conversões das assinaturas (spec 012, "Planos", "Ciclo de vida" e
// "Dados"; contrato da janela 560). Os valores repetem as restrições da migration 0015. Dinheiro
// é sempre centavo inteiro e os instantes são `Date` vindos do banco.

import type { EntitlementProductType } from '../entitlements/types.ts';
import type { PaymentMethod, PaymentProviderName, PaymentStatus } from '../payments/types.ts';
import { cents, type RefundStatus, type RefundView, type SalesPayment } from '../sales/types.ts';

/** Periodicidade do plano (`plans.interval`). */
export const PLAN_INTERVALS = ['month', 'year'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export function isPlanInterval(value: unknown): value is PlanInterval {
  return typeof value === 'string' && (PLAN_INTERVALS as readonly string[]).includes(value);
}

/** Ciclo de vida da assinatura (`subscriptions.status`, spec 012, "Ciclo de vida"). */
export const SUBSCRIPTION_LIFECYCLE_STATUSES = [
  'pending',
  'active',
  'past_due',
  'suspended',
  'canceling',
  'ended',
  'expired',
] as const;
export type SubscriptionLifecycleStatus = (typeof SUBSCRIPTION_LIFECYCLE_STATUSES)[number];

export function isSubscriptionLifecycleStatus(
  value: unknown,
): value is SubscriptionLifecycleStatus {
  return (
    typeof value === 'string' &&
    (SUBSCRIPTION_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Estados que contam como acesso ativo para fórum, mensagens e eventos (spec 012, "Convivência
 * com compra avulsa").
 */
export const SUBSCRIPTION_ACCESS_STATUSES = ['active', 'past_due', 'canceling'] as const;

export function subscriptionAllowsAccess(status: SubscriptionLifecycleStatus): boolean {
  return (SUBSCRIPTION_ACCESS_STATUSES as readonly string[]).includes(status);
}

/** Estados que ocupam a chave "uma assinatura por plano" (índice da 0015). */
export const SUBSCRIPTION_OPEN_STATUSES = ['pending', 'active', 'past_due', 'suspended'] as const;

/** Estados em que o dinheiro entrou ao menos uma vez. */
export const SUBSCRIPTION_PAID_STATUSES = [
  'active',
  'past_due',
  'suspended',
  'canceling',
  'ended',
] as const;

/** Assinatura `pending` sem pagamento vira `expired` em 30 min (spec 012, "Assinar"). */
export const SUBSCRIPTION_PENDING_MINUTES = 30;

/** Carência da cobrança recusada, padrão de `NUVA_SUBSCRIPTION_GRACE_DAYS` (spec 031). */
export const SUBSCRIPTION_GRACE_DAYS_DEFAULT = 3;

/** Assinatura suspensa há 30 dias vira `ended` (spec 012, "Ciclo de vida"). */
export const SUBSCRIPTION_SUSPENDED_END_DAYS = 30;

/** Motivo do cancelamento: texto de 1 a 200 caracteres (restrição da 0015). */
export const SUBSCRIPTION_CANCEL_REASON_MAX_LENGTH = 200;

/** Trecho do motivo do cancelamento feito pelo aluno, quando a API não manda outro. */
export const SUBSCRIPTION_SELF_CANCEL_REASON = 'Cancelada pelo aluno';
export const SUBSCRIPTION_ADMIN_CANCEL_REASON = 'Cancelada pela equipe';

/** Item do plano como o código o lê (`plan_items`). */
export interface PlanItem {
  productType: EntitlementProductType;
  productId: string;
  /** Título atual do produto; `produto removido` quando ele não existe mais. */
  title: string;
}

/** Plano na vitrine pública: sem `includesPrivate`, sem `groupKey` e com os itens visíveis. */
export interface PublicPlan {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  interval: PlanInterval;
  priceCents: number;
  includesAll: boolean;
  items: PlanItem[];
  position: number;
}

/** Uma linha de `plans` como o admin a vê (`Plan` do contrato administrativo). */
export interface Plan {
  id: string;
  slug: string;
  groupKey: string;
  title: string;
  description: string | null;
  interval: PlanInterval;
  priceCents: number;
  includesAll: boolean;
  includesPrivate: boolean;
  active: boolean;
  position: number;
  providerPlanId: string | null;
  /** Assinaturas do plano, inclusive `ended` e `expired`; é o vínculo que impede excluir. */
  subscriptionCount: number;
  createdAt: Date;
  updatedAt: Date;
  items: PlanItem[];
}

/** Planos do mesmo `group_key`, como a vitrine os agrupa (spec 012, "Planos"). */
export interface PlanGroup {
  groupKey: string;
  plans: PublicPlan[];
}

/** A vitrine de planos (`GET /plans` do classroom). */
export interface PlanCatalog {
  groups: PlanGroup[];
  currency: string;
}

/** Entrada da criação de plano (`POST /plans`). `slug` é gerado quando ausente. */
export interface PlanInput {
  slug?: string;
  groupKey: string;
  title: string;
  description?: string | null;
  interval: PlanInterval;
  priceCents: number;
  includesAll?: boolean;
  includesPrivate?: boolean;
  active?: boolean;
  position?: number;
  /** Usado quando `includesAll` é falso; com `includesAll` verdadeiro é recusado. */
  items?: readonly { productType: EntitlementProductType; productId: string }[];
}

/** Edição do plano (`PATCH /plans/{id}`): `slug`, `groupKey` e `interval` são imutáveis. */
export interface PlanUpdateInput {
  title?: string;
  description?: string | null;
  priceCents?: number;
  includesAll?: boolean;
  includesPrivate?: boolean;
  active?: boolean;
  position?: number;
}

/** Página de planos (`PlanPage` do contrato). */
export interface PlanPage {
  items: Plan[];
  nextCursor: string | null;
}

/** Uma linha de `subscriptions` como o código a lê. */
export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionLifecycleStatus;
  priceCents: number;
  currency: string;
  couponId: string | null;
  provider: PaymentProviderName;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  endedAt: Date | null;
  createdAt: Date;
}

/** Plano resumido na lista do admin (`SubscriptionPlanRef` do contrato administrativo). */
export interface SubscriptionPlanRef {
  id: string;
  title: string;
  interval: PlanInterval;
}

/** Plano resumido na lista do aluno (`SubscriptionPlanRef` do contrato do classroom). */
export interface MyPlanRef {
  id: string;
  slug: string;
  title: string;
  interval: PlanInterval;
}

/** Cobrança conhecida de uma assinatura, sem dado de cartão (`SubscriptionCharge`). */
export interface SubscriptionCharge {
  id: string;
  status: PaymentStatus;
  method: PaymentMethod;
  amountCents: number;
  refundedCents: number;
  currency: string;
  provider: PaymentProviderName;
  providerPaymentId: string;
  paidAt: Date | null;
  createdAt: Date;
}

/** Uma assinatura do aluno na lista (`MySubscriptionSummary`). */
export interface MySubscriptionSummary {
  id: string;
  plan: MyPlanRef;
  status: SubscriptionLifecycleStatus;
  priceCents: number;
  currency: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  /** Próxima renovação prevista: `currentPeriodEnd` em `active`; nula nos demais. */
  nextChargeAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export interface MySubscriptionDetail extends MySubscriptionSummary {
  plan: PublicPlan;
  payments: SubscriptionCharge[];
}

/** Assinante na tela do admin, sem documento fiscal (`Subscriber`). */
export interface SubscriptionUser {
  id: string;
  name: string;
  email: string;
}

/** Item da lista do admin (`AdminSubscriptionSummary`). */
export interface SubscriptionSummary {
  id: string;
  subscriber: SubscriptionUser;
  plan: SubscriptionPlanRef;
  status: SubscriptionLifecycleStatus;
  priceCents: number;
  currency: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  nextChargeAt: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  endedAt: Date | null;
  createdAt: Date;
}

/** Uma cobrança do admin, com os reembolsos (`PaymentDetail`). */
export interface SubscriptionPaymentDetail extends SalesPayment {
  refunds: SubscriptionRefund[];
}

/** Reembolso de cobrança recorrente: mesmo formato do reembolso de pedido. */
export type SubscriptionRefund = RefundView;

/** O detalhe do admin (`AdminSubscriptionDetail`). */
export interface SubscriptionDetail extends SubscriptionSummary {
  plan: Plan;
  provider: PaymentProviderName;
  providerSubscriptionId: string | null;
  couponCode: string | null;
  /** A cobrança que abriu o período em curso; reembolsá-la encerra a assinatura. */
  currentPeriodPaymentId: string | null;
  payments: SubscriptionPaymentDetail[];
}

/** Resultado de assinar um plano (`SubscriptionCheckout`). */
export interface SubscriptionCheckout {
  subscription: MySubscriptionDetail;
  checkoutUrl: string;
}

export interface MySubscriptionsQuery {
  status?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface SubscriptionQuery extends MySubscriptionsQuery {
  from?: unknown;
  to?: unknown;
  planId?: unknown;
  userId?: unknown;
  q?: unknown;
}

export type SubscriptionPaymentStatus = PaymentStatus;
export type SubscriptionPaymentMethod = PaymentMethod;
export type SubscriptionRefundStatus = RefundStatus;

/** Quantos dias de carência a instalação usa (spec 031). */
export function normalizeGraceDays(value: number | undefined): number {
  if (value === undefined) return SUBSCRIPTION_GRACE_DAYS_DEFAULT;
  if (!Number.isInteger(value) || value < 0 || value > 60) {
    throw new TypeError('A carência da assinatura deve ser um inteiro de 0 a 60 dias.');
  }
  return value;
}

/** Data somada de dias, em UTC. */
export function addDays(start: Date, days: number): Date {
  const result = new Date(start);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Fim do período seguinte, contado do início (`month` ou `year`). */
export function addInterval(start: Date, interval: PlanInterval): Date {
  const result = new Date(start);
  if (interval === 'month') {
    result.setUTCMonth(result.getUTCMonth() + 1);
  } else {
    result.setUTCFullYear(result.getUTCFullYear() + 1);
  }
  return result;
}

/** Periodicidade do plano no formato da porta de pagamento (spec 013). */
export function planPeriodicity(interval: PlanInterval): {
  value: number;
  unit: 'months' | 'years';
} {
  return interval === 'month' ? { value: 1, unit: 'months' } : { value: 1, unit: 'years' };
}

/** Converte a linha de `plans` no tipo do módulo, sem os itens nem a contagem. */
export function toPlan(row: {
  id: string;
  slug: string;
  groupKey: string;
  title: string;
  description: string | null;
  interval: string;
  priceCents: string | number | bigint;
  includesAll: boolean;
  includesPrivate: boolean;
  active: boolean;
  position: number;
  providerPlanId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Omit<Plan, 'items' | 'subscriptionCount'> {
  return {
    id: row.id,
    slug: row.slug,
    groupKey: row.groupKey,
    title: row.title,
    description: row.description,
    interval: row.interval as PlanInterval,
    priceCents: cents(row.priceCents),
    includesAll: row.includesAll,
    includesPrivate: row.includesPrivate,
    active: row.active,
    position: row.position,
    providerPlanId: row.providerPlanId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Converte a linha de `subscriptions` no tipo do módulo. */
export function toSubscription(row: {
  id: string;
  userId: string;
  planId: string;
  status: string;
  priceCents: string | number | bigint;
  currency: string;
  couponId: string | null;
  provider: string;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  endedAt: Date | null;
  createdAt: Date;
}): Subscription {
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    status: row.status as SubscriptionLifecycleStatus,
    priceCents: cents(row.priceCents),
    currency: row.currency,
    couponId: row.couponId,
    provider: row.provider as PaymentProviderName,
    providerSubscriptionId: row.providerSubscriptionId,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    graceUntil: row.graceUntil,
    canceledAt: row.canceledAt,
    cancelReason: row.cancelReason,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

/** Próxima cobrança mostrada ao aluno: o fim do período apenas em `active`. */
export function nextChargeAt(status: SubscriptionLifecycleStatus, end: Date | null): Date | null {
  if (status !== 'active') return null;
  return end;
}

/** Plano resumido do admin a partir de uma linha de `plans`. */
export function toPlanRef(row: {
  id: string;
  title: string;
  interval: string;
}): SubscriptionPlanRef {
  return {
    id: row.id,
    title: row.title,
    interval: row.interval as PlanInterval,
  };
}

/** Plano resumido do aluno a partir de uma linha de `plans`. */
export function toMyPlanRef(row: {
  id: string;
  slug: string;
  title: string;
  interval: string;
}): MyPlanRef {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    interval: row.interval as PlanInterval,
  };
}

/** Plano público a partir de uma linha de `plans` e dos itens já filtrados. */
export function toPublicPlan(
  row: Omit<Plan, 'items' | 'subscriptionCount'>,
  items: PlanItem[],
): PublicPlan {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    interval: row.interval,
    priceCents: row.priceCents,
    includesAll: row.includesAll,
    items,
    position: row.position,
  };
}
