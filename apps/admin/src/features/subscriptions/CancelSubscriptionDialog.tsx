import { AdminButton, AdminTextArea, Alert, Dialog } from '@nuva-edu/ui';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { cancelPreview, subscriptionPlanLabel, useSubscriptionsError } from './format';
import {
  type AdminSubscriptionDetail,
  cancelEndsNow,
  cancelSubscription,
  REASON_MAX,
  REASON_MIN,
} from './queries';

interface Props {
  subscription: AdminSubscriptionDetail;
  onClose: () => void;
  onDone: (detail: AdminSubscriptionDetail) => void;
}

/**
 * Cancelamento da assinatura de um aluno (spec 012, "Cancelamento pelo admin";
 * `POST /subscriptions/{id}/cancel`, `subscription.cancel`, só admin, com motivo obrigatório).
 * Em `active` ou `past_due` a assinatura vai a `canceling` e o acesso segue até o fim do período
 * pago; em `suspended` encerra na hora e a recorrência é cancelada sem esperar os 30 dias.
 */
export function CancelSubscriptionDialog({ subscription, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const message = useSubscriptionsError();
  const formId = useId();
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const endsNow = cancelEndsNow(subscription.status);

  const cancel = useAction(() =>
    cancelSubscription(api, { id: subscription.id, reason: reason.trim() }),
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setReasonMissing(false);
    cancel.reset();
    if (reason.trim().length < REASON_MIN) {
      setReasonMissing(true);
      return;
    }
    const result = await cancel.run();
    if (result.ok) onDone(result.data);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('subscriptions.cancel.title')}
      description={t('subscriptions.cancel.subtitle', {
        name: subscription.subscriber.name,
        plan: subscriptionPlanLabel(t, subscription.plan),
      })}
      closeLabel={t('common.close')}
      dismissible={!cancel.busy}
      footer={
        <>
          <AdminButton onClick={onClose} disabled={cancel.busy}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton
            variant="primary"
            type="submit"
            form={formId}
            className="minui-adm-btn--danger"
            disabled={cancel.busy}
            aria-busy={cancel.busy || undefined}
          >
            {cancel.busy ? t('subscriptions.cancel.busy') : t('subscriptions.cancel.submit')}
          </AdminButton>
        </>
      }
    >
      {cancel.error ? (
        <Alert tone="error" className="mb-4">
          {message(cancel.error)}
        </Alert>
      ) : null}
      <Alert tone={endsNow ? 'error' : 'warning'} className="mb-4">
        {cancelPreview(t, subscription)}
      </Alert>
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminTextArea
          label={t('subscriptions.cancel.reason')}
          hint={t('subscriptions.cancel.reasonHint')}
          value={reason}
          onChange={setReason}
          maxLength={REASON_MAX}
          rows={3}
          error={reasonMissing ? t('subscriptions.cancel.reasonMissing') : undefined}
        />
        <p className="m-0 text-sm text-ink-3">{t('subscriptions.cancel.audit')}</p>
      </form>
    </Dialog>
  );
}
