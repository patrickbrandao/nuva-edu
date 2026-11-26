import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  clearNotifications,
  closeDatabase,
  countUnreadNotifications,
  createDatabase,
  createNotification,
  type Database,
  deliverNotification,
  enqueueNotify,
  getNotification,
  getUnreadNotificationCount,
  isDomainError,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  publishNotificationCreated,
  setNotificationPrefs,
} from '../../../src/index.ts';
import { createUser, inRollback, newId } from './helpers.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 3 });
});

afterAll(async () => {
  await closeDatabase(db);
});

const eventIds = () => {
  let id = 0;
  return async () => {
    id += 1;
    return id;
  };
};

async function insertNotification(
  trx: Database,
  input: {
    userId: string;
    type?: string;
    actorId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    data?: Record<string, unknown>;
    createdAt?: Date;
    readAt?: Date | null;
  },
): Promise<string> {
  const row = await trx
    .insertInto('notifications')
    .values({
      userId: input.userId,
      type: input.type ?? 'forum.reply',
      actorId: input.actorId ?? null,
      targetType: input.targetType === undefined ? 'forum_topic' : input.targetType,
      targetId: input.targetId === undefined ? newId() : input.targetId,
      data: JSON.stringify(input.data ?? { title: 'Oi' }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      ...(input.readAt === undefined ? {} : { readAt: input.readAt }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('notify (spec 024, RF-01)', () => {
  it('exige transação, tipo do catálogo e grupo com canal plataforma', async () => {
    const userId = newId();
    await expect(notify(db, 'forum.reply', userId)).rejects.toThrow(TypeError);
    await inRollback(db, async (trx) => {
      await expect(notify(trx, 'unknown.type' as never, userId)).rejects.toThrow(/desconhecido/);
      await expect(notify(trx, 'account.new_login', userId)).rejects.toThrow(/enqueueEmail/);
      await expect(notify(trx, 'forum.reply', ['não-é-uuid'])).rejects.toThrow(TypeError);
      await expect(notify(trx, 'forum.reply', userId, { targetType: 'topic' })).rejects.toThrow(
        /existem juntos/,
      );
      await expect(notify(trx, 'forum.reply', userId, { data: { password: 'x' } })).rejects.toThrow(
        /password/,
      );
    });
  });

  it('enfileira uma tarefa `notify` por destinatário elegível', async () => {
    await inRollback(db, async (trx) => {
      const actor = await createUser(trx);
      const ana = await createUser(trx);
      const bruno = await createUser(trx);
      const deleted = await createUser(trx, { deletedAt: new Date() });
      const targetId = newId();
      const result = await notify(
        trx,
        'forum.reply',
        [ana, bruno, ana.toUpperCase(), deleted, actor],
        {
          actorId: actor,
          targetType: 'forum_topic',
          targetId,
          data: { title: 'Nova resposta' },
        },
      );
      expect(result.queued.map((item) => item.userId)).toEqual([ana, bruno]);
      expect(result.skipped).toEqual([
        { userId: deleted, reason: 'recipient_deleted' },
        { userId: actor, reason: 'actor_self' },
      ]);
      const jobs = await trx
        .selectFrom('jobs')
        .select(['id', 'type', 'payload', 'maxAttempts', 'status'])
        .where(
          'id',
          'in',
          result.queued.map((item) => item.jobId),
        )
        .orderBy('id')
        .execute();
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({
        type: 'notify',
        maxAttempts: 5,
        status: 'queued',
        payload: {
          type: 'forum.reply',
          userId: ana,
          actorId: actor,
          targetType: 'forum_topic',
          targetId,
          data: { title: 'Nova resposta' },
        },
      });
    });
  });

  it('aplica o grupo `staff` só à equipe', async () => {
    await inRollback(db, async (trx) => {
      const staff = await createUser(trx, { role: 'manager' });
      const student = await createUser(trx);
      const result = await notify(trx, 'ticket.opened', [staff, student]);
      expect(result.queued.map((item) => item.userId)).toEqual([staff]);
      expect(result.skipped).toEqual([{ userId: student, reason: 'not_staff' }]);
    });
  });

  it('`enqueueNotify` recusa quem não está em transação', async () => {
    await expect(
      enqueueNotify(db, {
        type: 'forum.reply',
        userId: newId(),
        actorId: null,
        targetType: null,
        targetId: null,
        data: {},
      }),
    ).rejects.toThrow(/transação/);
  });
});

describe('createNotification e agrupamento (spec 024, "Central")', () => {
  it('grava a linha e publica o evento com o contador', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const actor = await createUser(trx);
      const targetId = newId();
      const created = await createNotification(
        trx,
        {
          userId,
          type: 'forum.reply',
          actorId: actor,
          targetType: 'forum_topic',
          targetId,
          data: { title: 'Resposta' },
        },
        { nextEventId: eventIds() },
      );
      expect(created).toMatchObject({
        created: true,
        unreadCount: 1,
        notification: {
          userId,
          type: 'forum.reply',
          actorId: actor,
          targetType: 'forum_topic',
          targetId,
          data: { title: 'Resposta' },
          count: 1,
          readAt: null,
        },
      });
    });
  });

  it('funde o mesmo tipo e alvo enquanto não lido', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const ana = await createUser(trx, { name: 'Ana' });
      const bruno = await createUser(trx, { name: 'Bruno' });
      const targetId = newId();
      const first = await createNotification(
        trx,
        {
          userId,
          type: 'forum.reply',
          actorId: ana,
          targetType: 'forum_topic',
          targetId,
          data: { title: 'Primeira' },
        },
        { nextEventId: eventIds() },
      );
      const second = await createNotification(
        trx,
        {
          userId,
          type: 'forum.reply',
          actorId: bruno,
          targetType: 'forum_topic',
          targetId,
          data: { title: 'Segunda' },
        },
        { nextEventId: eventIds() },
      );
      expect(second?.created).toBe(false);
      expect(second?.notification.id).toBe(first?.notification.id);
      expect(second?.notification).toMatchObject({
        count: 2,
        actorId: bruno,
        data: { title: 'Segunda' },
      });
      expect(second?.unreadCount).toBe(1);
      // Alvo diferente cria linha nova.
      const other = await createNotification(
        trx,
        {
          userId,
          type: 'forum.reply',
          actorId: ana,
          targetType: 'forum_topic',
          targetId: newId(),
          data: {},
        },
        { nextEventId: eventIds() },
      );
      expect(other?.created).toBe(true);
      expect(other?.unreadCount).toBe(2);
      // Tipo diferente, mesmo alvo: outra linha.
      const mention = await createNotification(
        trx,
        {
          userId,
          type: 'forum.mention',
          actorId: ana,
          targetType: 'forum_topic',
          targetId,
          data: {},
        },
        { nextEventId: eventIds() },
      );
      expect(mention?.created).toBe(true);
      expect(mention?.unreadCount).toBe(3);
    });
  });

  it('depois de lida, a próxima cria linha nova e mantém o histórico', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const targetId = newId();
      const first = await createNotification(
        trx,
        { userId, type: 'forum.reply', targetType: 'forum_topic', targetId, data: {} },
        { nextEventId: eventIds() },
      );
      await markNotificationRead(trx, userId, first?.notification.id ?? '');
      const next = await createNotification(
        trx,
        { userId, type: 'forum.reply', targetType: 'forum_topic', targetId, data: {} },
        { nextEventId: eventIds() },
      );
      expect(next?.created).toBe(true);
      expect(next?.notification.id).not.toBe(first?.notification.id);
      const page = await listNotifications(trx, userId);
      expect(page.items).toHaveLength(2);
      expect(page.items[0]?.count).toBe(1);
      expect(page.items[1]?.count).toBe(1);
    });
  });

  it('recusa tipo sem canal plataforma, tipo fora do catálogo e transação ausente', async () => {
    const userId = newId();
    await expect(createNotification(db, { userId, type: 'forum.reply', data: {} })).rejects.toThrow(
      /transação/,
    );
    await inRollback(db, async (trx) => {
      await expect(
        createNotification(trx, { userId, type: 'x.y' as never, data: {} }),
      ).rejects.toThrow(/desconhecido/);
      await expect(
        createNotification(trx, { userId, type: 'account.new_login', data: {} }),
      ).rejects.toThrow(/plataforma/);
    });
  });

  it('devolve `null` para quem deixou de poder receber', async () => {
    await inRollback(db, async (trx) => {
      const actor = await createUser(trx);
      const suspended = await createUser(trx, { suspendedKind: 'posting' });
      const student = await createUser(trx);
      const call = (userId: string, type: 'forum.reply' | 'ticket.opened', actorId: string) =>
        createNotification(trx, { userId, type, actorId, data: {} }, { nextEventId: eventIds() });
      expect(await call(actor, 'forum.reply', actor)).toBeNull();
      expect(await call(suspended, 'forum.reply', actor)).toBeNull();
      expect(await call(student, 'ticket.opened', actor)).toBeNull();
      const missing = await createNotification(
        trx,
        { userId: newId(), type: 'forum.reply', data: {} },
        { nextEventId: eventIds() },
      );
      expect(missing).toBeNull();
    });
  });
});

