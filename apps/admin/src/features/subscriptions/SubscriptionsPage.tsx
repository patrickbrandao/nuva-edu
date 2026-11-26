import {
  AdminButton,
  AdminEmpty,
  AdminField,
  AdminMenu,
  AdminPageHeader,
  AdminSearch,
  AdminTable,
  LoadingState,
  SubscriptionStatusBadge,
  TextLink,
} from '@nuva-edu/ui';
import { Repeat } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { usePlanOptions } from '../plans/queries';
import { ALL, hasSubscriptionFilters, readSubscriptionFilters, subscriptionQuery } from './filters';
import { subscriptionPlanLabel, subscriptionStatusLabel, useSubscriptionsMoney } from './format';
import {
  type AdminSubscriptionSummary,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTIONS_PATH,
  type SubscriptionStatus,
  subscriptionPath,
  useSubscriptionsList,
} from './queries';

/**
 * Assinaturas (spec 006, mapa de telas; spec 012; `/assinaturas`, `sales.view`): `manager` e
 * `admin` consultam, o `instructor` recebe `403` da API. Filtros no endereço — período, estado,
 * plano (só para quem pode listar planos, `plan.manage`) e busca pelo assinante. O cancelamento e
 * o reembolso ficam no detalhe, com o papel que a API exige.
 */
