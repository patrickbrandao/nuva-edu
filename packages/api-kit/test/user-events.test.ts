import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createUserEventPipeline,
  OPEN_FRAME,
  PING_FRAME,
  parseEventId,
  parseUserStreamEventPayload,
  type UserEventChannelHandlers,
  type UserEventChannelListener,
  type UserEventKinds,
  userEventFrame,
} from '../src/index.ts';
import { captureLogs } from './helpers.ts';

const ALICE = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
const BRUNO = '0193a5b2-8e2f-7a11-b0c3-5d7e9f1a2b3c';

/** Os tipos que o núcleo conhece (no serviço, vêm de `isUserEventKind`). */
const KNOWN = new Set(['presence', 'notification.created', 'dm.message.created']);
const isKnownKind = (kind: string): boolean => KNOWN.has(kind);

/** Política da classroom-api: entrega todos os tipos do núcleo. */
const everyKind: UserEventKinds<string> = {
  isKnownKind,
  acceptsKind: (kind): kind is string => isKnownKind(kind),
};

/** Política da admin-api (ADR 0028): reconhece todos, entrega só `notification.created`. */
const onlyNotifications: UserEventKinds<'notification.created'> = {
  isKnownKind,
  acceptsKind: (kind): kind is 'notification.created' => kind === 'notification.created',
};

function payload(kind: string, id: number, data: Record<string, unknown> = {}): string {
  return JSON.stringify({ userId: ALICE, kind, id, data });
}

