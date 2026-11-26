import { isApiError } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminCard,
  AdminField,
  type BuyerData,
  BuyerForm,
  LoadingState,
  PageTitle,
  type PlanCardData,
  PlanGrid,
  type PlanGridLabels,
  PriceTag,
  TextLink,
} from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { describeError, type ErrorText } from '../api/errors';
import { useMeta } from '../api/meta';
import { browser, isHttpUrl } from '../lib/browser';
import { usePageMeta } from '../lib/usePageMeta';
import { useBilling, useSaveBilling } from '../sales/queries';
import { withReturnTo } from '../session/returnTo';
import { useSession } from '../session/session';
import { HOME_PATH, LOGIN_PATH, PLANS_PATH, PURCHASES_PATH } from '../shell/navigation';
import { intervalLabel, planFeatures } from './format';
import {
  blocksNewSubscription,
  type PlanGroup,
  type PublicPlan,
  useCreateSubscription,
  useMySubscriptions,
  usePlanCatalog,
} from './queries';

/** A alternância da vitrine; cada plano pertence a uma das duas periodicidades. */
type BillingInterval = 'month' | 'year';

interface CatalogCard extends PlanCardData {
  plan: PublicPlan;
}

function planCard(t: TFunction, plan: PublicPlan, groupKey: string): CatalogCard {
  return {
    id: plan.id,
    groupKey,
    title: plan.title,
    ...(plan.description ? { description: plan.description } : {}),
    interval: plan.interval,
    priceCents: plan.priceCents,
    periodLabel: intervalLabel(t, plan.interval),
    ...(plan.includesAll ? { badge: t('subscriptions.plans.allBadge') } : {}),
    features: planFeatures(t, plan),
    plan,
  };
}

/** Os planos de todos os grupos, cada um como cartão da vitrine. */
function catalogCards(t: TFunction, groups: readonly PlanGroup[]): CatalogCard[] {
  return groups.flatMap((group) => group.plans.map((plan) => planCard(t, plan, group.groupKey)));
}

function gridLabels(t: TFunction): PlanGridLabels {
  return {
    region: t('subscriptions.plans.region'),
    subscribe: t('subscriptions.plans.subscribe'),
    loading: t('subscriptions.plans.loading'),
    emptyTitle: t('subscriptions.plans.emptyTitle'),
    emptyText: t('subscriptions.plans.emptyText'),
    errorTitle: t('subscriptions.plans.errorTitle'),
    errorText: t('subscriptions.plans.errorText'),
    retry: t('common.retry'),
    billing: {
      group: t('subscriptions.plans.billing.group'),
      month: t('subscriptions.plans.billing.month'),
      year: t('subscriptions.plans.billing.year'),
      yearHint: t('subscriptions.plans.billing.yearHint'),
    },
  };
}

type FieldErrors = { fullName?: string; taxId?: string };

interface CheckoutPanelProps {
  plan: PublicPlan;
  onClose: () => void;
  onRefreshPlans: () => void;
}

/**
 * Checkout próprio da assinatura, fora da cesta (spec 012, "Assinar"): o plano escolhido, o
 * cupom da primeira cobrança e os dados de comprador que faltarem. A resposta leva à página do
 * provedor para autorizar a recorrência; a tela mantém o link caso a navegação seja barrada.
 */
