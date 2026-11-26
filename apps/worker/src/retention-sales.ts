import type { Database } from '@nuva-edu/core';
import { drainBatches, RETENTION_BATCH_SIZE } from './retention.ts';

const DAY_MS = 86_400_000;

/** Prazo contado de received_at inclusive para os eventos rejeitados (spec 033). */
export function purgeWebhookEvents(
  db: Database,
  {
    now,
    days,
    signal,
    batchSize = RETENTION_BATCH_SIZE,
  }: {
    now: Date;
    days: number;
    signal?: AbortSignal;
    batchSize?: number;
  },
): Promise<number> {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return drainBatches(
    async () => {
      const rows = await db
        .deleteFrom('webhookEvents')
        .where('receivedAt', '<', cutoff)
        .where('id', 'in', (eb) =>
          eb
            .selectFrom('webhookEvents')
            .select('id')
            .where('receivedAt', '<', cutoff)
            .orderBy('receivedAt')
            .limit(batchSize),
        )
        .executeTakeFirst();
      return Number(rows.numDeletedRows);
    },
    batchSize,
    signal,
  );
}
