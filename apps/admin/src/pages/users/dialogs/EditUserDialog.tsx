import { isApiError } from '@nuva-edu/api-client/admin';
import { AdminButton, AdminField, Alert, Dialog } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../../api/action';
import { useApi } from '../../../api/client';
import { type UserDetail, userChanged, usersKeys } from '../../../api/users';
import { invalidFields, useUserActionError } from '../errors';

interface Props {
  user: UserDetail;
  onClose: () => void;
  onDone: (user: UserDetail) => void;
}

/** Editar nome, nome completo e e-mail (`PATCH /api/v1/users/{id}`, com `version`). */
export function EditUserDialog({ user, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useUserActionError();
  const [name, setName] = useState(user.name);
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [email, setEmail] = useState(user.email);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const save = useAction(async () => {
    const { data } = await api.PATCH('/api/v1/users/{id}', {
      params: { path: { id: user.id } },
      body: {
        name: name.trim(),
        fullName: fullName.trim() === '' ? null : fullName.trim(),
        email: email.trim(),
        version: user.version,
      },
    });
    if (!data) throw new Error('PATCH /api/v1/users/{id} respondeu sem corpo');
    return data;
  });

  const code = isApiError(save.error) ? save.error.code : undefined;
  const invalid = invalidFields(save.error);
  const fieldError = (field: string) =>
    missing.has(field)
      ? t('forms.required')
      : field === 'email' && code === 'email_taken'
        ? t('users.errors.email_taken')
        : invalid.has(field)
          ? t('forms.invalid')
          : undefined;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = new Set(
      [name.trim() === '' ? 'name' : null, email.trim() === '' ? 'email' : null].filter(
        (field): field is string => field !== null,
      ),
    );
    setMissing(empty);
    if (empty.size > 0) return;
    const result = await save.run();
    if (result.ok) {
      userChanged(queryClient, result.data);
      onDone(result.data);
    }
  };

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: usersKeys.detail(user.id) });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('users.edit.title', { name: user.name })}
      closeLabel={t('common.close')}
      dismissible={!save.busy}
      footer={
        <>
          <AdminButton disabled={save.busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={save.busy}>
            {save.busy ? t('common.saving') : t('common.save')}
          </AdminButton>
        </>
      }
    >
      {save.error && code !== 'email_taken' ? (
        <Alert
          tone="error"
          className="mb-4"
          actions={
            code === 'version_conflict' ? (
              <AdminButton size="sm" onClick={reload}>
                {t('users.edit.reload')}
              </AdminButton>
            ) : undefined
          }
        >
          {message(save.error)}
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
          label={t('users.fields.fullName')}
          hint={t('users.fields.fullNameHint')}
          value={fullName}
          onChange={setFullName}
          maxLength={160}
          autoComplete="off"
          error={fieldError('fullName')}
        />
        <AdminField
          label={t('users.fields.email')}
          hint={t('users.edit.emailHint')}
          type="email"
          value={email}
          onChange={setEmail}
          maxLength={254}
          autoComplete="off"
          error={fieldError('email')}
        />
      </form>
    </Dialog>
  );
}
