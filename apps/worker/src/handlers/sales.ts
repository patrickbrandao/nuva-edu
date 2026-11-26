import {
  type Database,
  executeRefund,
  fulfillOrder,
  JOB_DEFINITIONS,
  type JobHandlers,
  type Logger,
  type PaymentProvider,
  processPaymentWebhook,
  reconcilePendingOrders,
  reconcileRefunds,
} from '@nuva-edu/core';
import { expireSalesOrders } from '../payments/expire-orders.ts';

interface SalesHandlerOptions {
  db: Database;
  logger: Logger;
  provider(): PaymentProvider;
  boletoDays: number;
  graceDays: number;
  now?: () => Date;
}

type SalesJobType =
  | 'payment.webhook'
  | 'order.fulfill'
  | 'refund.execute'
  | 'payment.reconcile_orders'
  | 'payment.reconcile_refunds';

export function createSalesHandlers({
  db,
  logger,
  provider,
  boletoDays,
  graceDays,
  now = () => new Date(),
}: SalesHandlerOptions): Required<Pick<JobHandlers, SalesJobType>> {
  return {
    'payment.webhook': async (job, { signal }) => {
      signal.throwIfAborted();
      const result = await processPaymentWebhook(db, provider(), job.payload.webhookEventId, {
        now: now(),
        graceDays,
        finalAttempt:
          job.attempts >= Math.min(job.maxAttempts, JOB_DEFINITIONS['payment.webhook'].maxAttempts),
      });
      logger.info({ job_id: job.id, ...result }, 'Webhook de pagamento processado');
    },
    'order.fulfill': async (job, { signal }) => {
      signal.throwIfAborted();
      const { orderId } = job.payload;
      const result = await db.transaction().execute(async (trx) => {
        const order = await trx
          .selectFrom('orders')
          .select('status')
          .where('id', '=', orderId)
          .forUpdate()
          .executeTakeFirst();
        // A transição do núcleo já concede o acesso na aprovação. Uma tarefa atrasada
        // jamais volta a conceder itens revogados por estorno.
        return order?.status === 'paid' ? fulfillOrder(trx, orderId) : null;
      });
      logger.info(
        { job_id: job.id, order_id: orderId, granted: result?.granted ?? 0 },
        'Liberação de pedido conferida',
      );
    },
    'refund.execute': async (job, { signal }) => {
      signal.throwIfAborted();
      const refund = await executeRefund(db, provider(), job.payload.refundId, {
        now: now(),
        attempt: job.attempts,
      });
      logger.info(
        { job_id: job.id, refund_id: refund.id, status: refund.status },
        'Estorno conferido',
      );
    },
    'payment.reconcile_orders': async (job, { signal }) => {
      signal.throwIfAborted();
      const moment = now();
      const paymentProvider = provider();
      const counts = await reconcilePendingOrders(db, paymentProvider, { now: moment });
      const expired = await expireSalesOrders(db, paymentProvider, moment, boletoDays, signal);
      logger.info({ job_id: job.id, ...counts, expired }, 'Pedidos reconciliados');
    },
    'payment.reconcile_refunds': async (job, { signal }) => {
      signal.throwIfAborted();
      const counts = await reconcileRefunds(db, provider(), { now: now() });
      logger.info({ job_id: job.id, ...counts }, 'Reembolsos reconciliados');
    },
  };
}
