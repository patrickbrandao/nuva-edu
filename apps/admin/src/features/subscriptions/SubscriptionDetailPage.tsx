import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminPageHeader,
  AdminSection,
  AdminStatus,
  AdminTag,
  Alert,
  LoadingState,
  SubscriptionStatusBadge,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Repeat, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { usePageCrumb } from '../../shell/crumbs';
import { planCoverageDetails } from '../plans/format';
import { CancelSubscriptionDialog } from './CancelSubscriptionDialog';
import {
  paymentMethodLabel,
  paymentStatusLabel,
  refundStatusLabel,
  subscriptionAccessNote,
  subscriptionIntervalLabel,
  subscriptionPlanLabel,
  subscriptionStatusLabel,
  useSubscriptionsMoney,
} from './format';
import {
  type AdminSubscriptionDetail,
  isCancelable,
  isPaymentRefundable,
  type PaymentDetail,
  type PaymentStatus,
  type Refund,
  type RefundStatus,
  SUBSCRIPTIONS_PATH,
  subscriptionsKeys,
  useSubscription,
} from './queries';
import { SubscriptionRefundDialog } from './SubscriptionRefundDialog';

const PAYMENT_TONES: Record<PaymentStatus, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  approved: 'green',
  pending: 'amber',
  rejected: 'red',
  canceled: 'gray',
  refunded: 'gray',
  partially_refunded: 'blue',
  charged_back: 'red',
};

const REFUND_TONES: Record<RefundStatus, 'amber' | 'green' | 'red'> = {
  requested: 'amber',
  done: 'green',
  failed: 'red',
};

/**
 * Detalhe da assinatura (spec 012; `GET /api/v1/subscriptions/{id}`, `sales.view`): assinante,
 * plano atual, período, carência, cancelamento, cupom e as cobranças com os reembolsos de cada
 * uma. O cancelamento (`subscription.cancel`) e o reembolso (`order.refund`) são só do admin; os
 * botões só aparecem para quem tem a ação, e quem autoriza é a API. Um reembolso em execução é
 * acompanhado consultando a assinatura até o worker concluir.
 */
export function SubscriptionDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const subscription = useSubscription(id);
  usePageCrumb(subscription.data ? subscription.data.subscriber.name : null);

  if (subscription.isPending) return <LoadingState label={t('subscriptions.detailLoading')} />;
  if (subscription.isError && !subscription.data) {
    if (isApiError(subscription.error) && subscription.error.status === 404) {
      return (
        <AdminEmpty
          icon={<Repeat aria-hidden="true" />}
          title={t('subscriptions.notFound')}
          text={t('subscriptions.notFoundText')}
        >
          <AdminButton href={SUBSCRIPTIONS_PATH}>{t('subscriptions.backToList')}</AdminButton>
        </AdminEmpty>
      );
    }
    return (
      <QueryErrorState
        error={subscription.error}
        title={t('subscriptions.detailErrorTitle')}
        onRetry={() => void subscription.refetch()}
        retrying={subscription.isFetching}
      />
    );
  }
  return <SubscriptionView subscription={subscription.data} />;
}

