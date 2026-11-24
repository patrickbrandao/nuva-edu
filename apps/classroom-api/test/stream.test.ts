import { unauthenticated } from '@nuva-edu/core';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ClassroomAppOptions, userEventStream } from '../src/app.ts';
import type { SessionAuthenticator } from '../src/session.ts';
import { USER_EVENTS_CHANNEL } from '../src/stream/events.ts';
import { createTestApp, type TestApp } from './helpers.ts';
import { openSse, type SseConnection } from './sse-client.ts';

const ALICE = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
const BRUNO = '0193a5b2-8e2f-7a11-b0c3-5d7e9f1a2b3c';
const CONVERSATION = '0193a5b2-9a3b-7c22-8d14-6e8f0a2b4c5d';
const MESSAGE = '0193a5b2-ab4c-7d33-9e25-7f9a1b3c5d6e';

/** Sessão falsa, só dos testes: o cabeçalho diz quem é o usuário. */
const fakeSession: SessionAuthenticator = (request) => {
  const userId = request.headers['x-test-user'];
  if (typeof userId !== 'string') {
    throw unauthenticated();
  }
  return { userId };
};

interface Served extends TestApp {
  url: string;
  connect(userId: string, headers?: Record<string, string>): Promise<SseConnection>;
}

const opened: TestApp[] = [];
const connections: SseConnection[] = [];
let publisher: pg.Client;

/** A API escutando numa porta de verdade, com a escuta do canal já ativa. */
async function serve(
  overrides: Partial<ClassroomAppOptions> = {},
  env: Record<string, string> = {},
): Promise<Served> {
  const test = createTestApp(env, { authenticate: fakeSession, ...overrides });
  opened.push(test);
  const address = await test.app.listen({ port: 0, host: '127.0.0.1' });
  const url = `${address}/api/v1/stream`;
  return {
    ...test,
    url,
    connect: async (userId, headers = {}) => {
      const connection = await openSse(url, { 'x-test-user': userId, ...headers });
      connections.push(connection);
      return connection;
    },
  };
}

function notify(payload: unknown): Promise<unknown> {
  return publisher.query('select pg_notify($1, $2)', [
    USER_EVENTS_CHANNEL,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  ]);
}

async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Condição não atendida em ${timeoutMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  publisher = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await publisher.connect();
});
afterEach(() => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }
});
afterAll(async () => {
  await Promise.all(opened.map((test) => test.close()));
  await publisher.end();
});

describe('GET /api/v1/stream sem sessão', () => {
  it('em produção (tratador padrão) responde 401 em problem+json, mesmo com cookie', async () => {
    const test = createTestApp();
    opened.push(test);
    const response = await test.app.inject({
      method: 'GET',
      url: '/api/v1/stream',
      headers: { cookie: 'nuva_classroom_session=qualquer', 'x-test-user': ALICE },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 401,
      code: 'unauthenticated',
      instance: '/api/v1/stream',
    });
    expect(userEventStream(test.app).hub.connectionCount()).toBe(0);
  });
});

