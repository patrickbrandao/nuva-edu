import { AdminButton, NotificationBell } from '@nuva-edu/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotificationCenter } from './NotificationCenter';
import { NOTIFICATION_PREFS_PATH, NOTIFICATIONS_PATH } from './paths';
import { useNotifications, useUnreadCount } from './queries';
import { useNotificationStream } from './useNotificationStream';

/**
 * Sino da equipe na barra superior (spec 006, "Casca comum"; spec 024): abre a central num
 * painel não modal e mostra o contador de não lidas. É o único ponto que abre o fluxo SSE do
 * admin — uma conexão por aba (`useNotificationStream`). O painel mostra a primeira página; a
 * central completa fica em `/notificacoes`, e as preferências em `/notificacoes/preferencias`.
 */
export function NotificationBellMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications(open);
  useNotificationStream();

  const items = list.data?.pages[0]?.items ?? [];

  return (
    <NotificationBell
      unread={unread.data?.unreadCount ?? 0}
      open={open}
      onOpenChange={setOpen}
      labels={{
        button: (count: number) =>
          count === 0 ? t('notifications.bellNone') : t('notifications.bell', { count }),
        title: t('notifications.panelTitle'),
        close: t('common.close'),
      }}
    >
      <NotificationCenter
        items={items}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        footer={
          <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-ink-3/20 pt-2">
            <AdminButton
              size="sm"
              variant="ghost"
              href={NOTIFICATIONS_PATH}
              onClick={() => setOpen(false)}
            >
              {t('notifications.openAll')}
            </AdminButton>
            <AdminButton
              size="sm"
              variant="ghost"
              href={NOTIFICATION_PREFS_PATH}
              onClick={() => setOpen(false)}
            >
              {t('notifications.preferences')}
            </AdminButton>
          </footer>
        }
      />
    </NotificationBell>
  );
}
