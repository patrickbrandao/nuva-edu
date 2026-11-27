import {
  asObject,
  type Database,
  deliverNotification,
  isNotificationType,
  type JobHandler,
  type Logger,
  PermanentJobError,
} from '@nuva-edu/core';
import { canReceiveTarget } from './access.ts';
import { emailRejectionStreak } from './delivery-history.ts';

const EMAIL_WINDOW_MS = 15 * 60_000;

export function createNotifyHandler(
  db: Database,
  logger: Logger,
  now = () => new Date(),
): JobHandler<'notify'> {
  return async (job, { signal }) => {
    signal.throwIfAborted();
    const input = job.payload;
    if (!isNotificationType(input.type)) {
      throw new PermanentJobError('Tipo de notificação desconhecido.');
    }

    const delivery = await db.transaction().execute(async (trx) => {
      const queued = await trx
        .selectFrom('jobs')
        .select('payload')
        .where('id', '=', job.id)
        .where('type', '=', 'notify')
        .forUpdate()
        .executeTakeFirst();
      if (!queued || asObject(queued.payload).notificationDeliveredAt !== undefined) {
        return 'already_handled';
      }

      // Aos envios do mesmo titular aplica-se a mesma janela, inclusive sem canal plataforma.
      const user = await trx
        .selectFrom('users')
        .select('email')
        .where('id', '=', input.userId)
        .forUpdate()
        .executeTakeFirst();
      const date = now();
      const completion = { ...input, notificationDeliveredAt: date.toISOString() };
      if (!user || !(await canReceiveTarget(trx, input))) {
        await trx
          .updateTable('jobs')
          .set({ payload: JSON.stringify(completion) })
          .where('id', '=', job.id)
          .execute();
        return 'target_unavailable';
      }

      const previous = await trx
        .selectFrom('jobs')
        .select('payload')
        .where('type', '=', 'notify')
        .where(
          'payload',
          '@>',
          JSON.stringify({
            type: input.type,
            userId: input.userId,
            targetType: input.targetType,
            targetId: input.targetId,
          }),
        )
        .execute();
      const cutoff = date.getTime() - EMAIL_WINDOW_MS;
      const recent = previous.some(({ payload }) => {
        const queuedAt = asObject(payload).notificationEmailAt;
        return typeof queuedAt === 'string' && Date.parse(queuedAt) > cutoff;
      });
      const undeliverable =
        !recent && (await emailRejectionStreak(trx, input.userId, user.email)) >= 3;
      const result = await deliverNotification(trx, input, {
        suppressEmail: recent || undeliverable,
      });
      await trx
        .updateTable('jobs')
        .set({
          payload: JSON.stringify(
            result.email === null
              ? completion
              : {
                  ...completion,
                  notificationEmailAt: date.toISOString(),
                  notificationOutboxId: result.email.outboxId,
                },
          ),
        })
        .where('id', '=', job.id)
        .execute();
      return result.skipped ?? 'delivered';
    });
    logger.info(
      { job_id: job.id, notification_type: input.type, outcome: delivery },
      'Notificação conferida',
    );
  };
}
