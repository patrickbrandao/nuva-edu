import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminDetails,
  AdminField,
  Alert,
  ErrorState,
  LoadingState,
} from '@nuva-edu/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApi } from '../api/client';
import { describeError, type ErrorText, fieldErrors } from '../api/errors';
import { AuthLayout, looksLikeEmail } from '../auth/AuthLayout';
import { ErrorAlert } from '../auth/ErrorAlert';
import { TermsAcceptance } from '../legal/TermsAcceptance';
import { usePageMeta } from '../lib/usePageMeta';
import { DEFAULT_AFTER_LOGIN, withReturnTo } from '../session/returnTo';
import { useStoreSession } from '../session/session';
import { LOGIN_PATH } from '../shell/navigation';

type SocialPending = ClassroomSchemas['SocialPending'];

/** Configurações > Acesso, onde se vincula um provedor a uma conta que já existe. */
const ACCESS_PATH = '/conta/acesso';

interface FieldErrors {
  email?: string;
  terms?: string;
}

/** O cadastro pendente venceu (30 minutos) ou não existe: recomeçar pelo provedor. */
function Expired() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning" title={t('socialSignUp.expiredTitle')}>
        {t('socialSignUp.expiredText')}
      </Alert>
      <AdminButton href={LOGIN_PATH} variant="primary">
        {t('socialSignUp.backToLogin')}
      </AdminButton>
    </div>
  );
}

function CompleteForm({ pending, onExpired }: { pending: SocialPending; onExpired: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const storeSession = useStoreSession();
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const provider = t(`auth.providers.${pending.provider}`);
  const asksEmail = pending.email === null;

  const complete = useMutation({
    mutationFn: async (body: { acceptedTerms: string[]; email?: string }) => {
      const { data } = await api.POST('/api/v1/auth/social/complete', { body });
      return data ?? null;
    },
    onMutate: () => {
      setFailure(null);
      setEmailTaken(false);
    },
    onSuccess: (session) => {
      storeSession(session);
      navigate(DEFAULT_AFTER_LOGIN, { replace: true });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'email_taken') {
        setEmailTaken(true);
        return;
      }
      if (isApiError(error) && error.code === 'terms_acceptance_required') {
        setAccepted(false);
        setErrors({ terms: t('signUp.errors.termsChanged') });
        onExpired();
        return;
      }
      if (isApiError(error) && error.status === 404 && error.code === 'not_found') {
        onExpired();
        return;
      }
      if (isApiError(error) && error.status === 400 && fieldErrors(error).email) {
        setErrors({ email: t('signUp.errors.emailInvalid') });
        emailRef.current?.focus();
        return;
      }
      setFailure(describeError(t, error));
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: FieldErrors = {};
    if (asksEmail && !looksLikeEmail(email)) found.email = t('signUp.errors.emailInvalid');
    if (pending.terms.length && !accepted) found.terms = t('signUp.errors.termsRequired');
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.terms) {
      document.querySelector<HTMLInputElement>('[name="acceptedTerms"]')?.focus();
      return;
    }
    complete.mutate({
      acceptedTerms: accepted ? pending.terms.map((version) => version.id) : [],
      ...(asksEmail ? { email: email.trim() } : {}),
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <ErrorAlert error={failure} />
      {emailTaken ? (
        <Alert
          tone="error"
          title={t('socialSignUp.emailTakenTitle')}
          actions={
            <AdminButton href={withReturnTo(LOGIN_PATH, ACCESS_PATH)} size="sm">
              {t('socialSignUp.emailTakenAction')}
            </AdminButton>
          }
        >
          {t('socialSignUp.emailTakenText', { provider })}
        </Alert>
      ) : null}
      <AdminDetails
        items={[
          { label: t('socialSignUp.provider'), value: provider },
          ...(pending.name ? [{ label: t('socialSignUp.name'), value: pending.name }] : []),
          ...(pending.email ? [{ label: t('socialSignUp.email'), value: pending.email }] : []),
        ]}
      />
      {asksEmail ? (
        <AdminField
          label={t('socialSignUp.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={setEmail}
          hint={t('socialSignUp.emailHint', { provider })}
          error={errors.email}
          ref={emailRef}
        />
      ) : null}
      {!asksEmail && !pending.emailVerified ? (
        <p className="m-0 text-[13px] text-ink-3">{t('socialSignUp.unverifiedNote')}</p>
      ) : null}
      <TermsAcceptance
        versions={pending.terms}
        checked={accepted}
        onChange={setAccepted}
        error={errors.terms}
      />
      <AdminButton type="submit" variant="primary" disabled={complete.isPending}>
        {complete.isPending ? t('socialSignUp.submitting') : t('socialSignUp.submit')}
      </AdminButton>
    </form>
  );
}

/**
 * `/cadastro/social`: conclusão do cadastro pelo provedor (spec 007, "Cadastro pendente"), com o
 * que ele informou, o e-mail quando faltou e o aceite dos termos vigentes.
 */
export function SocialSignUpPage() {
  const { t } = useTranslation();
  const api = useApi();
  usePageMeta(t('socialSignUp.title'), t('socialSignUp.description'));

  const query = useQuery({
    queryKey: ['social-pending'],
    queryFn: async ({ signal }): Promise<SocialPending | null> => {
      try {
        const { data } = await api.GET('/api/v1/auth/social/pending', { signal });
        return data ?? null;
      } catch (error) {
        // Sem cookie de retorno válido: 404 do contrato (`not_found`). Um 404 sem o código é
        // a rota ainda inexistente, e cai no erro tratado.
        if (isApiError(error) && error.status === 404 && error.code === 'not_found') return null;
        throw error;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  let body: ReactNode;
  if (query.isPending) body = <LoadingState label={t('socialSignUp.loading')} />;
  else if (query.isError) {
    const failure = describeError(t, query.error);
    body = (
      <ErrorState
        title={t('socialSignUp.errorTitle')}
        text={failure.message}
        detail={failure.detail}
        retryLabel={t('common.retry')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (!query.data) body = <Expired />;
  else body = <CompleteForm pending={query.data} onExpired={() => void query.refetch()} />;

  return (
    <AuthLayout title={t('socialSignUp.title')} lead={t('socialSignUp.lead')}>
      {body}
    </AuthLayout>
  );
}
