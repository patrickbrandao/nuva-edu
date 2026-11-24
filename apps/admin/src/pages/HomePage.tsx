import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminPageHeader,
  AdminSection,
} from '@nuva-edu/ui';
import { CircleAlert, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type Meta, useMeta } from '../api/meta';

/** Painel: por enquanto mostra os dados da instalação vindos de `/api/v1/meta`. */
export function HomePage() {
  const { t } = useTranslation();
  const meta = useMeta();

  return (
    <>
      <AdminPageHeader title={t('home.title')} subtitle={t('home.subtitle')} />
      <AdminSection title={t('home.meta.title')}>
        {meta.isPending ? (
          <p role="status" className="m-0 text-ink-3">
            {t('home.meta.loading')}
          </p>
        ) : meta.isError ? (
          <div role="alert">
            <AdminEmpty
              icon={<CircleAlert aria-hidden="true" />}
              title={t('home.meta.errorTitle')}
              text={t('home.meta.errorText')}
            >
              {isApiError(meta.error) && meta.error.requestId ? (
                <span>{t('common.requestId', { id: meta.error.requestId })}</span>
              ) : null}
              <AdminButton
                icon={<RotateCw aria-hidden="true" />}
                disabled={meta.isFetching}
                onClick={() => void meta.refetch()}
              >
                {t('common.retry')}
              </AdminButton>
            </AdminEmpty>
          </div>
        ) : (
          <MetaCard meta={meta.data} />
        )}
      </AdminSection>
    </>
  );
}

function MetaCard({ meta }: { meta: Meta }) {
  const { t } = useTranslation();
  const providers = meta.authProviders.map((provider) => t(`providers.${provider}`));
  const items = [
    { label: t('home.meta.schoolName'), value: meta.schoolName },
    { label: t('home.meta.version'), value: meta.version },
    { label: t('home.meta.currency'), value: meta.currency },
    { label: t('home.meta.locale'), value: meta.locale },
    {
      label: t('home.meta.authProviders'),
      value: providers.length > 0 ? providers.join(', ') : t('home.meta.noAuthProviders'),
    },
  ];
  return (
    <AdminCard pad>
      <AdminDetails items={items} />
    </AdminCard>
  );
}