it('avisa endereço indisponível só na central e preserva os outros tipos da conta', async () => {
  await inRollback(db, async (trx) => {
    const userId = await createUser(trx);
    const input = { userId, type: 'account.email_undeliverable' as const };
    const first = await createNotification(trx, input, { nextEventId: eventIds() });
    const repeated = await createNotification(trx, input, { nextEventId: eventIds() });
    expect(first?.notification.type).toBe(input.type);
    expect(repeated?.notification).toMatchObject({ id: first?.notification.id, count: 2 });
    expect(
      await trx.selectFrom('emailOutbox').select('id').where('userId', '=', userId).execute(),
    ).toEqual([]);
    await expect(deliverNotification(trx, input)).rejects.toThrow(/enqueueEmail/);
    await expect(createNotification(trx, { userId, type: 'account.exists' })).rejects.toThrow(
      /plataforma/,
    );
  });
});

describe('deliverNotification (canais e preferências)', () => {
  it('grava na central e enfileira o e-mail conforme os padrões', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const delivered = await deliverNotification(
        trx,
        { userId, type: 'forum.reply', data: { title: 'Nova resposta' } },
        { nextEventId: eventIds() },
      );
      expect(delivered.channels).toEqual({ inApp: true, email: true });
      expect(delivered.created?.created).toBe(true);
      expect(delivered.email).not.toBeNull();
      const outbox = await trx
        .selectFrom('emailOutbox')
        .select(['userId', 'type', 'data', 'status'])
        .where('userId', '=', userId)
        .execute();
      expect(outbox).toEqual([
        {
          userId,
          type: 'forum.reply',
          data: { title: 'Nova resposta' },
          status: 'queued',
        },
      ]);
    });
  });

  it('respeita o canal desligado pelo usuário', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      await setNotificationPrefs(trx, userId, { forum: { email: false } });
      const withoutEmail = await deliverNotification(
        trx,
        { userId, type: 'forum.reply', data: {} },
        { nextEventId: eventIds() },
      );
      expect(withoutEmail.created).not.toBeNull();
      expect(withoutEmail.email).toBeNull();

      await setNotificationPrefs(trx, userId, { courses: { inApp: false } });
      const withoutCentral = await deliverNotification(
        trx,
        { userId, type: 'lesson.published', data: {} },
        { nextEventId: eventIds() },
      );
      expect(withoutCentral.created).toBeNull();
      expect(withoutCentral.email).not.toBeNull();
      expect(withoutCentral.channels).toEqual({ inApp: false, email: true });
    });
  });

  it('permite suprimir um e-mail sem alterar preferências nem a central', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const delivered = await deliverNotification(
        trx,
        { userId, type: 'forum.reply', data: {} },
        { nextEventId: eventIds(), suppressEmail: true },
      );
      expect(delivered.channels).toEqual({ inApp: true, email: true });
      expect(delivered.created).not.toBeNull();
      expect(delivered.email).toBeNull();
    });
  });

  it('conta suspensa não recebe nada, nem a central nem o e-mail', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx, { suspendedKind: 'full' });
      const delivered = await deliverNotification(
        trx,
        { userId, type: 'forum.reply', data: {} },
        { nextEventId: eventIds() },
      );
      expect(delivered).toEqual({
        skipped: 'recipient_suspended',
        created: null,
        email: null,
        channels: null,
      });
      const rows = await trx
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('userId', '=', userId)
        .executeTakeFirst();
      expect(Number(rows?.count)).toBe(0);
    });
  });

  it('exige transação e tipo com canal plataforma', async () => {
    await expect(
      deliverNotification(db, { userId: newId(), type: 'forum.reply', data: {} }),
    ).rejects.toThrow(/transação/);
    await inRollback(db, async (trx) => {
      await expect(
        deliverNotification(trx, { userId: newId(), type: 'account.exists', data: {} }),
      ).rejects.toThrow(/enqueueEmail/);
      await expect(
        deliverNotification(trx, { userId: newId(), type: 'x.y' as never, data: {} }),
      ).rejects.toThrow(/desconhecido/);
    });
  });
});

