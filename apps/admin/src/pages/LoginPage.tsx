import { type AdminAuthProvider, adminOAuthStartUrl, isApiError } from '@nuva-edu/api-client/admin';
import { AdminButton, AdminField, Alert, PasswordInput, TextLink } from '@nuva-edu/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useApi } from '../api/client';
import { useMeta } from '../api/meta';
import { useProblemText } from '../api/problems';
import { useRuntimeConfig } from '../runtime/useRuntimeConfig';
import { browser } from '../session/browser';
import { DESTINATION_PARAM, ERROR_PARAM, safeDestination } from '../session/destination';
import { storeSession } from '../session/session';
import { StandalonePage } from '../shell/StandalonePage';

interface Problem {
  title?: string;
  text: ReactNode;
}

/**
 * Entrar no painel (spec 007, "Login por senha" e "Login social"): e-mail e senha, ou um dos
 * provedores ligados nesta instalação. Depois do login, volta ao destino guardado.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: meta } = useMeta();
  const { classroomUrl } = useRuntimeConfig();
  const describe = useProblemText();
  const destination = safeDestination(params.get(DESTINATION_PARAM));
  const returnError = params.get(ERROR_PARAM);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState<{ email?: boolean; password?: boolean }>({});

  const login = useMutation({
    mutationFn: async () => {
      const { data } = await api.POST('/api/v1/auth/login', {
        body: { email: email.trim(), password },
      });
      if (!data) throw new Error('POST /api/v1/auth/login respondeu sem corpo');
      return data;
    },
    onSuccess: (session) => {
      storeSession(queryClient, session);
      void navigate(destination, { replace: true });
    },
  });

  const staffOnly = (): Problem => ({
    title: t('noAccess.title'),
    text: (
      <>
        {t('noAccess.text')}
        {classroomUrl ? (
          <>
            {' '}
            <TextLink href={classroomUrl}>{t('noAccess.classroomLink')}</TextLink>
          </>
        ) : null}
      </>
    ),
  });

  const fromCode = (code: string): Problem | undefined => {
    switch (code) {
      case 'invalid_credentials':
        return { text: t('login.errors.invalidCredentials') };
      case 'account_suspended':
        return { text: t('login.errors.accountSuspended') };
      case 'staff_only':
        return staffOnly();
      case 'validation_failed':
        return { text: t('login.errors.validation') };
      default:
        return undefined;
    }
  };

  const loginProblem = (error: unknown): Problem => {
    if (isApiError(error)) {
      if (error.code === 'too_many_attempts') {
        return {
          text:
            error.retryAfter !== undefined
              ? t('login.errors.tooManyAttemptsIn', {
                  count: Math.max(1, Math.ceil(error.retryAfter / 60)),
                })
              : t('login.errors.tooManyAttempts'),
        };
      }
      const known = fromCode(error.code);
      if (known) return known;
    }
    const { text, detail } = describe(error);
    return { text: detail ? `${text} ${detail}` : text };
  };

  const returnProblem = (code: string): Problem => {
    switch (code) {
      case 'oauth_state_invalid':
        return { text: t('login.errors.oauthStateInvalid') };
      case 'oauth_denied':
        return { text: t('login.errors.oauthDenied') };
      case 'oauth_provider_error':
        return { text: t('login.errors.oauthProviderError') };
      default:
        return fromCode(code) ?? { text: t('login.errors.oauthUnknown') };
    }
  };

  const problem: Problem | undefined = login.isError
    ? loginProblem(login.error)
    : !login.isPending && !login.isSuccess && returnError
      ? returnProblem(returnError)
      : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const empty = { email: email.trim() === '', password: password === '' };
    setMissing(empty);
    if (empty.email || empty.password) return;
    login.mutate();
  };

  const startProvider = (provider: AdminAuthProvider) => {
    browser.assign(adminOAuthStartUrl(provider, { returnTo: destination }));
  };

  const providers = meta?.authProviders ?? [];

  return (
    <StandalonePage title={t('login.title')} subtitle={t('login.subtitle')}>
      {problem ? (
        <Alert tone="error" title={problem.title} className="mb-4">
          {problem.text}
        </Alert>
      ) : null}
      <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('login.email')}
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          error={missing.email ? t('login.emailRequired') : undefined}
          disabled={login.isPending}
        />
        <PasswordInput
          label={t('login.password')}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
          // Sem limite de tamanho no login: qualquer valor errado é `invalid_credentials`.
          minLength={0}
          maxLength={1024}
          error={missing.password ? t('login.passwordRequired') : undefined}
          disabled={login.isPending}
        />
        <AdminButton
          variant="primary"
          type="submit"
          disabled={login.isPending}
          aria-busy={login.isPending || undefined}
        >
          {login.isPending ? t('login.submitting') : t('login.submit')}
        </AdminButton>
        {classroomUrl ? (
          <p className="m-0 text-sm">
            <TextLink href={`${classroomUrl}/redefinir`}>{t('login.forgotPassword')}</TextLink>
          </p>
        ) : null}
      </form>
      {providers.length > 0 ? (
        <section aria-label={t('login.providersLabel')} className="mt-5 flex flex-col gap-2">
          <p className="m-0 text-xs text-ink-3">{t('login.orWith')}</p>
          {providers.map((provider) => (
            <AdminButton key={provider} onClick={() => startProvider(provider)}>
              {t('login.withProvider', { provider: t(`providers.${provider}`) })}
            </AdminButton>
          ))}
        </section>
      ) : null}
    </StandalonePage>
  );
}
