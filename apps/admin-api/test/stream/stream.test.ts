import { USER_EVENTS_CHANNEL } from '@nuva-edu/core';
import { connect, loadConfig } from '@nuva-edu/database';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type AdminAppOptions, userEventStream } from '../../src/app.ts';
import { type Actor, createActor, deniedBy } from '../actors.ts';
import { createTestApp, type TestApp } from '../helpers.ts';
import { openSse, type SseConnection } from './sse-client.ts';

const ALICE = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
const NOTIFICATION = '0193a5b2-ab4c-7d33-9e25-7f9a1b3c5d6e';
const CONVERSATION = '0193a5b2-9a3b-7c22-8d14-6e8f0a2b4c5d';

/** Carga `data` válida pelo `StreamEvent` do contrato. */
const CREATED = { notificationId: NOTIFICATION, type: 'ticket.opened', unreadCount: 1 };

interface Served extends TestApp {
  url: string;
  connect(actor: Actor, headers?: Record<string, string>): Promise<SseConnection>;
}

const opened: TestApp[] = [];
const connections: SseConnection[] = [];
let publisher: Awaited<ReturnType<typeof connect>>;

/** A API escutando numa porta de verdade, com a escuta do canal já ativa. */
async function serve(
  overrides: Partial<AdminAppOptions> = {},
  env: Record<string, string> = {},
): Promise<Served> {
  const test = createTestApp(env, overrides);
  opened.push(test);
  const address = await test.app.listen({ port: 0, host: '127.0.0.1' });
  const url = `${address}/api/v1/stream`;
  return {
    ...test,
    url,
    connect: async (actor, headers = {}) => {
      const connection = await openSse(url, {
        cookie: `nuva_admin_session=${actor.cookie}`,
        ...headers,
      });
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
  publisher = await connect(loadConfig());
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
  it('responde 401 em problem+json, sem abrir conexão', async () => {
    const test = createTestApp();
    opened.push(test);
    const response = await test.app.inject({
      method: 'GET',
      url: '/api/v1/stream',
      headers: { cookie: 'nuva_admin_session=qualquer' },
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

describe('GET /api/v1/stream com sessão', () => {
  let api: Served;
  beforeAll(async () => {
    api = await serve();
    await userEventStream(api.app).whenListening();
  });

  it('sessão apenas student recebe 403 permission_denied, com a negação na auditoria', async () => {
    const student = await createActor(api, 'student');
    const response = await fetch(api.url, {
      headers: { cookie: `nuva_admin_session=${student.cookie}` },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({
      status: 403,
      code: 'permission_denied',
      instance: '/api/v1/stream',
    });
    expect(userEventStream(api.app).hub.connectionCount()).toBe(0);
    const denied = await deniedBy(api, student.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ action: 'admin.access', outcome: 'denied' });
  });

  it('abre o fluxo com os cabeçalhos de SSE, sem compressão nem cache', async () => {
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor, { 'x-request-id': 'req-stream-1' });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(stream.headers.get('cache-control')).toBe('no-store');
    expect(stream.headers.get('x-accel-buffering')).toBe('no');
    expect(stream.headers.get('content-encoding')).toBeNull();
    expect(stream.headers.get('x-request-id')).toBe('req-stream-1');
    await until(() => stream.frames.length > 0);
    expect(stream.frames[0]).toEqual({ comment: 'ok' });
  });

  it('um NOTIFY de notification.created chega em menos de 1 s, no formato do contrato', async () => {
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor);
    await until(() => stream.frames.length > 0);

    const startedAt = performance.now();
    await notify({ userId: actor.id, kind: 'notification.created', id: 42, data: CREATED });
    const frame = await stream.next(1_000);
    const elapsed = performance.now() - startedAt;

    expect(frame).toEqual({
      id: '42',
      event: 'notification.created',
      data: JSON.stringify(CREATED),
    });
    expect(elapsed).toBeLessThan(1_000);
  });

  it('cada conexão só recebe o notification.created do titular da sessão', async () => {
    const alice = await createActor(api, 'manager');
    const bruno = await createActor(api, 'instructor');
    const aliceStream = await api.connect(alice);
    const brunoStream = await api.connect(bruno);
    await until(() => aliceStream.frames.length > 0 && brunoStream.frames.length > 0);

    await notify({
      userId: bruno.id,
      kind: 'notification.created',
      id: 7,
      data: { ...CREATED, type: 'report.created' },
    });
    await notify({ userId: alice.id, kind: 'notification.created', id: 8, data: CREATED });

    expect(await brunoStream.next()).toMatchObject({ id: '7', event: 'notification.created' });
    expect(await aliceStream.next()).toMatchObject({ id: '8', event: 'notification.created' });
    expect(aliceStream.frames).toHaveLength(2);
    expect(brunoStream.frames).toHaveLength(2);
  });

  it('descarta os demais tipos do canal, sem entrega e sem aviso', async () => {
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor);
    await until(() => stream.frames.length > 0);
    const before = api.lines.length;

    await notify({
      userId: actor.id,
      kind: 'dm.message.created',
      id: 10,
      data: { conversationId: CONVERSATION, messageId: NOTIFICATION },
    });
    await notify({
      userId: actor.id,
      kind: 'presence',
      id: 11,
      data: { userId: actor.id, online: true },
    });
    await notify({ userId: actor.id, kind: 'notification.created', id: 12, data: CREATED });

    expect(await stream.next()).toMatchObject({ id: '12' });
    expect(stream.frames).toHaveLength(2);
    expect(
      api.lines
        .slice(before)
        .filter((line) => line.msg === 'Aviso de evento fora do formato; descartado'),
    ).toHaveLength(0);
  });

  it('todas as conexões do mesmo usuário recebem o evento; a quarta derruba a mais antiga', async () => {
    await until(() => api.app.eventStreams.count() === 0);
    const actor = await createActor(api, 'manager');
    const first = await api.connect(actor);
    const second = await api.connect(actor);
    const third = await api.connect(actor);
    expect(userEventStream(api.app).hub.connectionCount()).toBe(3);

    const fourth = await api.connect(actor);
    await first.ended();
    expect(userEventStream(api.app).hub.connectionCount()).toBe(3);

    await notify({ userId: actor.id, kind: 'notification.created', id: 90, data: CREATED });
    for (const stream of [second, third, fourth]) {
      expect(await stream.next()).toMatchObject({ id: '90' });
    }
  });

  it('na reconexão, Last-Event-ID reenvia só o que foi perdido, sem os tipos descartados', async () => {
    await until(() => api.app.eventStreams.count() === 0);
    const actor = await createActor(api, 'manager');
    const before = await api.connect(actor);
    await until(() => before.frames.length > 0);
    await notify({ userId: actor.id, kind: 'notification.created', id: 1, data: CREATED });
    expect(await before.next()).toMatchObject({ id: '1' });
    before.close();
    await until(() => userEventStream(api.app).hub.connectionCount() === 0);

    // Chegam com o cliente desconectado: o do admin é guardado; os dos outros tipos, não.
    await notify({ userId: actor.id, kind: 'notification.created', id: 2, data: CREATED });
    await notify({
      userId: actor.id,
      kind: 'dm.message.created',
      id: 3,
      data: { conversationId: CONVERSATION, messageId: NOTIFICATION },
    });
    await notify({ userId: ALICE, kind: 'notification.created', id: 4, data: CREATED });
    // Barreira: quando o evento 5 chegar a uma conexão nova, os anteriores já foram guardados.
    const barrier = await api.connect(actor);
    await notify({ userId: actor.id, kind: 'notification.created', id: 5, data: CREATED });
    expect(await barrier.next()).toMatchObject({ id: '5' });

    const after = await api.connect(actor, { 'last-event-id': '1' });
    expect(await after.next()).toMatchObject({ id: '2', event: 'notification.created' });
    expect(await after.next()).toMatchObject({ id: '5' });
  });

  it('Last-Event-ID fora do formato do contrato é recusado com 400', async () => {
    const actor = await createActor(api, 'manager');
    const response = await fetch(api.url, {
      headers: { cookie: `nuva_admin_session=${actor.cookie}`, 'last-event-id': 'abc' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('aviso fora do formato é descartado, sem derrubar a escuta nem ir para o log', async () => {
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor);
    await until(() => stream.frames.length > 0);
    await notify('isto-nao-e-json segredo-na-carga');
    await notify({ userId: actor.id, kind: 'tipo.desconhecido', id: 1, data: {} });
    await notify({ userId: 'sem-uuid', kind: 'notification.created', id: 1, data: CREATED });
    await notify({ userId: actor.id, kind: 'notification.created', id: 123, data: CREATED });

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

  it('notification.created que não confere com o StreamEvent do contrato não é entregue', async () => {
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor);
    await until(() => stream.frames.length > 0);
    const before = api.lines.length;
    // Falta `type`, e há um campo que o contrato não descreve.
    await notify({
      userId: actor.id,
      kind: 'notification.created',
      id: 200,
      data: { notificationId: NOTIFICATION, unreadCount: 1, text: 'conteudo-que-nao-pode-vazar' },
    });
    await notify({
      userId: actor.id,
      kind: 'notification.created',
      id: 201,
      data: { notificationId: NOTIFICATION, type: 'ticket.opened', unreadCount: -1 },
    });
    await notify({ userId: actor.id, kind: 'notification.created', id: 202, data: CREATED });

    expect(await stream.next()).toMatchObject({ id: '202' });
    const warnings = api.lines
      .slice(before)
      .filter((line) => line.msg === 'Aviso de evento fora do formato; descartado');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({
      level: 'warn',
      reason: 'contract_mismatch',
      event: 'notification.created',
    });
    expect(api.logText()).not.toContain('conteudo-que-nao-pode-vazar');
    expect(api.logText()).not.toContain(NOTIFICATION);

    // O descartado também não fica guardado para reenvio.
    const again = await api.connect(actor, { 'last-event-id': '199' });
    expect(await again.next()).toMatchObject({ id: '202' });
  });

  it('expõe as conexões abertas em sse_connections', async () => {
    await until(() => api.app.eventStreams.count() === 0);
    const alice = await createActor(api, 'manager');
    const bruno = await createActor(api, 'instructor');
    await api.connect(alice);
    await api.connect(bruno);
    const metrics = await api.app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body.match(/^# TYPE sse_connections gauge$/gm)).toHaveLength(1);
    expect(metrics.body).toContain('sse_connections 2\n');
    expect(api.app.eventStreams.count()).toBe(userEventStream(api.app).hub.connectionCount());
  });

  it('registra o fim do fluxo fechado pelo cliente, com a rota e sem o usuário', async () => {
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor, { 'x-request-id': 'req-stream-log' });
    await until(() => stream.frames.length > 0);
    stream.close();
    await until(() => api.lines.some((line) => line.request_id === 'req-stream-log'));
    const logged = api.lines.filter((line) => line.request_id === 'req-stream-log');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      msg: 'Requisição encerrada pelo cliente',
      route: '/api/v1/stream',
      status: 499,
      aborted: true,
    });
    expect(api.logText()).not.toContain(actor.id);
    const metrics = await api.app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain(
      'http_requests_total{method="GET",route="/api/v1/stream",status="499"}',
    );
  });
});

describe('batimento e encerramento', () => {
  it('envia ping periódico, com data vazio e sem id', async () => {
    const api = await serve({ stream: { pingIntervalMs: 40 } });
    await userEventStream(api.app).whenListening();
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor);
    const first = await stream.next();
    const second = await stream.next();
    expect(first).toEqual({ event: 'ping', data: '{}' });
    expect(second).toEqual({ event: 'ping', data: '{}' });
  });

  it('ao encerrar o serviço, fecha os fluxos abertos em vez de esperar por eles', async () => {
    const api = await serve();
    await userEventStream(api.app).whenListening();
    const actor = await createActor(api, 'manager');
    const stream = await api.connect(actor);
    await until(() => stream.frames.length > 0);

    const startedAt = performance.now();
    await api.app.close();
    await stream.ended();
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(userEventStream(api.app).hub.connectionCount()).toBe(0);
    expect(api.app.eventStreams.count()).toBe(0);
    expect(userEventStream(api.app).isListening()).toBe(false);
  });

  it('sem a escuta do banco responde 503 database_unavailable', async () => {
    const api = await serve({ listenUserEvents: false });
    const actor = await createActor(api, 'manager');
    const response = await fetch(api.url, {
      headers: { cookie: `nuva_admin_session=${actor.cookie}` },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'database_unavailable' });
  });
});
