import { PageTitle } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { NotificationsList } from './NotificationsList';

/**
 * `/notificacoes`: a central do aluno (spec 006, mapa de telas; spec 024, "Central"). Lista da
 * mais nova para a mais antiga, com agrupamento, leitura ao abrir, "marcar todas" e "limpar
 * todas". O sino da casca usa a mesma lista.
 */
export function NotificationsPage() {
  const { t } = useTranslation();
  usePageMeta(t('notifications.title'), t('notifications.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
          <PageTitle>{t('notifications.title')}</PageTitle>
          <NotificationsList />
        </div>
      )}
    </RequireSession>
  );
}
