import { AdminButton, AdminPageHeader } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { NotificationCenter } from './NotificationCenter';
import { NOTIFICATION_PREFS_PATH } from './paths';
import { useNotifications } from './queries';

/**
 * Central completa da equipe (`/notificacoes`; spec 024): o que o sino mostra resumido, com
 * paginação por cursor. Os textos, o tempo relativo e os links para o alvo saem de
 * `NotificationCenter`, o mesmo do painel do sino.
 */
export function NotificationsPage() {
  const { t } = useTranslation();
  const list = useNotifications();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <AdminPageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          <AdminButton href={NOTIFICATION_PREFS_PATH}>{t('notifications.preferences')}</AdminButton>
        }
      />
      <NotificationCenter
        items={items}
        loading={list.isPending}
        error={list.isError && items.length === 0}
        onRetry={() => void list.refetch()}
        loadMore={{
          hasNextPage: list.hasNextPage,
          loading: list.isFetchingNextPage,
          onLoad: () => void list.fetchNextPage(),
        }}
      />
    </>
  );
}
