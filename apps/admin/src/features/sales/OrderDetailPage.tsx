import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminList,
  AdminPageHeader,
  AdminSection,
  AdminStatus,
  AdminTable,
  Alert,
  LoadingState,
  OrderStatusBadge,
  OrderTotals,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Receipt, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { usePageCrumb } from '../../shell/crumbs';
import {
  orderStatusLabel,
  paymentMethodLabel,
  paymentProviderLabel,
  paymentStatusLabel,
  refundStatusLabel,
  useSalesError,
  useSalesMoney,
  useSalesMoneyOptions,
} from './format';
import {
  isRefundable,
  ORDERS_PATH,
  type OrderDetail,
  type OrderItem,
  type Payment,
  type Refund,
  retryRefund,
  salesKeys,
  useOrder,
} from './queries';
import { RefundDialog } from './RefundDialog';

const REFUND_TONES: Record<Refund['status'], string> = {
  requested: 'amber',
  done: 'green',
  failed: 'red',
};

/**
 * Detalhe do pedido (spec 011; `GET /api/v1/orders/{id}`, `sales.view`): comprador com o
 * documento fiscal, itens com os valores congelados, totais, cobranças e reembolsos. Só o admin
 * vê o reembolso (`order.refund`) e quem autoriza é a API; o estorno em andamento é acompanhado
 * consultando o pedido até o desfecho.
 */
export function OrderDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const order = useOrder(id);
  usePageCrumb(order.data ? t('sales.orders.number', { number: order.data.number }) : null);

  if (order.isPending) return <LoadingState label={t('sales.orders.detailLoading')} />;
  if (order.isError && !order.data) {
    if (isApiError(order.error) && order.error.status === 404) {
      return (
        <AdminEmpty
          icon={<Receipt aria-hidden="true" />}
          title={t('sales.orders.notFound')}
          text={t('sales.orders.notFoundText')}
        >
          <AdminButton href={ORDERS_PATH}>{t('sales.orders.backToList')}</AdminButton>
        </AdminEmpty>
      );
    }
    return (
      <QueryErrorState
        error={order.error}
        title={t('sales.orders.detailErrorTitle')}
        onRetry={() => void order.refetch()}
        retrying={order.isFetching}
      />
    );
  }
  return <OrderView order={order.data} />;
}

