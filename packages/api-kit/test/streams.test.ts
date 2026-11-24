import { connect, type Socket } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_CLOSED_REQUEST_STATUS,
  createEventStreamTracker,
  formatSseComment,
  formatSseEvent,
  parseContract,
  SSE_HEADERS,
} from '../src/index.ts';
import { buildApp, type CapturedLogs, fixtureContract } from './helpers.ts';

const ITEM = { id: 1, name: 'Curso', createdAt: '2026-11-24T13:45:00Z' };

/** O contrato de teste mais `GET /api/v1/stream`, um fluxo SSE público. */
function streamContract() {
  const document = structuredClone(fixtureContract().document) as {
    paths: Record<string, unknown>;
  };
  document.paths['/api/v1/stream'] = {
    get: {
      operationId: 'openStream',
      security: [],
      responses: {
        '200': { description: 'Fluxo.', content: { 'text/event-stream': {} } },
      },
    },
  };
  return parseContract(document, 'stream.yaml');
}

const apps: FastifyInstance[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

interface Listening {
  app: FastifyInstance;
  logs: CapturedLogs;
  port: number;
  /** Fluxos abertos pela rota, na ordem. */
  opened: PassThrough[];
  /** Libera a rota lenta `getItem`. */
  release(): void;
  /** Quantas vezes a rota lenta começou a rodar. */
  entered(): number;
}

async function listen(options: { eventStreams?: boolean } = { eventStreams: true }) {
  const { app, logs } = buildApp({
    contract: streamContract(),
    security: { sessionCookie: () => {}, csrfToken: () => {}, apiKey: () => {} },
    ...options,
  });
  apps.push(app);
  const opened: PassThrough[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.operation('listItems', () => ({ items: [ITEM], nextCursor: null }));
  app.operation('createItem', (_request, reply) => reply.status(201).send(ITEM));
  let entered = 0;
  app.operation('getItem', async () => {
    entered += 1;
    await gate;
    return ITEM;
  });
  app.operation('deleteItem', (_request, reply) => reply.status(204).send());
  app.operation('login', (_request, reply) => reply.status(204).send());
  app.operation('openStream', (_request, reply) => {
    const stream = new PassThrough();
    opened.push(stream);
    stream.write(formatSseComment());
    return app.eventStreams.open(reply, stream);
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, logs, port, opened, release, entered: () => entered } satisfies Listening;
}

/** Abre uma conexão crua e envia um GET; devolve o soquete e o que já chegou. */
async function rawGet(port: number, path: string, waitFor?: string) {
  const socket = connect(port, '127.0.0.1');
  sockets.push(socket);
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    received += chunk;
  });
  socket.on('error', () => {});
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
  if (waitFor !== undefined) {
    await until(() => received.includes(waitFor));
  }
  return { socket, received: () => received };
}

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > limit) {
      throw new Error('condição não atendida no prazo');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const requestLines = (logs: CapturedLogs, route: string) =>
  logs.lines.filter(
    (line) =>
      line.route === route &&
      (line.msg === 'Requisição atendida' || line.msg === 'Requisição encerrada pelo cliente'),
  );

async function metricsText(app: FastifyInstance): Promise<string> {
  return (await app.inject({ method: 'GET', url: '/metrics' })).body;
}

describe('requisição abortada pelo cliente', () => {
  it('registra uma linha de log e conta na métrica HTTP com o status 499', async () => {
    const { app, logs, port, release, entered } = await listen();
    const { socket } = await rawGet(port, '/api/v1/items/1?token=segredo');
    // A rota está parada no `gate`: o cliente desiste antes da resposta.
    await until(() => entered() === 1);
    socket.destroy();
    await until(() => requestLines(logs, '/api/v1/items/:id').length > 0);

    const [line, ...rest] = requestLines(logs, '/api/v1/items/:id');
    expect(rest).toEqual([]);
    expect(CLIENT_CLOSED_REQUEST_STATUS).toBe(499);
    expect(line).toMatchObject({
      msg: 'Requisição encerrada pelo cliente',
      level: 'info',
      method: 'GET',
      route: '/api/v1/items/:id',
      status: 499,
      aborted: true,
      client_ip: '127.0.0.1',
    });
    expect(line?.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof line?.duration_ms).toBe('number');
    expect(logs.text()).not.toContain('segredo');

    // A rota termina depois do aborto: nada é registrado de novo.
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestLines(logs, '/api/v1/items/:id')).toHaveLength(1);
    const metrics = await metricsText(app);
    expect(metrics).toContain(
      'http_requests_total{method="GET",route="/api/v1/items/:id",status="499"} 1',
    );
    expect(metrics).not.toContain('route="/api/v1/items/:id",status="200"');
    expect(metrics).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/v1/items/:id"} 1',
    );
  });

  it('resposta que termina normalmente é registrada uma vez só, mesmo com a conexão fechada depois', async () => {
    const { app, logs, port } = await listen();
    const { socket, received } = await rawGet(port, '/api/v1/items', '"nextCursor":null}');
    expect(received()).toContain('HTTP/1.1 200');
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lines = requestLines(logs, '/api/v1/items');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'Requisição atendida', status: 200 });
    expect(lines[0]?.aborted).toBeUndefined();
    const metrics = await metricsText(app);
    expect(metrics).toContain(
      'http_requests_total{method="GET",route="/api/v1/items",status="200"} 1',
    );
    expect(metrics).not.toContain('status="499"');
  });
});

