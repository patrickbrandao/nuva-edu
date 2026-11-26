import {
  type Database,
  deleteOrphanImages,
  expireSuspensions,
  isDomainError,
  type JobHandlers,
  type Logger,
  type PaymentProvider,
  PermanentJobError,
  recalculateEntitlements,
  recalculatePlanSubscriptions,
} from '@nuva-edu/core';
import { createCertificateHandlers } from './certificates/handlers.ts';
import type { CertificateRenderer } from './certificates/renderer.ts';
import { createEmailSendHandler } from './email/send-email.ts';
import type { Mailer } from './email/smtp.ts';
import { createSalesHandlers } from './handlers/sales.ts';
import { drainBatches, purgeRetention, type RetentionSettings } from './retention.ts';
import { purgeWebhookEvents } from './retention-sales.ts';
import { createSubscriptionHandlers } from './subscriptions/handlers.ts';

/** Lote de `expireSuspensions` e de `deleteOrphanImages` (o padrão das duas no núcleo). */
export const CORE_BATCH_SIZE = 500;

export interface HandlerDependencies {
  db: Database;
  logger: Logger;
  mailer: Mailer;
  /** `config.classroomUrl`, `config.adminUrl` e `config.locale`, para os links e os textos. */
  classroomUrl: string;
  adminUrl: string;
  locale: string;
  /** Prazos de `config.retention` usados pelo `retention.purge` (spec 033). */
  retention: RetentionSettings;
  /** Navegador dos PDFs de certificado, um por processo (spec 015, "PDF"). */
  renderer: CertificateRenderer;
  payment: {
    provider(): PaymentProvider;
    boletoDays: number;
    graceDays: number;
    webhookDays: number;
    now?: () => Date;
  };
}

/**
 * Manipuladores por tipo de tarefa (catálogo da spec 005). Todos idempotentes: a mesma tarefa
 * pode executar mais de uma vez (nova tentativa, worker morto, encerramento no meio).
 */
export function createHandlers(deps: HandlerDependencies): JobHandlers {
  const { db, logger, payment } = deps;
  const sales = createSalesHandlers({ db, logger, ...payment });
  const subscriptions = createSubscriptionHandlers({ db, logger, ...payment });
  return {
    ...sales,
    'payment.reconcile_orders': async (job, context) => {
      // A reconciliação remota de assinaturas é a cada 6 h. Os prazos locais seguem a janela de 5 min.
      await subscriptions.checkDeadlines(job, context);
      await sales['payment.reconcile_orders'](job, context);
    },
    'payment.reconcile_subscriptions': subscriptions.reconcile,
    // Exemplo da Fase 0: sem efeito além do log, então repetir não muda nada.
    'example.echo': async (job) => {
      logger.info({ job_id: job.id, message: job.payload.message }, 'Tarefa de exemplo executada');
    },
    // Expurgo diário (spec 033): apagar por prazo é idempotente por natureza.
    'retention.purge': async (job, context) => {
      const deleted = await purgeRetention(db, deps.retention, { signal: context.signal });
      const webhookEvents = await purgeWebhookEvents(db, {
        days: payment.webhookDays,
        now: new Date(),
        signal: context.signal,
      });
      logger.info(
        { job_id: job.id, unique_key: job.uniqueKey, deleted: { ...deleted, webhookEvents } },
        'Expurgo diário executado',
      );
    },
    // E-mail da fila (spec 024): linha que já não está `queued` não é enviada de novo.
    'email.send': createEmailSendHandler(deps),
    // Fim do prazo das suspensões (spec 026): o núcleo grava `user.unsuspend` com
    // `origin = worker`; a suspensão já encerrada é pulada, então repetir não duplica.
    'suspension.expire': async (job, context) => {
      const expired = await drainBatches(
        () => expireSuspensions(db, { limit: CORE_BATCH_SIZE }),
        CORE_BATCH_SIZE,
        context.signal,
      );
      logger.info({ job_id: job.id, expired }, 'Suspensões vencidas encerradas');
    },
    // Imagens sem referência há mais de 24 h (spec 029): a condição é refeita no `DELETE`.
    'image.cleanup': async (job, context) => {
      const deleted = await drainBatches(
        () => deleteOrphanImages(db, { limit: CORE_BATCH_SIZE }),
        CORE_BATCH_SIZE,
        context.signal,
      );
      logger.info({ job_id: job.id, deleted }, 'Imagens órfãs apagadas');
    },
    // Composição de curso ou pacote mudou (spec 010, "Recalcular a cascata"): o núcleo compara
    // cada árvore com o catálogo atual, em lotes de 500 raízes, uma transação por lote. Repetir
    // sem mudança no catálogo não grava nada; parar no meio deixa lotes inteiros prontos.
    'entitlement.recompute': async (job, context) => {
      context.signal.throwIfAborted();
      const { productType, productId } = job.payload;
      let result:
        | Awaited<ReturnType<typeof recalculateEntitlements>>
        | Awaited<ReturnType<typeof recalculatePlanSubscriptions>>;
      try {
        result =
          productType === 'plan'
            ? await recalculatePlanSubscriptions(db, productId, { graceDays: payment.graceDays })
            : await recalculateEntitlements(db, { productType, productId });
      } catch (error) {
        // Payload fora do formato (tipo ou id inválido) não melhora com nova tentativa.
        if (isDomainError(error) && error.code === 'validation_failed') {
          throw new PermanentJobError('entitlement.recompute: payload inválido', { cause: error });
        }
        throw error;
      }
      logger.info(
        { job_id: job.id, product_type: productType, product_id: productId, ...result },
        'Cascata de direitos recalculada',
      );
    },
    // Conclusão de curso, certificados e PDFs (specs 014 e 015).
    ...createCertificateHandlers({
      db,
      logger,
      renderer: deps.renderer,
      classroomUrl: deps.classroomUrl,
      locale: deps.locale,
    }),
  };
}
