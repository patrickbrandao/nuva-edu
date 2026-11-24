import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  type ChannelListener,
  closeDatabase,
  createDatabase,
  createLogger,
  type Database,
  isDomainError,
  isUserEventKind,
  listenChannel,
  nextUserEventId,
  publishUserEvent,
  USER_EVENT_KINDS,
  USER_EVENT_MAX_PAYLOAD_BYTES,
  USER_EVENTS_CHANNEL,
  USER_EVENTS_SEQUENCE,
} from '../src/index.ts';

const USER_ID = '019aa3f2-7b1c-7e55-9a10-5299822472aa';

let db: Database;
let listener: ChannelListener;
const received: string[] = [];

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condição não atendida a tempo');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 3 });
  // Banco descartável desta execução: o teste tira a sequência da migration 0003 para provar o
  // erro de banco sem migration, e a recria adiante.
  await sql`DROP SEQUENCE IF EXISTS ${sql.id(USER_EVENTS_SEQUENCE)} CASCADE`.execute(db);
  listener = listenChannel({
    connectionString: inject('databaseUrl'),
    channel: USER_EVENTS_CHANNEL,
    onNotification: (payload) => received.push(payload),
  });
  await listener.whenConnected();
});

afterAll(async () => {
  await listener.close();
  await closeDatabase(db);
});

describe('publishUserEvent', () => {
  it('sem a sequência, falha com erro claro e não aborta a transação de quem chamou', async () => {
    const error = await nextUserEventId(db).catch((caught: unknown) => caught);
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'user_event_sequence_missing', status: 500 });
    expect((error as Error).message).toContain(USER_EVENTS_SEQUENCE);

    const alive = await db.transaction().execute(async (trx) => {
      await expect(
        publishUserEvent(trx, { userId: USER_ID, kind: 'presence' }),
      ).rejects.toMatchObject({ code: 'user_event_sequence_missing' });
      const result = await sql<{ ok: number }>`SELECT 1 AS ok`.execute(trx);
      return result.rows[0]?.ok;
    });
    expect(alive).toBe(1);
    await pause(100);
    expect(received).toEqual([]);
  });

  it('com gerador injetado, publica a carga que a classroom-api lê', async () => {
    received.length = 0;
    const event = await publishUserEvent(
      db,
      {
        userId: USER_ID.toUpperCase(),
        kind: 'dm.message.created',
        data: { conversationId: 'c1', messageId: 'm1' },
      },
      { nextId: async () => 42 },
    );
    expect(event).toEqual({
      userId: USER_ID,
      kind: 'dm.message.created',
      id: 42,
      data: { conversationId: 'c1', messageId: 'm1' },
    });
    await waitFor(() => received.length === 1);
    expect(JSON.parse(received[0] ?? '')).toEqual(event);
  });

  it('com a sequência criada, numera em ordem crescente; data ausente vira objeto vazio', async () => {
    await sql`CREATE SEQUENCE ${sql.id(USER_EVENTS_SEQUENCE)} AS bigint`.execute(db);
    received.length = 0;
    const first = await publishUserEvent(db, { userId: USER_ID, kind: 'presence' });
    const second = await publishUserEvent(db, {
      userId: USER_ID,
      kind: 'notification.created',
      data: { notificationId: 'n1', type: 'x', unreadCount: 3 },
    });
    expect(first).toMatchObject({ id: 1, data: {} });
    expect(second.id).toBe(2);
    await waitFor(() => received.length === 2);
    expect(received.map((payload) => JSON.parse(payload).id)).toEqual([1, 2]);
  });

  it('só avisa no COMMIT; transação desfeita não avisa', async () => {
    received.length = 0;
    await expect(
      db.transaction().execute(async (trx) => {
        await publishUserEvent(trx, { userId: USER_ID, kind: 'presence' });
        throw new Error('desiste');
      }),
    ).rejects.toThrow('desiste');
    await db.transaction().execute(async (trx) => {
      await publishUserEvent(trx, { userId: USER_ID, kind: 'presence', data: { online: true } });
      await pause(100);
      expect(received).toEqual([]);
    });
    await waitFor(() => received.length === 1);
    expect(JSON.parse(received[0] ?? '')).toMatchObject({ data: { online: true } });
  });

  it('recusa carga que não cabe no NOTIFY, sem gastar número nem publicar', async () => {
    received.length = 0;
    let generated = 0;
    const nextId = async () => {
      generated += 1;
      return 7;
    };
    const envelope = JSON.stringify({
      userId: USER_ID,
      kind: 'presence',
      id: Number.MAX_SAFE_INTEGER,
      data: { text: '' },
    }).length;
    const fits = 'a'.repeat(USER_EVENT_MAX_PAYLOAD_BYTES - envelope);

    await publishUserEvent(
      db,
      { userId: USER_ID, kind: 'presence', data: { text: fits } },
      { nextId },
    );
    await waitFor(() => received.length === 1);

    const error = await publishUserEvent(
      db,
      { userId: USER_ID, kind: 'presence', data: { text: `${fits}a` } },
      { nextId },
    ).catch((caught: unknown) => caught);
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'user_event_too_large', status: 500 });
    expect((error as Error).message).toContain(String(USER_EVENT_MAX_PAYLOAD_BYTES));
    // Conta em bytes, não em caracteres: acento ocupa dois.
    await expect(
      publishUserEvent(
        db,
        { userId: USER_ID, kind: 'presence', data: { text: `${fits.slice(1)}é` } },
        { nextId },
      ),
    ).rejects.toMatchObject({ code: 'user_event_too_large' });
    expect(generated).toBe(1);
    await pause(100);
    expect(received).toHaveLength(1);
  });

  it('recusa destinatário, evento, data e id fora do formato', async () => {
    const nextId = async () => 1;
    await expect(
      publishUserEvent(db, { userId: 'ana', kind: 'presence' }, { nextId }),
    ).rejects.toThrow(TypeError);
    await expect(
      publishUserEvent(db, { userId: USER_ID, kind: 'ping' as never }, { nextId }),
    ).rejects.toThrow('evento desconhecido');
    await expect(
      publishUserEvent(db, { userId: USER_ID, kind: 'presence', data: [] as never }, { nextId }),
    ).rejects.toThrow('data precisa ser um objeto');
    await expect(
      publishUserEvent(db, { userId: USER_ID, kind: 'presence' }, { nextId: async () => 1.5 }),
    ).rejects.toThrow('id');
  });

  it('conhece os eventos da spec 004, menos o ping', () => {
    expect(USER_EVENT_KINDS).toHaveLength(7);
    expect(isUserEventKind('forum.post.created')).toBe(true);
    expect(isUserEventKind('ping')).toBe(false);
  });
});

