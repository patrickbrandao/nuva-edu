import { isApiError } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminField,
  Alert,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
} from '@nuva-edu/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useApi } from '../api/client';
import { describeError } from '../api/errors';
import { AuthLayout, authLinkClass, looksLikeEmail } from '../auth/AuthLayout';
import { ErrorAlert } from '../auth/ErrorAlert';
import { LOGIN_NOTICE_PARAM, PASSWORD_RESET_NOTICE } from '../auth/notices';
import { usePageMeta } from '../lib/usePageMeta';

const backToLogin = (label: string) => (
  <p className="m-0 text-sm text-ink-3">
    <Link to="/entrar" className={authLinkClass}>
      {label}
    </Link>
  </p>
);

/** "Esqueci a senha": pede o link por e-mail; a resposta é sempre a mesma (spec 007). */
function RequestReset() {
  const { t } = useTranslation();
  const api = useApi();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const emailRef = useRef<HTMLInputElement>(null);

  const request = useMutation({
    mutationFn: async (value: string) => {
      await api.POST('/api/v1/auth/password/forgot', { body: { email: value } });
      return value;
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setError(t('reset.errors.emailInvalid'));
      emailRef.current?.focus();
      return;
    }
    setError(undefined);
    request.mutate(email.trim());
  };

  if (request.isSuccess) {
    return (
      <AuthLayout title={t('reset.title')} after={backToLogin(t('reset.backToLogin'))}>
        <Alert tone="success" title={t('reset.sentTitle')}>
          {t('reset.sentText', { email: request.data })}
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('reset.title')}
      lead={t('reset.requestLead')}
      after={backToLogin(t('reset.backToLogin'))}
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <ErrorAlert error={request.error ? describeError(t, request.error) : null} />
        <AdminField
          label={t('reset.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={setEmail}
          error={error}
          ref={emailRef}
        />
        <AdminButton type="submit" variant="primary" disabled={request.isPending}>
          {request.isPending ? t('reset.submitting') : t('reset.submit')}
        </AdminButton>
      </form>
    </AuthLayout>
  );
}

/** Nova senha a partir do link `/redefinir?token=`; não abre sessão, leva a `/entrar`. */
function ChooseNewPassword({ token }: { token: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const passwordRef = useRef<HTMLInputElement>(null);

  const reset = useMutation({
    mutationFn: async (value: string) => {
      await api.POST('/api/v1/auth/password/reset', { body: { token, password: value } });
    },
    onSuccess: () => {
      navigate(`/entrar?${LOGIN_NOTICE_PARAM}=${PASSWORD_RESET_NOTICE}`, { replace: true });
    },
    onError: (failure) => {
      if (isApiError(failure) && failure.code === 'password_invalid') {
        setError(t('password.invalid'));
        passwordRef.current?.focus();
      }
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      setError(t('password.invalid'));
      passwordRef.current?.focus();
      return;
    }
    setError(undefined);
    reset.mutate(password);
  };

  if (isApiError(reset.error) && reset.error.code === 'token_expired') {
    return (
      <AuthLayout title={t('reset.title')} after={backToLogin(t('reset.backToLogin'))}>
        <div className="flex flex-col gap-4">
          <Alert tone="error" title={t('reset.expiredTitle')}>
            {t('reset.expiredText')}
          </Alert>
          <AdminButton href="/redefinir" variant="primary">
            {t('reset.requestAgain')}
          </AdminButton>
        </div>
      </AuthLayout>
    );
  }

  const failure =
    reset.error && !(isApiError(reset.error) && reset.error.code === 'password_invalid')
      ? describeError(t, reset.error)
      : null;

  return (
    <AuthLayout
      title={t('reset.title')}
      lead={t('reset.newLead')}
      after={backToLogin(t('reset.backToLogin'))}
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <ErrorAlert error={failure} />
        <PasswordInput
          label={t('reset.newPassword')}
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
          showLabel={t('password.show')}
          hideLabel={t('password.hide')}
          hint={t('password.hint')}
          error={error}
          inputRef={passwordRef}
        />
        <AdminButton type="submit" variant="primary" disabled={reset.isPending}>
          {reset.isPending ? t('reset.saving') : t('reset.save')}
        </AdminButton>
      </form>
    </AuthLayout>
  );
}

/** `/redefinir` (pedir o link) e `/redefinir?token=` (nova senha), spec 007. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  usePageMeta(t('reset.title'), t('reset.description'));
  return token ? <ChooseNewPassword token={token} /> : <RequestReset />;
}
