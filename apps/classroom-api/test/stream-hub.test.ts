import type { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatEvent,
  parseEventId,
  parseUserEventPayload,
  type UserEvent,
} from '../src/stream/events.ts';
import { createStreamHub, type StreamHub } from '../src/stream/hub.ts';

const ALICE = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
const BRUNO = '0193a5b2-8e2f-7a11-b0c3-5d7e9f1a2b3c';

function event(userId: string, id: number, data: Record<string, unknown> = {}): UserEvent {
  return { userId, id, event: 'presence', data };
}

/** Tudo o que já foi escrito no fluxo e ainda não foi lido. */
function drain(stream: Readable): string {
  let text = '';
  for (let chunk = stream.read(); chunk !== null; chunk = stream.read()) {
    text += String(chunk);
  }
  return text;
}

describe('parseUserEventPayload', () => {
  it('lê { userId, kind, id, data } do NOTIFY', () => {
    const payload = JSON.stringify({
      userId: ALICE.toUpperCase(),
      kind: 'notification.created',
      id: '17',
      data: { notificationId: BRUNO, type: 'forum.reply', unreadCount: 3 },
    });
    expect(parseUserEventPayload(payload)).toEqual({
      ok: true,
      event: {
        userId: ALICE,
        id: 17,
        event: 'notification.created',
        data: { notificationId: BRUNO, type: 'forum.reply', unreadCount: 3 },
      },
    });
  });

  it('sem data, o evento sai com objeto vazio', () => {
    const parsed = parseUserEventPayload(
      JSON.stringify({ userId: ALICE, kind: 'presence', id: 1 }),
    );
    expect(parsed).toMatchObject({ ok: true, event: { data: {} } });
  });

  it.each([
    ['texto que não é JSON', 'x', 'invalid_json'],
    ['JSON que não é objeto', '[1]', 'invalid_shape'],
    ['sem userId', JSON.stringify({ kind: 'presence', id: 1 }), 'invalid_shape'],
    ['id negativo', JSON.stringify({ userId: ALICE, kind: 'presence', id: -1 }), 'invalid_shape'],
    [
      'id não inteiro',
      JSON.stringify({ userId: ALICE, kind: 'presence', id: 1.5 }),
      'invalid_shape',
    ],
    [
      'data que não é objeto',
      JSON.stringify({ userId: ALICE, kind: 'presence', id: 1, data: [1] }),
      'invalid_shape',
    ],
    ['ping vindo do banco', JSON.stringify({ userId: ALICE, kind: 'ping', id: 1 }), 'unknown_kind'],
  ])('recusa %s', (_name, payload, reason) => {
    expect(parseUserEventPayload(payload)).toEqual({ ok: false, reason });
  });
});

describe('parseEventId', () => {
  it('aceita número e texto só de dígitos; o resto é ausência', () => {
    expect(parseEventId('42')).toBe(42);
    expect(parseEventId(0)).toBe(0);
    expect(parseEventId('4x')).toBeUndefined();
    expect(parseEventId(undefined)).toBeUndefined();
    expect(parseEventId('99999999999999999999999')).toBeUndefined();
  });
});

describe('formatEvent', () => {
  it('escreve id, event e data numa linha cada, com linha em branco no fim', () => {
    expect(formatEvent(event(ALICE, 42, { userId: BRUNO, online: true }))).toBe(
      `id: 42\nevent: presence\ndata: {"userId":"${BRUNO}","online":true}\n\n`,
    );
  });

  it('quebra de linha no conteúdo não vira linha nova no fio', () => {
    const frame = formatEvent(event(ALICE, 1, { type: 'a\nevent: ping' }));
    expect(frame.split('\n')).toHaveLength(5);
  });
});

