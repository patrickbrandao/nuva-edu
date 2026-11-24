import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminCard,
  AdminSection,
  AdminTag,
  Alert,
  ConfirmDialog,
  ErrorState,
  LoadingState,
} from '@nuva-edu/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError, type ErrorText } from '../api/errors';
import { ErrorAlert } from '../auth/ErrorAlert';
import { ACCOUNT_SESSIONS_KEY, useAccountSessions } from './queries';

type SessionInfo = ClassroomSchemas['SessionInfo'];

/**
 * Sessões abertas nos dois sites (spec 007, "Sessões"): encerrar uma, ou todas as outras.
 * A sessão atual não se encerra aqui (para isso há "Sair").
 */
export function SessionsSection() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const client = useQueryClient();
  const sessions = useAccountSessions();
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [done, setDone] = useState('');
  const [confirmOthers, setConfirmOthers] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ACCOUNT_SESSIONS_KEY });

  const revokeOne = useMutation({
    mutationFn: async (session: SessionInfo) => {
      await api.DELETE('/api/v1/account/sessions/{id}', { params: { path: { id: session.id } } });
      return session;
    },
    onMutate: () => {
      setFailure(null);
      setDone('');
    },
    onSuccess: async (session) => {
      setDone(t('access.sessions.revoked', { device: describe(session) }));
      await refresh();
    },
    onError: (error) => setFailure(describeError(t, error)),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      await api.DELETE('/api/v1/account/sessions');
    },
    onMutate: () => {
      setFailure(null);
      setDone('');
    },
    onSuccess: async () => {
      setConfirmOthers(false);
      setDone(t('access.sessions.othersRevoked'));
      await refresh();
    },
    onError: (error) => {
      setConfirmOthers(false);
      setFailure(describeError(t, error));
    },
  });

  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  function describe(session: SessionInfo): string {
    const browser = session.browser ?? t('access.sessions.unknownBrowser');
    const system = session.os ?? t('access.sessions.unknownSystem');
    return t('access.sessions.device', { browser, system });
  }

  let body: ReactNode;
  if (sessions.isPending) body = <LoadingState label={t('access.sessions.loading')} />;
  else if (sessions.isError) {
    const error = describeError(t, sessions.error);
    body = (
      <ErrorState
        title={t('access.sessions.errorTitle')}
        text={error.message}
        detail={error.detail}
        retryLabel={t('common.retry')}
        onRetry={() => void sessions.refetch()}
        retrying={sessions.isFetching}
      />
    );
  } else {
    const others = sessions.data.filter((session) => !session.current);
    body = (
      <>
        <ul className="m-0 flex list-none flex-col p-0">
          {sessions.data.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-line py-3 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {describe(session)}
                  {session.current ? <AdminTag>{t('access.sessions.current')}</AdminTag> : null}
                </span>
                <span className="text-[13px] text-ink-3">
                  {t('access.sessions.details', {
                    site: t(`access.sessions.sites.${session.site}`),
                    ip: session.ip ?? t('access.sessions.unknownIp'),
                    lastUsed: when.format(new Date(session.lastUsedAt)),
                  })}
                </span>
              </span>
              {session.current ? null : (
                <AdminButton
                  size="sm"
                  onClick={() => revokeOne.mutate(session)}
                  disabled={revokeOne.isPending}
                  aria-label={t('access.sessions.revokeNamed', { device: describe(session) })}
                >
                  {t('access.sessions.revoke')}
                </AdminButton>
              )}
            </li>
          ))}
        </ul>
        {others.length ? (
          <span className="flex">
            <AdminButton variant="danger" onClick={() => setConfirmOthers(true)}>
              {t('access.sessions.revokeOthers')}
            </AdminButton>
          </span>
        ) : (
          <p className="m-0 text-[13px] text-ink-3">{t('access.sessions.onlyThis')}</p>
        )}
      </>
    );
  }

  return (
    <AdminSection title={t('access.sessions.title')}>
      <AdminCard pad>
        <div className="flex flex-col gap-3">
          {done ? <Alert tone="success">{done}</Alert> : null}
          <ErrorAlert error={failure} />
          {body}
        </div>
      </AdminCard>
      <ConfirmDialog
        open={confirmOthers}
        onCancel={() => setConfirmOthers(false)}
        onConfirm={() => revokeOthers.mutate()}
        title={t('access.sessions.confirmTitle')}
        itemName={t('access.sessions.confirmItem', {
          count: sessions.data?.filter((session) => !session.current).length ?? 0,
        })}
        message={t('access.sessions.confirmText')}
        confirmLabel={t('access.sessions.revokeOthers')}
        cancelLabel={t('common.cancel')}
        busy={revokeOthers.isPending}
        busyLabel={t('access.sessions.revoking')}
      />
    </AdminSection>
  );
}
