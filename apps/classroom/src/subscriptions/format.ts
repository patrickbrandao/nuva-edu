import type { TFunction } from 'i18next';
import type { PlanInterval, PublicPlan, SubscriptionStatus } from './queries';

/*
 * Textos derivados dos dados de planos e assinaturas (spec 012). O que a API manda como código
 * — periodicidade, estado da assinatura — vira frase aqui, pelas traduções do site; os títulos
 * de produtos vêm dos dados.
 */

export function subscriptionStatusLabel(t: TFunction, status: SubscriptionStatus): string {
  return t(`subscriptions.status.${status}`);
}

/** "por mês" / "por ano", o sufixo do preço do plano. */
export function intervalLabel(t: TFunction, interval: PlanInterval): string {
  return t(`subscriptions.interval.${interval}`);
}

/**
 * O que o plano libera, já como linhas da vitrine: "tudo, inclusive futuros" vira uma frase e,
 * quando o plano lista itens, cada um pelo título atual (mesma regra do contrato `PublicPlan`).
 */
export function planFeatures(t: TFunction, plan: PublicPlan): string[] {
  if (plan.includesAll) return [t('subscriptions.plans.features.all')];
  if (plan.items.length === 0) return [t('subscriptions.plans.features.empty')];
  return plan.items.map((item) => item.title);
}
