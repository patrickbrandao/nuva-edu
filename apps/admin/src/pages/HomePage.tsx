import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminCard,
  AdminDetails,
  AdminPageHeader,
  AdminSection,
  ErrorState,
  LoadingState,
} from '@nuva-edu/ui';
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
          <LoadingState label={t('home.meta.loading')} />
        ) : meta.isError ? (
          <ErrorState
            title={t('home.meta.errorTitle')}
            text={t('home.meta.errorText')}
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
      <AdminDetails wrap items={items} />
    </AdminCard>
  );
}
