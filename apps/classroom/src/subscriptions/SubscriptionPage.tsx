import {
  AdminBadge,
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminSection,
  ErrorState,
  formatMoney,
  LoadingState,
  PriceTag,
  SubscriptionStatusBadge,
} from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { PackageSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { describeError } from '../api/errors';
import { useMeta } from '../api/meta';
import { useDateFormatter } from '../catalog/format';
import { usePageMeta } from '../lib/usePageMeta';
import { paymentMethodLabel, useDateTimeFormatter } from '../sales/format';
import { RequireSession } from '../session/RequireSession';
import { PLANS_PATH, PURCHASES_PATH } from '../shell/navigation';
import { CancelSubscriptionButton } from './CancelSubscription';
import { intervalLabel, planFeatures, subscriptionStatusLabel } from './format';
import { isNotFound, type MySubscriptionDetail, useMySubscription } from './queries';

/**
 * Uma frase por estado do ciclo de vida (spec 012, "Ciclo de vida"): sem ela, o aluno vê o
 * mesmo selo colorido em situações opostas, como carência e cancelamento.
 */
function statusSentence(
  t: TFunction,
  formatDate: (iso: string) => string,
  subscription: MySubscriptionDetail,
): string {
  const { status } = subscription;
  if (status === 'active' && subscription.nextChargeAt) {
    return t('subscriptions.detail.status.activeNext', {
      date: formatDate(subscription.nextChargeAt),
    });
  }
  if (status === 'past_due' && subscription.graceUntil) {
    return t('subscriptions.detail.status.pastDueGrace', {
      date: formatDate(subscription.graceUntil),
    });
  }
  if (status === 'canceling' && subscription.currentPeriodEnd) {
    return t('subscriptions.detail.status.cancelingEnd', {
      date: formatDate(subscription.currentPeriodEnd),
    });
  }
  if (status === 'ended' && subscription.endedAt) {
    return t('subscriptions.detail.status.endedAt', { date: formatDate(subscription.endedAt) });
  }
  return t(`subscriptions.detail.status.${status}`);
}

function Charges({ subscription }: { subscription: MySubscriptionDetail }) {
  const { t } = useTranslation();
  const meta = useMeta();
  const formatDateTime = useDateTimeFormatter();
  const money = (cents: number, currency: string) =>
    formatMoney(cents, { currency, locale: meta.data?.locale });

  if (subscription.payments.length === 0) {
    return <p className="m-0 text-sm text-ink-2">{t('subscriptions.detail.noCharges')}</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {subscription.payments.map((charge) => (
        <li
          key={charge.id}
          className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0"
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <AdminBadge>{t(`sales.order.payment.status.${charge.status}`)}</AdminBadge>
              <span className="text-sm text-ink-2">{paymentMethodLabel(t, charge.method)}</span>
            </span>
            <PriceTag
              cents={charge.amountCents}
              currency={charge.currency}
              locale={meta.data?.locale}
            />
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
            {charge.paidAt ? (
              <span>
                {t('subscriptions.detail.charges.paidAt', {
                  date: formatDateTime(charge.paidAt),
                })}
              </span>
            ) : null}
            <span>
              {t('subscriptions.detail.charges.createdAt', {
                date: formatDateTime(charge.createdAt),
              })}
            </span>
            {charge.refundedCents > 0 ? (
              <span>
                {t('subscriptions.detail.charges.refunded', {
                  value: money(charge.refundedCents, charge.currency),
                })}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SubscriptionView({ subscription }: { subscription: MySubscriptionDetail }) {
  const { t } = useTranslation();
  const meta = useMeta();
  const formatDate = useDateFormatter();
  const { plan } = subscription;

  const details: { label: string; value: string }[] = [
    { label: t('subscriptions.detail.interval'), value: intervalLabel(t, plan.interval) },
  ];
  if (subscription.currentPeriodStart && subscription.currentPeriodEnd) {
    details.push({
      label: t('subscriptions.detail.period'),
      value: `${formatDate(subscription.currentPeriodStart)} – ${formatDate(
        subscription.currentPeriodEnd,
      )}`,
    });
  }
  if (subscription.nextChargeAt) {
    details.push({
      label: t('subscriptions.detail.nextCharge'),
      value: formatDate(subscription.nextChargeAt),
    });
  }
  if (subscription.graceUntil) {
    details.push({
      label: t('subscriptions.detail.graceUntil'),
      value: formatDate(subscription.graceUntil),
    });
  }
  if (subscription.canceledAt) {
    details.push({
      label: t('subscriptions.detail.canceledAt'),
      value: formatDate(subscription.canceledAt),
    });
  }
  if (subscription.endedAt) {
    details.push({
      label: t('subscriptions.detail.endedAt'),
      value: formatDate(subscription.endedAt),
    });
  }
  details.push({
    label: t('subscriptions.detail.createdAt'),
    value: formatDate(subscription.createdAt),
  });

  const features = planFeatures(t, plan);

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 min-w-0 text-xl font-semibold text-ink sm:text-2xl">{plan.title}</h1>
          <SubscriptionStatusBadge
            status={subscription.status}
            label={subscriptionStatusLabel(t, subscription.status)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminButton href={PURCHASES_PATH}>{t('subscriptions.detail.back')}</AdminButton>
          <AdminButton href={PLANS_PATH}>{t('subscriptions.detail.changePlan')}</AdminButton>
          <CancelSubscriptionButton
            subscription={{
              id: subscription.id,
              status: subscription.status,
              planTitle: plan.title,
              currentPeriodEnd: subscription.currentPeriodEnd,
            }}
          />
        </div>
      </div>

      <AdminCard pad>
        <p className="m-0 text-sm text-ink-2">{statusSentence(t, formatDate, subscription)}</p>
      </AdminCard>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <AdminSection title={t('subscriptions.detail.planTitle')}>
            <AdminCard pad>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-ink-2">
                  {t('subscriptions.detail.contractedPrice')}
                </span>
                <PriceTag
                  cents={subscription.priceCents}
                  period={intervalLabel(t, plan.interval)}
                  currency={subscription.currency}
                  locale={meta.data?.locale}
                />
              </div>
              <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-sm text-ink">
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </AdminCard>
          </AdminSection>

          <AdminSection title={t('subscriptions.detail.chargesTitle')}>
            <AdminCard pad>
              <Charges subscription={subscription} />
            </AdminCard>
          </AdminSection>
        </div>
        <aside aria-label={t('subscriptions.detail.detailsTitle')}>
          <AdminCard pad>
            <AdminDetails wrap items={details} />
          </AdminCard>
        </aside>
      </div>
    </article>
  );
}

function SubscriptionPageInner({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useMySubscription(id);

  if (query.isPending) {
    return (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('subscriptions.detail.loading')} />
      </AdminCard>
    );
  }

  if (query.isError) {
    if (isNotFound(query.error)) {
      return (
        <>
          <h1 className="m-0 text-xl font-semibold text-ink sm:text-2xl">
            {t('subscriptions.detail.notFoundTitle')}
          </h1>
          <AdminEmpty
            icon={<PackageSearch aria-hidden="true" />}
            text={t('subscriptions.detail.notFoundText')}
          >
            <span className="mt-3 flex">
              <AdminButton href={PURCHASES_PATH}>{t('subscriptions.detail.back')}</AdminButton>
            </span>
          </AdminEmpty>
        </>
      );
    }
    const failure = describeError(t, query.error);
    return (
      <AdminCard pad>
        <ErrorState
          title={t('subscriptions.detail.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  }

  return query.data ? <SubscriptionView subscription={query.data} /> : null;
}

/** `/conta/compras/assinaturas/:id`: plano, estado, período, carência e cobranças (spec 012). */
export function SubscriptionPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  usePageMeta(t('subscriptions.detail.title'), t('subscriptions.detail.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
          <SubscriptionPageInner id={id} />
        </div>
      )}
    </RequireSession>
  );
}