describe('fluxo SSE (app.eventStreams)', () => {
  it('envia os cabeçalhos de SSE e conta a conexão em sse_connections', async () => {
    const { app, port, opened } = await listen();
    expect(await metricsText(app)).toContain('sse_connections 0');

    const { received } = await rawGet(port, '/api/v1/stream', ': ok\n\n');
    const head = received().toLowerCase();
    expect(received()).toContain('HTTP/1.1 200');
    expect(head).toContain('content-type: text/event-stream');
    expect(head).toContain('cache-control: no-store');
    expect(head).toContain('x-accel-buffering: no');
    expect(head).toContain('x-request-id: ');
    expect(app.eventStreams.count()).toBe(1);
    expect(await metricsText(app)).toContain('sse_connections 1');

    opened[0]?.write(formatSseEvent({ id: 7, event: 'notification.created', data: { id: 'n1' } }));
    await until(() => received().includes('event: notification.created'));
    expect(received()).toContain('id: 7\nevent: notification.created\ndata: {"id":"n1"}\n\n');
  });

  it('cliente que fecha o fluxo: uma linha com status 499, e o medidor volta a zero', async () => {
    const { app, logs, port, opened } = await listen();
    const { socket } = await rawGet(port, '/api/v1/stream', ': ok\n\n');
    socket.destroy();
    await until(() => requestLines(logs, '/api/v1/stream').length > 0);
    await until(() => app.eventStreams.count() === 0);

    expect(requestLines(logs, '/api/v1/stream')).toHaveLength(1);
    expect(requestLines(logs, '/api/v1/stream')[0]).toMatchObject({
      msg: 'Requisição encerrada pelo cliente',
      status: 499,
      aborted: true,
    });
    // O fluxo da rota foi destruído: quem o alimenta para de escrever.
    expect(opened[0]?.destroyed).toBe(true);
    const metrics = await metricsText(app);
    expect(metrics).toContain('sse_connections 0');
    expect(metrics).toContain(
      'http_requests_total{method="GET",route="/api/v1/stream",status="499"} 1',
    );
  });

  it('fluxo que o servidor encerra é uma requisição atendida (200), sem linha de aborto', async () => {
    const { app, logs, port, opened } = await listen();
    const { socket } = await rawGet(port, '/api/v1/stream', ': ok\n\n');
    const ended = new Promise<void>((resolve) => socket.once('end', () => resolve()));
    opened[0]?.end();
    // Fim do corpo em pedaços: o cliente vê a resposta terminar.
    await until(() => requestLines(logs, '/api/v1/stream').length > 0);
    socket.end();
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(requestLines(logs, '/api/v1/stream')).toHaveLength(1);
    expect(requestLines(logs, '/api/v1/stream')[0]).toMatchObject({
      msg: 'Requisição atendida',
      status: 200,
    });
    expect(app.eventStreams.count()).toBe(0);
  });

  it('o encerramento do serviço fecha os fluxos abertos em vez de esperar por eles', async () => {
    const { app, port } = await listen();
    const first = await rawGet(port, '/api/v1/stream', ': ok\n\n');
    const second = await rawGet(port, '/api/v1/stream', ': ok\n\n');
    expect(app.eventStreams.count()).toBe(2);
    const closed = [first, second].map(
      ({ socket }) => new Promise<void>((resolve) => socket.once('close', () => resolve())),
    );

    const startedAt = Date.now();
    await app.close();
    await Promise.all(closed);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(app.eventStreams.count()).toBe(0);
    // O fim chega como término normal do corpo em pedaços.
    expect(first.received().endsWith('0\r\n\r\n')).toBe(true);
  });

  it('sem "eventStreams: true" a base não registra o medidor, e abrir um fluxo é erro', async () => {
    const { app, logs, port } = await listen({});
    expect(await metricsText(app)).not.toContain('sse_connections');
    // O serviço pode manter o próprio medidor (como a classroom-api fazia antes do kit).
    expect(() =>
      app.metrics.gauge({ name: 'sse_connections', help: 'Próprio.', collect: () => 3 }),
    ).not.toThrow();

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/stream`);
    expect(response.status).toBe(500);
    expect(((await response.json()) as { code: string }).code).toBe('internal_error');
    expect(logs.text()).toContain('eventStreams: true');
  });
});

describe('createEventStreamTracker', () => {
  it('conta até o fluxo fechar e não conta duas vezes o mesmo', () => {
    const tracker = createEventStreamTracker();
    const stream = new PassThrough();
    tracker.track(stream);
    tracker.track(stream);
    expect(tracker.count()).toBe(1);
    const destroyed = new PassThrough();
    destroyed.destroy();
    tracker.track(destroyed);
    expect(tracker.count()).toBe(1);
  });

  it('closeAll termina o que tem end() e destrói o que só sabe ler', async () => {
    const tracker = createEventStreamTracker();
    const duplex = new PassThrough();
    const readable = new Readable({ read() {} });
    tracker.track(duplex);
    tracker.track(readable);
    tracker.closeAll();
    expect(tracker.count()).toBe(0);
    expect(duplex.writableEnded).toBe(true);
    expect(readable.destroyed).toBe(true);
  });
});

describe('formatSseEvent', () => {
  it('escreve id, event, retry e data numa linha cada, com linha em branco no fim', () => {
    expect(formatSseEvent({ id: 12, event: 'presence', data: { text: 'a\nb' } })).toBe(
      'id: 12\nevent: presence\ndata: {"text":"a\\nb"}\n\n',
    );
    expect(formatSseEvent({ event: 'ping' })).toBe('event: ping\ndata: {}\n\n');
    expect(formatSseEvent({ retry: 3000, data: [1] })).toBe('retry: 3000\ndata: [1]\n\n');
    expect(formatSseComment()).toBe(': ok\n\n');
    expect(SSE_HEADERS).toEqual({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
  });

  it('recusa quebra de linha em id, event e comentário, e retry inválido', () => {
    expect(() => formatSseEvent({ id: '1\n2' })).toThrow(TypeError);
    expect(() => formatSseEvent({ event: 'a\rdata: x' })).toThrow(TypeError);
    expect(() => formatSseComment('a\nb')).toThrow(TypeError);
    expect(() => formatSseEvent({ retry: -1 })).toThrow(TypeError);
  });
});
