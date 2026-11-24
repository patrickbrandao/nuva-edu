import type { ClassroomSession } from '@nuva-edu/api-client/classroom';
import { isApiError } from '@nuva-edu/api-client/classroom';
import { AdminButton, AdminCard, PageTitle } from '@nuva-edu/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError, type ErrorText } from '../api/errors';
import { ErrorAlert } from '../auth/ErrorAlert';
import { usePageMeta } from '../lib/usePageMeta';
import { useRefreshSession } from '../session/session';
import { useSignOut } from '../session/useSignOut';
import { TermsAcceptance } from './TermsAcceptance';

/**
 * Tela de aceite (spec 030, RF-03; spec 007, "Termos no cadastro e aceite pendente"): com
 * `termsPending` não vazio, ela toma o lugar de todas as páginas, menos as dos próprios termos.
 */
export function TermsGate({ session }: { session: ClassroomSession }) {
  const { t } = useTranslation();
  const api = useApi();
  const refreshSession = useRefreshSession();
  const { signOut, pending: signingOut } = useSignOut();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const pending = session.termsPending;

  usePageMeta(t('termsGate.title'), t('termsGate.lead'));

  const accept = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.POST('/api/v1/me/terms-acceptance', { body: { termsVersionIds: ids } });
    },
    onMutate: () => setFailure(null),
    onSuccess: () => refreshSession(),
    onError: (cause) => {
      if (isApiError(cause) && cause.code === 'terms_version_outdated') {
        setAccepted(false);
        setError(t('termsGate.outdated'));
        void refreshSession();
        return;
      }
      setFailure(describeError(t, cause));
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accepted) {
      setError(t('termsGate.required'));
      document.querySelector<HTMLInputElement>('[name="acceptedTerms"]')?.focus();
      return;
    }
    setError(undefined);
    accept.mutate(pending.map((version) => version.id));
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10 sm:py-16">
      <PageTitle subtitle={t('termsGate.lead')}>{t('termsGate.title')}</PageTitle>
      <AdminCard as="form" pad className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <ErrorAlert error={failure} />
        <TermsAcceptance
          versions={pending}
          checked={accepted}
          onChange={setAccepted}
          error={error}
          lead={t('termsGate.listLead')}
        />
        <div className="flex flex-wrap gap-2">
          <AdminButton type="submit" variant="primary" disabled={accept.isPending}>
            {accept.isPending ? t('termsGate.submitting') : t('termsGate.submit')}
          </AdminButton>
          <AdminButton onClick={() => void signOut()} disabled={signingOut}>
            {t('shell.signOut')}
          </AdminButton>
        </div>
      </AdminCard>
    </div>
  );
}
