import { AdminButton, ConfirmDialog, useToast } from '@nuva-edu/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { useDateFormatter } from '../catalog/format';
import { canCancelSubscription, type SubscriptionStatus, useCancelSubscription } from './queries';

interface CancelableSubscription {
  id: string;
  status: SubscriptionStatus;
  planTitle: string;
  /** Fim do período pago: é até quando o acesso continua em `active` e `past_due`. */
  currentPeriodEnd: string | null;
}

/**
 * Cancelamento pelo aluno (spec 012, "Cancelamento pelo aluno"): em `pending`, encerra a adesão
 * na hora e libera assinar o mesmo plano de novo; em `active` e `past_due`, a cobrança recorrente
 * é cancelada e o acesso segue até o fim do período pago. `suspended` não é cancelável aqui.
 * A confirmação diz o que acontece em cada estado.
 */
export function CancelSubscriptionButton({
  subscription,
}: {
  subscription: CancelableSubscription;
}) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const toast = useToast();
  const cancel = useCancelSubscription(subscription.id);
  const [confirming, setConfirming] = useState(false);

  if (!canCancelSubscription(subscription.status)) return null;

  const end = subscription.currentPeriodEnd
    ? formatDate(subscription.currentPeriodEnd)
    : t('subscriptions.detail.noPeriod');
  const pending = subscription.status === 'pending';
  const message = pending
    ? t('subscriptions.cancel.text.pending')
    : subscription.status === 'past_due'
      ? t('subscriptions.cancel.text.pastDue', { date: end })
      : t('subscriptions.cancel.text.active', { date: end });

  const confirm = () =>
    cancel.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        toast.success(t('subscriptions.cancel.done'));
      },
      onError: (error) => {
        setConfirming(false);
        toast.error(
          describeError(t, error, {
            subscription_not_cancelable: t('subscriptions.cancel.notCancelable'),
            payment_provider_unavailable: t('subscriptions.cancel.providerUnavailable'),
          }).message,
          { title: t('subscriptions.cancel.errorTitle') },
        );
      },
    });

  return (
    <>
      <AdminButton onClick={() => setConfirming(true)} disabled={cancel.isPending}>
        {t('subscriptions.cancel.action')}
      </AdminButton>
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={confirm}
        title={pending ? t('subscriptions.cancel.titlePending') : t('subscriptions.cancel.title')}
        itemName={subscription.planTitle}
        message={message}
        confirmLabel={t('subscriptions.cancel.confirm')}
        cancelLabel={t('common.cancel')}
        busy={cancel.isPending}
        busyLabel={t('subscriptions.cancel.busy')}
        closeLabel={t('common.dismiss')}
      />
    </>
  );
}
