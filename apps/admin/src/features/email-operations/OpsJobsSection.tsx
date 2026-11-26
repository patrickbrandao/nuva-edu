import {
  AdminButton,
  AdminEmpty,
  AdminSection,
  AdminTable,
  AdminTabs,
  ConfirmDialog,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useOpsError } from './format';
import {
  discardOpsJob,
  JOB_STATUSES,
  type OpsJob,
  type OpsJobStatus,
  opsKeys,
  retryOpsJob,
  useOpsJobs,
} from './queries';

/**
 * Fila da tela "Operação" (spec 005; spec 033, "Tela Operação"): pendentes, em execução e com
 * falha, por estado. "Tentar de novo" e "Descartar" só aparecem nas com falha — a API recusa
 * `409 job_not_failed` de qualquer jeito. Descartar é destrutivo e pede confirmação (spec 006).
 */
export function OpsJobsSection() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useOpsError();
  const [status, setStatus] = useState<OpsJobStatus>('failed');
  const list = useOpsJobs(status);
  const jobs = list.data?.pages.flatMap((page) => page.items) ?? [];
  const [discarding, setDiscarding] = useState<OpsJob | null>(null);

  const retry = useAction((id: string) => retryOpsJob(api, id));
  const discard = useAction((id: string) => discardOpsJob(api, id));

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: opsKeys.jobs('failed') }),
      queryClient.invalidateQueries({ queryKey: opsKeys.jobs('queued') }),
      queryClient.invalidateQueries({ queryKey: opsKeys.jobs('running') }),
      queryClient.invalidateQueries({ queryKey: opsKeys.summary() }),
    ]);
  };

  const onRetry = async (job: OpsJob) => {
    const result = await retry.run(job.id);
    if (!result.ok) {
      toast.error(message(result.error), { title: t('operations.jobs.retryError') });
      return;
    }
    toast.success(t('operations.jobs.retried', { type: job.type }));
    await refresh();
  };

  const onDiscard = async () => {
    if (!discarding) return;
    const result = await discard.run(discarding.id);
    setDiscarding(null);
    if (!result.ok) {
      toast.error(message(result.error), { title: t('operations.jobs.discardError') });
      return;
    }
    toast.success(t('operations.jobs.discarded', { type: discarding.type }));
    await refresh();
  };

  const columns = [
    {
      id: 'type',
      label: t('operations.jobs.columns.type'),
      render: (job: OpsJob) => job.type,
    },
    {
      id: 'attempts',
      label: t('operations.jobs.columns.attempts'),
      render: (job: OpsJob) =>
        t('operations.jobs.attempts', {
          attempts: job.attempts,
          max: job.maxAttempts,
        }),
    },
    {
      id: 'runAt',
      label: t('operations.jobs.columns.runAt'),
      render: (job: OpsJob) => (
        <span className="flex flex-col">
          <span>{formatDateTime(job.runAt)}</span>
          <span className="text-xs text-ink-3">
            {t('operations.jobs.createdAt', { date: formatDateTime(job.createdAt) })}
          </span>
        </span>
      ),
    },
    {
      id: 'lastError',
      label: t('operations.jobs.columns.lastError'),
      render: (job: OpsJob) =>
        job.lastError ?? <span className="text-ink-3">{t('operations.jobs.columns.none')}</span>,
    },
    {
      id: 'actions',
      label: t('operations.jobs.columns.actions'),
      render: (job: OpsJob) =>
        job.status === 'failed' ? (
          <span className="flex flex-wrap gap-2">
            <AdminButton
              size="sm"
              icon={<Play size={14} aria-hidden="true" />}
              disabled={retry.busy}
              onClick={() => void onRetry(job)}
            >
              {t('operations.jobs.retry')}
            </AdminButton>
            <AdminButton
              size="sm"
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => setDiscarding(job)}
            >
              {t('operations.jobs.discard')}
            </AdminButton>
          </span>
        ) : null,
    },
  ];

  return (
    <AdminSection title={t('operations.jobs.title')}>
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">{t('operations.jobs.text')}</p>
      <AdminTabs
        label={t('operations.jobs.tabs')}
        value={status}
        onChange={(id: string) => setStatus(id as OpsJobStatus)}
        tabs={JOB_STATUSES.map((id) => ({ id, label: t(`operations.jobs.status.${id}`) }))}
      />
      {list.isPending ? (
        <LoadingState label={t('operations.jobs.loading')} />
      ) : list.isError && jobs.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('operations.jobs.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={jobs}
            empty={
              <AdminEmpty
                title={t('operations.jobs.empty')}
                text={t('operations.jobs.emptyText')}
              />
            }
          />
          {list.hasNextPage ? (
            <AdminButton
              className="mt-3"
              disabled={list.isFetchingNextPage}
              aria-busy={list.isFetchingNextPage || undefined}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
            </AdminButton>
          ) : null}
        </>
      )}
      {discarding ? (
        <ConfirmDialog
          open
          onCancel={() => setDiscarding(null)}
          onConfirm={() => void onDiscard()}
          title={t('operations.jobs.discardTitle')}
          itemName={discarding.type}
          message={t('operations.jobs.discardMessage')}
          confirmLabel={t('operations.jobs.discard')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          busy={discard.busy}
          busyLabel={t('common.saving')}
        />
      ) : null}
    </AdminSection>
  );
}
