import { AdminCard, AdminDetails, AdminSection, AdminStatus, LoadingState } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useBytes } from './format';
import { useOpsSummary } from './queries';

/** Um backup com mais de 26 horas aparece como atrasado (spec 033, "Backup e restauração"). */
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

/**
 * Bloco "Sistema" da operação (spec 033): versão, migrations, tamanho do banco e das imagens, e
 * a data do último backup e do último expurgo. Lê o mesmo resumo da tela, sem outra rota.
 */
export function OpsSystemSection() {
  const { t } = useTranslation();
  const bytes = useBytes();
  const summary = useOpsSummary();

  if (summary.isPending) {
    return (
      <AdminSection title={t('operations.system.title')}>
        <LoadingState label={t('operations.system.loading')} />
      </AdminSection>
    );
  }

  if (summary.isError) {
    return (
      <AdminSection title={t('operations.system.title')}>
        <QueryErrorState
          error={summary.error}
          title={t('operations.system.errorTitle')}
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      </AdminSection>
    );
  }

  const system = summary.data.system;
  const backup = system.lastBackup;
  const late = backup ? Date.now() - new Date(backup.finishedAt).getTime() > STALE_AFTER_MS : false;

  return (
    <AdminSection title={t('operations.system.title')}>
      <AdminCard pad>
        <AdminDetails
          wrap
          items={[
            { label: t('operations.system.version'), value: system.version },
            {
              label: t('operations.system.migrationVersion'),
              value: system.migrationVersion,
            },
            { label: t('operations.system.databaseBytes'), value: bytes(system.databaseBytes) },
            { label: t('operations.system.imageBytes'), value: bytes(system.imageBytes) },
            {
              label: t('operations.system.lastBackup'),
              value: backup ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>{formatDateTime(backup.finishedAt)}</span>
                  <span className="text-ink-3">{bytes(backup.sizeBytes)}</span>
                  <AdminStatus dot tone={backup.status === 'ok' ? 'green' : 'red'}>
                    {t(`operations.system.backupStatus.${backup.status}`)}
                  </AdminStatus>
                  {late ? (
                    <AdminStatus dot tone="amber">
                      {t('operations.system.backupLate')}
                    </AdminStatus>
                  ) : null}
                </span>
              ) : (
                t('operations.system.never')
              ),
            },
            {
              label: t('operations.system.lastPurge'),
              value: system.lastPurgeAt
                ? formatDateTime(system.lastPurgeAt)
                : t('operations.system.never'),
            },
          ]}
        />
      </AdminCard>
    </AdminSection>
  );
}
