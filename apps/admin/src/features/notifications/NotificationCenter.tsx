import {
  AdminButton,
  ConfirmDialog,
  NotificationList,
  type NotificationListLabels,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { useNotificationEntries, useRelativeTime } from './entries';
import { useNotificationError } from './errors';
import {
  clearNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
  notificationsKeys,
} from './queries';

interface Props {
  items: readonly NotificationItem[];
  loading: boolean;
  error: boolean;
  onRetry?: (() => void) | undefined;
  /** Rodapé do painel do sino (links para a central e as preferências). */
  footer?: ReactNode | undefined;
  /** "Carregar mais" da central completa. */
  loadMore?: { hasNextPage: boolean; loading: boolean; onLoad: () => void } | undefined;
}

/**
 * Lista da central com as ações da spec 024 — abrir (marca como lida), marcar todas e limpar
 * todas — usada tanto no painel do sino quanto na página `/notificacoes`. A confirmação de
 * "limpar todas" segue a regra da casca (spec 006): ação destrutiva pede confirmação com o nome
 * do item. A API continua sendo quem autoriza; o que falha vira aviso.
 */
export function NotificationCenter({ items, loading, error, onRetry, footer, loadMore }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useNotificationError();
  const entries = useNotificationEntries();
  const time = useRelativeTime();
  const [confirmingClear, setConfirmingClear] = useState(false);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: notificationsKeys.list() }),
      queryClient.invalidateQueries({ queryKey: notificationsKeys.unread() }),
    ]);
  };

  const markRead = useAction((id: string) => markNotificationRead(api, id));
  const markAll = useAction(() => markAllNotificationsRead(api));
  const clear = useAction(() => clearNotifications(api));

  const onOpen = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.readAt !== null) return;
    void markRead.run(id).then(async (result) => {
      if (!result.ok) {
        toast.error(message(result.error), { title: t('notifications.readError') });
        return;
      }
      queryClient.setQueryData(notificationsKeys.unread(), {
        unreadCount: result.data.unreadCount,
      });
      await refresh();
    });
  };

  const onMarkAll = async () => {
    const result = await markAll.run();
    if (!result.ok) {
      toast.error(message(result.error), { title: t('notifications.markAllError') });
      return;
    }
    queryClient.setQueryData(notificationsKeys.unread(), { unreadCount: result.data.unreadCount });
    await refresh();
    toast.success(t('notifications.markedAll'));
  };

  const onClear = async () => {
    const result = await clear.run();
    setConfirmingClear(false);
    if (!result.ok) {
      toast.error(message(result.error), { title: t('notifications.clearError') });
      return;
    }
    queryClient.setQueryData(notificationsKeys.unread(), { unreadCount: 0 });
    await refresh();
    toast.success(t('notifications.cleared'));
  };

  const labels: NotificationListLabels = {
    region: t('notifications.region'),
    emptyTitle: t('notifications.empty'),
    emptyText: t('notifications.emptyText'),
    loading: t('notifications.loading'),
    errorTitle: t('notifications.errorTitle'),
    errorText: t('notifications.errorText'),
    retry: t('common.retry'),
    markAll: t('notifications.markAll'),
    clearAll: t('notifications.clearAll'),
    unread: t('notifications.unread'),
    // O agrupamento conta as outras notificações da mesma linha: "e mais 3" para `count` 4.
    grouped: (count: number) => t('notifications.grouped', { count: count - 1 }),
    time,
  };

  return (
    <>
      <NotificationList
        items={entries(items)}
        labels={labels}
        onOpen={onOpen}
        onMarkAll={() => void onMarkAll()}
        onClearAll={() => setConfirmingClear(true)}
        loading={loading}
        error={error}
        {...(onRetry ? { onRetry } : {})}
      />
      {loadMore?.hasNextPage ? (
        <div className="mt-3 flex flex-col items-start gap-2">
          <AdminButton
            disabled={loadMore.loading}
            aria-busy={loadMore.loading || undefined}
            onClick={loadMore.onLoad}
          >
            {loadMore.loading ? t('common.loadingMore') : t('common.loadMore')}
          </AdminButton>
        </div>
      ) : null}
      {footer}
      {confirmingClear ? (
        <ConfirmDialog
          open
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => void onClear()}
          title={t('notifications.clearTitle')}
          itemName={t('notifications.clearItem')}
          message={t('notifications.clearMessage')}
          confirmLabel={t('notifications.clearAll')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          busy={clear.busy}
          busyLabel={t('common.saving')}
        />
      ) : null}
    </>
  );
}
