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
import { Pencil, Plus, TicketPercent } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { CouponDialog } from './CouponDialog';
import {
  couponAppliesToLabel,
  couponDiscountLabel,
  couponPerUserLabel,
  couponUsesLabel,
  useSalesMoney,
} from './format';
import {
  COUPON_APPLIES_TO,
  type Coupon,
  type CouponAppliesTo,
  salesKeys,
  updateCoupon,
  useCouponsList,
} from './queries';

const ALL = 'all';
const ACTIVE = 'active';
const INACTIVE = 'inactive';
const ACTIVE_FILTERS = [ACTIVE, INACTIVE] as const;

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/**
 * Cupons (spec 006, mapa de telas; spec 011, "Cupons"; `/cupons`, `coupon.manage`, só admin):
 * busca pelo código, filtros de situação e de aplicação, criação e edição no diálogo e
 * desativação com confirmação — o cupom nunca é excluído, só sai de circulação. Quem autoriza
 * cada escrita é a API.
 */
export function CouponsPage() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const money = useSalesMoney();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const active = pick(params.get('active'), ACTIVE_FILTERS);
  const appliesTo = pick(params.get('appliesTo'), COUPON_APPLIES_TO);
  const list = useCouponsList({
    ...(q ? { q } : {}),
    ...(active ? { active: active === ACTIVE } : {}),
    ...(appliesTo ? { appliesTo } : {}),
  });
  const coupons: Coupon[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);

  const [editing, setEditing] = useState<Coupon | null>(null);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<Coupon | null>(null);

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

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: salesKeys.coupons() }),
      queryClient.invalidateQueries({ queryKey: salesKeys.orders() }),
    ]);

  const toggle = useAction(async (coupon: Coupon) => {
    const saved = await updateCoupon(api, coupon.id, { active: !coupon.active });
    return saved;
  });

  const deactivate = useAction(async (coupon: Coupon) => {
    const saved = await updateCoupon(api, coupon.id, { active: false });
    return saved;
  });

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilter('q', search.trim() || undefined);
  };

  const onToggle = async (coupon: Coupon) => {
    const result = await toggle.run(coupon);
    if (result.ok) {
      toast.success(
        coupon.active
          ? t('sales.coupons.deactivated', { code: coupon.code })
          : t('sales.coupons.activated', { code: coupon.code }),
      );
      await refresh();
    } else {
      toast.error(t('sales.coupons.toggleFailed'), { title: coupon.code });
    }
  };

  const onDeactivate = async () => {
    if (!deactivating) return;
    const coupon = deactivating;
    const result = await deactivate.run(coupon);
    setDeactivating(null);
    if (result.ok) {
      toast.success(t('sales.coupons.deactivated', { code: coupon.code }));
      await refresh();
    } else {
      toast.error(t('sales.coupons.toggleFailed'), { title: coupon.code });
    }
  };

  const activeOptions = [
    { id: ALL, label: t('sales.coupons.filters.allStatuses') },
    { id: ACTIVE, label: t('sales.coupons.filters.active') },
    { id: INACTIVE, label: t('sales.coupons.filters.inactive') },
  ];
  const activeValue: string = active ?? ALL;
  const appliesOptions = [
    { id: ALL, label: t('sales.coupons.filters.allAppliesTo') },
    ...COUPON_APPLIES_TO.map((id: CouponAppliesTo) => ({
      id,
      label: couponAppliesToLabel(t, id),
    })),
  ];
  const appliesValue = appliesTo ?? ALL;
  const filtered = q !== '' || active !== undefined || appliesTo !== undefined;

  const validity = (coupon: Coupon) =>
    coupon.startsAt || coupon.endsAt
      ? t('sales.coupons.validityRange', {
          from: coupon.startsAt ? formatDateTime(coupon.startsAt) : t('sales.coupons.validityOpen'),
          to: coupon.endsAt ? formatDateTime(coupon.endsAt) : t('sales.coupons.validityOpen'),
        })
      : t('sales.coupons.validityAlways');

  const columns = [
    {
      id: 'code',
      label: t('sales.coupons.columns.code'),
      render: (coupon: Coupon) => (
        <span className="inline-flex flex-col">
          <span>{coupon.code}</span>
          <span className="text-xs text-ink-3">{couponDiscountLabel(t, coupon, money)}</span>
        </span>
      ),
    },
    {
      id: 'appliesTo',
      label: t('sales.coupons.columns.appliesTo'),
      render: (coupon: Coupon) => couponAppliesToLabel(t, coupon.appliesTo),
    },
    {
      id: 'uses',
      label: t('sales.coupons.columns.uses'),
      render: (coupon: Coupon) => (
        <span className="inline-flex flex-col">
          <span>{couponUsesLabel(t, coupon)}</span>
          <span className="text-xs text-ink-3">{couponPerUserLabel(t, coupon)}</span>
        </span>
      ),
    },
    {
      id: 'validity',
      label: t('sales.coupons.columns.validity'),
      render: (coupon: Coupon) => validity(coupon),
    },
    {
      id: 'status',
      label: t('sales.coupons.columns.status'),
      render: (coupon: Coupon) => (
        <AdminStatus dot tone={coupon.active ? 'green' : 'gray'}>
          {coupon.active ? t('sales.coupons.filters.active') : t('sales.coupons.filters.inactive')}
        </AdminStatus>
      ),
    },
    {
      id: 'actions',
      label: t('sales.coupons.columns.actions'),
      render: (coupon: Coupon) => (
        <span className="inline-flex flex-wrap gap-2">
          <AdminButton
            size="sm"
            icon={<Pencil size={14} aria-hidden="true" />}
            onClick={() => setEditing(coupon)}
          >
            {t('sales.coupons.editAction')}
          </AdminButton>
          <AdminButton
            size="sm"
            disabled={toggle.busy}
            onClick={() => (coupon.active ? setDeactivating(coupon) : void onToggle(coupon))}
          >
            {coupon.active ? t('sales.coupons.deactivate') : t('sales.coupons.activate')}
          </AdminButton>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t('menu.items.coupons')}
        subtitle={t('sales.coupons.subtitle')}
        actions={
          <AdminButton
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setCreating(true)}
          >
            {t('sales.coupons.create')}
          </AdminButton>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <form className="flex items-center gap-2" onSubmit={onSearch}>
          <AdminSearch
            value={search}
            onChange={setSearch}
            label={t('sales.coupons.filters.search')}
            placeholder={t('sales.coupons.filters.searchPlaceholder')}
            maxLength={40}
          />
          <AdminButton type="submit">{t('sales.filters.searchButton')}</AdminButton>
        </form>
        <AdminMenu
          options={activeOptions}
          value={activeValue}
          onChange={(id: string) => setFilter('active', id)}
          aria-label={t('sales.coupons.filters.statusLabel', {
            value: activeOptions.find((option) => option.id === activeValue)?.label ?? '',
          })}
        />
        <AdminMenu
          options={appliesOptions}
          value={appliesValue}
          onChange={(id: string) => setFilter('appliesTo', id)}
          aria-label={t('sales.coupons.filters.appliesToLabel', {
            value: appliesOptions.find((option) => option.id === appliesValue)?.label ?? '',
          })}
        />
        {filtered ? (
          <AdminButton onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            {t('sales.filters.clear')}
          </AdminButton>
        ) : null}
      </div>
      {list.isPending ? (
        <LoadingState label={t('sales.coupons.loading')} />
      ) : list.isError && coupons.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('sales.coupons.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={coupons}
            empty={
              <AdminEmpty
                icon={<TicketPercent aria-hidden="true" />}
                title={filtered ? t('sales.coupons.emptyFiltered') : t('sales.coupons.empty')}
                text={
                  filtered ? t('sales.coupons.emptyFilteredText') : t('sales.coupons.emptyText')
                }
              >
                {filtered ? (
                  <AdminButton onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    {t('sales.filters.clear')}
                  </AdminButton>
                ) : (
                  <AdminButton onClick={() => setCreating(true)}>
                    {t('sales.coupons.create')}
                  </AdminButton>
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
              {t('sales.coupons.loadMoreError')}
            </p>
          ) : null}
        </>
      )}
      {creating ? (
        <CouponDialog
          onClose={() => setCreating(false)}
          onDone={async (coupon) => {
            setCreating(false);
            toast.success(t('sales.coupons.created', { code: coupon.code }));
            await refresh();
          }}
        />
      ) : null}
      {editing ? (
        <CouponDialog
          coupon={editing}
          onClose={() => setEditing(null)}
          onDone={async (coupon) => {
            setEditing(null);
            toast.success(t('sales.coupons.updated', { code: coupon.code }));
            await refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deactivating !== null}
        onCancel={() => setDeactivating(null)}
        onConfirm={() => void onDeactivate()}
        title={t('sales.coupons.deactivateTitle')}
        itemName={deactivating?.code ?? ''}
        message={t('sales.coupons.deactivateText')}
        confirmLabel={t('sales.coupons.deactivate')}
        busyLabel={t('common.saving')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        busy={deactivate.busy}
      />
    </>
  );
}
