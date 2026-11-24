import { AdminButton, AdminMenu, Alert, ConfirmDialog, Dialog } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../../api/action';
import { useApi } from '../../../api/client';
import { USER_ROLES, type UserDetail, type UserRole, userChanged } from '../../../api/users';
import { useUserActionError } from '../errors';

interface Props {
  user: Pick<UserDetail, 'id' | 'name' | 'role'>;
  onClose: () => void;
  onDone: (user: UserDetail) => void;
}

/**
 * Mudar o papel (spec 008, "Mudança de papel"; `PATCH /api/v1/users/{id}/role`, só `admin`).
 * Encerra as sessões do usuário no painel e o avisa por e-mail; passa por confirmação.
 */
export function RoleDialog({ user, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const message = useUserActionError();
  const [role, setRole] = useState<UserRole>(user.role);
  const [confirming, setConfirming] = useState(false);

  const save = useAction(async () => {
    const { data } = await api.PATCH('/api/v1/users/{id}/role', {
      params: { path: { id: user.id } },
      body: { role },
    });
    if (!data) throw new Error('PATCH /api/v1/users/{id}/role respondeu sem corpo');
    return data;
  });

  const options = USER_ROLES.map((id) => ({ id, label: t(`roles.${id}`) }));

  const onConfirm = async () => {
    const result = await save.run();
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
        title={t('users.role.title', { name: user.name })}
        description={t('users.role.description')}
        closeLabel={t('common.close')}
        dismissible={!save.busy}
        footer={
          <>
            <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
            <AdminButton
              variant="primary"
              disabled={role === user.role}
              onClick={() => {
                save.reset();
                setConfirming(true);
              }}
            >
              {t('users.role.continue')}
            </AdminButton>
          </>
        }
      >
        {save.error ? (
          <Alert tone="error" className="mb-4">
            {message(save.error)}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">{t('users.fields.role')}</span>
          <AdminMenu
            options={options}
            value={role}
            onChange={(id: UserRole) => setRole(id)}
            aria-label={t('users.role.roleLabel', { value: t(`roles.${role}`) })}
          />
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onConfirm()}
        title={t('users.role.confirmTitle')}
        itemName={user.name}
        message={t('users.role.confirmText', {
          from: t(`roles.${user.role}`),
          to: t(`roles.${role}`),
        })}
        confirmLabel={t('users.role.confirm')}
        cancelLabel={t('common.cancel')}
        busy={save.busy}
        busyLabel={t('common.saving')}
      />
    </>
  );
}
