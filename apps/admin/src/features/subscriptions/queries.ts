import type { AdminClient, AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../../api/client';

/*
 * Assinaturas vistas pelo admin (spec 012, "Ciclo de vida", "Reembolso de cobrança" e
 * "Interfaces e contratos"): lista com filtros, detalhe com as cobranças e os reembolsos,
 * cancelamento pelo admin e reembolso por cobrança. Tudo pelo cliente gerado do contrato; os
 * testes simulam o `fetch` enquanto as rotas não existem na API (tarefa 555).
 */

export type SubscriptionStatus = AdminSchemas['SubscriptionStatus'];
export type Subscriber = AdminSchemas['Subscriber'];
export type SubscriptionPlanRef = AdminSchemas['SubscriptionPlanRef'];
export type AdminSubscriptionSummary = AdminSchemas['AdminSubscriptionSummary'];
export type AdminSubscriptionDetail = AdminSchemas['AdminSubscriptionDetail'];
export type PaymentDetail = AdminSchemas['PaymentDetail'];
export type Refund = AdminSchemas['Refund'];
export type RefundStatus = AdminSchemas['RefundStatus'];
export type SubscriptionRefundInput = AdminSchemas['SubscriptionRefundInput'];
export type PaymentStatus = AdminSchemas['PaymentStatus'];
export type PaymentMethod = AdminSchemas['PaymentMethod'];

export type SubscriptionsQuery = NonNullable<
  AdminOperations['listSubscriptions']['parameters']['query']
>;

export const SUBSCRIPTIONS_PATH = '/assinaturas';
export const SUBSCRIPTIONS_PAGE_SIZE = 25;
/** Enquanto um reembolso está `requested`, o detalhe consulta o estado de novo (o worker conclui). */
export const SUBSCRIPTION_POLL_MS = 5_000;
/** Limite do motivo no formulário; a API não impõe tamanho. */
export const REASON_MAX = 500;
export const REASON_MIN = 3;

/** Todos os estados, na ordem do ciclo de vida (spec 012, "Ciclo de vida"). */
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'pending',
  'active',
  'past_due',
  'suspended',
  'canceling',
  'ended',
  'expired',
];

export function subscriptionPath(id: string): string {
  return `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`;
}

export const subscriptionsKeys = {
  all: () => ['subscriptions'] as const,
  list: (query: Omit<SubscriptionsQuery, 'cursor'>) => ['subscriptions', 'list', query] as const,
  detail: (id: string) => ['subscriptions', 'detail', id] as const,
};