describe('consulta e contador da central', () => {
  it('lista do mais recente para o mais antigo, com autor e cursor', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const otherId = await createUser(trx);
      const ana = await createUser(trx, { name: 'Ana' });
      const removed = await createUser(trx, { name: 'Bruno', deletedAt: new Date() });
      const base = Date.now() - 10 * 60_000;
      const first = await insertNotification(trx, {
        userId,
        actorId: ana,
        createdAt: new Date(base),
        data: { title: 'Um' },
      });
      const second = await insertNotification(trx, {
        userId,
        createdAt: new Date(base + 60_000),
        data: { title: 'Dois' },
      });
      const third = await insertNotification(trx, {
        userId,
        actorId: removed,
        createdAt: new Date(base + 120_000),
        data: { title: 'Três' },
      });
      await insertNotification(trx, {
        userId: otherId,
        createdAt: new Date(base + 180_000),
        data: { title: 'De outro' },
      });

      const page = await listNotifications(trx, userId, { limit: 2 });
      expect(page.items.map((item) => item.id)).toEqual([third, second]);
      expect(page.nextCursor).not.toBeNull();
      expect(page.items[0]).toMatchObject({
        group: 'forum',
        type: 'forum.reply',
        data: { title: 'Três' },
        actor: { id: removed, name: 'usuário removido', avatarUrl: null },
      });
      expect(page.items[1]?.actor).toBeNull();

      const next = await listNotifications(trx, userId, {
        limit: 2,
        cursor: page.nextCursor ?? '',
      });
      expect(next.items.map((item) => item.id)).toEqual([first]);
      expect(next.nextCursor).toBeNull();
    });
  });

  it('filtra as não lidas e valida limite e cursor', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const read = await insertNotification(trx, {
        userId,
        createdAt: new Date(Date.now() - 60_000),
        readAt: new Date(Date.now() - 30_000),
      });
      const unread = await insertNotification(trx, { userId });
      const page = await listNotifications(trx, userId, { unreadOnly: true });
      expect(page.items.map((item) => item.id)).toEqual([unread]);
      expect(page.items[0]?.readAt).toBeNull();
      expect(await getUnreadNotificationCount(trx, userId)).toBe(1);
      expect(await countUnreadNotifications(trx, userId)).toBe(1);
      expect(await getNotification(trx, userId, unread)).toMatchObject({ id: unread });
      expect(await getNotification(trx, userId, read)).toMatchObject({ id: read });
      expect(await getNotification(trx, userId, 'não-é-uuid')).toBeNull();
      expect(await getNotification(trx, userId, newId())).toBeNull();

      for (const options of [
        { limit: 0 },
        { limit: 51 },
        { limit: 1.5 },
        { cursor: 'não-é-cursor' },
        { cursor: Buffer.from('outro:abc').toString('base64url') },
        { cursor: Buffer.from('notifications:não-uuid').toString('base64url') },
      ]) {
        const error = await listNotifications(trx, userId, options).catch((caught) => caught);
        expect(isDomainError(error) && error.code).toBe('validation_failed');
      }
    });
  });
});