describe('GET /api/v1/stream', () => {
  let api: Served;
  beforeAll(async () => {
    api = await serve();
    await userEventStream(api.app).whenListening();
  });

  it('abre o fluxo com os cabeçalhos de SSE, sem compressão nem cache', async () => {
    const stream = await api.connect(ALICE, { 'x-request-id': 'req-stream-1' });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(stream.headers.get('cache-control')).toBe('no-store');
    expect(stream.headers.get('x-accel-buffering')).toBe('no');
    expect(stream.headers.get('content-encoding')).toBeNull();
    expect(stream.headers.get('x-request-id')).toBe('req-stream-1');
    // Os cabeçalhos chegaram sem esperar o primeiro evento: o comentário de abertura já veio.
    await until(() => stream.frames.length > 0);
    expect(stream.frames[0]).toEqual({ comment: 'ok' });
  });

  it('um NOTIFY no banco chega ao cliente em menos de 1 s, no formato do contrato', async () => {
    const stream = await api.connect(ALICE);
    await until(() => stream.frames.length > 0);

    const startedAt = performance.now();
    await notify({
      userId: ALICE,
      kind: 'dm.message.created',
      id: 42,
      data: { conversationId: CONVERSATION, messageId: MESSAGE },
    });
    const frame = await stream.next(1_000);
    const elapsed = performance.now() - startedAt;

    expect(frame).toEqual({
      id: '42',
      event: 'dm.message.created',
      data: JSON.stringify({ conversationId: CONVERSATION, messageId: MESSAGE }),
    });
    expect(elapsed).toBeLessThan(1_000);
  });

  it('cada cliente só recebe os eventos do próprio usuário', async () => {
    const alice = await api.connect(ALICE);
    const bruno = await api.connect(BRUNO);
    await until(() => alice.frames.length > 0 && bruno.frames.length > 0);

    await notify({ userId: BRUNO, kind: 'presence', id: 7, data: { userId: ALICE, online: true } });
    await notify({ userId: ALICE, kind: 'presence', id: 8, data: { userId: BRUNO, online: true } });

    expect(await bruno.next()).toMatchObject({ id: '7', event: 'presence' });
    expect(await alice.next()).toMatchObject({ id: '8', event: 'presence' });
    // Nada além do comentário de abertura e do próprio evento em cada conexão.
    expect(alice.frames).toHaveLength(2);
    expect(bruno.frames).toHaveLength(2);
  });

  it('todas as conexões do mesmo usuário recebem o evento', async () => {
    const first = await api.connect(ALICE);
    const second = await api.connect(ALICE);
    await until(() => first.frames.length > 0 && second.frames.length > 0);
    await notify({ userId: ALICE, kind: 'forum.post.created', id: 50, data: {} });
    expect(await first.next()).toMatchObject({ id: '50' });
    expect(await second.next()).toMatchObject({ id: '50' });
  });

  it('a quarta conexão do usuário derruba a mais antiga', async () => {
    const first = await api.connect(BRUNO);
    const second = await api.connect(BRUNO);
    const third = await api.connect(BRUNO);
    expect(userEventStream(api.app).hub.connectionCount()).toBe(3);

    const fourth = await api.connect(BRUNO);
    await first.ended();
    expect(userEventStream(api.app).hub.connectionCount()).toBe(3);

    await notify({ userId: BRUNO, kind: 'presence', id: 90, data: {} });
    for (const stream of [second, third, fourth]) {
      expect(await stream.next()).toMatchObject({ id: '90' });
    }
  });

  it('na reconexão, Last-Event-ID reenvia só o que foi perdido', async () => {
    const user = '0193a5b2-bc5d-7e44-af36-8a0b2c4d6e7f';
    const before = await api.connect(user);
    await until(() => before.frames.length > 0);
    await notify({ userId: user, kind: 'presence', id: 1, data: {} });
    expect(await before.next()).toMatchObject({ id: '1' });
    before.close();
    await until(() => userEventStream(api.app).hub.connectionCount() === 0);

    // Chegam com o cliente desconectado.
    await notify({ userId: user, kind: 'presence', id: 2, data: {} });
    await notify({ userId: user, kind: 'notification.created', id: 3, data: {} });
    // Evento de outro usuário entre os dois: nunca é reenviado a este.
    await notify({ userId: ALICE, kind: 'presence', id: 99, data: {} });
    // Barreira: quando o evento 4 chegar a uma conexão nova, os anteriores já foram guardados.
    const barrier = await api.connect(user);
    await notify({ userId: user, kind: 'presence', id: 4, data: {} });
    expect(await barrier.next()).toMatchObject({ id: '4' });

    const after = await api.connect(user, { 'last-event-id': '1' });
    expect(await after.next()).toMatchObject({ id: '2', event: 'presence' });
    expect(await after.next()).toMatchObject({ id: '3', event: 'notification.created' });
    expect(await after.next()).toMatchObject({ id: '4' });

    // Sem o cabeçalho, nada é reenviado.
    const clean = await api.connect(user);
    await until(() => clean.frames.length > 0);
    await notify({ userId: user, kind: 'presence', id: 5, data: {} });
    expect(await clean.next()).toMatchObject({ id: '5' });
  });

  it('Last-Event-ID fora do formato do contrato é recusado com 400', async () => {
    const response = await fetch(api.url, {
      headers: { 'x-test-user': ALICE, 'last-event-id': 'abc' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('aviso fora do formato é descartado, sem derrubar a escuta nem ir para o log', async () => {
    const stream = await api.connect(ALICE);
    await until(() => stream.frames.length > 0);
    await notify('isto-nao-e-json segredo-na-carga');
    await notify({ userId: ALICE, kind: 'tipo.desconhecido', id: 1, data: {} });
    await notify({ userId: 'sem-uuid', kind: 'presence', id: 1, data: {} });
    await notify({ userId: ALICE, kind: 'presence', id: 123, data: {} });

    expect(await stream.next()).toMatchObject({ id: '123' });
    const warnings = api.lines.filter(
      (line) => line.msg === 'Aviso de evento fora do formato; descartado',
    );
    expect(warnings.map((line) => line.reason)).toEqual([
      'invalid_json',
      'unknown_kind',
      'invalid_shape',
    ]);
    expect(api.logText()).not.toContain('segredo-na-carga');
  });

  it('expõe as conexões abertas em sse_connections', async () => {
    await until(() => userEventStream(api.app).hub.connectionCount() === 0);
    await api.connect(ALICE);
    await api.connect(BRUNO);
    const metrics = await api.app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('# TYPE sse_connections gauge');
    expect(metrics.body).toContain('sse_connections 2\n');
  });

  it('registra o fim do fluxo fechado pelo cliente, com a rota e sem o usuário', async () => {
    const stream = await api.connect(ALICE, { 'x-request-id': 'req-stream-log' });
    await until(() => stream.frames.length > 0);
    stream.close();
    await until(() => api.lines.some((line) => line.request_id === 'req-stream-log'));
    expect(api.lines.find((line) => line.request_id === 'req-stream-log')).toMatchObject({
      msg: 'Fluxo SSE encerrado',
      route: '/api/v1/stream',
    });
    expect(api.logText()).not.toContain(ALICE);
  });
});

describe('batimento e encerramento', () => {
  it('envia ping periódico, com data vazio e sem id', async () => {
    const api = await serve({ stream: { pingIntervalMs: 40 } });
    await userEventStream(api.app).whenListening();
    const stream = await api.connect(ALICE);
    const first = await stream.next();
    const second = await stream.next();
    expect(first).toEqual({ event: 'ping', data: '{}' });
    expect(second).toEqual({ event: 'ping', data: '{}' });
  });

  it('ao encerrar o serviço, fecha os fluxos abertos em vez de esperar por eles', async () => {
    const api = await serve();
    await userEventStream(api.app).whenListening();
    const stream = await api.connect(ALICE);
    await until(() => stream.frames.length > 0);

    const startedAt = performance.now();
    await api.app.close();
    await stream.ended();
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(userEventStream(api.app).hub.connectionCount()).toBe(0);
    expect(userEventStream(api.app).isListening()).toBe(false);
  });

  it('sem a escuta do banco responde 503 database_unavailable', async () => {
    // Porta 9 (discard): nada escuta ali, então a escuta nunca fica ativa.
    const api = await serve(
      { readiness: { database: async () => ({ ok: false, reason: 'banco inacessível' }) } },
      { DATABASE_URL: 'postgres://nuva:x@127.0.0.1:9/nuva' },
    );
    const response = await fetch(api.url, { headers: { 'x-test-user': ALICE } });
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'database_unavailable' });
  });
});
