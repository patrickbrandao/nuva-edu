import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  Alert,
  ConfirmDialog,
  Dialog,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../../api/action';
import { useApi } from '../../../api/client';
import { type UserDetail, usersKeys } from '../../../api/users';
import { useUserActionError } from '../errors';

interface Props {
  user: Pick<UserDetail, 'id' | 'name'>;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Definir a senha de um usuário (`PUT /api/v1/users/{id}/password`, só `admin`). Encerra todas
 * as sessões dele e o avisa por e-mail; por isso passa por uma confirmação. A senha nova fica
 * só no estado deste diálogo.
 */
export function SetPasswordDialog({ user, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useUserActionError();
  const [password, setPassword] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = useAction(async (value: string) => {
    await api.PUT('/api/v1/users/{id}/password', {
      params: { path: { id: user.id } },
      body: { password: value },
    });
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const invalid = password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH;
    setTooShort(invalid);
    if (!invalid) {
      save.reset();
      setConfirming(true);
    }
  };

  const onConfirm = async () => {
    const result = await save.run(password);
    setConfirming(false);
    if (result.ok) {
      setPassword('');
      void queryClient.invalidateQueries({ queryKey: usersKeys.detail(user.id) });
      void queryClient.invalidateQueries({ queryKey: usersKeys.sessions(user.id) });
      onDone();
    }
  };

  const invalidFromApi = isApiError(save.error) && save.error.code === 'password_invalid';

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={t('users.setPassword.title', { name: user.name })}
        description={t('users.setPassword.description')}
        closeLabel={t('common.close')}
        dismissible={!save.busy}
        footer={
          <>
            <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
            <AdminButton variant="primary" type="submit" form={formId}>
              {t('users.setPassword.continue')}
            </AdminButton>
          </>
        }
      >
        {save.error && !invalidFromApi ? (
          <Alert tone="error" className="mb-4">
            {message(save.error)}
          </Alert>
        ) : null}
        <form id={formId} noValidate onSubmit={onSubmit}>
          <PasswordInput
            label={t('users.setPassword.newPassword')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            showLabel={t('common.showPassword')}
            hideLabel={t('common.hidePassword')}
            hint={t('forms.passwordHint', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
            counter={({ length, max }) => t('forms.passwordCounter', { length, max })}
            error={tooShort || invalidFromApi ? t('users.errors.password_invalid') : undefined}
          />
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onConfirm()}
        title={t('users.setPassword.confirmTitle')}
        itemName={user.name}
        message={t('users.setPassword.confirmText')}
        confirmLabel={t('users.setPassword.confirm')}
        cancelLabel={t('common.cancel')}
        busy={save.busy}
        busyLabel={t('common.saving')}
      />
    </>
  );
}
