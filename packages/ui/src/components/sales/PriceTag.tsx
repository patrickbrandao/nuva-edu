import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import './sales.css';
import { cx } from '../feedback/layer';
import { formatMoney, type MoneyOptions } from './money';

/*
 * Preço com desconto (spec 011: preço atual, desconto do cupom e total; valor final zero).
 * Todo texto chega por propriedade; os valores são centavos. Sem regra de cálculo: quem
 * calcula o desconto é o núcleo/API — aqui só se apresenta o que já veio calculado.
 */

export interface PriceTagProps extends MoneyOptions {
  /** Preço final em centavos (depois do desconto). */
  cents: number;
  /** Preço original, quando há desconto a mostrar (riscado). */
  originalCents?: number | null | undefined;
  /** Texto do desconto já traduzido (ex.: "-20% com o cupom BEMVINDO"). */
  discountLabel?: ReactNode;
  /** Texto quando o valor final é zero (ex.: "Gratuito"). Sem ele, mostra a moeda com zero. */
  freeLabel?: ReactNode;
  /** Sufixo ao lado do preço (ex.: "/mês"). */
  period?: ReactNode;
  className?: string | undefined;
}

/** Preço, com o valor original riscado e o selo de desconto quando há. */
export function PriceTag({
  cents,
  originalCents,
  discountLabel,
  freeLabel,
  period,
  currency,
  locale,
  className,
}: PriceTagProps) {
  const free = cents === 0 && freeLabel != null;
  const discounted =
    originalCents != null && originalCents > cents
      ? formatMoney(originalCents, { currency, locale })
      : null;
  return (
    <span className={cx('minui-price', className)}>
      {discounted ? <s className="minui-price__original">{discounted}</s> : null}
      <span className="minui-price__value" data-free={free ? 'true' : undefined}>
        {free ? freeLabel : formatMoney(cents, { currency, locale })}
      </span>
      {period ? <span className="minui-price__period">{period}</span> : null}
      {discountLabel ? <span className="minui-price__discount">{discountLabel}</span> : null}
    </span>
  );
}

export interface OrderTotalsRow {
  /** Identificador estável da linha (ex.: "subtotal", "discount", "total"). */
  id: string;
  /** Rótulo da linha (ex.: "Subtotal", "Desconto", "Reembolsado"). */
  label: ReactNode;
  /** Valor em centavos; quando `text` vem preenchido, ele é mostrado no lugar. */
  cents?: number | null | undefined;
  text?: ReactNode;
  /** Linha de destaque (o total). */
  strong?: boolean;
}

export interface OrderTotalsProps extends MoneyOptions {
  rows: readonly OrderTotalsRow[];
  /** Nome do grupo para o leitor de tela (ex.: "Totais do pedido"). */
  'aria-label'?: string | undefined;
  className?: string | undefined;
}

/** Bloco de totais: subtotal, desconto, reembolso e total, uma linha por entrada. */
export function OrderTotals({
  rows,
  currency,
  locale,
  'aria-label': ariaLabel,
  className,
}: OrderTotalsProps) {
  return (
    <dl className={cx('minui-totals', className)} aria-label={ariaLabel}>
      {rows.map((row) => (
        <div
          key={row.id}
          className="minui-totals__row"
          data-strong={row.strong ? 'true' : undefined}
        >
          <dt>{row.label}</dt>
          <dd>{row.text ?? formatMoney(row.cents, { currency, locale })}</dd>
        </div>
      ))}
    </dl>
  );
}
