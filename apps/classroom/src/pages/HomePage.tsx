import { isApiError } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminSection,
  ErrorState,
  ExampleHead,
  ExamplePage,
  LoadingState,
} from '@nuva-edu/ui';
import { LibraryBig } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type Meta, useMeta } from '../api/meta';
import { usePageMeta } from '../lib/usePageMeta';

/** Nome legível de um código (moeda ou idioma) no idioma da interface. */
function displayName(type: 'currency' | 'language', code: string, locale: string): string {
  try {
    return new Intl.DisplayNames(locale, { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

function AboutDetails({ meta }: { meta: Meta }) {
  const { t, i18n } = useTranslation();
  const signIn = [
    t('home.about.emailAndPassword'),
    ...meta.authProviders.map((provider) => t(`auth.providers.${provider}`)),
  ];
  return (
    <AdminDetails
      wrap
      items={[
        { label: t('home.about.school'), value: meta.schoolName },
        { label: t('home.about.version'), value: meta.version },
        {
          label: t('home.about.currency'),
          value: `${displayName('currency', meta.currency, i18n.language)} (${meta.currency})`,
        },
        {
          label: t('home.about.locale'),
          value: displayName('language', meta.locale, i18n.language),
        },
        { label: t('home.about.signIn'), value: signIn.join(', ') },
      ]}
    />
  );
}

/** Vitrine pública (spec 006): por enquanto vazia, com os dados de `/api/v1/meta`. */
export function HomePage() {
  const { t } = useTranslation();
  const meta = useMeta();
  const school = meta.data?.schoolName;

  usePageMeta(
    t('home.title'),
    school ? t('home.description', { school }) : t('home.descriptionFallback'),
  );

  return (
    <>
      <ExamplePage>
        <ExampleHead title={school ?? t('home.welcome')} lead={t('home.lead')} />
      </ExamplePage>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <AdminSection title={t('home.catalog.title')}>
          <AdminCard>
            <AdminEmpty
              icon={<LibraryBig aria-hidden="true" />}
              title={t('home.catalog.emptyTitle')}
              text={t('home.catalog.emptyText')}
            >
              <span className="mt-3 flex">
                <AdminButton href="/cadastro" variant="primary">
                  {t('home.catalog.action')}
                </AdminButton>
              </span>
            </AdminEmpty>
          </AdminCard>
        </AdminSection>

        <AdminSection title={t('home.about.title')}>
          <AdminCard pad aria-busy={meta.isPending}>
            {meta.isPending ? (
              <LoadingState label={t('home.about.loading')} />
            ) : meta.isError ? (
              <ErrorState
                title={t('home.about.errorTitle')}
                text={t('home.about.errorText')}
                detail={
                  isApiError(meta.error) && meta.error.requestId
                    ? t('common.requestId', { id: meta.error.requestId })
                    : undefined
                }
                retryLabel={t('common.retry')}
                onRetry={() => void meta.refetch()}
                retrying={meta.isFetching}
              />
            ) : (
              <AboutDetails meta={meta.data} />
            )}
          </AdminCard>
        </AdminSection>
      </div>
    </>
  );
}
