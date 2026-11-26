import {
  AdminButton,
  AdminEmpty,
  AdminSection,
  AdminTable,
  AdminTabs,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Webhook } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { usePaymentsError } from './format';
import {
  isRetryable,
  paymentsKeys,
  retryWebhookEvent,
  useWebhookEvents,
  type WebhookEvent,
  type WebhookFilter,
} from './queries';

/**
 * Avisos de pagamento com falha (spec 013, "Webhook"; spec 033, tela "Operação"; `ops.manage`).
 * `failed` é a fila operacional e aceita "reprocessar"; `rejected` é a trilha de segurança das
 * assinaturas recusadas, somente leitura — a tela nem oferece a ação. Quem recusa é a API
 * (`409 webhook_event_not_retryable`).
 */
export function WebhookEventsSection() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = usePaymentsError();
  const [filter, setFilter] = useState<WebhookFilter>('failed');
  const list = useWebhookEvents(filter);
  const events: WebhookEvent[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = filter === 'rejected';

  const retry = useAction((id: string) => retryWebhookEvent(api, id));

  const onRetry = async (event: WebhookEvent) => {
    const result = await retry.run(event.id);
    if (!result.ok) {
      toast.error(message(result.error), { title: t('payments.webhooks.retryFailed') });
      return;
    }
    toast.success(t('payments.webhooks.retried'));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: paymentsKeys.webhooks('failed') }),
      queryClient.invalidateQueries({ queryKey: paymentsKeys.webhooks('rejected') }),
    ]);
  };

  const columns = [
    {
      id: 'resource',
      label: t('payments.webhooks.columns.event'),
      render: (event: WebhookEvent) => (
        <span className="inline-flex flex-col">
          <span>{event.eventId ?? t('payments.webhooks.noEventId')}</span>
          <span className="text-xs text-ink-3">
            {event.resourceType
              ? t('payments.webhooks.resource', {
                  type: t(`payments.webhooks.resourceType.${event.resourceType}`),
                  id: event.resourceId ?? t('payments.webhooks.noResource'),
                })
              : t('payments.webhooks.noResource')}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      label: t('payments.webhooks.columns.status'),
      render: (event: WebhookEvent) => t(`payments.webhooks.status.${event.status}`),
    },
    {
      id: 'attempts',
      label: t('payments.webhooks.columns.attempts'),
      render: (event: WebhookEvent) => String(event.attempts),
    },
    {
      id: 'error',
      label: t('payments.webhooks.columns.error'),
      render: (event: WebhookEvent) =>
        event.error ?? <span className="text-ink-3">{t('payments.webhooks.columns.none')}</span>,
    },
    {
      id: 'receivedAt',
      label: t('payments.webhooks.columns.receivedAt'),
      render: (event: WebhookEvent) => formatDateTime(event.receivedAt),
    },
    {
      id: 'actions',
      label: t('payments.webhooks.columns.actions'),
      render: (event: WebhookEvent) =>
        isRetryable(event) ? (
          <AdminButton
            size="sm"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            disabled={retry.busy}
            aria-busy={retry.busy || undefined}
            onClick={() => void onRetry(event)}
          >
            {t('payments.webhooks.retry')}
          </AdminButton>
        ) : null,
    },
  ];

  return (
    <AdminSection title={t('payments.webhooks.title')}>
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">
        {filtered ? t('payments.webhooks.rejectedText') : t('payments.webhooks.failedText')}
      </p>
      <AdminTabs
        label={t('payments.webhooks.tabs')}
        value={filter}
        onChange={(id: string) => setFilter(id as WebhookFilter)}
        tabs={[
          { id: 'failed', label: t('payments.webhooks.failedTab') },
          { id: 'rejected', label: t('payments.webhooks.rejectedTab') },
        ]}
      />
      {list.isPending ? (
        <LoadingState label={t('payments.webhooks.loading')} />
      ) : list.isError && events.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('payments.webhooks.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={filtered ? columns.filter((column) => column.id !== 'attempts') : columns}
            rows={events}
            empty={
              <AdminEmpty
                icon={<Webhook aria-hidden="true" />}
                title={
                  filtered ? t('payments.webhooks.emptyRejected') : t('payments.webhooks.empty')
                }
                text={
                  filtered
                    ? t('payments.webhooks.emptyRejectedText')
                    : t('payments.webhooks.emptyText')
                }
              />
            }
          />
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <AdminButton
                disabled={list.isFetchingNextPage}
                aria-busy={list.isFetchingNextPage || undefined}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
          {list.isFetchNextPageError ? (
            <p role="alert" className="mt-2 text-center text-sm text-ink-2">
              {t('payments.webhooks.loadMoreError')}
            </p>
          ) : null}
        </>
      )}
    </AdminSection>
  );
}
