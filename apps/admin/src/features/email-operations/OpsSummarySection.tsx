import {
  AdminCard,
  AdminDetails,
  AdminSection,
  AdminStats,
  AdminStatus,
  LoadingState,
} from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { QueryErrorState } from '../../api/problems';
import { useAge } from './format';
import { useOpsSummary } from './queries';

/**
 * Resumo do topo da tela "Operação" (spec 033): falhas de fila, e-mails e webhooks, e a fila
 * por tipo com a idade da tarefa pendente mais antiga. É o mesmo número do selo do menu
 * (`failures`); só o `admin` chega aqui (`ops.manage`).
 */
export function OpsSummarySection() {
  const { t } = useTranslation();
  const age = useAge();
  const summary = useOpsSummary();

  if (summary.isPending) {
    return (
      <AdminSection title={t('operations.summary.title')}>
        <LoadingState label={t('operations.summary.loading')} />
      </AdminSection>
    );
  }

  if (summary.isError) {
    return (
      <AdminSection title={t('operations.summary.title')}>
        <QueryErrorState
          error={summary.error}
          title={t('operations.summary.errorTitle')}
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      </AdminSection>
    );
  }

  const data = summary.data;
  const queued = data.jobs.reduce((total, job) => total + job.queued, 0);
  const running = data.jobs.reduce((total, job) => total + job.running, 0);

  return (
    <AdminSection title={t('operations.summary.title')}>
      <AdminStats
        className="mb-4"
        stats={[
          {
            id: 'failed',
            value: data.failures,
            label: t('operations.summary.failures'),
            ...(data.failures > 0 ? { tone: 'red' } : {}),
          },
          { id: 'queued', value: queued, label: t('operations.summary.queued') },
          { id: 'running', value: running, label: t('operations.summary.running') },
          {
            id: 'emails',
            value: data.emails.queued + data.emails.failed,
            label: t('operations.summary.emails'),
          },
        ]}
      />
      {data.jobs.length > 0 ? (
        <AdminCard pad>
          <AdminDetails
            wrap
            items={data.jobs.map((job) => ({
              label: job.type,
              value: (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{t('operations.summary.perType.queued', { count: job.queued })}</span>
                  <span>{t('operations.summary.perType.running', { count: job.running })}</span>
                  <span>
                    <AdminStatus dot tone={job.failed > 0 ? 'red' : 'gray'}>
                      {t('operations.summary.perType.failed', { count: job.failed })}
                    </AdminStatus>
                  </span>
                  <span className="text-ink-3">
                    {job.oldestPendingSeconds === null
                      ? t('operations.summary.perType.nonePending')
                      : t('operations.summary.perType.oldest', {
                          age: age(job.oldestPendingSeconds),
                        })}
                  </span>
                </span>
              ),
            }))}
          />
        </AdminCard>
      ) : null}
    </AdminSection>
  );
}