describe('createStreamHub', () => {
  let hub: StreamHub;
  afterEach(() => {
    hub?.stop();
    vi.useRealTimers();
  });

  it('entrega só às conexões do destinatário e conta as entregas', () => {
    hub = createStreamHub();
    const alice = hub.open(ALICE);
    const bruno = hub.open(BRUNO);
    expect(drain(alice)).toBe(': ok\n\n');

    expect(hub.publish(event(ALICE, 1))).toBe(1);
    expect(hub.publish(event('0193a5b2-0000-7000-8000-000000000000', 1))).toBe(0);
    expect(drain(alice)).toContain('id: 1\n');
    expect(drain(bruno)).toBe(': ok\n\n');
    expect(hub.connectionCount()).toBe(2);
  });

  it('passou do limite por usuário, encerra a mais antiga', () => {
    hub = createStreamHub({ maxConnectionsPerUser: 2 });
    const first = hub.open(ALICE);
    const second = hub.open(ALICE);
    const third = hub.open(ALICE);
    expect(
      first.readableEnded || (first as unknown as { writableEnded: boolean }).writableEnded,
    ).toBe(true);
    expect(hub.connectionCount()).toBe(2);
    expect(hub.publish(event(ALICE, 1))).toBe(2);
    expect(drain(second)).toContain('id: 1\n');
    expect(drain(third)).toContain('id: 1\n');
  });

  it('envia ping a todas as conexões a cada intervalo', () => {
    vi.useFakeTimers();
    hub = createStreamHub({ pingIntervalMs: 25_000 });
    const alice = hub.open(ALICE);
    drain(alice);
    vi.advanceTimersByTime(24_999);
    expect(drain(alice)).toBe('');
    vi.advanceTimersByTime(1);
    expect(drain(alice)).toBe('event: ping\ndata: {}\n\n');
    vi.advanceTimersByTime(25_000);
    expect(drain(alice)).toBe('event: ping\ndata: {}\n\n');
  });

  it('reenvia pelo Last-Event-ID só os eventos mais novos, do usuário e dentro da janela', () => {
    let clock = 1_000_000;
    hub = createStreamHub({ replayWindowMs: 300_000, now: () => clock });
    hub.publish(event(ALICE, 1));
    clock += 200_000;
    hub.publish(event(ALICE, 2));
    hub.publish(event(BRUNO, 3));
    hub.publish(event(ALICE, 4));

    expect(drain(hub.open(ALICE, 1))).toBe(
      `: ok\n\n${formatEvent(event(ALICE, 2))}${formatEvent(event(ALICE, 4))}`,
    );
    // Sem Last-Event-ID nada é reenviado.
    expect(drain(hub.open(ALICE))).toBe(': ok\n\n');

    // O evento 1 passou dos 5 minutos; os outros dois, ainda não.
    clock += 150_000;
    expect(drain(hub.open(ALICE, 0))).toBe(
      `: ok\n\n${formatEvent(event(ALICE, 2))}${formatEvent(event(ALICE, 4))}`,
    );
    clock += 300_000;
    expect(drain(hub.open(ALICE, 0))).toBe(': ok\n\n');
  });

  it('guarda no máximo o teto de eventos por usuário', () => {
    hub = createStreamHub({ replayMaxEventsPerUser: 2 });
    for (const id of [1, 2, 3]) {
      hub.publish(event(ALICE, id));
    }
    const replayed = drain(hub.open(ALICE, 0));
    expect(replayed).not.toContain('id: 1\n');
    expect(replayed).toContain('id: 2\n');
    expect(replayed).toContain('id: 3\n');
  });

  it('derruba o cliente que não lê, em vez de acumular memória', () => {
    hub = createStreamHub({ maxPendingBytes: 1_000 });
    const slow = hub.open(ALICE);
    const big = { type: 'x'.repeat(600) };
    expect(hub.publish(event(ALICE, 1, big))).toBe(1);
    expect(hub.publish(event(ALICE, 2, big))).toBe(1);
    expect(hub.publish(event(ALICE, 3, big))).toBe(0);
    expect(slow.destroyed).toBe(true);
    expect(hub.connectionCount()).toBe(0);
  });

  it('disconnectUser fecha só as conexões daquele usuário; closeAll, todas', () => {
    hub = createStreamHub();
    hub.open(ALICE);
    hub.open(ALICE);
    hub.open(BRUNO);
    hub.disconnectUser(ALICE);
    expect(hub.connectionCount()).toBe(1);
    hub.closeAll();
    expect(hub.connectionCount()).toBe(0);
  });

  it('conexão fechada pelo cliente sai da contagem', async () => {
    hub = createStreamHub();
    const stream = hub.open(ALICE);
    stream.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(hub.connectionCount()).toBe(0);
  });
});