/** Lista de assinaturas por cursor (`GET /api/v1/subscriptions`, `sales.view`). */
export function useSubscriptionsList(
  query: Omit<SubscriptionsQuery, 'cursor' | 'limit'>,
  enabled = true,
) {
  const api = useApi();
  const full = { ...query, limit: SUBSCRIPTIONS_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: subscriptionsKeys.list(full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/subscriptions', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/subscriptions respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Uma assinatura com plano, período, cobranças e reembolsos (`GET /api/v1/subscriptions/{id}`). */
export function useSubscription(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: subscriptionsKeys.detail(id),
    queryFn: async ({ signal }): Promise<AdminSubscriptionDetail> => {
      const { data } = await api.GET('/api/v1/subscriptions/{id}', {
        params: { path: { id } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/subscriptions/{id} respondeu sem corpo');
      return data;
    },
    refetchInterval: (query) => subscriptionPollInterval(query.state.data),
  });
}

/**
 * Assinatura `pending` muda sozinha (a primeira cobrança pode ser aprovada) e um reembolso
 * `requested` só termina quando o worker confirma; nos demais estados não há o que esperar.
 */
export function subscriptionPollInterval(
  detail: AdminSubscriptionDetail | undefined,
): number | false {
  if (!detail) return false;
  const waiting = detail.status === 'pending';
  const refunding = detail.payments.some((payment) =>
    payment.refunds.some((refund) => refund.status === 'requested'),
  );
  return waiting || refunding ? SUBSCRIPTION_POLL_MS : false;
}

/** Assinatura que o admin cancela (`active`, `past_due` ou `suspended`, spec 012). */
export function isCancelable(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'past_due' || status === 'suspended';
}

/** Cancelar `suspended` encerra na hora; nos demais estados o acesso vai até o fim do período. */
export function cancelEndsNow(status: SubscriptionStatus): boolean {
  return status === 'suspended';
}

/** O saldo ainda reembolsável da cobrança, em centavos. */
export function refundableCents(payment: Pick<PaymentDetail, 'amountCents' | 'refundedCents'>) {
  return Math.max(0, payment.amountCents - payment.refundedCents);
}

/** Cobrança que aceita reembolso: aprovada (ou parcial) e com saldo (spec 012, casos de erro). */
export function isPaymentRefundable(
  payment: Pick<PaymentDetail, 'status' | 'amountCents' | 'refundedCents'>,
): boolean {
  const refundable = payment.status === 'approved' || payment.status === 'partially_refunded';
  return refundable && refundableCents(payment) > 0;
}

/**
 * O que um reembolso faz com a assinatura (spec 012, "Reembolso de cobrança"; decisão do
 * humano de 2026-11):
 * - `ends`: reembolso que fecha o saldo da cobrança do período em curso — a assinatura encerra na
 *   hora e os direitos são revogados com motivo `refund`;
 * - `keeps-partial`: valor menor que o saldo da cobrança do período em curso — devolve o valor e a
 *   assinatura segue no estado em que está, com acesso até o fim do período pago;
 * - `keeps-other-period`: cobrança de período passado — qualquer valor não altera o estado atual.
 */
export type RefundOutcome = 'ends' | 'keeps-partial' | 'keeps-other-period';

export function refundOutcome(input: {
  paymentId: string;
  currentPeriodPaymentId: string | null;
  amountCents: number;
  remainingCents: number;
}): RefundOutcome {
  if (input.currentPeriodPaymentId === null || input.paymentId !== input.currentPeriodPaymentId) {
    return 'keeps-other-period';
  }
  return input.amountCents >= input.remainingCents ? 'ends' : 'keeps-partial';
}

/** Cancelamento pelo admin (`POST /subscriptions/{id}/cancel`, `subscription.cancel`). */
export async function cancelSubscription(
  api: AdminClient,
  input: { id: string; reason: string },
): Promise<AdminSubscriptionDetail> {
  const { data } = await api.POST('/api/v1/subscriptions/{id}/cancel', {
    params: { path: { id: input.id } },
    body: { reason: input.reason },
  });
  if (!data) throw new Error('POST /api/v1/subscriptions/{id}/cancel respondeu sem corpo');
  return data;
}

/** Reembolso de uma cobrança (`POST /subscriptions/{id}/payments/{paymentId}/refund`). */
export async function requestSubscriptionRefund(
  api: AdminClient,
  input: {
    subscriptionId: string;
    paymentId: string;
    reason: string;
    /** Ausente ou nulo estorna o saldo não reembolsado inteiro. */
    amountCents?: number | null;
    idempotencyKey: string;
  },
): Promise<Refund> {
  const { data } = await api.POST('/api/v1/subscriptions/{id}/payments/{paymentId}/refund', {
    params: {
      path: { id: input.subscriptionId, paymentId: input.paymentId },
      header: { 'Idempotency-Key': input.idempotencyKey },
    },
    body: { reason: input.reason, amountCents: input.amountCents ?? null },
  });
  if (!data) {
    throw new Error(
      'POST /api/v1/subscriptions/{id}/payments/{paymentId}/refund respondeu sem corpo',
    );
  }
  return data;
}

/** Chave de idempotência do pedido de reembolso: a repetição devolve o primeiro por 24 h. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
