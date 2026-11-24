import { Alert, PageTitle } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PasswordSection } from '../account/PasswordSection';
import { linkErrorKey, ProvidersSection } from '../account/ProvidersSection';
import { useIdentities } from '../account/queries';
import { SessionsSection } from '../account/SessionsSection';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';

/** `/conta/acesso`: senha, provedores vinculados e sessões (spec 007). */
export function AccessPage() {
  const { t } = useTranslation();
  usePageMeta(t('access.title'), t('access.description'));
  return (
    <RequireSession>
      {(session) => <Access hasPassword={session.user.hasPassword} />}
    </RequireSession>
  );
}

function Access({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const linkError = params.get('erro');
  const identities = useIdentities();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageTitle subtitle={t('access.lead')}>{t('access.title')}</PageTitle>
      {linkError ? (
        <Alert tone="error" title={t('access.providers.linkErrorTitle')}>
          {t(linkErrorKey(linkError))}
        </Alert>
      ) : null}
      <PasswordSection hasPassword={identities.data?.hasPassword ?? hasPassword} />
      <ProvidersSection />
      <SessionsSection />
    </div>
  );
}
