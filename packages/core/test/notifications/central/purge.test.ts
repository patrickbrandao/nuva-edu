import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  type Database,
  NOTIFICATION_PURGE_BATCH_SIZE,
  NOTIFICATION_READ_RETENTION_DAYS,
  NOTIFICATION_UNREAD_RETENTION_DAYS,
  purgeNotifications,
} from '../../../src/index.ts';
import { createUser, inRollback } from './helpers.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 2 });
});

afterAll(async () => {
  await closeDatabase(db);
});

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = new Date('2026-11-26T12:00:00.000Z');

describe('expurgo das notificações (spec 024, RNF-04)', () => {
  it('usa 90 dias para as lidas e 180 para as não lidas', () => {
    expect(NOTIFICATION_READ_RETENTION_DAYS).toBe(90);
    expect(NOTIFICATION_UNREAD_RETENTION_DAYS).toBe(180);
    expect(NOTIFICATION_PURGE_BATCH_SIZE).toBe(5_000);
  });

  it('apaga cada grupo pelo seu prazo e mantém o resto', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const insert = async (daysAgo: number, readDaysAgo: number | null) =>
        (
          await trx
            .insertInto('notifications')
            .values({
              userId,
              type: 'forum.reply',
              targetType: 'forum_topic',
              targetId: crypto.randomUUID(),
              data: JSON.stringify({}),
              createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
              ...(readDaysAgo === null
                ? {}
                : { readAt: new Date(NOW.getTime() - readDaysAgo * DAY_MS) }),
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const readOld = await insert(200, 100);
      const readRecent = await insert(50, 10);
      const unreadOld = await insert(200, null);
      const unreadRecent = await insert(100, null);

      expect(await purgeNotifications(trx, { now: NOW })).toEqual({ read: 1, unread: 1 });
      const rows = await trx
        .selectFrom('notifications')
        .select('id')
        .where('userId', '=', userId)
        .orderBy('id')
        .execute();
      expect(rows.map((row) => row.id)).toEqual([readRecent, unreadRecent]);
      expect(rows.map((row) => row.id)).not.toContain(readOld);
      expect(rows.map((row) => row.id)).not.toContain(unreadOld);
      // Idempotente: rodar de novo não apaga mais nada.
      expect(await purgeNotifications(trx, { now: NOW })).toEqual({ read: 0, unread: 0 });
    });
  });

  it('trabalha em lotes e aceita prazos próprios', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      for (let index = 0; index < 3; index += 1) {
        await trx
          .insertInto('notifications')
          .values({
            userId,
            type: 'forum.reply',
            targetType: 'forum_topic',
            targetId: crypto.randomUUID(),
            data: JSON.stringify({}),
            createdAt: new Date(NOW.getTime() - 30 * DAY_MS),
            readAt: new Date(NOW.getTime() - 20 * DAY_MS),
          })
          .execute();
      }
      expect(
        await purgeNotifications(trx, { now: NOW, readDays: 10, unreadDays: 10, batchSize: 2 }),
      ).toEqual({ read: 3, unread: 0 });
    });
  });

  it('valida prazos e lote e respeita o aborto', async () => {
    for (const options of [
      { readDays: 0 },
      { readDays: 1.5 },
      { unreadDays: 0 },
      { unreadDays: 2.5 },
      { batchSize: 0 },
      { batchSize: 1.5 },
    ]) {
      await expect(purgeNotifications(db, options)).rejects.toThrow(TypeError);
    }
    const controller = new AbortController();
    controller.abort();
    await expect(purgeNotifications(db, { signal: controller.signal })).rejects.toThrow();
  });
});
