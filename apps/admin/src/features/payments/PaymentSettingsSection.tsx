import {
  AdminCard,
  AdminDetails,
  AdminSection,
  AdminStatus,
  Alert,
  LoadingState,
} from '@nuva-edu/ui';
import { FlaskConical, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { providerLabel } from './format';
import { usePaymentSettings } from './queries';

/**
 * Seção "Pagamento" de `/configuracoes` (spec 013, "Modo de teste"; `GET /settings/payments`,
 * `settings.manage`): o provedor em uso, o indicador de modo de teste e o aviso vermelho quando
 * uma instalação de produção usa token de teste. A API nunca devolve token, chave ou segredo.
 */
export function PaymentSettingsSection() {
  const { t } = useTranslation();
  const settings = usePaymentSettings();

  return (
    <AdminSection title={t('payments.settings.title')}>
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">{t('payments.settings.text')}</p>
      {settings.isPending ? (
        <LoadingState label={t('payments.settings.loading')} />
      ) : settings.isError ? (
        <QueryErrorState
          error={settings.error}
          title={t('payments.settings.errorTitle')}
          onRetry={() => void settings.refetch()}
          retrying={settings.isFetching}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {settings.data.productionWarning ? (
            <Alert tone="error" icon={<TriangleAlert aria-hidden="true" />}>
              {t('payments.settings.productionWarning')}
            </Alert>
          ) : null}
          {settings.data.testMode ? (
            <Alert tone="info" icon={<FlaskConical aria-hidden="true" />}>
              {t('payments.settings.testMode')}
            </Alert>
          ) : null}
          <AdminCard pad>
            <AdminDetails
              wrap
              items={[
                {
                  label: t('payments.settings.provider'),
                  value: providerLabel(t, settings.data.provider),
                },
                {
                  label: t('payments.settings.mode'),
                  value: (
                    <AdminStatus dot tone={settings.data.testMode ? 'amber' : 'green'}>
                      {settings.data.testMode
                        ? t('payments.settings.test')
                        : t('payments.settings.live')}
                    </AdminStatus>
                  ),
                },
                {
                  label: t('payments.settings.lastReconciliation'),
                  value: settings.data.lastReconciliationAt
                    ? formatDateTime(settings.data.lastReconciliationAt)
                    : t('payments.settings.never'),
                },
              ]}
            />
          </AdminCard>
          <p className="m-0 max-w-3xl text-sm text-ink-3">{t('payments.settings.secrets')}</p>
        </div>
      )}
    </AdminSection>
  );
}
