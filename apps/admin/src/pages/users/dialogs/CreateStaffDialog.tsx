import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminField,
  AdminMenu,
  Alert,
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
import { STAFF_ROLES, type UserDetail, type UserRole, usersKeys } from '../../../api/users';
import { invalidFields, useUserActionError } from '../errors';

interface Props {
  onClose: () => void;
  onDone: (user: UserDetail) => void;
}

/**
 * Criar conta da equipe (spec 007, "Equipe criada pelo admin"; `POST /api/v1/users`): nome,
 * e-mail, papel e senha, que o admin informa à pessoa por fora do sistema.
 */
export function CreateStaffDialog({ onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useUserActionError();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('instructor');
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const create = useAction(async () => {
    const { data } = await api.POST('/api/v1/users', {
      body: { name: name.trim(), email: email.trim(), role, password },
    });
    if (!data) throw new Error('POST /api/v1/users respondeu sem corpo');
    return data;
  });

  const code = isApiError(create.error) ? create.error.code : undefined;
  const invalid = invalidFields(create.error);
  const fieldError = (field: string) => {
    if (missing.has(field)) {
      return field === 'password' ? t('users.errors.password_invalid') : t('forms.required');
    }
    if (field === 'email' && code === 'email_taken') return t('users.errors.email_taken');
    if (field === 'password' && code === 'password_invalid')
      return t('users.errors.password_invalid');
    return invalid.has(field) ? t('forms.invalid') : undefined;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = new Set<string>();
    if (name.trim() === '') empty.add('name');
    if (email.trim() === '') empty.add('email');
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      empty.add('password');
    }
    setMissing(empty);
    if (empty.size > 0) return;
    const result = await create.run();
    if (result.ok) {
      setPassword('');
      void queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
      onDone(result.data);
    }
  };

  const fieldCodes = new Set(['email_taken', 'password_invalid']);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('team.create.title')}
      description={t('team.create.description')}
      closeLabel={t('common.close')}
      dismissible={!create.busy}
      footer={
        <>
          <AdminButton disabled={create.busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={create.busy}>
            {create.busy ? t('team.create.busy') : t('team.create.submit')}
          </AdminButton>
        </>
      }
    >
      {create.error && !(code && fieldCodes.has(code)) ? (
        <Alert tone="error" className="mb-4">
          {message(create.error)}
        </Alert>
      ) : null}
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('users.fields.name')}
          value={name}
          onChange={setName}
          maxLength={80}
          autoComplete="off"
          error={fieldError('name')}
        />
        <AdminField
          label={t('users.fields.email')}
          type="email"
          value={email}
          onChange={setEmail}
          maxLength={254}
          autoComplete="off"
          error={fieldError('email')}
        />
        <div className="flex flex-col items-start gap-1">
          <span className="text-sm font-medium text-ink">{t('users.fields.role')}</span>
          <AdminMenu
            options={STAFF_ROLES.map((id) => ({ id, label: t(`roles.${id}`) }))}
            value={role}
            onChange={(id: UserRole) => setRole(id)}
            aria-label={t('users.role.roleLabel', { value: t(`roles.${role}`) })}
          />
        </div>
        <PasswordInput
          label={t('team.create.password')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
          hint={t('forms.passwordHint', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
          counter={({ length, max }) => t('forms.passwordCounter', { length, max })}
          error={fieldError('password')}
        />
      </form>
    </Dialog>
  );
}