describe('listenChannel', () => {
  it('recusa nome de canal fora do formato', () => {
    expect(() =>
      listenChannel({
        connectionString: inject('databaseUrl'),
        channel: 'x; DROP TABLE jobs',
        onNotification: () => {},
      }),
    ).toThrow(TypeError);
  });

  it('entrega a carga, ignora outros canais e sobrevive a erro de quem trata', async () => {
    const lines: string[] = [];
    const payloads: string[] = [];
    const connections: boolean[] = [];
    const current = listenChannel({
      connectionString: inject('databaseUrl'),
      channel: 'core_test_canal',
      logger: createLogger({ service: 'core-test', write: (line) => lines.push(line) }),
      onConnected: ({ reconnected }) => {
        connections.push(reconnected);
        throw new Error('tratador de conexão quebrado');
      },
      onNotification: (payload) => {
        payloads.push(payload);
        if (payload === 'quebra') {
          throw new Error('tratador quebrado');
        }
      },
    });
    await current.whenConnected();
    await waitFor(() => connections.length === 1);
    expect(connections).toEqual([false]);

    await sql`SELECT pg_notify('core_test_outro', 'não é meu')`.execute(db);
    await sql`SELECT pg_notify('core_test_canal', 'quebra')`.execute(db);
    await sql`NOTIFY core_test_canal`.execute(db);
    await sql`SELECT pg_notify('core_test_canal', 'segredo-do-usuario')`.execute(db);
    await waitFor(() => payloads.length === 3);
    expect(payloads).toEqual(['quebra', '', 'segredo-do-usuario']);
    expect(current.isConnected()).toBe(true);

    const messages = lines.map((line) => JSON.parse(line));
    expect(messages).toEqual([
      expect.objectContaining({
        level: 'error',
        channel: 'core_test_canal',
        msg: 'Falha ao tratar a conexão da escuta do canal',
      }),
      expect.objectContaining({
        level: 'error',
        channel: 'core_test_canal',
        msg: 'Falha ao tratar o aviso do canal',
      }),
    ]);
    // A carga não vai para o log.
    expect(lines.join('')).not.toContain('segredo-do-usuario');
    await current.close();
  });

  it('avisa a queda e a reconexão', async () => {
    const lines: string[] = [];
    const events: string[] = [];
    const current = listenChannel({
      connectionString: inject('databaseUrl'),
      channel: 'core_test_queda',
      applicationName: 'core-test-channel-drop',
      logger: createLogger({ service: 'core-test', write: (line) => lines.push(line) }),
      reconnectMinDelayMs: 20,
      reconnectMaxDelayMs: 100,
      onNotification: (payload) => events.push(`aviso:${payload}`),
      onConnected: ({ reconnected }) => events.push(reconnected ? 'reconectou' : 'conectou'),
      onDisconnected: () => {
        events.push('caiu');
        throw new Error('tratador de queda quebrado');
      },
    });
    await current.whenConnected();
    await sql`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE application_name = 'core-test-channel-drop' AND datname = current_database()
    `.execute(db);
    await waitFor(() => events.includes('reconectou'));
    expect(events).toEqual(['conectou', 'caiu', 'reconectou']);

    await sql`SELECT pg_notify('core_test_queda', 'de volta')`.execute(db);
    await waitFor(() => events.length === 4);
    expect(events[3]).toBe('aviso:de volta');

    const messages = lines.map((line) => JSON.parse(line).msg);
    expect(messages).toEqual([
      'Falha ao tratar a queda da escuta do canal',
      'Escuta do canal caiu; reconectando',
      'Escuta do canal reconectada',
    ]);
    await current.close();
    expect(current.isConnected()).toBe(false);
  });
});
