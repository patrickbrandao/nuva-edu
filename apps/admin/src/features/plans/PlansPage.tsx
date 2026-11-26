import {
  AdminButton,
  AdminEmpty,
  AdminMenu,
  AdminPageHeader,
  AdminSearch,
  AdminStatus,
  AdminTable,
  ConfirmDialog,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tags } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import {
  planCoverageDetails,
  planCoverageLabel,
  planIntervalName,
  planPriceLabel,
  planSubscriptionCountLabel,
  usePlansError,
  usePlansMoney,
} from './format';
import {
  NEW_PLAN_PATH,
  PLAN_INTERVALS,
  type Plan,
  type PlanInterval,
  planPath,
  plansKeys,
  updatePlan,
  usePlansList,
} from './queries';

const ALL = 'all';
const ACTIVE = 'active';
const INACTIVE = 'inactive';
const ACTIVE_FILTERS = [ACTIVE, INACTIVE] as const;

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/**
 * Planos (spec 006, mapa de telas; spec 012, "Planos"; `/planos`, `plan.manage`, só admin):
 * busca por título ou slug, filtros de situação e periodicidade, a ordem da vitrine e o que cada
 * plano libera. Ativar e desativar pelo botão; excluir não existe — plano com assinaturas só é
 * desativado, e a API é quem autoriza.
 */
