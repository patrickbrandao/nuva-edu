import { afterAll, describe, expect, it } from 'vitest';
import { callAs, createActor, deniedBy } from '../actors.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

interface NotificationSeed {
  type?: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  data?: Record<string, unknown>;
  count?: number;
  readAt?: Date | null;
  createdAt?: Date;
}

/** Notificação como o worker a grava (só o essencial da migration 0016). */
async function seedNotification(userId: string, seed: NotificationSeed = {}): Promise<string> {
  const row = await test.db
    .insertInto('notifications')
    .values({
      userId,
      type: seed.type ?? 'ticket.opened',
      actorId: seed.actorId ?? null,
      targetType: seed.targetType ?? null,
      targetId: seed.targetId ?? null,
      data: JSON.stringify(seed.data ?? { protocol: 'SUP-1' }),
      count: seed.count ?? 1,
      readAt: seed.readAt ?? null,
      ...(seed.createdAt === undefined ? {} : { createdAt: seed.createdAt }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('central da equipe', () => {
  it('lista só as notificações do usuário, da mais nova para a mais antiga, com autor e grupo', async () => {
    const actor = await createActor(test, 'manager');
    const author = await createActor(test, 'admin');
    const older = await seedNotification(actor.id, {
      type: 'ticket.opened',
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    const newer = await seedNotification(actor.id, {
      type: 'forum.reply',
      actorId: author.id,
      targetType: 'topic',
      targetId: crypto.randomUUID(),
      data: { title: 'Tópico' },
      count: 3,
      createdAt: new Date('2026-01-02T10:00:00Z'),
    });
    const other = await createActor(test, 'manager');
    await seedNotification(other.id);

    const response = await callAs(test, { method: 'GET', url: '/api/v1/notifications', as: actor });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nextCursor).toBeNull();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([newer, older]);
    expect(body.items[0]).toMatchObject({
      type: 'forum.reply',
      group: 'forum',
      count: 3,
      targetType: 'topic',
      actor: { id: author.id, name: 'Pessoa de Teste' },
    });
    expect(body.items[0]).not.toHaveProperty('userId');
    expect(body.items[0]).not.toHaveProperty('actorId');
    expect(body.items[1]).toMatchObject({ type: 'ticket.opened', group: 'staff', actor: null });
  });

  it('pagina por cursor com limit e recusa cursor fora do formato', async () => {
    const actor = await createActor(test, 'instructor');
    const types = ['ticket.opened', 'forum.reply', 'ticket.user_reply'];
    for (const [index, type] of types.entries()) {
      await seedNotification(actor.id, {
        type,
        createdAt: new Date(`2026-02-0${index + 1}T00:00:00Z`),
      });
    }
    const first = await callAs(test, {
      method: 'GET',
      url: '/api/v1/notifications?limit=2',
      as: actor,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toBeTruthy();

    const second = await callAs(test, {
      method: 'GET',
      url: `/api/v1/notifications?limit=2&cursor=${encodeURIComponent(cursor)}`,
      as: actor,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().nextCursor).toBeNull();

    const invalid = await callAs(test, {
      method: 'GET',
      url: '/api/v1/notifications?cursor=fora-do-formato',
      as: actor,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('conta as não lidas, marca uma como lida (idempotente), todas e limpa', async () => {
    const actor = await createActor(test, 'manager');
    const mine = await seedNotification(actor.id);
    const other = await createActor(test, 'manager');
    const foreign = await seedNotification(other.id);

    const count = await callAs(test, {
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      as: actor,
    });
    expect(count.json()).toEqual({ unreadCount: 1 });

    const read = await callAs(test, {
      method: 'POST',
      url: `/api/v1/notifications/${mine}/read`,
      as: actor,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ unreadCount: 0, notification: { id: mine } });
    expect(read.json().notification.readAt).not.toBeNull();

    const again = await callAs(test, {
      method: 'POST',
      url: `/api/v1/notifications/${mine}/read`,
      as: actor,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().notification.readAt).toBe(read.json().notification.readAt);

    const foreignRead = await callAs(test, {
      method: 'POST',
      url: `/api/v1/notifications/${foreign}/read`,
      as: actor,
    });
    expect(foreignRead.statusCode).toBe(404);

    await seedNotification(actor.id, { type: 'forum.reply' });
    await seedNotification(actor.id, { type: 'ticket.user_reply' });
    const all = await callAs(test, {
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      as: actor,
    });
    expect(all.json()).toEqual({ updated: 2, unreadCount: 0 });

    const clear = await callAs(test, {
      method: 'DELETE',
      url: '/api/v1/notifications',
      as: actor,
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toEqual({ deleted: 3 });
    const remaining = await test.db
      .selectFrom('notifications')
      .select('id')
      .where('userId', '=', actor.id)
      .execute();
    expect(remaining).toHaveLength(0);
    // A notificação da outra pessoa continua.
    expect(
      await test.db
        .selectFrom('notifications')
        .select('id')
        .where('id', '=', foreign)
        .executeTakeFirst(),
    ).toBeDefined();
  });

  it('escrita sem CSRF é 403 e não altera nada', async () => {
    const actor = await createActor(test, 'manager');
    await seedNotification(actor.id);
    const response = await callAs(test, {
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      as: actor,
      csrf: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_token_invalid' });
  });

  it('papel student recebe 403 auditado', async () => {
    const student = await createActor(test, 'student');
    const response = await callAs(test, {
      method: 'GET',
      url: '/api/v1/notifications',
      as: student,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
    const denied = await deniedBy(test, student.id);
    expect(denied[0]).toMatchObject({ outcome: 'denied' });
  });
});

describe('preferências da equipe', () => {
  it('devolve os onze grupos com os padrões e as regras de cada um', async () => {
    const actor = await createActor(test, 'manager');
    const response = await callAs(test, {
      method: 'GET',
      url: '/api/v1/me/notification-prefs',
      as: actor,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Object.keys(body)).toEqual([
      'account',
      'purchase',
      'courses',
      'forum',
      'messages',
      'community',
      'events',
      'support',
      'announcements',
      'moderation',
      'staff',
    ]);
    expect(body.account).toEqual({
      inApp: false,
      email: true,
      emailRequired: true,
      inAppAvailable: false,
    });
    expect(body.purchase).toMatchObject({ inApp: true, email: true, emailRequired: true });
    expect(body.messages).toMatchObject({
      email: false,
      emailRequired: false,
      inAppAvailable: true,
    });
  });

  it('grava só o canal enviado e devolve as preferências efetivas', async () => {
    const actor = await createActor(test, 'manager');
    const response = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/me/notification-prefs',
      as: actor,
      payload: { forum: { email: false } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().forum).toMatchObject({ inApp: true, email: false });

    const stored = await test.db
      .selectFrom('notificationPrefs')
      .selectAll()
      .where('userId', '=', actor.id)
      .execute();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ group: 'forum', inApp: true, email: false });

    const read = await callAs(test, {
      method: 'GET',
      url: '/api/v1/me/notification-prefs',
      as: actor,
    });
    expect(read.json().forum.email).toBe(false);
    // O grupo não enviado continua no padrão.
    expect(read.json().courses.email).toBe(true);
  });

  it('recusa e-mail desligado em grupo obrigatório e canal plataforma no account', async () => {
    const actor = await createActor(test, 'manager');
    const required = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/me/notification-prefs',
      as: actor,
      payload: { purchase: { email: false } },
    });
    expect(required.statusCode).toBe(400);
    expect(required.json()).toMatchObject({ code: 'validation_failed' });
    expect(required.json().errors).toContainEqual(
      expect.objectContaining({ path: 'body.purchase.email' }),
    );

    const inApp = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/me/notification-prefs',
      as: actor,
      payload: { account: { inApp: true } },
    });
    expect(inApp.statusCode).toBe(400);
    expect(inApp.json().errors).toContainEqual(
      expect.objectContaining({ path: 'body.account.inApp' }),
    );
  });
});
