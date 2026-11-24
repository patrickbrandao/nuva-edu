import { ArrowRight, Check } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../lib/util';
import { ExampleHead, ExamplePage } from './ExamplePage';

/*
 * Página de preços: a chave Mensal/Anual (com o desconto do anual em verde)
 * e os planos lado a lado numa moldura só, separados por filetes. O plano em
 * destaque ganha fundo próprio, o selo "Most Popular" e o botão cheio.
 * Tudo HTML, CSS e SVG, nos dois temas.
 */

/** Planos padrão. `price` é um número (igual nos dois ciclos) ou { monthly, yearly }. */
export const PRICING_PLANS = [
  {
    id: 'hobby',
    name: 'Hobby',
    price: 0,
    description: 'For personal projects and experiments.',
    cta: 'Start Deploying',
    features: [
      'Unlimited deployments',
      'Custom domains',
      'Automatic HTTPS',
      'Edge network',
      'Community support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    badge: 'Most Popular',
    featured: true,
    price: { monthly: 20, yearly: 16 },
    description: 'For production applications and growing teams.',
    cta: 'Start Free Trial',
    features: [
      'Everything in Hobby',
      'Advanced analytics',
      'Password protection',
      'Team collaboration',
      'Priority support',
      '1 TB bandwidth',
      'Preview deployments',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: { monthly: 99, yearly: 79 },
    description: 'For organizations with advanced security and scale.',
    cta: 'Contact Sales',
    features: [
      'Everything in Pro',
      'SLA guarantee',
      'Dedicated support',
      'SSO / SAML',
      'Audit logs',
      'Advanced DDoS protection',
      'Custom contracts',
      'Compliance reviews',
    ],
  },
];

/** Preço do plano no ciclo escolhido. */
export const planPrice = (plan, billing) =>
  typeof plan.price === 'number' ? plan.price : (plan.price?.[billing] ?? plan.price?.monthly ?? 0);

/** Chave Mensal/Anual com o indicador que desliza até a opção ativa. */
function BillingToggle({ value, onChange, labels, discount }) {
  const name = useId();
  const monthly = useRef(null);
  const yearly = useRef(null);
  const [pill, setPill] = useState(null);

  useLayoutEffect(() => {
    const node = (value === 'yearly' ? yearly : monthly).current;
    if (!node) return undefined;
    const update = () => setPill({ left: node.offsetLeft, width: node.offsetWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);

  const option = (id, label, extra) => (
    <label
      ref={id === 'yearly' ? yearly : monthly}
      className={cx('minui-pricing__option', value === id && 'is-active')}
    >
      <input
        type="radio"
        name={name}
        value={id}
        checked={value === id}
        onChange={() => onChange(id)}
        className="minui-pricing__radio"
      />
      {label}
      {extra}
    </label>
  );

  return (
    <div className="minui-pricing__toggle" role="radiogroup" aria-label="Billing period">
      {pill ? (
        <span
          className="minui-pricing__pill"
          style={{ translate: `${pill.left}px 0`, width: pill.width }}
          aria-hidden="true"
        />
      ) : null}
      {option('monthly', labels.monthly)}
      {option(
        'yearly',
        labels.yearly,
        discount ? <span className="minui-pricing__discount">{discount}</span> : null,
      )}
    </div>
  );
}

/** Uma coluna de plano. Com `href` o botão é um link; sem, um <button>. */
function PlanColumn({ plan, billing, currency, period, onSelect }) {
  const price = planPrice(plan, billing);
  const Tag = plan.href ? 'a' : 'button';
  const props = plan.href ? { href: plan.href } : { type: 'button' };
  return (
    <article
      className={cx('minui-pricing__plan', plan.featured && 'minui-pricing__plan--featured')}
    >
      <header className="minui-pricing__name">
        <h2>{plan.name}</h2>
        {plan.badge ? <span className="minui-pricing__badge">{plan.badge}</span> : null}
      </header>

      <p className="minui-pricing__price">
        {/* a chave muda o key e reinicia a animação do número */}
        <span key={`${billing}-${price}`} className="minui-pricing__amount">
          {currency}
          {price}
        </span>
        {price > 0 && period ? <span className="minui-pricing__period">{period}</span> : null}
      </p>

      {plan.description ? <p className="minui-pricing__desc">{plan.description}</p> : null}

      {plan.cta ? (
        <Tag
          {...props}
          className={cx('minui-pricing__cta', plan.featured && 'minui-pricing__cta--solid')}
          onClick={onSelect ? () => onSelect(plan.id, billing, plan) : undefined}
        >
          {plan.cta}
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Tag>
      ) : null}

      {plan.features?.length ? (
        <>
          <hr className="minui-pricing__rule" />
          <ul className="minui-pricing__features">
            {plan.features.map((feature) => (
              <li key={feature}>
                <Check size={17} strokeWidth={2.2} aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

/**
 * Página de preços. O ciclo pode ser controlado (`billing` + `onBillingChange`)
 * ou ficar por conta da página (`defaultBilling`). `onSelect(id, ciclo, plano)`
 * é chamado no botão de cada plano.
 */
export function PricingPage({
  plans = PRICING_PLANS,
  billing: billingProp,
  defaultBilling = 'yearly',
  onBillingChange,
  billingLabels = { monthly: 'Monthly', yearly: 'Yearly' },
  discount = '-20%',
  showToggle = true,
  currency = '$',
  period = '/mo',
  title,
  lead,
  onSelect,
  className,
  style,
}) {
  const [own, setOwn] = useState(defaultBilling);
  const billing = billingProp ?? own;
  const change = (next) => {
    if (billingProp == null) setOwn(next);
    onBillingChange?.(next);
  };

  return (
    <ExamplePage variant="minui-pricing" className={className} style={style}>
      {title ? <ExampleHead title={title} lead={lead} /> : null}

      {showToggle ? (
        <BillingToggle
          value={billing}
          onChange={change}
          labels={billingLabels}
          discount={discount}
        />
      ) : null}

      <div className="minui-pricing__plans" style={{ '--pr-cols': plans.length }}>
        {plans.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            billing={billing}
            currency={currency}
            period={period}
            onSelect={onSelect}
          />
        ))}
      </div>
    </ExamplePage>
  );
}
