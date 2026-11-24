import { isApiError } from '@nuva-edu/api-client/classroom';
import { AdminButton, Alert, ErrorState, LoadingState } from '@nuva-edu/ui';
import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useApi } from '../api/client';
import { describeError } from '../api/errors';
import { AuthLayout } from '../auth/AuthLayout';
import { ResendVerification } from '../auth/ResendVerification';
import { usePageMeta } from '../lib/usePageMeta';
import { DEFAULT_AFTER_LOGIN, withReturnTo } from '../session/returnTo';
import { useRefreshSession, useSession } from '../session/session';

/** Confirmação de e-mail pelo link `/confirmar?token=` (spec 007, "Confirmação de e-mail"). */
export function ConfirmEmailPage() {
  const { t } = useTranslation();
  const api = useApi();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { session } = useSession();
  const refreshSession = useRefreshSession();
  const sent = useRef('');

  usePageMeta(t('confirm.title'), t('confirm.description'));

  const verify = useMutation({
    mutationFn: async (value: string) => {
      await api.POST('/api/v1/auth/email/verify', { body: { token: value } });
    },
    onSuccess: () => refreshSession(),
  });
  const { mutate } = verify;

  // O token é de uso único: a confirmação sai uma vez por token, mesmo no modo estrito do React.
  useEffect(() => {
    if (!token || sent.current === token) return;
    sent.current = token;
    mutate(token);
  }, [token, mutate]);

  const next = session ? DEFAULT_AFTER_LOGIN : withReturnTo('/entrar', DEFAULT_AFTER_LOGIN);
  const nextLabel = session ? t('confirm.continue') : t('confirm.signIn');

  let body: ReactNode;
  if (!token) {
    body = (
      <Alert tone="error" title={t('confirm.missingTitle')}>
        {t('confirm.missingText')}
      </Alert>
    );
  } else if (verify.isSuccess) {
    body = (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={t('confirm.successTitle')}>
          {t('confirm.successText')}
        </Alert>
        <AdminButton href={next} variant="primary">
          {nextLabel}
        </AdminButton>
      </div>
    );
  } else if (isApiError(verify.error) && verify.error.code === 'token_expired') {
    body = (
      <div className="flex flex-col gap-4">
        <Alert tone="error" title={t('confirm.expiredTitle')}>
          {session ? t('confirm.expiredText') : t('confirm.expiredTextSignedOut')}
        </Alert>
        {session ? (
          session.user.emailVerified ? null : (
            <ResendVerification email={session.user.email} />
          )
        ) : (
          <AdminButton href={next} variant="primary">
            {t('confirm.signIn')}
          </AdminButton>
        )}
      </div>
    );
  } else if (verify.isError) {
    const failure = describeError(t, verify.error);
    body = (
      <ErrorState
        title={t('confirm.errorTitle')}
        text={failure.message}
        detail={failure.detail}
        retryLabel={t('common.retry')}
        onRetry={() => mutate(token)}
        retrying={verify.isPending}
      />
    );
  } else {
    body = <LoadingState label={t('confirm.verifying')} />;
  }

  return <AuthLayout title={t('confirm.title')}>{body}</AuthLayout>;
}