function CheckoutPanel({ plan, onClose, onRefreshPlans }: CheckoutPanelProps) {
  const { t } = useTranslation();
  const meta = useMeta();
  const billingQuery = useBilling();
  const saveBilling = useSaveBilling();
  const create = useCreateSubscription();
  const [coupon, setCoupon] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [needsBuyer, setNeedsBuyer] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [redirect, setRedirect] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<BuyerData>(() => ({
    fullName: billingQuery.data?.fullName ?? '',
    taxIdType: billingQuery.data?.taxIdType ?? 'cpf',
    taxId: billingQuery.data?.taxId ?? '',
  }));
  const hydrated = useRef(false);
  const attempt = useRef<{ key: string; couponCode: string | null } | null>(null);

  // o que já está salvo em /me/billing preenche o formulário uma vez, sem apagar o que a pessoa digitou
  useEffect(() => {
    const data = billingQuery.data;
    if (hydrated.current || !data) return;
    hydrated.current = true;
    setBuyer({
      fullName: data.fullName ?? '',
      taxIdType: data.taxIdType ?? 'cpf',
      taxId: data.taxId ?? '',
    });
  }, [billingQuery.data]);

  // o nome e o CPF/CNPJ vêm de /me/billing; sem eles, a API recusa com `billing_required`
  const buyerRequired = needsBuyer || billingQuery.isError || billingQuery.data?.complete === false;
  const pending = saveBilling.isPending || create.isPending;

  const submit = async (buyerData: BuyerData | null) => {
    setFailure(null);
    setCouponError(null);

    if (buyerRequired) {
      const fullName = (buyerData?.fullName ?? buyer.fullName).trim();
      const taxId = (buyerData?.taxId ?? buyer.taxId).trim();
      const errors: FieldErrors = {};
      if (!fullName) errors.fullName = t('subscriptions.checkout.errors.requiredName');
      if (!taxId) errors.taxId = t('subscriptions.checkout.errors.requiredTaxId');
      setFieldErrors(errors);
      if (errors.fullName || errors.taxId) return;
      try {
        await saveBilling.mutateAsync({
          fullName,
          taxIdType: buyerData?.taxIdType ?? buyer.taxIdType,
          taxId,
        });
      } catch (error) {
        const shown = describeError(t, error, {
          tax_id_invalid: t('subscriptions.checkout.errors.taxIdInvalid'),
        });
        setFailure(shown);
        if (shown.code === 'tax_id_invalid') setFieldErrors({ taxId: shown.message });
        return;
      }
    }

    const couponCode = coupon.trim() || null;
    const normalizedCoupon = couponCode?.toLowerCase() ?? null;
    if (!attempt.current || attempt.current.couponCode !== normalizedCoupon) {
      const key =
        globalThis.crypto?.randomUUID?.() ??
        `assinatura-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      attempt.current = { key, couponCode: normalizedCoupon };
    }
    const { key } = attempt.current;
    try {
      const checkout = await create.mutateAsync({
        planId: plan.id,
        couponCode,
        idempotencyKey: key,
      });
      if (!isHttpUrl(checkout.checkoutUrl)) {
        setFailure({
          code: 'payment_provider_unavailable',
          message: t('subscriptions.checkout.errors.providerUnavailable'),
        });
        return;
      }
      setRedirect(checkout.checkoutUrl);
      // o provedor tem o próprio checkout; a tela mantém o link caso a navegação seja barrada
      browser.assign(checkout.checkoutUrl);
    } catch (error) {
      const shown = describeError(t, error, {
        billing_required: t('subscriptions.checkout.errors.billingRequired'),
        subscription_already_exists: t('subscriptions.checkout.errors.alreadyExists'),
        coupon_invalid: t('subscriptions.checkout.errors.couponInvalid'),
        email_not_verified: t('subscriptions.checkout.errors.emailNotVerified'),
        payment_provider_unavailable: t('subscriptions.checkout.errors.providerUnavailable'),
        not_found: t('subscriptions.checkout.errors.planUnavailable'),
      });
      setFailure(shown);
      if (
        attempt.current?.key === key &&
        isApiError(error) &&
        (error.status === 400 || error.status === 422 || shown.code === 'billing_required')
      ) {
        attempt.current = null;
      }
      if (shown.code === 'billing_required') setNeedsBuyer(true);
      if (shown.code === 'coupon_invalid') setCouponError(shown.message);
    }
  };

  const submitWithoutBuyer = (event: FormEvent) => {
    event.preventDefault();
    void submit(null);
  };

  if (redirect) {
    return (
      <AdminCard pad aria-live="polite">
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm font-medium text-ink">
            {t('subscriptions.checkout.redirecting')}
          </p>
          <p className="m-0 text-sm text-ink-2">{t('subscriptions.checkout.redirectText')}</p>
          <span className="flex">
            <AdminButton href={redirect} variant="primary">
              {t('subscriptions.checkout.redirectAction')}
            </AdminButton>
          </span>
        </div>
      </AdminCard>
    );
  }

  const failureNode: ReactNode = failure ? (
    <>
      <span>{failure.message}</span>
      {failure.code === 'subscription_already_exists' ? (
        <span className="mt-1 block">
          <TextLink href={PURCHASES_PATH}>{t('subscriptions.checkout.goToMine')}</TextLink>
        </span>
      ) : null}
      {failure.code === 'not_found' ? (
        <span className="mt-1 block">
          <AdminButton size="sm" onClick={onRefreshPlans}>
            {t('subscriptions.checkout.refreshPlans')}
          </AdminButton>
        </span>
      ) : null}
      {failure.detail ? <span className="mt-1 block text-ink-3">{failure.detail}</span> : null}
    </>
  ) : undefined;

  const couponField = (
    <AdminField
      label={t('subscriptions.checkout.coupon.label')}
      hint={t('subscriptions.checkout.coupon.hint')}
      value={coupon}
      onChange={setCoupon}
      autoComplete="off"
      spellCheck={false}
      {...(couponError ? { error: couponError } : {})}
    />
  );

  const submitLabel = pending
    ? t('subscriptions.checkout.submitting')
    : t('subscriptions.checkout.submit');

  return (
    <AdminCard pad as="section" aria-labelledby="assinatura-checkout-titulo">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="assinatura-checkout-titulo" className="m-0 text-base font-semibold text-ink">
              {t('subscriptions.checkout.title', { plan: plan.title })}
            </h2>
            <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink-2">
              <PriceTag
                cents={plan.priceCents}
                period={intervalLabel(t, plan.interval)}
                currency={meta.data?.currency}
                locale={meta.data?.locale}
              />
              <span>{t('subscriptions.checkout.chargeNote')}</span>
            </p>
          </div>
          <AdminButton size="sm" onClick={onClose}>
            {t('subscriptions.checkout.close')}
          </AdminButton>
        </div>

        {buyerRequired ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-sm text-ink-2">{t('subscriptions.checkout.buyer.required')}</p>
            <BuyerForm
              value={buyer}
              onChange={setBuyer}
              onSubmit={() => void submit(buyer)}
              labels={{
                legend: t('subscriptions.checkout.buyer.legend'),
                fullName: t('subscriptions.checkout.buyer.fullName'),
                fullNameHint: t('subscriptions.checkout.buyer.fullNameHint'),
                taxIdType: t('subscriptions.checkout.buyer.taxIdType'),
                cpf: t('subscriptions.checkout.buyer.cpf'),
                cnpj: t('subscriptions.checkout.buyer.cnpj'),
                taxId: t('subscriptions.checkout.buyer.taxId'),
                taxIdHint: t('subscriptions.checkout.buyer.taxIdHint'),
                submit: submitLabel,
                submitting: t('subscriptions.checkout.submitting'),
              }}
              errors={{
                ...(fieldErrors.fullName ? { fullName: fieldErrors.fullName } : {}),
                ...(fieldErrors.taxId ? { taxId: fieldErrors.taxId } : {}),
              }}
              pending={pending}
              {...(failureNode ? { error: failureNode } : {})}
            />
            {couponField}
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submitWithoutBuyer} noValidate>
            {couponField}
            {failureNode ? (
              <div role="alert" className="flex flex-col text-sm text-ink">
                {failureNode}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <AdminButton
                type="submit"
                variant="primary"
                disabled={pending}
                aria-busy={pending || undefined}
              >
                {submitLabel}
              </AdminButton>
              <AdminButton href={PURCHASES_PATH}>
                {t('subscriptions.checkout.goToMine')}
              </AdminButton>
            </div>
          </form>
        )}

        <p className="m-0 text-sm text-ink-3">{t('subscriptions.checkout.privacy')}</p>
      </div>
    </AdminCard>
  );
}

interface PlansContentProps {
  cards: CatalogCard[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  blocked: readonly { planTitle: string }[];
  selectedSlug: string | null;
  onSelect: (card: CatalogCard) => void;
  onCloseCheckout: () => void;
  onRefreshPlans: () => void;
}

function PlansContent({
  cards,
  loading,
  error,
  onRetry,
  blocked,
  selectedSlug,
  onSelect,
  onCloseCheckout,
  onRefreshPlans,
}: PlansContentProps) {
  const { t } = useTranslation();
  const meta = useMeta();
  const available = new Set(cards.map((card) => card.interval));
  const [chosen, setChosen] = useState<BillingInterval | null>(null);
  const billing: BillingInterval = chosen ?? (available.has('month') ? 'month' : 'year');
  const selected = selectedSlug ? cards.find((card) => card.plan.slug === selectedSlug) : undefined;
  const missing = selectedSlug !== null && !loading && !error && !selected;

  return (
    <>
      {blocked.length > 0 ? (
        <p className="m-0 text-sm text-ink-2" role="status">
          {t('subscriptions.plans.alreadyText', {
            plans: blocked.map((item) => item.planTitle).join(', '),
          })}{' '}
          <TextLink href={PURCHASES_PATH}>{t('subscriptions.plans.alreadyAction')}</TextLink>
        </p>
      ) : null}

      {selected ? (
        <CheckoutPanel
          key={selected.plan.id}
          plan={selected.plan}
          onClose={onCloseCheckout}
          onRefreshPlans={onRefreshPlans}
        />
      ) : null}

      {missing ? (
        <AdminCard pad role="status">
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm font-medium text-ink">
              {t('subscriptions.plans.unavailableTitle')}
            </p>
            <p className="m-0 text-sm text-ink-2">{t('subscriptions.plans.unavailableText')}</p>
            <span className="flex">
              <AdminButton onClick={onCloseCheckout}>
                {t('subscriptions.plans.unavailableAction')}
              </AdminButton>
            </span>
          </div>
        </AdminCard>
      ) : null}

      <PlanGrid
        plans={cards}
        labels={gridLabels(t)}
        billing={billing}
        onBillingChange={setChosen}
        onSelect={(card) => {
          const match = cards.find((item) => item.id === card.id);
          if (match) onSelect(match);
        }}
        loading={loading}
        error={error}
        onRetry={onRetry}
        emptyAction={
          <span className="mt-3 flex">
            <AdminButton href={HOME_PATH}>{t('subscriptions.plans.emptyAction')}</AdminButton>
          </span>
        }
        currency={meta.data?.currency}
        locale={meta.data?.locale}
      />
    </>
  );
}

/**
 * `/planos`: vitrine pública de assinaturas (spec 006, mapa de telas; spec 012, "Planos"). Os
 * planos vêm agrupados por conteúdo e a alternância troca mensal e anual. O checkout próprio
 * fica no mesmo endereço, com o plano escolhido no parâmetro `plano` para o login devolver a
 * pessoa à assinatura em curso.
 */
export function PlansPage() {
  const { t } = useTranslation();
  usePageMeta(t('subscriptions.plans.title'), t('subscriptions.plans.description'));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { session } = useSession();
  const catalog = usePlanCatalog();
  const mine = useMySubscriptions('all');

  const cards = catalog.data ? catalogCards(t, catalog.data.groups) : [];
  const subscriptions = mine.data?.pages.flatMap((page) => page.items) ?? [];
  const blocking = subscriptions.filter((item) => blocksNewSubscription(item.status));
  const byPlan = new Map(blocking.map((item) => [item.plan.id, item]));

  const marked = cards.map((card): CatalogCard => {
    const existing = byPlan.get(card.plan.id);
    if (!existing) return card;
    return {
      ...card,
      disabled: true,
      actionLabel: t(`subscriptions.plans.existing.${existing.status}`),
    };
  });

  const selectedSlug = params.get('plano');

  const select = (card: CatalogCard) => {
    if (!session) {
      const destino = `${PLANS_PATH}?${new URLSearchParams({ plano: card.plan.slug }).toString()}`;
      void navigate(withReturnTo(LOGIN_PATH, destino));
      return;
    }
    setParams({ plano: card.plan.slug });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageTitle subtitle={t('subscriptions.plans.subtitle')}>
        {t('subscriptions.plans.title')}
      </PageTitle>

      {catalog.isPending ? (
        <AdminCard pad aria-busy="true">
          <LoadingState label={t('subscriptions.plans.loading')} />
        </AdminCard>
      ) : (
        <PlansContent
          cards={marked}
          loading={false}
          error={catalog.isError}
          onRetry={() => void catalog.refetch()}
          blocked={blocking.map((item) => ({ planTitle: item.plan.title }))}
          selectedSlug={selectedSlug}
          onSelect={select}
          onCloseCheckout={() => setParams({})}
          onRefreshPlans={() => {
            setParams({});
            void catalog.refetch();
          }}
        />
      )}
    </div>
  );
}