function SubscriptionView({ subscription }: { subscription: AdminSubscriptionDetail }) {
  const { t } = useTranslation();
  const can = useCan();
  const toast = useToast();
  const money = useSubscriptionsMoney();
  const queryClient = useQueryClient();
  const [canceling, setCanceling] = useState(false);
  const [refunding, setRefunding] = useState<PaymentDetail | null>(null);

  const canCancel = can('subscription.cancel');
  const canRefund = can('order.refund');
  const cancelable = canCancel && isCancelable(subscription.status);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: subscriptionsKeys.detail(subscription.id) }),
      queryClient.invalidateQueries({ queryKey: subscriptionsKeys.all() }),
    ]);

  const onCanceled = async (updated: AdminSubscriptionDetail) => {
    setCanceling(false);
    queryClient.setQueryData(subscriptionsKeys.detail(subscription.id), updated);
    toast.success(
      updated.endedAt ? t('subscriptions.cancel.endedNow') : t('subscriptions.cancel.keepsAccess'),
      { title: subscription.subscriber.name },
    );
    await refresh();
  };

  const onRefunded = async (refund: Refund) => {
    setRefunding(null);
    toast.success(t('subscriptions.refunds.requested', { amount: money(refund.amountCents) }), {
      title: subscription.subscriber.name,
    });
    await refresh();
  };

  return (
    <>
      <AdminPageHeader
        title={t('subscriptions.detailTitle', { name: subscription.subscriber.name })}
        subtitle={t('subscriptions.detailSubtitle', {
          plan: subscriptionPlanLabel(t, subscription.plan),
          date: formatDateTime(subscription.createdAt),
        })}
        actions={
          cancelable ? (
            <AdminButton
              icon={<XCircle size={16} aria-hidden="true" />}
              onClick={() => setCanceling(true)}
            >
              {t('subscriptions.cancel.open')}
            </AdminButton>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SubscriptionStatusBadge
          status={subscription.status}
          label={subscriptionStatusLabel(t, subscription.status)}
        />
        <span className="text-sm text-ink-2">{subscriptionAccessNote(t, subscription)}</span>
        {subscription.nextChargeAt ? (
          <span className="text-sm text-ink-3">
            {t('subscriptions.nextChargeOn', { date: formatDateTime(subscription.nextChargeAt) })}
          </span>
        ) : null}
        {subscription.graceUntil ? (
          <span className="text-sm text-ink-3">
            {t('subscriptions.graceUntil', { date: formatDateTime(subscription.graceUntil) })}
          </span>
        ) : null}
      </div>

      {!cancelable && canCancel && subscription.status === 'pending' ? (
        <Alert tone="info" className="mb-4">
          {t('subscriptions.cancel.pendingNote')}
        </Alert>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <AdminSection title={t('subscriptions.subscriberTitle')}>
          <AdminCard pad>
            <AdminDetails
              wrap
              items={[
                { label: t('subscriptions.fields.name'), value: subscription.subscriber.name },
                { label: t('subscriptions.fields.email'), value: subscription.subscriber.email },
                // O link da ficha só para quem enxerga a conta (`users.view_private`).
                ...(can('users.view_private')
                  ? [
                      {
                        label: t('subscriptions.fields.account'),
                        value: (
                          <TextLink href={`/alunos/${subscription.subscriber.id}`} quiet>
                            {t('subscriptions.openAccount')}
                          </TextLink>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </AdminCard>
        </AdminSection>
        <AdminSection title={t('subscriptions.planTitle')}>
          <AdminCard pad className="flex flex-col gap-3">
            <AdminDetails
              wrap
              items={[
                { label: t('subscriptions.fields.plan'), value: subscription.plan.title },
                {
                  label: t('subscriptions.fields.interval'),
                  value: subscriptionIntervalLabel(t, subscription.plan),
                },
                {
                  label: t('subscriptions.fields.contractedPrice'),
                  value: money(subscription.priceCents),
                },
                {
                  label: t('subscriptions.fields.planPrice'),
                  value: money(subscription.plan.priceCents),
                },
              ]}
            />
            <p className="m-0 text-sm text-ink-3">{t('subscriptions.planPriceNote')}</p>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-2">{t('subscriptions.fields.planCoverage')}</span>
              <span>{planCoverageDetails(t, subscription.plan)}</span>
              {subscription.plan.items.length > 0 && !subscription.plan.includesAll ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-ink-2">
                  {subscription.plan.items.map((item) => (
                    <li key={`${item.productType}:${item.productId}`}>{item.title}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </AdminCard>
        </AdminSection>
      </div>

      <AdminSection title={t('subscriptions.periodTitle')}>
        <AdminCard pad>
          <AdminDetails
            wrap
            items={[
              {
                label: t('subscriptions.fields.currentPeriodStart'),
                value: subscription.currentPeriodStart
                  ? formatDateTime(subscription.currentPeriodStart)
                  : t('subscriptions.noPeriod'),
              },
              {
                label: t('subscriptions.fields.currentPeriodEnd'),
                value: subscription.currentPeriodEnd
                  ? formatDateTime(subscription.currentPeriodEnd)
                  : t('subscriptions.noPeriod'),
              },
              {
                label: t('subscriptions.fields.graceUntil'),
                value: subscription.graceUntil
                  ? formatDateTime(subscription.graceUntil)
                  : t('subscriptions.noGrace'),
              },
              {
                label: t('subscriptions.fields.nextCharge'),
                value: subscription.nextChargeAt
                  ? formatDateTime(subscription.nextChargeAt)
                  : t('subscriptions.noNextCharge'),
              },
              {
                label: t('subscriptions.fields.coupon'),
                value: subscription.couponCode ?? t('subscriptions.noCoupon'),
              },
              {
                label: t('subscriptions.fields.provider'),
                value: t(`subscriptions.providers.${subscription.provider}`),
              },
              {
                label: t('subscriptions.fields.providerSubscriptionId'),
                value: subscription.providerSubscriptionId ?? t('subscriptions.providerPending'),
              },
              {
                label: t('subscriptions.fields.createdAt'),
                value: formatDateTime(subscription.createdAt),
              },
              {
                label: t('subscriptions.fields.canceledAt'),
                value: subscription.canceledAt
                  ? formatDateTime(subscription.canceledAt)
                  : t('subscriptions.notCanceled'),
              },
              {
                label: t('subscriptions.fields.cancelReason'),
                value: subscription.cancelReason ?? t('subscriptions.noCancelReason'),
              },
              {
                label: t('subscriptions.fields.endedAt'),
                value: subscription.endedAt
                  ? formatDateTime(subscription.endedAt)
                  : t('subscriptions.notEnded'),
              },
            ]}
          />
        </AdminCard>
      </AdminSection>

      <AdminSection title={t('subscriptions.payments.title')}>
        {subscription.currentPeriodPaymentId ? (
          <p className="m-0 mb-3 text-sm text-ink-3">
            {t('subscriptions.payments.currentPeriodNote')}
          </p>
        ) : null}
        {subscription.payments.length === 0 ? (
          <AdminCard pad>
            <span className="text-sm text-ink-3">{t('subscriptions.payments.empty')}</span>
          </AdminCard>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {subscription.payments.map((payment) => {
              const current = payment.id === subscription.currentPeriodPaymentId;
              return (
                <li key={payment.id}>
                  <AdminCard pad className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <AdminStatus dot tone={PAYMENT_TONES[payment.status]}>
                          {paymentStatusLabel(t, payment.status)}
                        </AdminStatus>
                        <strong>{money(payment.amountCents)}</strong>
                        <span className="text-xs text-ink-3">
                          {paymentMethodLabel(t, payment.method)} ·{' '}
                          {formatDateTime(payment.paidAt ?? payment.createdAt)}
                        </span>
                        {current ? (
                          <AdminTag>{t('subscriptions.payments.currentPeriod')}</AdminTag>
                        ) : null}
                      </span>
                      {canRefund && isPaymentRefundable(payment) ? (
                        <AdminButton size="sm" onClick={() => setRefunding(payment)}>
                          {t('subscriptions.refunds.open')}
                        </AdminButton>
                      ) : null}
                    </div>
                    <AdminDetails
                      wrap
                      items={[
                        {
                          label: t('subscriptions.payments.refunded'),
                          value:
                            payment.refundedCents > 0
                              ? money(payment.refundedCents)
                              : t('subscriptions.payments.nothingRefunded'),
                        },
                        {
                          label: t('subscriptions.payments.providerPaymentId'),
                          value: payment.providerPaymentId,
                        },
                        {
                          label: t('subscriptions.payments.rawStatus'),
                          value: payment.rawStatus,
                        },
                      ]}
                    />
                    {payment.refunds.length === 0 ? (
                      <span className="text-sm text-ink-3">
                        {t('subscriptions.payments.noRefunds')}
                      </span>
                    ) : (
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {payment.refunds.map((refund) => (
                          <li
                            key={refund.id}
                            className="flex flex-wrap items-center gap-2 text-sm text-ink-2"
                          >
                            <AdminStatus dot tone={REFUND_TONES[refund.status]}>
                              {refundStatusLabel(t, refund.status)}
                            </AdminStatus>
                            <strong>{money(refund.amountCents)}</strong>
                            <span>{refund.reason}</span>
                            <span className="text-xs text-ink-3">
                              {formatDateTime(refund.doneAt ?? refund.createdAt)} ·{' '}
                              {refund.requestedBy.name}
                            </span>
                            {refund.error ? (
                              <span className="text-xs text-ink-3">
                                {t('subscriptions.payments.refundError', { error: refund.error })}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </AdminCard>
                </li>
              );
            })}
          </ul>
        )}
      </AdminSection>

      {canceling ? (
        <CancelSubscriptionDialog
          subscription={subscription}
          onClose={() => setCanceling(false)}
          onDone={(updated) => void onCanceled(updated)}
        />
      ) : null}
      {refunding ? (
        <SubscriptionRefundDialog
          subscription={subscription}
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={(refund) => void onRefunded(refund)}
        />
      ) : null}
    </>
  );
}
