import { isApiError } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminField,
  ErrorState,
  LoadingState,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
} from '@nuva-edu/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useApi } from '../api/client';
import { describeError, type ErrorText, fieldErrors } from '../api/errors';
import { AuthLayout, authLinkClass, looksLikeEmail } from '../auth/AuthLayout';
import { ErrorAlert } from '../auth/ErrorAlert';
import { useCurrentTerms } from '../legal/legal';
import { TermsAcceptance } from '../legal/TermsAcceptance';
import { usePageMeta } from '../lib/usePageMeta';
import { DEFAULT_AFTER_LOGIN, RETURN_PARAM, safeReturnTo, withReturnTo } from '../session/returnTo';
import { useSession, useStoreSession } from '../session/session';

export const NAME_MAX_LENGTH = 80;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  terms?: string;
}

interface SignUpBody {
  name: string;
  email: string;
  password: string;
  acceptedTerms: string[];
}

/**
 * Cadastro por e-mail e senha (spec 007, "Cadastro por e-mail e senha"). A rota de cadastro não
 * abre sessão: depois do `204` o site entra com as mesmas credenciais.
 */
export function SignUpPage() {
  const { t } = useTranslation();
  const api = useApi();
  const { session } = useSession();
  const storeSession = useStoreSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get(RETURN_PARAM));
  const terms = useCurrentTerms();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [loginFailed, setLoginFailed] = useState(false);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  usePageMeta(t('signUp.title'), t('signUp.description'));

  const focusFirst = (found: FieldErrors) => {
    if (found.name) refs.name.current?.focus();
    else if (found.email) refs.email.current?.focus();
    else if (found.password) refs.password.current?.focus();
    else if (found.terms)
      document.querySelector<HTMLInputElement>('[name="acceptedTerms"]')?.focus();
  };

  const signUp = useMutation({
    mutationFn: async (body: SignUpBody) => {
      await api.POST('/api/v1/auth/register', { body });
      // O cadastro não abre sessão nem revela se o e-mail já existia: entra com os mesmos dados.
      try {
        const { data } = await api.POST('/api/v1/auth/login', {
          body: { email: body.email, password: body.password },
        });
        return data ?? null;
      } catch {
        return 'login-failed' as const;
      }
    },
    onMutate: () => {
      setFailure(null);
      setLoginFailed(false);
    },
    onSuccess: (result) => {
      if (result === 'login-failed' || result === null) {
        setLoginFailed(true);
        return;
      }
      storeSession(result);
      navigate(returnTo ?? DEFAULT_AFTER_LOGIN, { replace: true });
    },
    onError: (error) => {
      const found: FieldErrors = {};
      if (isApiError(error) && error.code === 'password_invalid') {
        found.password = t('password.invalid');
      } else if (isApiError(error) && error.code === 'terms_acceptance_required') {
        found.terms = t('signUp.errors.termsChanged');
        setAccepted(false);
        void terms.refetch();
      } else if (isApiError(error) && error.status === 400) {
        const fields = fieldErrors(error);
        if (fields.name) found.name = t('signUp.errors.nameRequired');
        if (fields.email) found.email = t('signUp.errors.emailInvalid');
        if (fields.password) found.password = t('password.invalid');
      }
      setErrors(found);
      if (Object.keys(found).length) focusFirst(found);
      else setFailure(describeError(t, error));
    },
  });

  if (session && !signUp.isPending) {
    return <Navigate to={returnTo ?? DEFAULT_AFTER_LOGIN} replace />;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: FieldErrors = {};
    const trimmedName = name.trim();
    if (!trimmedName) found.name = t('signUp.errors.nameRequired');
    else if (trimmedName.length > NAME_MAX_LENGTH) found.name = t('signUp.errors.nameTooLong');
    if (!looksLikeEmail(email)) found.email = t('signUp.errors.emailInvalid');
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      found.password = t('password.invalid');
    }
    if (terms.versions.length && !accepted) found.terms = t('signUp.errors.termsRequired');
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirst(found);
      return;
    }
    signUp.mutate({
      name: trimmedName,
      email: email.trim(),
      password,
      acceptedTerms: accepted ? terms.versions.map((version) => version.id) : [],
    });
  };

  const termsError = terms.error ? describeError(t, terms.error) : null;

  return (
    <AuthLayout
      title={t('signUp.title')}
      lead={t('signUp.lead')}
      after={
        <p className="m-0 text-sm text-ink-3">
          {t('signUp.hasAccount')}{' '}
          <Link to={withReturnTo('/entrar', returnTo)} className={authLinkClass}>
            {t('signUp.signIn')}
          </Link>
        </p>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <ErrorAlert error={failure} />
        {loginFailed ? (
          <ErrorAlert
            error={{ code: 'login_failed', message: t('signUp.loginAfterFailed') }}
            actions={
              <AdminButton href={withReturnTo('/entrar', returnTo)} size="sm">
                {t('signUp.goToLogin')}
              </AdminButton>
            }
          />
        ) : null}
        <AdminField
          label={t('signUp.name')}
          name="name"
          autoComplete="name"
          required
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={setName}
          hint={t('signUp.nameHint')}
          error={errors.name}
          ref={refs.name}
        />
        <AdminField
          label={t('signUp.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={setEmail}
          error={errors.email}
          ref={refs.email}
        />
        <PasswordInput
          label={t('signUp.password')}
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
          showLabel={t('password.show')}
          hideLabel={t('password.hide')}
          hint={t('signUp.passwordHint')}
          error={errors.password}
          inputRef={refs.password}
        />

        {terms.pending ? (
          <LoadingState inline label={t('signUp.termsLoading')} />
        ) : termsError ? (
          <ErrorState
            title={t('signUp.termsErrorTitle')}
            text={termsError.message}
            detail={termsError.detail}
            retryLabel={t('common.retry')}
            onRetry={() => void terms.refetch()}
            retrying={terms.retrying}
          />
        ) : (
          <TermsAcceptance
            versions={terms.versions}
            checked={accepted}
            onChange={setAccepted}
            error={errors.terms}
          />
        )}

        <AdminButton
          type="submit"
          variant="primary"
          disabled={signUp.isPending || terms.pending || Boolean(termsError)}
        >
          {signUp.isPending ? t('signUp.submitting') : t('signUp.submit')}
        </AdminButton>
      </form>
    </AuthLayout>
  );
}
