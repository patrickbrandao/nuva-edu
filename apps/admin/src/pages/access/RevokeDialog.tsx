import { AdminButton, AdminTextArea, Alert, Dialog } from '@nuva-edu/ui';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type EntitlementNode, REASON_MAX } from '../../api/access';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { useAccessError } from './errors';

interface Props {
  /** A raiz `grant` a revogar. */
  entitlement: EntitlementNode;
  userName: string;
  onClose: () => void;
  onDone: (revoked: EntitlementNode) => void;
  /** A API recusou porque o direito mudou (`409`): quem abriu lê a árvore de novo. */
  onStale: () => void;
}

/**
 * Revogar uma concessão manual (`POST /api/v1/entitlements/{id}/revoke`; spec 010, "Concessão
 * manual"): motivo obrigatório, que vai para a auditoria. A recusa (`409`) aparece no diálogo.
 */
export function RevokeDialog({ entitlement, userName, onClose, onDone, onStale }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const formId = useId();
  const message = useAccessError();
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const title = entitlement.product.title;

  const revoke = useAction(async () => {
    const { data } = await api.POST('/api/v1/entitlements/{id}/revoke', {
      params: { path: { id: entitlement.id } },
      body: { reason: reason.trim() },
    });
    if (!data) throw new Error('POST /api/v1/entitlements/{id}/revoke respondeu sem corpo');
    return data;
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = reason.trim() === '';
    setReasonMissing(empty);
    if (empty) return;
    const result = await revoke.run();
    if (result.ok) onDone(result.data);
    else onStale();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('access.revoke.title', { title })}
      description={t('access.revoke.description', { name: userName })}
      closeLabel={t('common.close')}
      dismissible={!revoke.busy}
      footer={
        <>
          <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={revoke.busy}>
            {revoke.busy ? t('access.revoke.busy') : t('access.revoke.submit')}
          </AdminButton>
        </>
      }
    >
      {revoke.error ? (
        <Alert tone="error" className="mb-4">
          {message(revoke.error)}
        </Alert>
      ) : null}
      <form id={formId} noValidate onSubmit={(event) => void onSubmit(event)}>
        <AdminTextArea
          label={t('access.revoke.reason')}
          hint={t('access.revoke.reasonHint')}
          value={reason}
          onChange={setReason}
          maxLength={REASON_MAX}
          rows={3}
          error={reasonMissing ? t('forms.required') : undefined}
        />
      </form>
    </Dialog>
  );
}
