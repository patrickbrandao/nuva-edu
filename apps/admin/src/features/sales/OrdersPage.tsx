import {
  AdminButton,
  AdminEmpty,
  AdminPageHeader,
  AdminStats,
  AdminTable,
  LoadingState,
  OrderStatusBadge,
  TextLink,
} from '@nuva-edu/ui';
import { Download, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { exportHref, hasSalesFilters, readSalesFilters, salesQuery } from './filters';
import { orderStatusLabel, useSalesMoney } from './format';
import { ORDER_STATUSES, type OrderSummary, orderPath, useOrdersList } from './queries';
import { SalesFiltersBar } from './SalesFiltersBar';

/**
 * Pedidos (spec 006, mapa de telas; spec 011, "Consulta e exportação"; `GET /api/v1/orders`,
 * `sales.view`): filtros no endereço, totais do filtro e o caminho para o detalhe. A exportação
 * em CSV só aparece para quem tem `sales.export`; quem autoriza é a API.
 */
export function OrdersPage() {
  const { t } = useTranslation();
  const can = useCan();
  const money = useSalesMoney();
  const [params, setParams] = useSearchParams();
  const filters = readSalesFilters(params, ORDER_STATUSES);
  const list = useOrdersList(salesQuery(filters));
  const orders: OrderSummary[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const totals = list.data?.pages[0]?.totals;

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
  const filtered = hasSalesFilters(filters);

  const columns = [
    {
      id: 'number',
      label: t('sales.orders.columns.number'),
      render: (order: OrderSummary) => (
        <TextLink href={orderPath(order.id)}>
          {t('sales.orders.number', { number: order.number })}
        </TextLink>
      ),
    },
    {
      id: 'buyer',
      label: t('sales.orders.columns.buyer'),
      render: (order: OrderSummary) => (
        <span className="inline-flex flex-col">
          {order.buyer.name}
          <span className="text-xs text-ink-3">{order.buyer.email}</span>
        </span>
      ),
    },
    {
      id: 'status',
      label: t('sales.orders.columns.status'),
      render: (order: OrderSummary) => (
        <OrderStatusBadge status={order.status} label={orderStatusLabel(t, order.status)} />
      ),
    },
    {
      id: 'items',
      label: t('sales.orders.columns.items'),
      render: (order: OrderSummary) => t('sales.orders.itemCount', { count: order.itemCount }),
    },
    {
      id: 'total',
      label: t('sales.orders.columns.total'),
      render: (order: OrderSummary) => money(order.totalCents),
    },
    {
      id: 'createdAt',
      label: t('sales.orders.columns.createdAt'),
      render: (order: OrderSummary) => formatDateTime(order.createdAt),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t('menu.items.orders')}
        subtitle={t('sales.orders.subtitle')}
        actions={
          can('sales.export') ? (
            <AdminButton
              href={exportHref(filters)}
              icon={<Download size={16} aria-hidden="true" />}
            >
              {t('sales.export.open')}
            </AdminButton>
          ) : null
        }
      />
      <SalesFiltersBar filters={filters} onChange={update} onClear={clear} />
      {totals ? (
        <AdminStats
          className="mb-4"
          columns={5}
          stats={[
            {
              id: 'subtotal',
              value: money(totals.subtotalCents),
              label: t('sales.totals.subtotal'),
            },
            {
              id: 'discount',
              value: money(totals.discountCents),
              label: t('sales.totals.discount'),
            },
            {
              id: 'refunded',
              value: money(totals.refundedCents),
              label: t('sales.totals.refunded'),
            },
            { id: 'total', value: money(totals.totalCents), label: t('sales.totals.total') },
            { id: 'net', value: money(totals.netCents), label: t('sales.totals.net') },
          ]}
        />
      ) : null}
      {list.isPending ? (
        <LoadingState label={t('sales.orders.loading')} />
      ) : list.isError && orders.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('sales.orders.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={orders}
            empty={
              <AdminEmpty
                icon={<Receipt aria-hidden="true" />}
                title={filtered ? t('sales.orders.emptyFiltered') : t('sales.orders.empty')}
                text={filtered ? t('sales.orders.emptyFilteredText') : t('sales.orders.emptyText')}
              >
                {filtered ? (
                  <AdminButton onClick={clear}>{t('sales.filters.clear')}</AdminButton>
                ) : (
                  <AdminButton href="/">{t('common.backHome')}</AdminButton>
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
              {t('sales.orders.loadMoreError')}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
