import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type ClassroomSchemas,
  openClassroomStream,
  type StreamEvent,
  type StreamEventName,
  type StreamEventOf,
  streamEventNames,
} from '../src/classroom';

type Listener = (event: unknown) => void;

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static last: FakeEventSource | undefined;

  readyState = FakeEventSource.CONNECTING;
  readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function open(overrides: Partial<Parameters<typeof openClassroomStream>[0]> = {}) {
  const events: StreamEvent[] = [];
  const stream = openClassroomStream({
    EventSource: FakeEventSource as unknown as typeof EventSource,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  const source = FakeEventSource.last;
  if (!source) throw new Error('EventSource não foi criado');
  return { stream, source, events };
}

describe('openClassroomStream', () => {
  it('os nomes gerados cobrem exatamente a união StreamEvent do contrato', () => {
    expectTypeOf<(typeof streamEventNames)[number]>().toEqualTypeOf<StreamEventName>();
    expectTypeOf<StreamEventOf<'presence'>>().toEqualTypeOf<
      ClassroomSchemas['StreamEventPresence']
    >();
    expect(streamEventNames).toContain('dm.message.created');
    expect(streamEventNames).toContain('ping');
  });

  it('abre o fluxo do contrato com o cookie de sessão e escuta todos os eventos', () => {
    const { source } = open({ baseUrl: 'http://classroom.test' });

    expect(source.url).toBe('http://classroom.test/api/v1/stream');
    expect(source.init).toEqual({ withCredentials: true });
    for (const name of streamEventNames) expect(source.listeners.has(name)).toBe(true);
  });

  it('usa a origem da página quando não há baseUrl', () => {
    expect(open().source.url).toBe('/api/v1/stream');
  });

  it('entrega o evento com id, nome e data lido do JSON', () => {
    const { source, events } = open();
    const data = {
      conversationId: '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70',
      messageId: '0193a5b2-8e2f-7a11-b0c3-5d7e9f1a2b3c',
    };

    source.emit('dm.message.created', { data: JSON.stringify(data), lastEventId: '42' });

    expect(events).toEqual([{ id: '42', event: 'dm.message.created', data }]);
    const [event] = events;
    if (event?.event === 'dm.message.created') {
      expectTypeOf(event.data.conversationId).toBeString();
    }
  });

  it('entrega ping sem id, mesmo com Last-Event-ID anterior', () => {
    const { source, events } = open();

    source.emit('ping', { data: '{}', lastEventId: '42' });

    expect(events).toEqual([{ event: 'ping', data: {} }]);
  });

  it('descarta evento com data inválido e avisa', () => {
    const invalid: unknown[] = [];
    const { source, events } = open({ onInvalidEvent: (info) => invalid.push(info) });

    source.emit('presence', { data: '{quebrado', lastEventId: '7' });

    expect(events).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ event: 'presence', data: '{quebrado' });
  });

  it('informa abertura, queda com reconexão e encerramento definitivo', () => {
    const log: string[] = [];
    const { source, stream } = open({
      onOpen: () => log.push('open'),
      onError: ({ closed }) => log.push(closed ? 'closed' : 'reconnecting'),
    });

    source.emit('open');
    source.emit('error');
    source.readyState = FakeEventSource.CLOSED;
    source.emit('error');
    expect(log).toEqual(['open', 'reconnecting', 'closed']);

    source.readyState = FakeEventSource.OPEN;
    stream.close();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });
});
