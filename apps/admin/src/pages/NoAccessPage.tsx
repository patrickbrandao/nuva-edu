import { AdminButton, AdminCard, AdminScope } from '@nuva-edu/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { useRuntimeConfig } from '../runtime/useRuntimeConfig';
import { Footer } from '../shell/Footer';

/**
 * "Sem acesso ao painel": a conta entrou, mas não tem papel de equipe (spec 006, Base técnica).
 * O link para o classroom usa o `classroomUrl` do `/config.json`; sem ele, o link não aparece.
 * Quem mostra esta tela é a guarda de sessão (`403` por papel), que chega com a spec 007.
 */
export function NoAccessPage() {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  const { classroomUrl } = useRuntimeConfig();
  const brandName = meta?.schoolName ?? t('app.name');

  useEffect(() => {
    document.title = `${t('noAccess.title')} · ${brandName}`;
  }, [t, brandName]);

  return (
    <AdminScope className="flex min-h-dvh flex-col bg-panel">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <AdminCard pad className="w-full max-w-sm">
          <p className="m-0 text-xs font-medium text-ink-3">
            {brandName} · {t('app.admin')}
          </p>
          <h1 className="mt-1 mb-1 text-xl font-semibold text-ink">{t('noAccess.title')}</h1>
          <p className="mt-0 mb-0 text-ink-3">{t('noAccess.text')}</p>
          {classroomUrl ? (
            <div className="mt-5 flex">
              <AdminButton variant="primary" href={classroomUrl}>
                {t('noAccess.classroomLink')}
              </AdminButton>
            </div>
          ) : null}
        </AdminCard>
      </main>
      <Footer />
    </AdminScope>
  );
}
