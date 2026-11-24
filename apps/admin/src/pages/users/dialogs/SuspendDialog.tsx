import { AdminButton, AdminMenu, Alert, ConfirmDialog, Dialog } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../../api/action';
import { useApi } from '../../../api/client';
import { type SuspensionKind, type UserDetail, userChanged } from '../../../api/users';
import { TextArea } from '../../../forms/TextArea';
import { useUserActionError } from '../errors';

const KINDS: readonly SuspensionKind[] = ['posting', 'full'];
const DURATIONS = ['1', '7', '30', 'none'] as const;
type Duration = (typeof DURATIONS)[number];

interface Props {
  user: Pick<UserDetail, 'id' | 'name'>;
  onClose: () => void;
  onDone: (user: UserDetail) => void;
}

/**
 * Suspender (spec 008, "Suspensão"): tipo, motivo interno (1 a 500) e prazo. O formulário leva
 * a uma confirmação com o nome do usuário antes do `POST /api/v1/users/{id}/suspend`.
 */
export function SuspendDialog({ user, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useUserActionError();
  const [kind, setKind] = useState<SuspensionKind>('posting');
  const [duration, setDuration] = useState<Duration>('7');
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const suspend = useAction(async () => {
    const { data } = await api.POST('/api/v1/users/{id}/suspend', {
      params: { path: { id: user.id } },
      body: {
        kind,
        reason: reason.trim(),
        durationDays: duration === 'none' ? null : (Number(duration) as 1 | 7 | 30),
      },
    });
    if (!data) throw new Error('POST /api/v1/users/{id}/suspend respondeu sem corpo');
    return data;
  });

  const kindOptions = KINDS.map((id) => ({ id, label: t(`users.suspend.kinds.${id}`) }));
  const durationOptions = DURATIONS.map((id) => ({
    id,
    label: t(`users.suspend.durations.${id}`),
  }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const empty = reason.trim() === '';
    setReasonMissing(empty);
    if (!empty) {
      suspend.reset();
      setConfirming(true);
    }
  };

  const onConfirm = async () => {
    const result = await suspend.run();
    setConfirming(false);
    if (result.ok) {
      userChanged(queryClient, result.data);
      onDone(result.data);
    }
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={t('users.suspend.title', { name: user.name })}
        description={t('users.suspend.description')}
        closeLabel={t('common.close')}
        dismissible={!suspend.busy}
        footer={
          <>
            <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
            <AdminButton variant="primary" type="submit" form={formId}>
              {t('users.suspend.continue')}
            </AdminButton>
          </>
        }
      >
        {suspend.error ? (
          <Alert tone="error" className="mb-4">
            {message(suspend.error)}
          </Alert>
        ) : null}
        <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">{t('users.suspend.kind')}</span>
            <AdminMenu
              options={kindOptions}
              value={kind}
              onChange={(id: SuspensionKind) => setKind(id)}
              aria-label={t('users.suspend.kindLabel', {
                value: t(`users.suspend.kinds.${kind}`),
              })}
            />
            <span className="text-xs text-ink-3">{t(`users.suspend.kindHints.${kind}`)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">{t('users.suspend.duration')}</span>
            <AdminMenu
              options={durationOptions}
              value={duration}
              onChange={(id: Duration) => setDuration(id)}
              aria-label={t('users.suspend.durationLabel', {
                value: t(`users.suspend.durations.${duration}`),
              })}
            />
          </div>
          <TextArea
            label={t('users.suspend.reason')}
            hint={t('users.suspend.reasonHint')}
            value={reason}
            onChange={setReason}
            maxLength={500}
            rows={3}
            error={reasonMissing ? t('forms.required') : undefined}
          />
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onConfirm()}
        title={t('users.suspend.confirmTitle')}
        itemName={user.name}
        message={t(`users.suspend.confirmText.${kind}`, {
          duration: t(`users.suspend.durations.${duration}`),
        })}
        confirmLabel={t('users.suspend.confirm')}
        cancelLabel={t('common.cancel')}
        busy={suspend.busy}
        busyLabel={t('users.suspend.busy')}
      />
    </>
  );
}
