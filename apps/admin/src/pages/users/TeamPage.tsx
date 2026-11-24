import {
  AdminButton,
  AdminEmpty,
  AdminPageHeader,
  AdminTable,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { STAFF_ROLES, type UserSummary, userChanged, useUsersList } from '../../api/users';
import { formatDateTime } from '../../format';
import { useSession } from '../../session/session';
import { CreateStaffDialog } from './dialogs/CreateStaffDialog';
import { RoleDialog } from './dialogs/RoleDialog';
import { SimpleConfirm } from './dialogs/SimpleConfirm';
import { SuspendDialog } from './dialogs/SuspendDialog';
import { UserNameCell, UserStatusCell } from './UserBits';

type Pending =
  | { kind: 'create' }
  | { kind: 'role' | 'suspend' | 'reactivate'; user: UserSummary }
  | null;

/**
 * Equipe (spec 006; spec 008, só `staff.manage`): instrutores, gerentes e administradores,
 * criar conta, mudar papel, suspender e reativar. A lista junta as três consultas por papel
 * (`GET /api/v1/users?role=`), em ordem de nome.
 */
export function TeamPage() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const instructors = useUsersList({ role: 'instructor', sort: 'name' });
  const managers = useUsersList({ role: 'manager', sort: 'name' });
  const admins = useUsersList({ role: 'admin', sort: 'name' });
  const lists = [admins, managers, instructors];

  const rows = lists
    .flatMap((list) => list.data?.pages.flatMap((page) => page.items) ?? [])
    .sort(
      (a, b) =>
        STAFF_ROLES.indexOf(b.role) - STAFF_ROLES.indexOf(a.role) || a.name.localeCompare(b.name),
    );
  const loading = lists.some((list) => list.isPending);
  const failed = lists.find((list) => list.isError);
  const hasMore = lists.some((list) => list.hasNextPage);
  const loadingMore = lists.some((list) => list.isFetchingNextPage);

  const columns = [
    {
      id: 'name',
      label: t('users.columns.name'),
      render: (u: UserSummary) => <UserNameCell user={u} />,
    },
    { id: 'email', label: t('users.columns.email') },
    {
      id: 'role',
      label: t('users.columns.role'),
      render: (u: UserSummary) => t(`roles.${u.role}`),
    },
    {
      id: 'status',
      label: t('users.columns.status'),
      render: (u: UserSummary) => <UserStatusCell user={u} />,
    },
    {
      id: 'lastLoginAt',
      label: t('users.columns.lastLoginAt'),
      render: (u: UserSummary) =>
        u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.neverLoggedIn'),
    },
    {
      id: 'actions',
      label: t('team.columns.actions'),
      render: (u: UserSummary) =>
        u.id === session.user.id ? (
          <span className="text-ink-3">{t('team.you')}</span>
        ) : (
          <span className="inline-flex flex-wrap gap-2">
            <AdminButton
              size="sm"
              aria-label={t('team.actions.role', { name: u.name })}
              onClick={() => setPending({ kind: 'role', user: u })}
            >
              {t('users.role.open')}
            </AdminButton>
            {u.status === 'suspended' ? (
              <AdminButton
                size="sm"
                aria-label={t('team.actions.reactivate', { name: u.name })}
                onClick={() => setPending({ kind: 'reactivate', user: u })}
              >
                {t('users.reactivate.open')}
              </AdminButton>
            ) : (
              <AdminButton
                size="sm"
                aria-label={t('team.actions.suspend', { name: u.name })}
                onClick={() => setPending({ kind: 'suspend', user: u })}
              >
                {t('users.suspend.open')}
              </AdminButton>
            )}
          </span>
        ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t('menu.items.team')}
        subtitle={t('team.subtitle')}
        actions={
          <AdminButton
            variant="primary"
            icon={<UserPlus size={15} aria-hidden="true" />}
            onClick={() => setPending({ kind: 'create' })}
          >
            {t('team.create.open')}
          </AdminButton>
        }
      />
      {loading ? (
        <LoadingState label={t('team.loading')} />
      ) : failed && rows.length === 0 ? (
        <QueryErrorState
          error={failed.error}
          title={t('team.errorTitle')}
          onRetry={() => lists.forEach((list) => void list.refetch())}
          retrying={lists.some((list) => list.isFetching)}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            empty={
              <AdminEmpty
                icon={<ShieldCheck aria-hidden="true" />}
                title={t('team.empty')}
                text={t('team.emptyText')}
              >
                <AdminButton onClick={() => setPending({ kind: 'create' })}>
                  {t('team.create.open')}
                </AdminButton>
              </AdminEmpty>
            }
          />
          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <AdminButton
                disabled={loadingMore}
                onClick={() => {
                  for (const list of lists) if (list.hasNextPage) void list.fetchNextPage();
                }}
              >
                {loadingMore ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
        </>
      )}

      {pending?.kind === 'create' ? (
        <CreateStaffDialog
          onClose={close}
          onDone={(user) => {
            close();
            toast.success(t('team.create.done', { name: user.name }));
          }}
        />
      ) : null}
      {pending?.kind === 'role' ? (
        <RoleDialog
          user={pending.user}
          onClose={close}
          onDone={(user) => {
            close();
            toast.success(t('users.role.done', { role: t(`roles.${user.role}`) }));
          }}
        />
      ) : null}
      {pending?.kind === 'suspend' ? (
        <SuspendDialog
          user={pending.user}
          onClose={close}
          onDone={() => {
            close();
            toast.success(t('users.suspend.done', { name: pending.user.name }));
          }}
        />
      ) : null}
      {pending?.kind === 'reactivate' ? (
        <SimpleConfirm
          title={t('users.reactivate.confirmTitle')}
          itemName={pending.user.name}
          message={t('users.reactivate.confirmText')}
          confirmLabel={t('users.reactivate.confirm')}
          busyLabel={t('users.reactivate.busy')}
          destructive={false}
          action={async () => {
            const { data } = await api.POST('/api/v1/users/{id}/reactivate', {
              params: { path: { id: pending.user.id } },
            });
            if (data) userChanged(queryClient, data);
          }}
          onClose={close}
          onDone={() => toast.success(t('users.reactivate.done', { name: pending.user.name }))}
        />
      ) : null}
    </>
  );
}
