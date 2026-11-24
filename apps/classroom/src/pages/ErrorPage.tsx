import { AdminScope, ErrorState, PageTitle } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';

/** Erro inesperado de renderização (spec 006, casos de erro). */
export function ErrorPage() {
  const { t } = useTranslation();
  return (
    <AdminScope className="flex min-h-dvh flex-col items-center justify-center bg-panel font-sans text-ink">
      <main className="w-full max-w-xl px-4">
        <PageTitle align="center">{t('error.title')}</PageTitle>
        <ErrorState
          text={t('error.text')}
          retryLabel={t('error.reload')}
          onRetry={() => window.location.reload()}
        />
      </main>
    </AdminScope>
  );
}