function OrderView({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const money = useSalesMoney();
  const moneyOptions = useSalesMoneyOptions();
  const message = useSalesError();
  const queryClient = useQueryClient();
  const [refunding, setRefunding] = useState(false);

  const retry = useAction((refundId: string) => retryRefund(api, refundId));
  const canRefund = can('order.refund');
  const refundable = isRefundable(order);
  const client = queryClient;

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: salesKeys.order(order.id) }),
      client.invalidateQueries({ queryKey: salesKeys.orders() }),
    ]);

  const onRetry = async (refund: Refund) => {
    const result = await retry.run(refund.id);
    if (result.ok) {
      toast.success(t('sales.refunds.retryDone'));
      await refresh();
    } else {
      toast.error(message(result.error), { title: t('sales.refunds.retryFailed') });
    }
  };

  const itemColumns = [
    {
      id: 'title',
      label: t('sales.orders.itemsColumns.title'),
      render: (item: OrderItem) => (
        <span className="inline-flex flex-col">
          {item.title}
          <span className="text-xs text-ink-3">{t(`sales.productType.${item.productType}`)}</span>
        </span>
      ),
    },
    {
      id: 'unitPrice',
      label: t('sales.orders.itemsColumns.unitPrice'),
      render: (item: OrderItem) => money(item.unitPriceCents),
    },
    {
      id: 'discount',
      label: t('sales.orders.itemsColumns.discount'),
      render: (item: OrderItem) => money(item.discountCents),
    },
    {
      id: 'paid',
      label: t('sales.orders.itemsColumns.paid'),
      render: (item: OrderItem) => money(item.paidCents),
    },
    {
      id: 'refunded',
      label: t('sales.orders.itemsColumns.refunded'),
      render: (item: OrderItem) =>
        item.refundedCents > 0 ? money(item.refundedCents) : t('sales.orders.itemsColumns.none'),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t('sales.orders.detailTitle', { number: order.number })}
        subtitle={t('sales.orders.detailSubtitle', { date: formatDateTime(order.createdAt) })}
        actions={
          canRefund && refundable ? (
            <AdminButton
              icon={<Undo2 size={16} aria-hidden="true" />}
              onClick={() => setRefunding(true)}
            >
              {t('sales.refunds.open')}
            </AdminButton>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <OrderStatusBadge status={order.status} label={orderStatusLabel(t, order.status)} />
        <span className="text-sm text-ink-3">
          {t('sales.orders.itemsSummary', { count: order.itemCount })}
        </span>
        {order.paidAt ? (
          <span className="text-sm text-ink-3">
            {t('sales.orders.paidOn', { date: formatDateTime(order.paidAt) })}
          </span>
        ) : null}
        {order.expiresAt && order.status === 'pending' ? (
          <span className="text-sm text-ink-3">
            {t('sales.orders.expiresOn', { date: formatDateTime(order.expiresAt) })}
          </span>
        ) : null}
        {order.couponCode ? (
          <span className="text-sm text-ink-3">
            {t('sales.orders.coupon', { code: order.couponCode })}
          </span>
        ) : null}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <AdminSection title={t('sales.orders.buyer')}>
          <AdminCard pad>
            <AdminDetails
              wrap
              items={[
                { label: t('sales.orders.buyerName'), value: order.buyer.name },
                { label: t('sales.orders.buyerEmail'), value: order.buyer.email },
                {
                  label: t(`sales.buyer.taxIdType.${order.buyer.taxIdType}`),
                  value: order.buyer.taxId,
                },
                {
                  label: t('sales.orders.buyerAccount'),
                  value: can('users.view_private') ? (
                    <TextLink href={`/alunos/${order.buyer.id}`} quiet>
                      {t('sales.orders.openAccount')}
                    </TextLink>
                  ) : (
                    order.buyer.name
                  ),
                },
              ]}
            />
          </AdminCard>
        </AdminSection>
        <AdminSection title={t('sales.orders.totalsTitle')}>
          <AdminCard pad>
            <OrderTotals
              aria-label={t('sales.orders.totalsTitle')}
              {...moneyOptions}
              rows={[
                {
                  id: 'subtotal',
                  label: t('sales.totals.subtotal'),
                  cents: order.subtotalCents,
                },
                {
                  id: 'discount',
                  label: t('sales.totals.discount'),
                  cents: order.discountCents,
                },
                {
                  id: 'refunded',
                  label: t('sales.totals.refunded'),
                  cents: order.refundedCents,
                },
                {
                  id: 'total',
                  label: t('sales.totals.total'),
                  cents: order.totalCents,
                  strong: true,
                },
              ]}
            />
          </AdminCard>
        </AdminSection>
      </div>

      <AdminSection title={t('sales.orders.itemsTitle')}>
        <AdminTable
          columns={itemColumns}
          rows={order.items}
          empty={<AdminEmpty title={t('sales.orders.noItems')} />}
        />
      </AdminSection>

      <AdminSection title={t('sales.orders.paymentsTitle')}>
        {order.payments.length === 0 ? (
          <AdminCard pad>
            <span className="text-sm text-ink-3">{t('sales.orders.noPayments')}</span>
          </AdminCard>
        ) : (
          <AdminList
            items={order.payments.map((payment: Payment) => ({
              id: payment.id,
              icon: <Receipt size={16} aria-hidden="true" />,
              title: money(payment.amountCents),
              text: `${paymentStatusLabel(t, payment)} · ${paymentMethodLabel(
                t,
                payment.method,
              )} · ${paymentProviderLabel(t, payment.provider)}`,
              aside: [
                payment.providerPaymentId,
                t('sales.payments.rawStatus', { status: payment.rawStatus }),
                formatDateTime(payment.paidAt ?? payment.createdAt),
              ],
            }))}
          />
        )}
      </AdminSection>

      <AdminSection title={t('sales.orders.refundsTitle')}>
        {order.refunds.length === 0 ? (
          <AdminCard pad>
            <span className="text-sm text-ink-3">{t('sales.orders.noRefunds')}</span>
          </AdminCard>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {order.refunds.map((refund) => (
              <li key={refund.id}>
                <AdminCard pad className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <AdminStatus dot tone={REFUND_TONES[refund.status]}>
                        {refundStatusLabel(t, refund.status)}
                      </AdminStatus>
                      <strong>{money(refund.amountCents)}</strong>
                      <span className="text-xs text-ink-3">
                        {formatDateTime(refund.doneAt ?? refund.createdAt)}
                      </span>
                    </span>
                    {canRefund && refund.status === 'failed' ? (
                      <AdminButton
                        size="sm"
                        icon={<RotateCcw size={14} aria-hidden="true" />}
                        disabled={retry.busy}
                        aria-busy={retry.busy || undefined}
                        onClick={() => void onRetry(refund)}
                      >
                        {t('sales.refunds.retry')}
                      </AdminButton>
                    ) : null}
                  </div>
                  <p className="m-0 text-sm text-ink">{refund.reason}</p>
                  {refund.items.length > 0 ? (
                    <p className="m-0 text-xs text-ink-3">
                      {refund.items
                        .map((item) => `${item.title} (${money(item.amountCents)})`)
                        .join(' · ')}
                    </p>
                  ) : null}
                  {refund.error ? (
                    // biome-ignore lint/a11y/useValidAriaRole: `role={null}` é a propriedade do Alert que tira o papel, não um atributo
                    <Alert tone="error" role={null}>
                      {t('sales.refunds.error', { error: refund.error })}
                    </Alert>
                  ) : null}
                </AdminCard>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      {refunding ? (
        <RefundDialog
          order={order}
          onClose={() => setRefunding(false)}
          onDone={async (refund) => {
            setRefunding(false);
            toast.success(t('sales.refunds.requested', { amount: money(refund.amountCents) }));
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}
