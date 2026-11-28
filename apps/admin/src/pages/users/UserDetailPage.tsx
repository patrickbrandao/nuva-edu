import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminList,
  AdminPageHeader,
  AdminSection,
  AdminTag,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone, UserX } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { canActOn, type UserDetail, userChanged, useUser, useUserSessions } from '../../api/users';
import { formatDateTime } from '../../format';
import { useCan, useSession } from '../../session/session';
import { usePageCrumb } from '../../shell/crumbs';
import { EditUserDialog } from './dialogs/EditUserDialog';
import { RevealPasswordDialog } from './dialogs/RevealPasswordDialog';
import { RoleDialog } from './dialogs/RoleDialog';
import { SetPasswordDialog } from './dialogs/SetPasswordDialog';
import { SimpleConfirm } from './dialogs/SimpleConfirm';
import { SuspendDialog } from './dialogs/SuspendDialog';
import { STUDENTS_PATH, UserStatusCell } from './UserBits';

/*
 * Acessos e progresso (specs 010 e 014) entram sob demanda (spec 006, RNF-03): a ficha abre com
 * os dados da conta e as duas seções chegam em seguida, fora do JavaScript inicial.
 */
const UserAccessPanels = lazy(() =>
  import('../access/UserAccessPanels').then((module) => ({ default: module.UserAccessPanels })),
);

const UserModeration = lazy(() =>
  import('../../features/moderation/UserModeration').then((module) => ({
    default: module.UserModeration,
  })),
);

type DialogName = 'edit' | 'suspend' | 'reactivate' | 'sessions' | 'reveal' | 'password' | 'role';

/**
 * Ficha do usuário (spec 006, base `ClientOverview`; specs 007 e 008): dados e edição,
 * suspensão, sessões, provedores vinculados e senha. Cada botão só aparece com a ação da
 * spec 008 (equipe exige `staff.manage`); a API decide e as recusas viram aviso.
 */
export function UserDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const user = useUser(id);
  usePageCrumb(user.data?.name);

  if (user.isPending) return <LoadingState label={t('users.detail.loading')} />;
  if (user.isError && !user.data) {
    if (isApiError(user.error) && user.error.status === 404) {
      return (
        <AdminEmpty
          icon={<UserX aria-hidden="true" />}
          title={t('users.detail.notFound')}
          text={t('users.detail.notFoundText')}
        >
          <AdminButton href={STUDENTS_PATH}>{t('users.detail.backToList')}</AdminButton>
        </AdminEmpty>
      );
    }
    return (
      <QueryErrorState
        error={user.error}
        title={t('users.detail.errorTitle')}
        onRetry={() => void user.refetch()}
        retrying={user.isFetching}
      />
    );
  }
  return <UserOverview user={user.data} />;
}

