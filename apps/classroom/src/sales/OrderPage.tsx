import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminSection,
  ConfirmDialog,
  ErrorState,
  formatMoney,
  LoadingState,
  OrderStatusBadge,
  OrderTotals,
  PageTitle,
  PaymentResult,
  PriceTag,
  useToast,
} from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { PackageSearch } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { describeError } from '../api/errors';
import { useMeta } from '../api/meta';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { MY_COURSES_PATH, PURCHASES_PATH } from '../shell/navigation';
import {
  orderStatusLabel,
  paymentMethodLabel,
  providerLabel,
  useDateTimeFormatter,
} from './format';
import {
  isNotFound,
  type MyOrderDetail,
  type OrderStatus,
  useCancelOrder,
  useMyOrder,
} from './queries';

/** Rótulos do retorno do pagamento; o estado vem do pedido, acompanhado enquanto `pending`. */
function paymentLabels(t: TFunction, status: OrderStatus) {
  return {
    region: t('sales.order.payment.region'),
    title: t(`sales.order.payment.${status}.title`),
    text: t(`sales.order.payment.${status}.text`),
    waiting: t('sales.order.payment.waiting'),
  };
}

function OrderItems({ order }: { order: MyOrderDetail }) {
  const { t } = useTranslation();
  const meta = useMeta();
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {order.items.map((item) => {
        const refunded = item.refundedCents > 0;
        return (
          <li
            key={item.id}
            className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0"
          >
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 basis-40 break-words font-medium text-ink">
                {item.title}
              </span>
              <PriceTag
                cents={item.paidCents}
                originalCents={item.discountCents > 0 ? item.unitPriceCents : null}
                currency={order.currency}
                locale={meta.data?.locale}
              />
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
              <span>{t(`product.types.${item.productType}`)}</span>
              {item.discountCents > 0 ? (
                <span>
                  {t('sales.order.item.discount', {
                    value: formatMoney(item.discountCents, {
                      currency: order.currency,
                      locale: meta.data?.locale,
                    }),
                  })}
                </span>
              ) : null}
              {refunded ? (
                <span>
                  {t('sales.order.item.refunded', {
                    value: formatMoney(item.refundedCents, {
                      currency: order.currency,
                      locale: meta.data?.locale,
                    }),
                  })}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function OrderActions({
  order,
  onCancel,
}: {
  order: MyOrderDetail;
  onCancel: (() => void) | null;
}) {
  const { t } = useTranslation();
  const paid = ['paid', 'partially_refunded'].includes(order.status);
  return (
    <div className="flex flex-wrap gap-2">
      {order.status === 'pending' && order.checkoutUrl ? (
        <AdminButton href={order.checkoutUrl} target="_blank" rel="noreferrer" variant="primary">
          {t('sales.order.goToPayment')}
        </AdminButton>
      ) : null}
      {onCancel ? (
        <AdminButton onClick={onCancel}>{t('sales.order.cancel.action')}</AdminButton>
      ) : null}
      {paid ? (
        <AdminButton href={MY_COURSES_PATH} variant={order.checkoutUrl ? 'default' : 'primary'}>
          {t('sales.order.goToCourses')}
        </AdminButton>
      ) : null}
      <AdminButton href={PURCHASES_PATH}>{t('sales.order.backToOrders')}</AdminButton>
    </div>
  );
}

function OrderView({ order }: { order: MyOrderDetail }) {
  const { t } = useTranslation();
  const meta = useMeta();
  const toast = useToast();
  const formatDateTime = useDateTimeFormatter();
  const cancel = useCancelOrder(order.id);
  const [confirming, setConfirming] = useState(false);
  const money = (cents: number) =>
    formatMoney(cents, { currency: order.currency, locale: meta.data?.locale });
  const number = t('sales.order.number', { number: order.number });
  const refunded = order.items.reduce((sum, item) => sum + item.refundedCents, 0);

  const totals = [
    { id: 'subtotal', label: t('sales.order.totals.subtotal'), cents: order.subtotalCents },
    ...(order.discountCents > 0
      ? [
          {
            id: 'discount',
            label: t('sales.order.totals.discount'),
            text: formatMoney(-order.discountCents, {
              currency: order.currency,
              locale: meta.data?.locale,
            }),
          },
        ]
      : []),
    { id: 'total', label: t('sales.order.totals.total'), cents: order.totalCents, strong: true },
    ...(refunded > 0
      ? [
          {
            id: 'refunded',
            label: t('sales.order.totals.refunded'),
            text: money(refunded),
          },
        ]
      : []),
  ];

  const details: { label: string; value: string }[] = [
    { label: t('sales.order.details.number'), value: String(order.number) },
    { label: t('sales.order.details.createdAt'), value: formatDateTime(order.createdAt) },
  ];
  if (order.paidAt) {
    details.push({ label: t('sales.order.details.paidAt'), value: formatDateTime(order.paidAt) });
  }
  if (order.status === 'pending' && order.expiresAt) {
    details.push({
      label: t('sales.order.details.expiresAt'),
      value: formatDateTime(order.expiresAt),
    });
  }
  details.push({ label: t('sales.order.details.buyer'), value: order.buyerName });
  if (order.couponCode) {
    details.push({ label: t('sales.order.details.coupon'), value: order.couponCode });
  }
  details.push({
    label: t('sales.order.details.provider'),
    value: providerLabel(t, order.provider),
  });
  if (order.payment) {
    details.push({
      label: t('sales.order.details.method'),
      value: paymentMethodLabel(t, order.payment.method),
    });
    details.push({
      label: t('sales.order.details.paymentStatus'),
      value: t(`sales.order.payment.status.${order.payment.status}`),
    });
  }

  const pendingDetails =
    order.status === 'pending' ? (
      <div className="flex flex-col gap-2 text-sm text-ink-2">
        <p className="m-0">{t('sales.order.payment.pending.text')}</p>
        {order.expiresAt ? (
          <p className="m-0">
            {t('sales.order.payment.pending.deadline', { when: formatDateTime(order.expiresAt) })}
          </p>
        ) : null}
      </div>
    ) : undefined;

  const confirmCancel = () =>
    cancel.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        toast.success(t('sales.order.cancel.done'));
      },
      onError: (error) => {
        setConfirming(false);
        toast.error(
          describeError(t, error, { order_not_cancelable: t('sales.order.cancel.notCancelable') })
            .message,
          {
            title: t('sales.order.cancel.errorTitle'),
          },
        );
      },
    });

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <PageTitle>{number}</PageTitle>
          <OrderStatusBadge status={order.status} label={orderStatusLabel(t, order.status)} />
        </div>
        <OrderActions
          order={order}
          onCancel={order.status === 'pending' ? () => setConfirming(true) : null}
        />
      </div>

      <PaymentResult
        status={order.status}
        labels={paymentLabels(t, order.status)}
        {...(pendingDetails ? { paymentDetails: pendingDetails } : {})}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <AdminSection title={t('sales.order.itemsTitle')}>
            <AdminCard pad>
              <OrderItems order={order} />
              <div className="mt-4">
                <OrderTotals
                  rows={totals}
                  currency={order.currency}
                  locale={meta.data?.locale}
                  aria-label={t('sales.order.totals.region')}
                />
              </div>
            </AdminCard>
          </AdminSection>
        </div>
        <aside aria-label={t('sales.order.details.title')}>
          <AdminCard pad>
            <AdminDetails wrap items={details} />
          </AdminCard>
        </aside>
      </div>

      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmCancel}
        title={t('sales.order.cancel.title')}
        itemName={number}
        message={t('sales.order.cancel.text')}
        confirmLabel={t('sales.order.cancel.confirm')}
        cancelLabel={t('common.cancel')}
        busy={cancel.isPending}
        busyLabel={t('sales.order.cancel.busy')}
        closeLabel={t('common.dismiss')}
      />
    </article>
  );
}

function OrderPageInner({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useMyOrder(id);

  if (query.isPending) {
    return (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('sales.order.loading')} />
      </AdminCard>
    );
  }

  if (query.isError) {
    if (isNotFound(query.error)) {
      return (
        <>
          <PageTitle>{t('sales.order.notFoundTitle')}</PageTitle>
          <AdminEmpty
            icon={<PackageSearch aria-hidden="true" />}
            text={t('sales.order.notFoundText')}
          >
            <span className="mt-3 flex">
              <AdminButton href={PURCHASES_PATH}>{t('sales.order.backToOrders')}</AdminButton>
            </span>
          </AdminEmpty>
        </>
      );
    }
    const failure = describeError(t, query.error);
    return (
      <AdminCard pad>
        <ErrorState
          title={t('sales.order.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  }

  return query.data ? <OrderView order={query.data} /> : null;
}

function OrderPageByRoute({ id }: { id: string }) {
  return <OrderPageInner id={id} />;
}

/** `/pedidos/:id`: retorno do checkout, estado acompanhado e cancelamento (spec 011). */
export function OrderPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  usePageMeta(t('sales.order.title'), t('sales.order.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
          <OrderPageByRoute id={id} />
        </div>
      )}
    </RequireSession>
  );
}
