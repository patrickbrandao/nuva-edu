import { isApiError } from '@nuva-edu/api-client/admin';
import { formatMoney } from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useProblemText } from '../../api/problems';
import { type Plan, type PlanInterval, type ProductType, planItemCounts } from './queries';

/*
 * Textos e formatos das telas de planos (spec 012). O que a API manda como código —
 * periodicidade e tipo de produto — vira frase pelas traduções do site; o preço sai na moeda da
 * instalação (`GET /api/v1/meta`, spec 006). Nenhum valor do plano é calculado aqui.
 */

/** Moeda da instalação: centavos → "R$ 97,00". */
export function usePlansMoney() {
  const meta = useMeta();
  const currency = meta.data?.currency;
  const locale = meta.data?.locale;
  return useCallback(
    (cents: number | null | undefined) => formatMoney(cents, { currency, locale }),
    [currency, locale],
  );
}

/** "mês" / "ano", para a frase de preço. */
export function planIntervalLabel(t: TFunction, interval: PlanInterval): string {
  return t(`plans.intervals.${interval}`);
}

/** "Mensal" / "Anual", para a periodicidade sozinha (coluna, filtro, detalhe). */
export function planIntervalName(t: TFunction, interval: PlanInterval): string {
  return t(`plans.intervalNames.${interval}`);
}

/** "R$ 97,00 por mês" / "R$ 970,00 por ano". */
export function planPriceLabel(
  t: TFunction,
  money: (cents: number) => string,
  plan: Pick<Plan, 'priceCents' | 'interval'>,
): string {
  return t('plans.pricePerPeriod', {
    amount: money(plan.priceCents),
    period: planIntervalLabel(t, plan.interval),
  });
}

export function productTypeLabel(t: TFunction, productType: ProductType): string {
  return t(`plans.productTypes.${productType}`);
}

/** "Nenhuma assinatura" / "3 assinaturas": o plural do português trata 0 como singular. */
export function planSubscriptionCountLabel(t: TFunction, count: number): string {
  return count === 0 ? t('plans.noSubscriptions') : t('plans.subscriptionCount', { count });
}

/** O que o plano libera, em uma frase: "Tudo, inclusive futuros e privados" ou "3 itens". */
export function planCoverageLabel(
  t: TFunction,
  plan: Pick<Plan, 'includesAll' | 'includesPrivate' | 'items'>,
): string {
  if (plan.includesAll) {
    return plan.includesPrivate ? t('plans.coverage.allPrivate') : t('plans.coverage.all');
  }
  if (plan.items.length === 0) return t('plans.coverage.none');
  return t('plans.coverage.items', { count: plan.items.length });
}

/**
 * Itens por tipo, na ordem de curso, ebook e pacote: "2 cursos · 1 ebook". Tipo sem item some;
 * lista vazia devolve a frase de "nenhum item".
 */
export function planCoverageDetails(
  t: TFunction,
  plan: Pick<Plan, 'includesAll' | 'includesPrivate' | 'items'>,
): string {
  if (plan.includesAll || plan.items.length === 0) return planCoverageLabel(t, plan);
  const counts = planItemCounts(plan);
  const parts = (['course', 'ebook', 'bundle'] as const)
    .filter((type) => counts[type] > 0)
    .map((type) => t(`plans.coverage.count.${type}`, { count: counts[type] }));
  return parts.join(' · ');
}

/** Códigos das operações de planos (contrato) com texto próprio. */
const KNOWN_ERRORS = [
  'plan_group_conflict',
  'plan_slug_taken',
  'plan_invalid',
  'plan_item_invalid',
  'not_found',
  'validation_failed',
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

function isKnownError(code: string): code is KnownError {
  return (KNOWN_ERRORS as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação de planos; a genérica leva o código da requisição. */
export function usePlansError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnownError(error.code)) return t(`plans.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/** Campos recusados na validação (`body.code` → `code`). */
export function refusedFields(error: unknown): Set<string> {
  if (!isApiError(error)) return new Set();
  return new Set(error.fieldErrors.map((field) => field.path.replace(/^body\./, '')));
}