function UserOverview({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const can = useCan();
  const session = useSession();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const close = () => setDialog(null);

  const self = session.user.id === user.id;
  const canEdit = canActOn(can, user, 'users.edit');
  const canSuspend = canActOn(can, user, 'users.suspend') && !self;
  const canSessions = canActOn(can, user, 'users.sessions.revoke');
  const canRole = can('staff.manage') && !self;
  const sessions = useUserSessions(user.id, canSessions);

  const details = [
    { label: t('users.fields.name'), value: user.name },
    { label: t('users.fields.fullName'), value: user.fullName ?? t('users.detail.none') },
    {
      label: t('users.fields.email'),
      value: user.emailVerified ? (
        user.email
      ) : (
        <span className="inline-flex flex-wrap items-center gap-2">
          {user.email}
          <AdminTag>{t('users.status.unverified')}</AdminTag>
        </span>
      ),
    },
    { label: t('users.fields.role'), value: t(`roles.${user.role}`) },
    {
      label: t('users.fields.status'),
      value: <UserStatusCell user={{ ...user, emailVerified: true }} />,
    },
    { label: t('users.columns.createdAt'), value: formatDateTime(user.createdAt) },
    {
      label: t('users.columns.lastLoginAt'),
      value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t('users.neverLoggedIn'),
    },
  ];

  const suspension = user.suspension;

  return (
    <>
      <AdminPageHeader
        title={user.name}
        subtitle={user.email}
        actions={
          <>
            {canEdit ? (
              <AdminButton onClick={() => setDialog('edit')}>{t('users.detail.edit')}</AdminButton>
            ) : null}
            {canRole ? (
              <AdminButton onClick={() => setDialog('role')}>{t('users.role.open')}</AdminButton>
            ) : null}
            {canSuspend ? (
              suspension ? (
                <AdminButton onClick={() => setDialog('reactivate')}>
                  {t('users.reactivate.open')}
                </AdminButton>
              ) : (
                <AdminButton onClick={() => setDialog('suspend')}>
                  {t('users.suspend.open')}
                </AdminButton>
              )
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <AdminSection title={t('users.detail.data')}>
            <AdminCard pad>
              <AdminDetails wrap items={details} />
            </AdminCard>
          </AdminSection>

          {suspension ? (
            <AdminSection title={t('users.detail.suspension')}>
              <AdminCard pad>
                <AdminDetails
                  wrap
                  items={[
                    {
                      label: t('users.suspend.kind'),
                      value: t(`users.suspend.kinds.${suspension.kind}`),
                    },
                    { label: t('users.suspend.reason'), value: suspension.reason },
                    { label: t('users.detail.since'), value: formatDateTime(suspension.startsAt) },
                    {
                      label: t('users.detail.until'),
                      value: suspension.endsAt
                        ? formatDateTime(suspension.endsAt)
                        : t('users.suspend.durations.none'),
                    },
                    {
                      label: t('users.detail.suspendedBy'),
                      value: suspension.createdBy?.name ?? t('users.detail.system'),
                    },
                  ]}
                />
              </AdminCard>
            </AdminSection>
          ) : null}

          {canSessions ? (
            <AdminSection
              title={t('users.sessions.title')}
              actions={
                sessions.data && sessions.data.length > 0 ? (
                  <AdminButton size="sm" onClick={() => setDialog('sessions')}>
                    {t('users.sessions.revoke')}
                  </AdminButton>
                ) : null
              }
            >
              {sessions.isPending ? (
                <LoadingState label={t('users.sessions.loading')} />
              ) : sessions.isError ? (
                <QueryErrorState
                  error={sessions.error}
                  title={t('users.sessions.errorTitle')}
                  onRetry={() => void sessions.refetch()}
                  retrying={sessions.isFetching}
                />
              ) : sessions.data.length === 0 ? (
                <AdminCard>
                  <AdminEmpty
                    icon={<MonitorSmartphone aria-hidden="true" />}
                    title={t('users.sessions.empty')}
                    text={t('users.sessions.emptyText')}
                  />
                </AdminCard>
              ) : (
                <AdminList
                  items={sessions.data.map((item) => ({
                    id: item.id,
                    title: `${item.browser ?? t('users.sessions.unknownBrowser')} · ${
                      item.os ?? t('users.sessions.unknownOs')
                    }`,
                    text: item.ip ? t('users.sessions.ip', { ip: item.ip }) : undefined,
                    aside: [
                      t(`users.sessions.sites.${item.site}`),
                      t('users.sessions.lastUsed', { date: formatDateTime(item.lastUsedAt) }),
                    ],
                  }))}
                />
              )}
            </AdminSection>
          ) : null}

          {can('report.handle') &&
          (user.role === 'student' ? can('users.suspend') : can('staff.manage')) ? (
            <Suspense fallback={<LoadingState label={t('common.loadingPage')} />}>
              <UserModeration id={user.id} warn={canSuspend} />
            </Suspense>
          ) : null}

          {can('entitlement.manage') || can('progress.view') ? (
            <Suspense fallback={<LoadingState label={t('common.loadingPage')} />}>
              <UserAccessPanels user={user} />
            </Suspense>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <AdminSection title={t('users.detail.password')}>
            <AdminCard pad className="flex flex-col gap-3">
              <p className="m-0 text-ink">
                {user.hasPassword ? t('users.detail.hasPassword') : t('users.detail.noPassword')}
              </p>
              {can('users.password.view') || can('users.password.set') ? (
                <div className="flex flex-wrap gap-2">
                  {can('users.password.view') && user.hasPassword ? (
                    <AdminButton onClick={() => setDialog('reveal')}>
                      {t('users.reveal.open')}
                    </AdminButton>
                  ) : null}
                  {can('users.password.set') ? (
                    <AdminButton onClick={() => setDialog('password')}>
                      {t('users.setPassword.open')}
                    </AdminButton>
                  ) : null}
                </div>
              ) : null}
            </AdminCard>
          </AdminSection>

          <AdminSection title={t('users.detail.providers')}>
            {user.identities.length === 0 ? (
              <AdminCard pad>
                <p className="m-0 text-ink-3">{t('users.detail.noProviders')}</p>
              </AdminCard>
            ) : (
              <AdminList
                items={user.identities.map((identity) => ({
                  id: identity.provider,
                  title: t(`providers.${identity.provider}`),
                  text: identity.email ?? t('users.detail.providerNoEmail'),
                  aside: [t('users.detail.linkedAt', { date: formatDateTime(identity.createdAt) })],
                }))}
              />
            )}
          </AdminSection>
        </div>
      </div>

      {dialog === 'edit' ? (
        <EditUserDialog
          user={user}
          onClose={close}
          onDone={() => {
            close();
            toast.success(t('users.edit.done'));
          }}
        />
      ) : null}
      {dialog === 'role' ? (
        <RoleDialog
          user={user}
          onClose={close}
          onDone={(changed) => {
            close();
            toast.success(t('users.role.done', { role: t(`roles.${changed.role}`) }));
          }}
        />
      ) : null}
      {dialog === 'suspend' ? (
        <SuspendDialog
          user={user}
          onClose={close}
          onDone={() => {
            close();
            toast.success(t('users.suspend.done', { name: user.name }));
          }}
        />
      ) : null}
      {dialog === 'reactivate' ? <ReactivateConfirm user={user} onClose={close} /> : null}
      {dialog === 'sessions' ? (
        <SimpleConfirm
          title={t('users.sessions.confirmTitle')}
          itemName={user.name}
          message={t('users.sessions.confirmText')}
          confirmLabel={t('users.sessions.confirm')}
          busyLabel={t('users.sessions.busy')}
          action={() =>
            api.DELETE('/api/v1/users/{id}/sessions', { params: { path: { id: user.id } } })
          }
          onClose={close}
          onDone={() => {
            void sessions.refetch();
            toast.success(t('users.sessions.done'));
          }}
        />
      ) : null}
      {dialog === 'reveal' ? <RevealPasswordDialog user={user} onClose={close} /> : null}
      {dialog === 'password' ? (
        <SetPasswordDialog
          user={user}
          onClose={close}
          onDone={() => {
            close();
            toast.success(t('users.setPassword.done'));
          }}
        />
      ) : null}
    </>
  );
}

function ReactivateConfirm({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  return (
    <SimpleConfirm
      title={t('users.reactivate.confirmTitle')}
      itemName={user.name}
      message={t('users.reactivate.confirmText')}
      confirmLabel={t('users.reactivate.confirm')}
      busyLabel={t('users.reactivate.busy')}
      destructive={false}
      action={async () => {
        const { data } = await api.POST('/api/v1/users/{id}/reactivate', {
          params: { path: { id: user.id } },
        });
        if (data) userChanged(queryClient, data);
        return data;
      }}
      onClose={onClose}
      onDone={() => toast.success(t('users.reactivate.done', { name: user.name }))}
    />
  );
}
