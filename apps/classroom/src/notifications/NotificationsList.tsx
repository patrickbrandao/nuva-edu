import { AdminButton, ConfirmDialog, NotificationList, TextLink, useToast } from '@nuva-edu/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { NOTIFICATIONS_PATH } from '../shell/navigation';
import { useNotificationEntries, useRelativeTime } from './format';
import {
  useClearNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from './queries';

interface NotificationsListProps {
  /** Carrega a lista só quando a tela (ou o painel do sino) está aberta. */
  enabled?: boolean;
  /** Chamado depois de abrir um item, para fechar o painel do sino. */
  onOpened?: (() => void) | undefined;
  /** Rodapé do painel do sino: o caminho para a central inteira. */
  footer?: boolean | undefined;
  /** Avisa quem monta a lista quando a confirmação de "limpar todas" abre ou fecha. */
  onConfirmingChange?: ((open: boolean) => void) | undefined;
  className?: string | undefined;
}

/**
 * Lista da central com as ações da spec 024: abrir marca como lido, "marcar todas como lidas" e
 * "limpar todas" (com confirmação, porque apaga também o histórico lido). Usada na página
 * `/notificacoes` e no painel do sino.
 */
export function NotificationsList({
  enabled = true,
  onOpened,
  footer = false,
  onConfirmingChange,
  className,
}: NotificationsListProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const time = useRelativeTime();
  const query = useNotifications({ enabled });
  const entries = useNotificationEntries(query.data?.pages.flatMap((page) => page.items) ?? []);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const clear = useClearNotifications();
  const [confirming, setConfirming] = useState(false);
  const changeConfirming = (next: boolean) => {
    setConfirming(next);
    onConfirmingChange?.(next);
  };

  const failure = (error: unknown) =>
    toast.error(describeError(t, error).message, { title: t('notifications.errorTitle') });

  return (
    <>
      <NotificationList
        items={entries}
        labels={{
          region: t('notifications.list.region'),
          emptyTitle: t('notifications.emptyTitle'),
          emptyText: t('notifications.emptyText'),
          loading: t('notifications.loading'),
          errorTitle: t('notifications.errorTitle'),
          errorText: t('notifications.errorText'),
          retry: t('common.retry'),
          markAll: t('notifications.markAll'),
          clearAll: t('notifications.clearAll'),
          unread: t('notifications.unread'),
          grouped: (count: number) => t('notifications.grouped', { count: count - 1 }),
          time,
          newTabLabel: t('common.newTab'),
        }}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onOpen={(id) => {
          markRead.mutate(id, { onError: failure });
          onOpened?.();
        }}
        onMarkAll={() =>
          markAll.mutate(undefined, {
            onError: failure,
            onSuccess: (result) => {
              if (result.updated > 0) toast.success(t('notifications.markAllDone'));
            },
          })
        }
        onClearAll={() => changeConfirming(true)}
        {...(className ? { className } : {})}
      />

      {footer ? (
        <p className="m-0 text-center text-sm">
          <TextLink href={NOTIFICATIONS_PATH}>{t('notifications.bell.viewAll')}</TextLink>
        </p>
      ) : null}

      {enabled && query.hasNextPage ? (
        <span className="flex justify-center">
          <AdminButton
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? t('common.loading') : t('notifications.loadMore')}
          </AdminButton>
        </span>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onCancel={() => changeConfirming(false)}
        onConfirm={() =>
          clear.mutate(undefined, {
            onError: (error) => {
              changeConfirming(false);
              failure(error);
            },
            onSuccess: (result) => {
              changeConfirming(false);
              if (result.deleted > 0) toast.success(t('notifications.clearDone'));
            },
          })
        }
        title={t('notifications.clearTitle')}
        itemName={t('notifications.clearItem')}
        message={t('notifications.clearText')}
        confirmLabel={t('notifications.clearConfirm')}
        cancelLabel={t('common.cancel')}
        busy={clear.isPending}
        busyLabel={t('notifications.clearing')}
      />
    </>
  );
}
