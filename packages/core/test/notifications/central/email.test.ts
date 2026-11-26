import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  type Database,
  enqueueNotificationEmail,
  NotificationDataError,
} from '../../../src/index.ts';
import { createUser, inRollback, newId } from './helpers.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 2 });
});

afterAll(async () => {
  await closeDatabase(db);
});

describe('e-mail de uma notificação (spec 024, "E-mail")', () => {
  it('usa `enqueueEmail` para os tipos que já têm modelo', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const result = await enqueueNotificationEmail(trx, {
        userId,
        type: 'access.granted',
        data: { productType: 'course', productTitle: 'Curso', expiresAt: null },
      });
      expect(result).not.toBeNull();
      const outbox = await trx
        .selectFrom('emailOutbox')
        .select(['type', 'data', 'status'])
        .where('id', '=', result?.outboxId ?? '')
        .executeTakeFirstOrThrow();
      expect(outbox).toMatchObject({
        type: 'access.granted',
        data: { productType: 'course', productTitle: 'Curso', expiresAt: null },
        status: 'queued',
      });
      const job = await trx
        .selectFrom('jobs')
        .select(['type', 'payload'])
        .where('id', '=', result?.jobId ?? '')
        .executeTakeFirstOrThrow();
      expect(job).toEqual({ type: 'email.send', payload: { outboxId: result?.outboxId } });
    });
  });

  it('grava a linha dos demais tipos com o e-mail atual', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const result = await enqueueNotificationEmail(trx, {
        userId,
        type: 'forum.reply',
        data: { title: 'Nova resposta', topicId: newId() },
      });
      expect(result).not.toBeNull();
      const outbox = await trx
        .selectFrom('emailOutbox')
        .select(['userId', 'type', 'data'])
        .where('id', '=', result?.outboxId ?? '')
        .executeTakeFirstOrThrow();
      expect(outbox.userId).toBe(userId);
      expect(outbox.type).toBe('forum.reply');
      expect(outbox.data).toEqual({ title: 'Nova resposta', topicId: expect.any(String) });
    });
  });

  it('não enfileira para conta excluída nem suspensa', async () => {
    await inRollback(db, async (trx) => {
      const deleted = await createUser(trx, { deletedAt: new Date() });
      expect(
        await enqueueNotificationEmail(trx, { userId: deleted, type: 'forum.reply', data: {} }),
      ).toBeNull();
      expect(
        await enqueueNotificationEmail(trx, {
          userId: deleted,
          type: 'access.granted',
          data: { productType: 'ebook', productTitle: 'Ebook', expiresAt: null },
        }),
      ).toBeNull();

      const suspended = await createUser(trx, { suspendedKind: 'posting' });
      expect(
        await enqueueNotificationEmail(trx, { userId: suspended, type: 'forum.reply', data: {} }),
      ).toBeNull();
      // `moderation.suspended` é do catálogo e sai mesmo com a conta suspensa.
      expect(
        await enqueueNotificationEmail(trx, {
          userId: suspended,
          type: 'moderation.suspended',
          data: { kind: 'full', endsAt: null },
        }),
      ).not.toBeNull();
    });
  });

  it('recusa grupo `account`, tipo desconhecido, usuário inexistente e `data` inválido', async () => {
    await expect(
      enqueueNotificationEmail(db, { userId: newId(), type: 'forum.reply', data: {} }),
    ).rejects.toThrow(/transação/);
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      await expect(
        enqueueNotificationEmail(trx, { userId, type: 'account.new_login', data: {} }),
      ).rejects.toThrow(/enqueueEmail/);
      await expect(
        enqueueNotificationEmail(trx, { userId, type: 'forum.unknown' as never, data: {} }),
      ).rejects.toThrow(/desconhecido/);
      await expect(
        enqueueNotificationEmail(trx, { userId: newId(), type: 'forum.reply', data: {} }),
      ).rejects.toThrow(/não existe/);
      await expect(
        enqueueNotificationEmail(trx, { userId, type: 'forum.reply', data: { token: 'x' } }),
      ).rejects.toThrow(NotificationDataError);
    });
  });
});
