import { NotificationBell } from '@nuva-edu/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { NotificationsList } from './NotificationsList';
import { useUnreadCount } from './queries';

/**
 * Sino da barra superior (spec 024, RF-02). O contador vem de `GET /api/v1/notifications/
 * unread-count` e é trocado pelo evento SSE `notification.created`; o painel é a mesma lista da
 * central, carregada só quando abre. A lista é relida depois de cada reconexão do fluxo
 * (`./stream.ts`), então o número e os itens nunca dependem de um evento.
 *
 * A confirmação de "limpar todas" é um portal fora do painel: enquanto ela está aberta, o clique
 * dentro do diálogo não fecha o painel (e não desmonta o diálogo).
 */
export function NotificationsMenu({ className }: { className?: string | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const unread = useUnreadCount().data?.unreadCount ?? 0;
  const { pathname } = useLocation();

  // Trocar de página fecha o painel: o link do item ou "Ver todas" levam para outro lugar.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  return (
    <NotificationBell
      unread={unread}
      open={open}
      onOpenChange={(next) => {
        if (!next && confirming) return;
        setOpen(next);
      }}
      labels={{
        button: (count: number) =>
          count > 0 ? t('notifications.bell.button', { count }) : t('notifications.bell.none'),
        title: t('notifications.title'),
        close: t('notifications.bell.close'),
      }}
      {...(className ? { className } : {})}
    >
      <NotificationsList
        enabled={open}
        footer
        onOpened={() => setOpen(false)}
        onConfirmingChange={setConfirming}
      />
    </NotificationBell>
  );
}
