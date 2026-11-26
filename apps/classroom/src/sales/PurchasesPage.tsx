import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminMenu,
  ErrorState,
  LoadingState,
  OrderStatusBadge,
  PageTitle,
  TextLink,
} from '@nuva-edu/ui';
import { Receipt } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { useDateFormatter } from '../catalog/format';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { HOME_PATH, ORDER_PATH } from '../shell/navigation';
import { orderStatusLabel } from './format';
import { type MyOrderSummary, type OrderStatus, useMyOrders } from './queries';

const STATUSES: readonly (OrderStatus | 'all')[] = [
  'all',
  'pending',
  'paid',
  'partially_refunded',
  'refunded',
  'canceled',
  'expired',
  'chargeback',
];

/** Limite de pedidos `pending` ao mesmo tempo (spec 011, "Pedido e seus estados"). */
const PENDING_LIMIT = 3;

function OrderCard({ order }: { order: MyOrderSummary }) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const number = t('sales.order.number', { number: order.number });
  const titles = order.items.map((item) => item.title).join(', ');
  return (
    <AdminCard as="li" pad className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 min-w-0 text-base font-semibold">
          <TextLink href={`${ORDER_PATH}/${order.id}`}>{number}</TextLink>
        </h2>
        <OrderStatusBadge status={order.status} label={orderStatusLabel(t, order.status)} />
      </div>
      <p className="m-0 text-sm text-ink">{titles}</p>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
        <span>{t('sales.orders.itemCount', { count: order.itemCount })}</span>
        <span>{formatDate(order.createdAt)}</span>
        {order.paidAt ? (
          <span>{t('sales.orders.paidOn', { date: formatDate(order.paidAt) })}</span>
        ) : null}
      </p>
      <span className="flex">
        <TextLink href={`${ORDER_PATH}/${order.id}`} className="text-sm">
          {t('sales.orders.open')}
        </TextLink>
      </span>
    </AdminCard>
  );
}

function PurchasesView() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const query = useMyOrders(status);
  const orders = query.data?.pages.flatMap((page) => page.items) ?? [];
  const pending = orders.filter((order) => order.status === 'pending').length;

  const options = STATUSES.map((value) => ({
    id: value,
    label: value === 'all' ? t('sales.orders.filters.all') : orderStatusLabel(t, value),
  }));
  const chosen = options.find((option) => option.id === status);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <AdminMenu
            options={options}
            value={status}
            onChange={(id: string) => setStatus(id as OrderStatus | 'all')}
            label={t('sales.orders.filters.label')}
            aria-label={`${t('sales.orders.filters.label')}: ${chosen?.label ?? ''}`}
          />
        </div>
      </div>

      {pending >= PENDING_LIMIT ? (
        <p role="status" className="m-0 text-sm text-ink-2">
          {t('sales.orders.pendingLimit')}
        </p>
      ) : null}

      {query.isPending ? (
        <AdminCard pad aria-busy="true">
          <LoadingState label={t('sales.orders.loading')} />
        </AdminCard>
      ) : query.isError ? (
        <AdminCard pad>
          <ErrorState
            title={t('sales.orders.errorTitle')}
            text={describeError(t, query.error).message}
            detail={describeError(t, query.error).detail}
            retryLabel={t('common.retry')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </AdminCard>
      ) : orders.length === 0 ? (
        <AdminEmpty
          icon={<Receipt aria-hidden="true" />}
          title={t('sales.orders.emptyTitle')}
          text={t('sales.orders.emptyText')}
        >
          <span className="mt-3 flex">
            <AdminButton href={HOME_PATH}>{t('sales.orders.emptyAction')}</AdminButton>
          </span>
        </AdminEmpty>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </ul>
          {query.hasNextPage ? (
            <span className="flex">
              <AdminButton
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                aria-busy={query.isFetchingNextPage || undefined}
              >
                {query.isFetchingNextPage ? t('common.loading') : t('sales.orders.loadMore')}
              </AdminButton>
            </span>
          ) : null}
        </>
      )}
    </>
  );
}

/** `/conta/compras`: pedidos do aluno, com estado e o caminho para o detalhe (spec 011, RF-08). */
export function PurchasesPage() {
  const { t } = useTranslation();
  usePageMeta(t('sales.orders.title'), t('sales.orders.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8 sm:px-6">
          <PageTitle subtitle={t('sales.orders.subtitle')}>{t('sales.orders.title')}</PageTitle>
          <PurchasesView />
        </div>
      )}
    </RequireSession>
  );
}