export function PlansPage() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const money = usePlansMoney();
  const message = usePlansError();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const active = pick(params.get('active'), ACTIVE_FILTERS);
  const interval = pick(params.get('interval'), PLAN_INTERVALS);
  const list = usePlansList({
    ...(q ? { q } : {}),
    ...(active ? { active: active === ACTIVE } : {}),
    ...(interval ? { interval } : {}),
  });
  const plans: Plan[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const [deactivating, setDeactivating] = useState<Plan | null>(null);

  const setFilter = (key: string, value: string | undefined) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== ALL) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: plansKeys.all() });

  const toggle = useAction((plan: Plan) => updatePlan(api, plan.id, { active: !plan.active }));

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilter('q', search.trim() || undefined);
  };

  const onToggle = async (plan: Plan) => {
    const result = await toggle.run(plan);
    if (result.ok) {
      toast.success(
        plan.active
          ? t('plans.deactivated', { title: plan.title })
          : t('plans.activated', { title: plan.title }),
      );
      await refresh();
    } else {
      toast.error(message(result.error), { title: plan.title });
    }
  };

  const onDeactivate = async () => {
    if (!deactivating) return;
    const plan = deactivating;
    const result = await toggle.run(plan);
    setDeactivating(null);
    if (result.ok) {
      toast.success(t('plans.deactivated', { title: plan.title }));
      await refresh();
    } else {
      toast.error(message(result.error), { title: plan.title });
    }
  };

  const activeOptions = [
    { id: ALL, label: t('plans.filters.allStatuses') },
    { id: ACTIVE, label: t('plans.filters.active') },
    { id: INACTIVE, label: t('plans.filters.inactive') },
  ];
  const activeValue: string = active ?? ALL;
  const activeLabel = activeOptions.find((option) => option.id === activeValue)?.label ?? '';
  const intervalOptions = [
    { id: ALL, label: t('plans.filters.allIntervals') },
    ...PLAN_INTERVALS.map((id: PlanInterval) => ({ id, label: planIntervalName(t, id) })),
  ];
  const intervalValue: string = interval ?? ALL;
  const intervalMenuLabel =
    intervalOptions.find((option) => option.id === intervalValue)?.label ?? '';
  const filtered = q !== '' || active !== undefined || interval !== undefined;

  const columns = [
    {
      id: 'title',
      label: t('plans.columns.title'),
      render: (plan: Plan) => (
        <span className="inline-flex flex-col">
          <span>{plan.title}</span>
          <span className="text-xs text-ink-3">{plan.slug}</span>
        </span>
      ),
    },
    {
      id: 'interval',
      label: t('plans.columns.interval'),
      render: (plan: Plan) => planIntervalName(t, plan.interval),
    },
    {
      id: 'price',
      label: t('plans.columns.price'),
      render: (plan: Plan) => planPriceLabel(t, money, plan),
    },
    {
      id: 'coverage',
      label: t('plans.columns.coverage'),
      render: (plan: Plan) => (
        <span className="inline-flex flex-col">
          <span>{planCoverageLabel(t, plan)}</span>
          <span className="text-xs text-ink-3">{planCoverageDetails(t, plan)}</span>
        </span>
      ),
    },
    {
      id: 'subscriptions',
      label: t('plans.columns.subscriptions'),
      render: (plan: Plan) => planSubscriptionCountLabel(t, plan.subscriptionCount),
    },
    {
      id: 'position',
      label: t('plans.columns.position'),
      render: (plan: Plan) => String(plan.position),
    },
    {
      id: 'status',
      label: t('plans.columns.status'),
      render: (plan: Plan) => (
        <AdminStatus dot tone={plan.active ? 'green' : 'gray'}>
          {plan.active ? t('plans.filters.active') : t('plans.filters.inactive')}
        </AdminStatus>
      ),
    },
    {
      id: 'actions',
      label: t('plans.columns.actions'),
      render: (plan: Plan) => (
        <span className="inline-flex flex-wrap gap-2">
          <AdminButton
            size="sm"
            href={planPath(plan.id)}
            icon={<Pencil size={14} aria-hidden="true" />}
          >
            {t('plans.editAction')}
          </AdminButton>
          <AdminButton
            size="sm"
            disabled={toggle.busy}
            onClick={() => (plan.active ? setDeactivating(plan) : void onToggle(plan))}
          >
            {plan.active ? t('plans.deactivate') : t('plans.activate')}
          </AdminButton>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t('menu.items.plans')}
        subtitle={t('plans.subtitle')}
        actions={
          <AdminButton href={NEW_PLAN_PATH} icon={<Plus size={16} aria-hidden="true" />}>
            {t('plans.create')}
          </AdminButton>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <form className="flex items-center gap-2" onSubmit={onSearch}>
          <AdminSearch
            value={search}
            onChange={setSearch}
            label={t('plans.filters.search')}
            placeholder={t('plans.filters.searchPlaceholder')}
            maxLength={200}
          />
          <AdminButton type="submit">{t('plans.filters.searchButton')}</AdminButton>
        </form>
        <AdminMenu
          options={activeOptions}
          value={activeValue}
          onChange={(id: string) => setFilter('active', id === ALL ? undefined : id)}
          aria-label={t('plans.filters.statusLabel', { value: activeLabel })}
        />
        <AdminMenu
          options={intervalOptions}
          value={intervalValue}
          onChange={(id: string) => setFilter('interval', id === ALL ? undefined : id)}
          aria-label={t('plans.filters.intervalLabel', { value: intervalMenuLabel })}
        />
        {filtered ? (
          <AdminButton onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            {t('plans.filters.clear')}
          </AdminButton>
        ) : null}
      </div>
      {list.isPending ? (
        <LoadingState label={t('plans.loading')} />
      ) : list.isError && plans.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('plans.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={plans}
            empty={
              <AdminEmpty
                icon={<Tags aria-hidden="true" />}
                title={filtered ? t('plans.emptyFiltered') : t('plans.empty')}
                text={filtered ? t('plans.emptyFilteredText') : t('plans.emptyText')}
              >
                {filtered ? (
                  <AdminButton onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    {t('plans.filters.clear')}
                  </AdminButton>
                ) : (
                  <AdminButton href={NEW_PLAN_PATH}>{t('plans.create')}</AdminButton>
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
              {t('plans.loadMoreError')}
            </p>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={deactivating !== null}
        onCancel={() => setDeactivating(null)}
        onConfirm={() => void onDeactivate()}
        title={t('plans.deactivateTitle')}
        itemName={deactivating?.title ?? ''}
        message={
          (deactivating?.subscriptionCount ?? 0) > 0
            ? t('plans.deactivateWithSubscriptions', {
                count: deactivating?.subscriptionCount ?? 0,
              })
            : t('plans.deactivateMessage')
        }
        confirmLabel={t('plans.deactivate')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        busy={toggle.busy}
      />
    </>
  );
}
