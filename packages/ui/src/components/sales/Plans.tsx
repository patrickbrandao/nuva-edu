import { ArrowRight, Check } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react';
import '../../styles/tokens.css';
import './sales.css';
import { cx } from '../feedback/layer';
import { ErrorState, LoadingState } from '../flow/flow';
import type { MoneyOptions } from './money';
import { PriceTag } from './PriceTag';

/*
 * Planos de assinatura e a alternância mensal/anual (spec 012: a vitrine agrupa os planos
 * por `group_key`). Inspirado na BillingToggle/PlanColumn do PricingPage portado do minui
 * (examples/PricingPage.jsx), mas com dados do produto: preço em centavos, itens liberados
 * ("tudo, inclusive futuros" chega como texto) e estados vazio/carregando/erro.
 * Sem regra de negócio: o site escolhe os planos de cada grupo e trata o clique de assinar.
 */

export type BillingInterval = 'month' | 'year';

export interface PlanCardData {
  id: string;
  /** Grupo que reúne as duas periodicidades do mesmo conteúdo (`group_key`). */
  groupKey: string;
  title: string;
  description?: ReactNode;
  interval: BillingInterval;
  /** Preço por período, em centavos. */
  priceCents: number;
  /** Sufixo do preço (ex.: "/mês", "/ano"). */
  periodLabel?: ReactNode;
  /** Selo ao lado do título (ex.: "Mais popular"). */
  badge?: ReactNode;
  featured?: boolean;
  /** O que o plano libera, já traduzido (itens ou "Todos os cursos, inclusive futuros"). */
  features?: readonly ReactNode[] | undefined;
  /** Plano inativo não aceita novas assinaturas (a vitrine nem o mostra; útil no admin). */
  disabled?: boolean;
  /** Texto do botão (ex.: "Assinar"). Padrão: `labels.subscribe`. */
  actionLabel?: ReactNode;
}

export interface BillingToggleLabels {
  /** Nome do grupo (ex.: "Periodicidade da cobrança"). */
  group: string;
  month: ReactNode;
  year: ReactNode;
  /** Extra ao lado do anual (ex.: "2 meses de desconto"). */
  yearHint?: ReactNode;
}

export interface BillingToggleProps {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  labels: BillingToggleLabels;
  className?: string | undefined;
}

/** Alternância mensal/anual em rádio: Tab entra no grupo, as setas trocam a opção. */
export function BillingToggle({ value, onChange, labels, className }: BillingToggleProps) {
  const name = useId();
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next: BillingInterval = value === 'month' ? 'year' : 'month';
    onChange(next);
    (next === 'month' ? monthRef : yearRef).current?.focus();
  };

  const option = (interval: BillingInterval, label: ReactNode, hint?: ReactNode) => (
    <label
      className={cx('minui-billing__option', value === interval && 'is-active')}
      data-interval={interval}
    >
      <input
        ref={interval === 'month' ? monthRef : yearRef}
        type="radio"
        name={name}
        value={interval}
        checked={value === interval}
        onChange={() => onChange(interval)}
        onKeyDown={onKeyDown}
      />
      <span>{label}</span>
      {hint ? <span className="minui-billing__hint">{hint}</span> : null}
    </label>
  );

  return (
    <div className={cx('minui-billing', className)} role="radiogroup" aria-label={labels.group}>
      {option('month', labels.month)}
      {option('year', labels.year, labels.yearHint)}
    </div>
  );
}

export interface PlanCardProps extends MoneyOptions {
  plan: PlanCardData;
  onSelect?: ((plan: PlanCardData) => void) | undefined;
  /** Texto do botão quando o plano não define o seu. */
  subscribeLabel?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string | undefined;
}