export function SubscriptionsPage() {
  const { t } = useTranslation();
  const can = useCan();
  const money = useSubscriptionsMoney();
  const [params, setParams] = useSearchParams();
  const filters = readSubscriptionFilters(params);
  const list = useSubscriptionsList(subscriptionQuery(filters));
  const subscriptions: AdminSubscriptionSummary[] =
    list.data?.pages.flatMap((page) => page.items) ?? [];
  const [search, setSearch] = useState(filters.q ?? '');
  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);

  const canPlans = can('plan.manage');
  const plans = usePlanOptions(canPlans);

  const update = (key: string, value: string | undefined) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const filtered = hasSubscriptionFilters(filters);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    update('q', search.trim() || undefined);
  };

  const statusOptions = [
    { id: ALL, label: t('subscriptions.filters.allStatuses') },
    ...SUBSCRIPTION_STATUSES.map((id: SubscriptionStatus) => ({
      id,
      label: subscriptionStatusLabel(t, id),
    })),
  ];
  const statusValue = filters.status ?? ALL;
  const statusLabel = statusOptions.find((option) => option.id === statusValue)?.label ?? '';

  const planOptions = [
    { id: ALL, label: t('subscriptions.filters.allPlans') },
    ...plans.map((plan) => ({ id: plan.id, label: plan.title })),
  ];
  const planValue = filters.planId ?? ALL;
  const planLabel =
    planOptions.find((option) => option.id === planValue)?.label ??
    t('subscriptions.filters.allPlans');

  const period = (subscription: AdminSubscriptionSummary) => {
    if (!subscription.currentPeriodStart && !subscription.currentPeriodEnd) {
      return t('subscriptions.noPeriod');
    }
    return t('subscriptions.periodRange', {
      from: subscription.currentPeriodStart
        ? formatDateTime(subscription.currentPeriodStart)
        : t('subscriptions.noPeriod'),
      to: subscription.currentPeriodEnd
        ? formatDateTime(subscription.currentPeriodEnd)
        : t('subscriptions.noPeriod'),
    });
  };

  const columns = [
    {
      id: 'subscriber',
      label: t('subscriptions.columns.subscriber'),
      render: (subscription: AdminSubscriptionSummary) => (
        <TextLink href={subscriptionPath(subscription.id)}>
          <span className="inline-flex flex-col">
            <span>{subscription.subscriber.name}</span>
            <span className="text-xs text-ink-3">{subscription.subscriber.email}</span>
          </span>
        </TextLink>
      ),
    },
    {
      id: 'plan',
      label: t('subscriptions.columns.plan'),
      render: (subscription: AdminSubscriptionSummary) =>
        subscriptionPlanLabel(t, subscription.plan),
    },
    {
      id: 'status',
      label: t('subscriptions.columns.status'),
      render: (subscription: AdminSubscriptionSummary) => (
        <SubscriptionStatusBadge
          status={subscription.status}
          label={subscriptionStatusLabel(t, subscription.status)}
        />
      ),
    },
    {
      id: 'price',
      label: t('subscriptions.columns.price'),
      render: (subscription: AdminSubscriptionSummary) => money(subscription.priceCents),
    },
    {
      id: 'period',
      label: t('subscriptions.columns.period'),
      render: (subscription: AdminSubscriptionSummary) => period(subscription),
    },
    {
      id: 'nextCharge',
      label: t('subscriptions.columns.nextCharge'),
      render: (subscription: AdminSubscriptionSummary) =>
        subscription.nextChargeAt
          ? formatDateTime(subscription.nextChargeAt)
          : subscription.graceUntil
            ? t('subscriptions.graceUntil', { date: formatDateTime(subscription.graceUntil) })
            : t('subscriptions.noNextCharge'),
    },
    {
      id: 'createdAt',
      label: t('subscriptions.columns.createdAt'),
      render: (subscription: AdminSubscriptionSummary) => formatDateTime(subscription.createdAt),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t('menu.items.subscriptions')}
        subtitle={t('subscriptions.subtitle')}
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <form className="flex items-center gap-2" onSubmit={onSearch}>
          <AdminSearch
            value={search}
            onChange={setSearch}
            label={t('subscriptions.filters.search')}
            placeholder={t('subscriptions.filters.searchPlaceholder')}
            maxLength={200}
          />
          <AdminButton type="submit">{t('subscriptions.filters.searchButton')}</AdminButton>
        </form>
        <AdminField
          type="date"
          label={t('subscriptions.filters.from')}
          value={filters.from ?? ''}
          max={filters.to}
          onChange={(value: string) => update('from', value || undefined)}
        />
        <AdminField
          type="date"
          label={t('subscriptions.filters.to')}
          value={filters.to ?? ''}
          min={filters.from}
          onChange={(value: string) => update('to', value || undefined)}
        />
        <AdminMenu
          options={statusOptions}
          value={statusValue}
          onChange={(id: string) => update('status', id === ALL ? undefined : id)}
          aria-label={t('subscriptions.filters.statusLabel', { value: statusLabel })}
        />
        {canPlans ? (
          <AdminMenu
            options={planOptions}
            value={planValue}
            onChange={(id: string) => update('planId', id === ALL ? undefined : id)}
            aria-label={t('subscriptions.filters.planLabel', { value: planLabel })}
          />
        ) : null}
        {filtered ? (
          <AdminButton onClick={clear}>{t('subscriptions.filters.clear')}</AdminButton>
        ) : null}
      </div>
      {list.isPending ? (
        <LoadingState label={t('subscriptions.loading')} />
      ) : list.isError && subscriptions.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('subscriptions.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={subscriptions}
            empty={
              <AdminEmpty
                icon={<Repeat aria-hidden="true" />}
                title={filtered ? t('subscriptions.emptyFiltered') : t('subscriptions.empty')}
                text={
                  filtered ? t('subscriptions.emptyFilteredText') : t('subscriptions.emptyText')
                }
              >
                {filtered ? (
                  <AdminButton onClick={clear}>{t('subscriptions.filters.clear')}</AdminButton>
                ) : canPlans ? (
                  <AdminButton href="/planos">{t('subscriptions.openPlans')}</AdminButton>
                ) : (
                  <AdminButton href={SUBSCRIPTIONS_PATH}>{t('common.backHome')}</AdminButton>
                )}
              </AdminEmpty>
            }
          />
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <AdminButton
                disabled={list.isFetchingNextPage}
                aria-busy={list.isFetchingNextPage || undefined}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
          {list.isFetchNextPageError ? (
            <p role="alert" className="mt-2 text-center text-sm text-ink-2">
              {t('subscriptions.loadMoreError')}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