describe('parseUserStreamEventPayload', () => {
  it('lê { userId, kind, id, data } do NOTIFY', () => {
    const raw = JSON.stringify({
      userId: ALICE.toUpperCase(),
      kind: 'notification.created',
      id: '17',
      data: { notificationId: BRUNO, type: 'forum.reply', unreadCount: 3 },
    });
    expect(parseUserStreamEventPayload(raw, everyKind)).toEqual({
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
    const parsed = parseUserStreamEventPayload(
      JSON.stringify({ userId: ALICE, kind: 'presence', id: 1 }),
      everyKind,
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
  ])('recusa %s', (_name, raw, reason) => {
    expect(parseUserStreamEventPayload(raw, everyKind)).toEqual({ ok: false, reason });
  });

  it('tipo conhecido que o serviço não entrega sai como foreign_kind', () => {
    expect(parseUserStreamEventPayload(payload('presence', 1), onlyNotifications)).toEqual({
      ok: false,
      reason: 'foreign_kind',
    });
    expect(
      parseUserStreamEventPayload(payload('notification.created', 2), onlyNotifications),
    ).toMatchObject({ ok: true, event: { event: 'notification.created' } });
  });

  it('sem isKnownKind, o filtro de aceitos também define o que é conhecido', () => {
    const parsed = parseUserStreamEventPayload(payload('presence', 1), {
      acceptsKind: onlyNotifications.acceptsKind,
    });
    expect(parsed).toEqual({ ok: false, reason: 'unknown_kind' });
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

describe('frames', () => {
  it('userEventFrame escreve id, event e data numa linha cada, com linha em branco no fim', () => {
    expect(
      userEventFrame({
        userId: ALICE,
        id: 42,
        event: 'presence',
        data: { userId: BRUNO, online: true },
      }),
    ).toBe(`id: 42\nevent: presence\ndata: {"userId":"${BRUNO}","online":true}\n\n`);
  });

  it('quebra de linha no conteúdo não vira linha nova no fio', () => {
    const frame = userEventFrame({
      userId: ALICE,
      id: 1,
      event: 'notification.created',
      data: { type: 'a\nevent: ping' },
    });
    expect(frame.split('\n')).toHaveLength(5);
  });

  it('o ping não leva id, e a abertura é um comentário ignorado pelo cliente', () => {
    expect(PING_FRAME).toBe('event: ping\ndata: {}\n\n');
    expect(OPEN_FRAME).toBe(': ok\n\n');
  });
});

/** Escuta falsa do canal: entrega os tratadores ao teste e registra as chamadas. */
function fakeChannel() {
  const calls = { listen: 0, closed: 0 };
  let handlers: UserEventChannelHandlers | null = null;
  let connected = false;
  let resolveFirst: () => void = () => {};
  const first = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  const listener: UserEventChannelListener = {
    isConnected: () => connected,
    whenConnected: () => first,
    close: async () => {
      calls.closed += 1;
      connected = false;
    },
  };
  return {
    calls,
    listener,
    listen(next: UserEventChannelHandlers): UserEventChannelListener {
      calls.listen += 1;
      handlers = next;
      connected = true;
      resolveFirst();
      return listener;
    },
    handlers(): UserEventChannelHandlers {
      if (!handlers) {
        throw new Error('A escuta não foi aberta.');
      }
      return handlers;
    },
  };
}

/** Tudo o que já foi escrito no fluxo e ainda não foi lido. */
function drain(stream: Readable): string {
  let text = '';
  for (let chunk = stream.read(); chunk !== null; chunk = stream.read()) {
    text += String(chunk);
  }
  return text;
}

function pipelineFor(
  kinds: UserEventKinds<string>,
  validate?: (body: { data: Record<string, unknown> }) => readonly string[],
) {
  const channel = fakeChannel();
  const logs = captureLogs();
  const pipeline = createUserEventPipeline({
    kinds,
    listen: (handlers) => channel.listen(handlers),
    logger: logs.logger,
    channel: 'nuva_user_events',
    ...(validate ? { validate } : {}),
  });
  return { pipeline, channel, logs };
}

describe('createUserEventPipeline', () => {
  it('entrega o evento aceito às conexões do destinatário', () => {
    const { pipeline } = pipelineFor(everyKind);
    const stream = pipeline.hub.open(ALICE);
    pipeline.ingest(payload('notification.created', 7, { notificationId: BRUNO }));
    expect(drain(stream)).toBe(
      `${OPEN_FRAME}id: 7\nevent: notification.created\ndata: {"notificationId":"${BRUNO}"}\n\n`,
    );
    expect(pipeline.hub.connectionCount()).toBe(1);
  });

  it('tipo de outro serviço: sem entrega, sem reenvio e sem aviso no log', () => {
    const { pipeline, logs } = pipelineFor(onlyNotifications);
    pipeline.ingest(payload('presence', 9, { userId: BRUNO, online: true }));
    pipeline.ingest(payload('dm.message.created', 10, { conversationId: BRUNO }));

    // Sem conexão aberta na hora: nada foi guardado para o reenvio.
    expect(drain(pipeline.hub.open(ALICE, 0))).toBe(OPEN_FRAME);
    pipeline.ingest(payload('notification.created', 11, { notificationId: BRUNO }));
    // Só o aceito é reenviado; os de fora não ocuparam o `id` do destinatário.
    expect(drain(pipeline.hub.open(ALICE, 0))).toContain('id: 11\n');
    expect(logs.text()).not.toContain('presence');
    expect(logs.text()).not.toContain('Aviso de evento fora do formato');
  });

  it('evento do próprio serviço que o contrato recusa não é entregue nem guardado', () => {
    const { pipeline, logs } = pipelineFor(onlyNotifications, (body) =>
      body.data.notificationId === undefined ? ['/data/notificationId'] : [],
    );
    const stream = pipeline.hub.open(ALICE);
    pipeline.ingest(
      payload('notification.created', 20, {
        notificationId: undefined,
        secret: 'conteudo-interno',
      }),
    );
    pipeline.ingest(payload('notification.created', 21, { notificationId: BRUNO }));

    expect(drain(stream)).toContain('id: 21\n');
    expect(drain(stream)).not.toContain('id: 20\n');
    expect(drain(pipeline.hub.open(ALICE, 19))).toBe(
      `${OPEN_FRAME}id: 21\nevent: notification.created\ndata: {"notificationId":"${BRUNO}"}\n\n`,
    );
    const [warning] = logs.lines.filter(
      (line) => line.msg === 'Aviso de evento fora do formato; descartado',
    );
    expect(warning).toMatchObject({
      level: 'warn',
      channel: 'nuva_user_events',
      reason: 'contract_mismatch',
      event: 'notification.created',
      fields: ['/data/notificationId'],
    });
    expect(logs.text()).not.toContain('conteudo-interno');
  });

  it('carga fora do formato é descartada com o motivo e nunca com o conteúdo', () => {
    const { pipeline, logs } = pipelineFor(everyKind);
    const stream = pipeline.hub.open(ALICE);
    pipeline.ingest('isto-nao-e-json segredo-na-carga');
    pipeline.ingest(JSON.stringify({ userId: 'sem-uuid', kind: 'presence', id: 1 }));
    pipeline.ingest(payload('tipo.desconhecido', 1));

    expect(drain(stream)).toBe(OPEN_FRAME);
    expect(
      logs.lines
        .filter((line) => line.msg === 'Aviso de evento fora do formato; descartado')
        .map((line) => line.reason),
    ).toEqual(['invalid_json', 'invalid_shape', 'unknown_kind']);
    expect(logs.text()).not.toContain('segredo-na-carga');
  });

  it('a queda da escuta fecha as conexões; o navegador reconecta', () => {
    const { pipeline, channel } = pipelineFor(everyKind);
    pipeline.start();
    pipeline.hub.open(ALICE);
    expect(pipeline.hub.connectionCount()).toBe(1);
    channel.handlers().onDisconnected();
    expect(pipeline.hub.connectionCount()).toBe(0);
  });

  it('start abre a escuta uma vez; isListening e whenListening seguem a escuta', async () => {
    const { pipeline, channel } = pipelineFor(everyKind);
    expect(pipeline.isListening()).toBe(false);
    pipeline.start();
    pipeline.start();
    expect(channel.calls.listen).toBe(1);
    await pipeline.whenListening();
    expect(pipeline.isListening()).toBe(true);

    await pipeline.close();
    expect(channel.calls.closed).toBe(1);
    expect(pipeline.isListening()).toBe(false);
  });

  it('sem escuta aberta, whenListening resolve e o hub funciona pela ingestão direta', async () => {
    const { pipeline } = pipelineFor(everyKind);
    await pipeline.whenListening();
    expect(pipeline.isListening()).toBe(false);
    const stream = pipeline.hub.open(ALICE);
    pipeline.ingest(payload('presence', 3, { userId: BRUNO, online: false }));
    expect(drain(stream)).toContain('id: 3\n');
  });

  it('close encerra as conexões abertas', async () => {
    const { pipeline } = pipelineFor(everyKind);
    pipeline.start();
    pipeline.hub.open(ALICE);
    expect(pipeline.hub.connectionCount()).toBe(1);
    await pipeline.close();
    expect(pipeline.hub.connectionCount()).toBe(0);
  });
});
