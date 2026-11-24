import { AdminButton, AdminEmpty, AdminScope } from '@nuva-edu/ui';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Erro inesperado de renderização (spec 006, casos de erro). */
export function ErrorPage() {
  const { t } = useTranslation();
  return (
    <AdminScope className="flex min-h-dvh flex-col items-center justify-center bg-panel font-sans text-ink">
      <main role="alert" className="w-full max-w-xl px-4">
        <h1 className="m-0 text-center text-2xl font-semibold tracking-tight">
          {t('error.title')}
        </h1>
        <AdminEmpty icon={<TriangleAlert aria-hidden="true" />} text={t('error.text')}>
          <span className="mt-3 flex">
            <AdminButton onClick={() => window.location.reload()}>{t('error.reload')}</AdminButton>
          </span>
        </AdminEmpty>
      </main>
    </AdminScope>
  );
}
