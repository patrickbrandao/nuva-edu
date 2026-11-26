import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminMenu,
  AdminSection,
  ErrorState,
  LoadingState,
  PriceTag,
  SubscriptionStatusBadge,
  TextLink,
} from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { BadgeCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { useMeta } from '../api/meta';
import { useDateFormatter } from '../catalog/format';
import { PLANS_PATH, SUBSCRIPTIONS_PATH } from '../shell/navigation';
import { CancelSubscriptionButton } from './CancelSubscription';
import { intervalLabel, subscriptionStatusLabel } from './format';
import { type MySubscriptionSummary, type SubscriptionStatus, useMySubscriptions } from './queries';

const STATUSES: readonly (SubscriptionStatus | 'all')[] = [
  'all',
  'active',
  'past_due',
  'canceling',
  'pending',
  'suspended',
  'ended',
  'expired',
];

/**
 * O que o aluno precisa saber de relance (spec 012, RF-08): próxima cobrança, carência,
 * até quando o acesso vale e quando o cancelamento aconteceu.
 */
function summaryFacts(
  t: TFunction,
  formatDate: (iso: string) => string,
  item: MySubscriptionSummary,
) {
  const facts: string[] = [];
  if (item.nextChargeAt) {
    facts.push(t('subscriptions.mine.nextCharge', { date: formatDate(item.nextChargeAt) }));
  }
  if (item.status === 'past_due' && item.graceUntil) {
    facts.push(t('subscriptions.mine.grace', { date: formatDate(item.graceUntil) }));
  }
  if (['active', 'past_due', 'canceling'].includes(item.status) && item.currentPeriodEnd) {
    facts.push(t('subscriptions.mine.accessUntil', { date: formatDate(item.currentPeriodEnd) }));
  }
  if (item.canceledAt) {
    facts.push(t('subscriptions.mine.canceledAt', { date: formatDate(item.canceledAt) }));
  }
  if (item.endedAt) {
    facts.push(t('subscriptions.mine.endedAt', { date: formatDate(item.endedAt) }));
  }
  return facts;
}

function SubscriptionCard({ item }: { item: MySubscriptionSummary }) {
  const { t } = useTranslation();
  const meta = useMeta();
  const formatDate = useDateFormatter();
  const facts = summaryFacts(t, formatDate, item);
  return (
    <AdminCard as="li" pad className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 min-w-0 text-base font-semibold">
          <TextLink href={`${SUBSCRIPTIONS_PATH}/${item.id}`}>{item.plan.title}</TextLink>
        </h3>
        <SubscriptionStatusBadge
          status={item.status}
          label={subscriptionStatusLabel(t, item.status)}
        />
      </div>
      <PriceTag
        cents={item.priceCents}
        period={intervalLabel(t, item.plan.interval)}
        currency={item.currency}
        locale={meta.data?.locale}
      />
      {facts.length > 0 ? (
        <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <AdminButton href={`${SUBSCRIPTIONS_PATH}/${item.id}`} size="sm">
          {t('subscriptions.mine.open')}
        </AdminButton>
        <CancelSubscriptionButton
          subscription={{
            id: item.id,
            status: item.status,
            planTitle: item.plan.title,
            currentPeriodEnd: item.currentPeriodEnd,
          }}
        />
      </div>
    </AdminCard>
  );
}

/**
 * "Minha assinatura" dentro de `/conta/compras` (spec 006, mapa de telas; spec 012, RF-08):
 * plano, estado, próxima cobrança e histórico, com filtro por estado e o checkout para assinar
 * outro plano.
 */
export function MySubscriptions() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SubscriptionStatus | 'all'>('all');
  const query = useMySubscriptions(status);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  const options = STATUSES.map((value) => ({
    id: value,
    label:
      value === 'all' ? t('subscriptions.mine.filters.all') : subscriptionStatusLabel(t, value),
  }));
  const chosen = options.find((option) => option.id === status);
  const failure = query.isError ? describeError(t, query.error) : null;

  return (
    <AdminSection
      title={t('subscriptions.mine.title')}
      actions={
        <AdminButton href={PLANS_PATH} size="sm">
          {t('subscriptions.mine.browsePlans')}
        </AdminButton>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <AdminMenu
              options={options}
              value={status}
              onChange={(id: string) => setStatus(id as SubscriptionStatus | 'all')}
              label={t('subscriptions.mine.filters.label')}
              aria-label={`${t('subscriptions.mine.filters.label')}: ${chosen?.label ?? ''}`}
            />
          </div>
        </div>

        {query.isPending ? (
          <AdminCard pad aria-busy="true">
            <LoadingState label={t('subscriptions.mine.loading')} />
          </AdminCard>
        ) : failure ? (
          <AdminCard pad>
            <ErrorState
              title={t('subscriptions.mine.errorTitle')}
              text={failure.message}
              detail={failure.detail}
              retryLabel={t('common.retry')}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          </AdminCard>
        ) : items.length === 0 ? (
          <AdminEmpty
            icon={<BadgeCheck aria-hidden="true" />}
            title={
              status === 'all'
                ? t('subscriptions.mine.emptyTitle')
                : t('subscriptions.mine.emptyFilteredTitle')
            }
            text={
              status === 'all'
                ? t('subscriptions.mine.emptyText')
                : t('subscriptions.mine.emptyFilteredText')
            }
          >
            <span className="mt-3 flex">
              <AdminButton href={PLANS_PATH}>{t('subscriptions.mine.emptyAction')}</AdminButton>
            </span>
          </AdminEmpty>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {items.map((item) => (
                <SubscriptionCard key={item.id} item={item} />
              ))}
            </ul>
            {query.hasNextPage ? (
              <span className="flex">
                <AdminButton
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  aria-busy={query.isFetchingNextPage || undefined}
                >
                  {query.isFetchingNextPage
                    ? t('common.loading')
                    : t('subscriptions.mine.loadMore')}
                </AdminButton>
              </span>
            ) : null}
          </>
        )}
      </div>
    </AdminSection>
  );
}
