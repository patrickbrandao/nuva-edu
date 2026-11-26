import {
  type Database,
  endCancelingSubscriptions,
  endSuspendedSubscriptions,
  expirePendingSubscriptions,
  type JobHandler,
  type Logger,
  type PaymentProvider,
  reconcileSubscriptions,
  suspendExpiredSubscriptions,
} from '@nuva-edu/core';

interface SubscriptionHandlerOptions {
  db: Database;
  logger: Logger;
  provider(): PaymentProvider;
  graceDays: number;
  now?: () => Date;
}

export function createSubscriptionHandlers({
  db,
  logger,
  provider,
  graceDays,
  now = () => new Date(),
}: SubscriptionHandlerOptions) {
  const checkDeadlines: JobHandler<'payment.reconcile_orders'> = async (job, { signal }) => {
    const moment = now();
    signal.throwIfAborted();
    const suspended = await suspendExpiredSubscriptions(db, { now: moment, graceDays });
    signal.throwIfAborted();
    const ended = await endCancelingSubscriptions(db, { now: moment });
    signal.throwIfAborted();
    const expired = await expirePendingSubscriptions(db, provider(), { now: moment });
    logger.info({ job_id: job.id, suspended, ended, expired }, 'Prazos de assinaturas verificados');
  };

  const reconcile: JobHandler<'payment.reconcile_subscriptions'> = async (job, { signal }) => {
    signal.throwIfAborted();
    const moment = now();
    const paymentProvider = provider();
    const result = await reconcileSubscriptions(db, paymentProvider, { now: moment, graceDays });
    signal.throwIfAborted();
    const ended = await endSuspendedSubscriptions(db, paymentProvider, { now: moment });
    logger.info({ job_id: job.id, ...result, ended }, 'Assinaturas reconciliadas');
  };

  return { checkDeadlines, reconcile };
}
