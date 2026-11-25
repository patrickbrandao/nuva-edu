import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import type { ProductType } from './queries';

const PATHS: Record<ProductType, string> = {
  course: '/cursos',
  bundle: '/pacotes',
  ebook: '/ebooks',
};

/** Endereço da página do produto (mapa de telas da spec 006). */
export function productPath(type: ProductType, slug: string): string {
  return `${PATHS[type]}/${encodeURIComponent(slug)}`;
}

/**
 * Formata centavos na moeda e no idioma da instalação, que vêm só de `/api/v1/meta` (spec 006).
 * Antes de o `meta` responder não há moeda: devolve `undefined` e o preço aparece em seguida.
 */
export function usePriceFormatter(): (cents: number) => string | undefined {
  const { data } = useMeta();
  const currency = data?.currency;
  const locale = data?.locale;
  return useCallback(
    (cents: number) => {
      if (!currency) return undefined;
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
      } catch {
        return undefined;
      }
    },
    [currency, locale],
  );
}

/** Duração legível ("3 h 20 min"), arredondada para o minuto; menos de um minuto vira 1 min. */
export function formatDuration(t: TFunction, seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return t('product.duration.minutes', { minutes });
  if (minutes === 0) return t('product.duration.hours', { hours });
  return t('product.duration.hoursMinutes', { hours, minutes });
}

interface Totals {
  moduleCount?: number | null;
  lessonCount?: number | null;
  durationSeconds?: number | null;
  itemCount?: number | null;
  pages?: number | null;
}

/** Totais do produto já traduzidos: módulos, aulas e duração (curso), itens (pacote), páginas. */
export function productTotals(t: TFunction, totals: Totals): string[] {
  const facts: string[] = [];
  if (typeof totals.moduleCount === 'number') {
    facts.push(t('product.totals.modules', { count: totals.moduleCount }));
  }
  if (typeof totals.lessonCount === 'number') {
    facts.push(t('product.totals.lessons', { count: totals.lessonCount }));
  }
  if (totals.durationSeconds) facts.push(formatDuration(t, totals.durationSeconds));
  if (typeof totals.itemCount === 'number') {
    facts.push(t('product.totals.items', { count: totals.itemCount }));
  }
  if (typeof totals.pages === 'number') {
    facts.push(t('product.totals.pages', { count: totals.pages }));
  }
  return facts;
}

/** Validade do acesso: "Acesso vitalício" ou "Acesso por N dias". */
export function accessValidity(t: TFunction, accessDays: number | null): string {
  return accessDays === null
    ? t('product.validity.lifetime')
    : t('product.validity.days', { count: accessDays });
}

/** Gratuito: modo `open` ou preço zero (o mesmo critério do filtro `price=free` da API). */
export function isFree(product: { accessMode: 'open' | 'paid'; priceCents: number | null }) {
  return product.accessMode === 'open' || !product.priceCents;
}

/** Data longa no idioma da interface. */
export function useDateFormatter(): (iso: string) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date(iso)),
    [i18n.language],
  );
}
