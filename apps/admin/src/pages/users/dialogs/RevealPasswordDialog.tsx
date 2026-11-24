import { isApiError } from '@nuva-edu/api-client/admin';
import { AdminButton, Alert, Dialog, PasswordInput } from '@nuva-edu/ui';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../../api/action';
import { useApi } from '../../../api/client';
import type { UserDetail } from '../../../api/users';
import { useUserActionError } from '../errors';

interface Props {
  user: Pick<UserDetail, 'id' | 'name'>;
  onClose: () => void;
}

/**
 * Mostrar a senha de um usuário (spec 007, "Exibição da senha"; ADR 0002). Só `admin`
 * (`users.password.view`). Pede a senha do próprio admin e avisa que a visualização fica na
 * auditoria. A senha vive só no estado deste diálogo: não passa pelo cache de consultas nem de
 * mutações, não vai para o endereço nem para o histórico, e some ao fechar (o diálogo é
 * desmontado) ou ao sair da tela. A chamada é `POST` com `cache: 'no-store'`.
 */
export function RevealPasswordDialog({ user, onClose }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const formId = useId();
  const message = useUserActionError();
  const [adminPassword, setAdminPassword] = useState('');
  const [missing, setMissing] = useState(false);
  const [revealed, setRevealed] = useState<{ password: string | null } | null>(null);

  const reveal = useAction(async (confirmation: string) => {
    const { data } = await api.POST('/api/v1/users/{id}/password/reveal', {
      params: { path: { id: user.id } },
      body: { adminPassword: confirmation },
      cache: 'no-store',
    });
    if (!data) throw new Error('POST /api/v1/users/{id}/password/reveal respondeu sem corpo');
    return data;
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (adminPassword === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    const confirmation = adminPassword;
    // A senha do admin não fica no campo depois do envio, com acerto ou erro.
    setAdminPassword('');
    const result = await reveal.run(confirmation);
    if (result.ok) setRevealed({ password: result.data.password });
  };

  const wrongPassword =
    isApiError(reveal.error) && reveal.error.code === 'password_confirmation_invalid';

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('users.reveal.title', { name: user.name })}
      closeLabel={t('common.close')}
      dismissible={!reveal.busy}
      footer={
        revealed ? (
          <AdminButton variant="primary" onClick={onClose}>
            {t('users.reveal.hide')}
          </AdminButton>
        ) : (
          <>
            <AdminButton disabled={reveal.busy} onClick={onClose}>
              {t('common.cancel')}
            </AdminButton>
            <AdminButton variant="primary" type="submit" form={formId} disabled={reveal.busy}>
              {reveal.busy ? t('users.reveal.busy') : t('users.reveal.submit')}
            </AdminButton>
          </>
        )
      }
    >
      <Alert tone="warning" title={t('users.reveal.auditTitle')} className="mb-4">
        {t('users.reveal.auditText')}
      </Alert>
      {revealed ? (
        revealed.password === null ? (
          <p className="m-0 text-ink">{t('users.reveal.noPassword')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <span id={`${formId}-label`} className="text-sm font-medium text-ink">
              {t('users.reveal.value')}
            </span>
            <output
              aria-labelledby={`${formId}-label`}
              className="block rounded border border-line px-3 py-2 font-mono text-base break-all text-ink select-all"
            >
              {revealed.password}
            </output>
          </div>
        )
      ) : (
        <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
          {reveal.error && !wrongPassword ? (
            <Alert tone="error">{message(reveal.error)}</Alert>
          ) : null}
          <PasswordInput
            label={t('users.reveal.adminPassword')}
            hint={t('users.reveal.adminPasswordHint')}
            value={adminPassword}
            onChange={setAdminPassword}
            autoComplete="current-password"
            showLabel={t('common.showPassword')}
            hideLabel={t('common.hidePassword')}
            minLength={0}
            maxLength={1024}
            disabled={reveal.busy}
            error={
              missing
                ? t('forms.required')
                : wrongPassword
                  ? t('users.errors.password_confirmation_invalid')
                  : undefined
            }
          />
        </form>
      )}
    </Dialog>
  );
}
