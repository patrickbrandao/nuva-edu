import { AdminPageHeader } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { WebhookEventsSection } from '../payments/WebhookEventsSection';
import { OpsEmailsSection } from './OpsEmailsSection';
import { OpsJobsSection } from './OpsJobsSection';
import { OpsSummarySection } from './OpsSummarySection';
import { OpsSystemSection } from './OpsSystemSection';

/**
 * Operação (`/operacao`, `ops.manage`; specs 005, 013 e 033): o resumo com o selo, a fila com
 * "tentar de novo" e "descartar", os e-mails pendentes e com falha com "reenviar", os webhooks
 * de pagamento e o bloco do sistema. Só o `admin` chega aqui; o gerente não vê a tela nem os
 * dados — a rota é guardada pela ação, e as consultas só saem para quem a tem.
 */
export function OperationsPage() {
  const { t } = useTranslation();
  return (
    <>
      <AdminPageHeader title={t('menu.items.operations')} subtitle={t('operations.subtitle')} />
      <OpsSummarySection />
      <OpsJobsSection />
      <OpsEmailsSection />
      <WebhookEventsSection />
      <OpsSystemSection />
    </>
  );
}
