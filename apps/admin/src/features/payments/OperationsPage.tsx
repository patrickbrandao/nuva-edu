import { AdminPageHeader } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { WebhookEventsSection } from './WebhookEventsSection';

/**
 * Operação (spec 006 e 033; `/operacao`, `ops.manage`): por enquanto, os webhooks de pagamento
 * com falha e a trilha de assinaturas recusadas (spec 013). Fila e e-mails entram com a spec 005.
 */
export function OperationsPage() {
  const { t } = useTranslation();
  return (
    <>
      <AdminPageHeader title={t('menu.items.operations')} subtitle={t('payments.operations')} />
      <WebhookEventsSection />
    </>
  );
}
