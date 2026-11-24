import { isApiError } from '@nuva-edu/api-client/classroom';
import { AdminButton, AdminField, Alert, PasswordInput } from '@nuva-edu/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useApi } from '../api/client';
import { describeError, formatWait } from '../api/errors';
import { AuthLayout, authLinkClass, looksLikeEmail } from '../auth/AuthLayout';
import { ErrorAlert } from '../auth/ErrorAlert';
import { LOGIN_NOTICE_PARAM, PASSWORD_RESET_NOTICE } from '../auth/notices';
import { SocialButtons } from '../auth/SocialButtons';
import { usePageMeta } from '../lib/usePageMeta';
import { DEFAULT_AFTER_LOGIN, RETURN_PARAM, safeReturnTo, withReturnTo } from '../session/returnTo';
import { useRefreshSession, useSession, useStoreSession } from '../session/session';

/** Códigos de `?erro=` da volta do login social (spec 007, "Fluxo do provedor"). */
const OAUTH_ERRORS = [
  'oauth_state_invalid',
  'oauth_denied',
  'oauth_provider_error',
  'account_suspended',
  'staff_only',
  'identity_in_use',
] as const;
type OAuthError = (typeof OAUTH_ERRORS)[number];

function isOAuthError(code: string): code is OAuthError {
  return (OAUTH_ERRORS as readonly string[]).includes(code);
}

interface FieldErrors {
  email?: string;
  password?: string;
}

/** Tela de login por e-mail e senha (spec 007, "Login por senha"). */
export function LoginPage() {
  const { t } = useTranslation();
  const api = useApi();
  const { session } = useSession();
  const storeSession = useStoreSession();
  const refreshSession = useRefreshSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get(RETURN_PARAM));
  const oauthError = params.get('erro');
  const notice = params.get(LOGIN_NOTICE_PARAM);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  usePageMeta(t('login.title'), t('login.description'));

  const login = useMutation({
    mutationFn: async (body: { email: string; password: string }) => {
      const { data } = await api.POST('/api/v1/auth/login', { body });
      return data ?? null;
    },
    onSuccess: async (data) => {
      if (data) storeSession(data);
      else await refreshSession();
      navigate(returnTo ?? DEFAULT_AFTER_LOGIN, { replace: true });
    },
  });

  // Quem já entrou não precisa desta tela.
  if (session && !login.isPending) {
    return <Navigate to={returnTo ?? DEFAULT_AFTER_LOGIN} replace />;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!email.trim()) found.email = t('login.errors.emailRequired');
    else if (!looksLikeEmail(email)) found.email = t('login.errors.emailInvalid');
    if (!password) found.password = t('login.errors.passwordRequired');
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();
    login.mutate({ email: email.trim(), password });
  };

  const wait = isApiError(login.error) ? login.error.retryAfter : undefined;
  const failure = login.error
    ? describeError(t, login.error, {
        invalid_credentials: t('login.errors.invalidCredentials'),
        account_suspended: t('login.errors.accountSuspended'),
        too_many_attempts:
          wait !== undefined
            ? t('login.errors.tooManyAttempts', { time: formatWait(t, wait) })
            : t('login.errors.tooManyAttemptsNoTime'),
      })
    : null;

  return (
    <AuthLayout
      title={t('login.title')}
      lead={t('login.lead')}
      after={
        <p className="m-0 text-sm text-ink-3">
          {t('login.noAccount')}{' '}
          <Link to={withReturnTo('/cadastro', returnTo)} className={authLinkClass}>
            {t('login.signUp')}
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {oauthError ? (
          <Alert tone="error" title={t('login.oauth.title')}>
            {isOAuthError(oauthError)
              ? t(`login.oauth.codes.${oauthError}`)
              : t('login.oauth.codes.unknown')}
          </Alert>
        ) : null}
        {notice === PASSWORD_RESET_NOTICE ? (
          <Alert tone="success">{t('login.notices.passwordReset')}</Alert>
        ) : null}
        <ErrorAlert error={failure} />

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <AdminField
            label={t('login.email')}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={setEmail}
            error={errors.email}
            ref={emailRef}
          />
          <PasswordInput
            label={t('login.password')}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
            showLabel={t('password.show')}
            hideLabel={t('password.hide')}
            error={errors.password}
            inputRef={passwordRef}
            // no login vale qualquer tamanho: quem decide é a API (invalid_credentials)
            minLength={0}
          />
          <AdminButton type="submit" variant="primary" disabled={login.isPending}>
            {login.isPending ? t('login.submitting') : t('login.submit')}
          </AdminButton>
          <Link to="/redefinir" className={`${authLinkClass} self-start text-[13px]`}>
            {t('login.forgot')}
          </Link>
        </form>
      </div>

      <SocialButtons title={t('login.social')} returnTo={returnTo ?? DEFAULT_AFTER_LOGIN} />
    </AuthLayout>
  );
}
