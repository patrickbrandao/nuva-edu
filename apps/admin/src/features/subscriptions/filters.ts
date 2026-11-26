import { ALL, dateEndIso, dateStartIso, isDate, isUuid } from '../sales/filters';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus, type SubscriptionsQuery } from './queries';

/*
 * Filtros da lista de assinaturas no endereço (spec 006, RF-07): período, estado, plano e busca
 * pelo assinante, como no contrato. O que o endereço traz fora do contrato é ignorado — a tela
 * nunca manda à API um filtro que ela não oferece.
 */
export interface SubscriptionFilters {
  q?: string;
  /** `YYYY-MM-DD`, do endereço; vira o começo do dia local na consulta. */
  from?: string;
  /** `YYYY-MM-DD`, do endereço; vira o começo do dia seguinte (fim exclusivo). */
  to?: string;
  status?: SubscriptionStatus;
  planId?: string;
  userId?: string;
}

/** Filtros a partir do endereço da tela. */
export function readSubscriptionFilters(params: URLSearchParams): SubscriptionFilters {
  const q = params.get('q')?.trim() || undefined;
  const from = params.get('from');
  const to = params.get('to');
  const status = SUBSCRIPTION_STATUSES.find((item) => item === params.get('status'));
  const planId = params.get('planId');
  const userId = params.get('userId');
  return {
    ...(q ? { q } : {}),
    ...(from && isDate(from) ? { from } : {}),
    ...(to && isDate(to) ? { to } : {}),
    ...(status ? { status } : {}),
    ...(planId && isUuid(planId) ? { planId } : {}),
    ...(userId && isUuid(userId) ? { userId } : {}),
  };
}

/** Consulta da lista: os filtros do endereço no formato do contrato. */
export function subscriptionQuery(
  filters: SubscriptionFilters,
): Omit<SubscriptionsQuery, 'cursor' | 'limit'> {
  return {
    ...(filters.from ? { from: dateStartIso(filters.from) } : {}),
    ...(filters.to ? { to: dateEndIso(filters.to) } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.planId ? { planId: filters.planId } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };
}

/** Há algum filtro escolhido; o estado vazio fala de "nenhum resultado" quando há. */
export function hasSubscriptionFilters(filters: SubscriptionFilters): boolean {
  return Boolean(
    filters.q || filters.from || filters.to || filters.status || filters.planId || filters.userId,
  );
}

export { ALL };
