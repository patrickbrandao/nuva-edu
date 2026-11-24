import { isApiError } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminSection,
  ExampleHead,
  ExamplePage,
} from '@nuva-edu/ui';
import { LibraryBig, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type Meta, useMeta } from '../api/meta';
import { LinkButton } from '../lib/LinkButton';
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
                <LinkButton to="/cadastro" variant="primary">
                  {t('home.catalog.action')}
                </LinkButton>
              </span>
            </AdminEmpty>
          </AdminCard>
        </AdminSection>

        <AdminSection title={t('home.about.title')}>
          <AdminCard pad aria-busy={meta.isPending}>
            {meta.isPending ? (
              <p role="status" className="m-0 text-sm text-ink-3">
                {t('home.about.loading')}
              </p>
            ) : meta.isError ? (
              <div role="alert">
                <AdminEmpty
                  icon={<TriangleAlert aria-hidden="true" />}
                  title={t('home.about.errorTitle')}
                  text={t('home.about.errorText')}
                >
                  {isApiError(meta.error) && meta.error.requestId ? (
                    <span>{t('common.requestId', { id: meta.error.requestId })}</span>
                  ) : null}
                  <span className="mt-3 flex">
                    <AdminButton onClick={() => void meta.refetch()}>
                      {t('common.retry')}
                    </AdminButton>
                  </span>
                </AdminEmpty>
              </div>
            ) : (
              <AboutDetails meta={meta.data} />
            )}
          </AdminCard>
        </AdminSection>
      </div>
    </>
  );
}
