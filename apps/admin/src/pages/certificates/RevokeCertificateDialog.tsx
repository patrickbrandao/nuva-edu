import { AdminButton, AdminTextArea, Alert, Dialog } from '@nuva-edu/ui';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { CERTIFICATE_REASON_MAX, type Certificate } from '../../api/certificates';
import { useApi } from '../../api/client';
import { useCertificateError } from './errors';

interface Props {
  certificate: Certificate;
  onClose: () => void;
  onDone: (revoked: Certificate) => void;
  /** A API recusou (já revogado, não encontrado): quem abriu lê a lista de novo. */
  onStale: () => void;
}

/**
 * Revogar um certificado (`POST /api/v1/certificates/{id}/revoke`; spec 015, só `admin`): motivo
 * obrigatório, que vai para a auditoria. A recusa aparece no diálogo.
 */
export function RevokeCertificateDialog({ certificate, onClose, onDone, onStale }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const formId = useId();
  const message = useCertificateError();
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);

  const revoke = useAction(async () => {
    const { data } = await api.POST('/api/v1/certificates/{id}/revoke', {
      params: { path: { id: certificate.id } },
      body: { reason: reason.trim() },
    });
    if (!data) throw new Error('POST /api/v1/certificates/{id}/revoke respondeu sem corpo');
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
      title={t('certificates.revoke.title', { code: certificate.code })}
      description={t('certificates.revoke.description', {
        name: certificate.studentName ?? certificate.user.name,
      })}
      closeLabel={t('common.close')}
      dismissible={!revoke.busy}
      footer={
        <>
          <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={revoke.busy}>
            {revoke.busy ? t('certificates.revoke.busy') : t('certificates.revoke.submit')}
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
          label={t('certificates.revoke.reason')}
          hint={t('certificates.revoke.reasonHint')}
          value={reason}
          onChange={setReason}
          maxLength={CERTIFICATE_REASON_MAX}
          rows={3}
          error={reasonMissing ? t('forms.required') : undefined}
        />
      </form>
    </Dialog>
  );
}
