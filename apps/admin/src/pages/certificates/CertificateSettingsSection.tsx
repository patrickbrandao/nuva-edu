import { AdminButton, AdminField, AdminSection, Alert, LoadingState, useToast } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import {
  type CertificateSettings,
  certificateKeys,
  SIGNER_MAX,
  useCertificateSettings,
} from '../../api/certificates';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { refusedFields, useCertificateError } from './errors';

/**
 * Seção "Certificado" de `/configuracoes` (spec 015; `GET|PUT /settings/certificates`,
 * `settings.manage`): signatário e cargo; o nome da escola é só leitura. Sem logotipo (Fase 4).
 */
export function CertificateSettingsSection() {
  const { t } = useTranslation();
  const settings = useCertificateSettings();
  return (
    <AdminSection title={t('settings.certificate.title')}>
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">{t('settings.certificate.text')}</p>
      {settings.isPending ? (
        <LoadingState label={t('settings.certificate.loading')} />
      ) : settings.isError ? (
        <QueryErrorState
          error={settings.error}
          title={t('settings.certificate.errorTitle')}
          onRetry={() => void settings.refetch()}
          retrying={settings.isFetching}
        />
      ) : (
        <SettingsForm settings={settings.data} />
      )}
    </AdminSection>
  );
}

const orNull = (value: string): string | null => value.trim() || null;

function SettingsForm({ settings }: { settings: CertificateSettings }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useCertificateError();
  const [signerName, setSignerName] = useState(settings.signerName ?? '');
  const [signerRole, setSignerRole] = useState(settings.signerRole ?? '');

  const save = useAction(async () => {
    const { data } = await api.PUT('/api/v1/settings/certificates', {
      body: { signerName: orNull(signerName), signerRole: orNull(signerRole) },
    });
    if (!data) throw new Error('PUT /api/v1/settings/certificates respondeu sem corpo');
    return data;
  });
  const refused = refusedFields(save.error);
  const fieldRefused = refused.has('signerName') || refused.has('signerRole');

  const dirty =
    orNull(signerName) !== settings.signerName || orNull(signerRole) !== settings.signerRole;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await save.run();
    if (!result.ok) return;
    queryClient.setQueryData(certificateKeys.settings(), result.data);
    setSignerName(result.data.signerName ?? '');
    setSignerRole(result.data.signerRole ?? '');
    toast.success(t('settings.certificate.saved'));
  };

  return (
    <>
      {save.error && !fieldRefused ? (
        <Alert tone="error" className="mb-4">
          {message(save.error)}
        </Alert>
      ) : null}
      <form className="flex max-w-3xl flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('settings.certificate.schoolName')}
          hint={t('settings.certificate.schoolNameHint')}
          value={settings.schoolName}
          readOnly
        />
        <AdminField
          label={t('settings.certificate.signerName')}
          hint={t('settings.certificate.emptyHint')}
          value={signerName}
          onChange={setSignerName}
          maxLength={SIGNER_MAX}
          autoComplete="off"
          error={refused.has('signerName') ? t('forms.invalid') : undefined}
        />
        <AdminField
          label={t('settings.certificate.signerRole')}
          hint={t('settings.certificate.emptyHint')}
          value={signerRole}
          onChange={setSignerRole}
          maxLength={SIGNER_MAX}
          autoComplete="off"
          error={refused.has('signerRole') ? t('forms.invalid') : undefined}
        />
        <div>
          <AdminButton variant="primary" type="submit" disabled={save.busy || !dirty}>
            {save.busy ? t('common.saving') : t('common.save')}
          </AdminButton>
        </div>
      </form>
    </>
  );
}
