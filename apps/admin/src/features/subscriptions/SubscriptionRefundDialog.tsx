import { AdminButton, AdminField, AdminTextArea, Alert, Dialog } from '@nuva-edu/ui';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { formatDateTime } from '../../format';
import { amountInput, parseAmountCents } from '../sales/format';
import { paymentStatusLabel, useSubscriptionsError, useSubscriptionsMoney } from './format';
import {
  type AdminSubscriptionDetail,
  newIdempotencyKey,
  type PaymentDetail,
  REASON_MAX,
  REASON_MIN,
  type Refund,
  type RefundOutcome,
  refundableCents,
  refundOutcome,
  requestSubscriptionRefund,
} from './queries';

interface Props {
  subscription: AdminSubscriptionDetail;
  payment: PaymentDetail;
  onClose: () => void;
  onDone: (refund: Refund) => void;
}

const TONES: Record<RefundOutcome, 'error' | 'warning' | 'info'> = {
  ends: 'error',
  'keeps-partial': 'warning',
  'keeps-other-period': 'info',
};

/**
 * Reembolso de uma cobrança da assinatura (spec 012, "Reembolso de cobrança";
 * `POST /subscriptions/{id}/payments/{paymentId}/refund`, `order.refund`, só admin). A tela diz
 * antes de confirmar o que o valor faz com a assinatura: o reembolso que fecha o saldo da
 * cobrança do período em curso encerra na hora; o parcial devolve o valor e não altera o estado;
 * a cobrança de período passado não muda o estado atual, qualquer que seja o valor. O estorno é
 * executado em segundo plano e chega depois pelo detalhe.
 */
export function SubscriptionRefundDialog({ subscription, payment, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const money = useSubscriptionsMoney();
  const message = useSubscriptionsError();
  const formId = useId();
  const remaining = refundableCents(payment);
  const [amount, setAmount] = useState(() => amountInput(remaining));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  // A repetição do envio devolve o primeiro reembolso por 24 h (Idempotency-Key do contrato).
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const cents = amount.trim() === '' ? null : parseAmountCents(amount);
  const outcome = refundOutcome({
    paymentId: payment.id,
    currentPeriodPaymentId: subscription.currentPeriodPaymentId,
    amountCents: cents ?? remaining,
    remainingCents: remaining,
  });

  const refund = useAction(() =>
    requestSubscriptionRefund(api, {
      subscriptionId: subscription.id,
      paymentId: payment.id,
      reason: reason.trim(),
      amountCents: cents,
      idempotencyKey,
    }),
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setReasonMissing(false);
    refund.reset();
    if (reason.trim().length < REASON_MIN) {
      setReasonMissing(true);
      return;
    }
    if (cents !== null && (cents <= 0 || cents > remaining)) {
      setProblem(t('subscriptions.refunds.invalidAmount', { amount: money(remaining) }));
      return;
    }
    const result = await refund.run();
    if (result.ok) onDone(result.data);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('subscriptions.refunds.title')}
      description={t('subscriptions.refunds.subtitle', {
        name: subscription.subscriber.name,
        amount: money(payment.amountCents),
        date: formatDateTime(payment.paidAt ?? payment.createdAt),
      })}
      closeLabel={t('common.close')}
      dismissible={!refund.busy}
      footer={
        <>
          <AdminButton onClick={onClose} disabled={refund.busy}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton
            variant="primary"
            type="submit"
            form={formId}
            className="minui-adm-btn--danger"
            disabled={refund.busy}
            aria-busy={refund.busy || undefined}
          >
            {refund.busy ? t('subscriptions.refunds.busy') : t('subscriptions.refunds.submit')}
          </AdminButton>
        </>
      }
    >
      {refund.error ? (
        <Alert tone="error" className="mb-4">
          {message(refund.error)}
        </Alert>
      ) : null}
      {problem ? (
        <Alert tone="error" className="mb-4">
          {problem}
        </Alert>
      ) : null}
      <Alert tone={TONES[outcome]} className="mb-4">
        {t(`subscriptions.refunds.outcome.${outcome}`)}
      </Alert>
      <ul className="m-0 mb-4 flex list-none flex-col gap-1 p-0 text-sm text-ink-2">
        <li>
          {t('subscriptions.refunds.paymentStatus', {
            status: paymentStatusLabel(t, payment.status),
          })}
        </li>
        <li>{t('subscriptions.refunds.refunded', { amount: money(payment.refundedCents) })}</li>
        <li>{t('subscriptions.refunds.remaining', { amount: money(remaining) })}</li>
      </ul>
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('subscriptions.refunds.amount')}
          hint={t('subscriptions.refunds.amountHint', { amount: money(remaining) })}
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          autoComplete="off"
        />
        <AdminTextArea
          label={t('subscriptions.refunds.reason')}
          hint={t('subscriptions.refunds.reasonHint')}
          value={reason}
          onChange={setReason}
          maxLength={REASON_MAX}
          rows={3}
          error={reasonMissing ? t('subscriptions.refunds.reasonMissing') : undefined}
        />
        <p className="m-0 text-sm text-ink-3">{t('subscriptions.refunds.background')}</p>
      </form>
    </Dialog>
  );
}