describe('leitura e limpeza (spec 024, RF-02)', () => {
  it('marca uma como lida, de forma idempotente e só do dono', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const otherId = await createUser(trx);
      const id = await insertNotification(trx, {
        userId,
        createdAt: new Date(Date.now() - 60_000),
      });
      await insertNotification(trx, { userId });
      const result = await markNotificationRead(trx, userId, id);
      expect(result?.notification.readAt).not.toBeNull();
      expect(result?.unreadCount).toBe(1);
      const again = await markNotificationRead(trx, userId, id);
      expect(again?.notification.readAt?.getTime()).toBe(result?.notification.readAt?.getTime());
      expect(await markNotificationRead(trx, otherId, id)).toBeNull();
      expect(await markNotificationRead(trx, userId, newId())).toBeNull();
      expect(await markNotificationRead(trx, userId, 'não-é-uuid')).toBeNull();
    });
  });

  it('marca todas como lidas e limpa só as do usuário', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const otherId = await createUser(trx);
      await insertNotification(trx, { userId, createdAt: new Date(Date.now() - 120_000) });
      await insertNotification(trx, { userId, createdAt: new Date(Date.now() - 60_000) });
      await insertNotification(trx, {
        userId,
        readAt: new Date(Date.now() - 30_000),
        createdAt: new Date(Date.now() - 90_000),
      });
      await insertNotification(trx, { userId: otherId });
      expect(await markAllNotificationsRead(trx, userId)).toEqual({
        updated: 2,
        unreadCount: 0,
      });
      expect(await getUnreadNotificationCount(trx, userId)).toBe(0);
      expect(await markAllNotificationsRead(trx, userId)).toEqual({
        updated: 0,
        unreadCount: 0,
      });
      expect(await clearNotifications(trx, userId)).toEqual({ deleted: 3 });
      const otherPage = await listNotifications(trx, otherId);
      expect(otherPage.items).toHaveLength(1);
      expect(otherPage.items[0]?.userId).toBe(otherId);
      expect(await clearNotifications(trx, userId)).toEqual({ deleted: 0 });
    });
  });
});