/** Um plano: título, preço por período, o que libera e o botão de assinar. */
export function PlanCard({
  plan,
  onSelect,
  subscribeLabel,
  headingLevel = 3,
  currency,
  locale,
  className,
}: PlanCardProps) {
  const Heading = `h${headingLevel}` as const;
  const action = plan.actionLabel ?? subscribeLabel;
  return (
    <article
      className={cx('minui-plan', plan.featured && 'minui-plan--featured', className)}
      data-disabled={plan.disabled ? 'true' : undefined}
    >
      <header className="minui-plan__head">
        <Heading>{plan.title}</Heading>
        {plan.badge ? <span className="minui-plan__badge">{plan.badge}</span> : null}
      </header>
      <PriceTag
        cents={plan.priceCents}
        period={plan.periodLabel}
        currency={currency}
        locale={locale}
        className="minui-plan__price"
      />
      {plan.description ? <p className="minui-plan__desc">{plan.description}</p> : null}
      {action ? (
        <button
          type="button"
          className={cx('minui-plan__cta', plan.featured && 'minui-plan__cta--solid')}
          disabled={plan.disabled}
          onClick={() => onSelect?.(plan)}
        >
          {action}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : null}
      {plan.features?.length ? (
        <ul className="minui-plan__features">
          {plan.features.map((feature, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
            <li key={index}>
              <Check size={16} aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export interface PlanGridLabels {
  /** Nome da região (ex.: "Planos de assinatura"). */
  region: string;
  subscribe: ReactNode;
  loading: string;
  emptyTitle: ReactNode;
  emptyText?: ReactNode;
  errorTitle?: ReactNode;
  errorText?: ReactNode;
  retry?: string;
  /** Rótulos da alternância mensal/anual. */
  billing: BillingToggleLabels;
}

export interface PlanGridProps extends MoneyOptions {
  plans: readonly PlanCardData[];
  labels: PlanGridLabels;
  /** Periodicidade visível; com `onBillingChange`, controlada pelo site. */
  billing?: BillingInterval | undefined;
  defaultBilling?: BillingInterval | undefined;
  onBillingChange?: ((interval: BillingInterval) => void) | undefined;
  onSelect?: ((plan: PlanCardData) => void) | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry?: (() => void) | undefined;
  /** Ação sugerida no estado vazio (spec 006, RF-09). */
  emptyAction?: ReactNode;
  /** Sem plano anual/mensal na lista, a alternância não aparece. */
  className?: string | undefined;
}

/** Vitrine de planos: alternância de periodicidade e os planos do grupo, lado a lado. */
export function PlanGrid({
  plans,
  labels,
  billing: billingProp,
  defaultBilling = 'month',
  onBillingChange,
  onSelect,
  loading = false,
  error = false,
  onRetry,
  emptyAction,
  currency,
  locale,
  className,
}: PlanGridProps) {
  const [own, setOwn] = useState<BillingInterval>(defaultBilling);
  const billing = billingProp ?? own;
  const change = (next: BillingInterval) => {
    if (billingProp === undefined) setOwn(next);
    onBillingChange?.(next);
  };
  const intervals = new Set(plans.map((plan) => plan.interval));
  const visible = plans.filter((plan) => plan.interval === billing);

  return (
    <section aria-label={labels.region} className={cx('minui-plans', className)}>
      {intervals.size > 1 ? (
        <BillingToggle value={billing} onChange={change} labels={labels.billing} />
      ) : null}
      {loading ? (
        <LoadingState label={labels.loading} />
      ) : error ? (
        <ErrorState
          title={labels.errorTitle}
          text={labels.errorText}
          {...(onRetry ? { onRetry, retryLabel: labels.retry } : {})}
        />
      ) : visible.length === 0 ? (
        <div className="minui-plans__empty">
          <strong>{labels.emptyTitle}</strong>
          {labels.emptyText ? <p>{labels.emptyText}</p> : null}
          {emptyAction}
        </div>
      ) : (
        <div className="minui-plans__grid">
          {visible.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onSelect={onSelect}
              subscribeLabel={labels.subscribe}
              currency={currency}
              locale={locale}
            />
          ))}
        </div>
      )}
    </section>
  );
}