describe('evento `notification.created`', () => {
  it('publica só identificadores e o contador', async () => {
    const userId = newId();
    const notificationId = newId();
    const event = await publishNotificationCreated(
      db,
      { userId, notificationId: notificationId.toUpperCase(), type: 'forum.reply', unreadCount: 3 },
      { nextId: async () => 42 },
    );
    expect(event).toEqual({
      userId: userId.toLowerCase(),
      kind: 'notification.created',
      id: 42,
      data: { notificationId: notificationId.toLowerCase(), type: 'forum.reply', unreadCount: 3 },
    });
  });

  it('recusa id, tipo e contador fora do formato', async () => {
    const userId = newId();
    const notificationId = newId();
    await expect(
      publishNotificationCreated(db, {
        userId,
        notificationId: 'não-é-uuid',
        type: 'forum.reply',
        unreadCount: 1,
      }),
    ).rejects.toThrow(/notificationId/);
    await expect(
      publishNotificationCreated(db, {
        userId,
        notificationId,
        type: 'forum.unknown' as never,
        unreadCount: 1,
      }),
    ).rejects.toThrow(/tipo desconhecido/);
    await expect(
      publishNotificationCreated(db, {
        userId,
        notificationId,
        type: 'forum.reply',
        unreadCount: 0,
      }),
    ).rejects.toThrow(/unreadCount/);
  });
});
