import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { startServer } from '../src/index.ts';
import { buildApp, READY } from './helpers.ts';

function readyApp() {
  const built = buildApp({
    readiness: READY,
    security: { sessionCookie: () => {}, csrfToken: () => {}, apiKey: () => {} },
  });
  const { app } = built;
  app.operation('listItems', () => ({ items: [], nextCursor: null }));
  app.operation('createItem', (_request, reply) => reply.status(201).send({}));
  app.operation('getItem', async () => {
    // Requisição lenta: o encerramento precisa esperar por ela.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { id: 1, name: 'Curso', createdAt: '2026-11-24T13:45:00Z' };
  });
  app.operation('deleteItem', (_request, reply) => reply.status(204).send());
  app.operation('login', (_request, reply) => reply.status(204).send());
  return built;
}

function exitRecorder() {
  let resolve: (code: number) => void = () => {};
  const exited = new Promise<number>((done) => {
    resolve = done;
  });
  return { exit: (code: number) => resolve(code), exited };
}

describe('startServer', () => {
  it('atende de verdade e encerra limpo no SIGTERM, esperando a requisição em curso', async () => {
    const { app, logs } = readyApp();
    const signals = new EventEmitter();
    const { exit, exited } = exitRecorder();
    const closed: string[] = [];
    app.addHook('onClose', async () => {
      closed.push('banco fechado');
    });

    const server = await startServer(app, { port: 0, host: '127.0.0.1', process: signals, exit });
    expect(server.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const health = await fetch(`${server.address}/healthz`);
    expect(health.status).toBe(200);
    expect(health.headers.get('x-request-id')).toBeTruthy();

    const slow = fetch(`${server.address}/api/v1/items/1`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    signals.emit('SIGTERM');
    signals.emit('SIGTERM');

    expect(await exited).toBe(0);
    expect((await slow).status).toBe(200);
    expect(closed).toEqual(['banco fechado']);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    const messages = logs.lines.map((line) => line.msg);
    expect(messages.filter((msg) => msg === 'Sinal recebido; encerrando o serviço')).toHaveLength(
      1,
    );
    expect(messages).toContain('Serviço encerrado');
    await expect(fetch(`${server.address}/healthz`)).rejects.toThrow();
  });

  it('sai com 1 quando o encerramento passa do prazo', async () => {
    const { app, logs } = readyApp();
    const signals = new EventEmitter();
    const { exit, exited } = exitRecorder();
    let release: () => void = () => {};
    app.addHook('onClose', () => new Promise<void>((resolve) => (release = resolve)));

    await startServer(app, {
      port: 0,
      host: '127.0.0.1',
      process: signals,
      exit,
      shutdownTimeoutMs: 50,
    });
    signals.emit('SIGINT');
    expect(await exited).toBe(1);
    expect(logs.lines.at(-1)).toMatchObject({
      level: 'error',
      msg: 'Encerramento passou do prazo; saindo à força',
    });
    release();
  });

  it('close() encerra sem terminar o processo', async () => {
    const { app } = readyApp();
    const signals = new EventEmitter();
    const codes: number[] = [];
    const server = await startServer(app, {
      port: 0,
      host: '127.0.0.1',
      process: signals,
      exit: (code) => codes.push(code),
    });
    await server.close();
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(codes).toEqual([]);
  });

  it('não sobe com contrato e rotas divergentes', async () => {
    const { app } = buildApp();
    const signals = new EventEmitter();
    await expect(
      startServer(app, { port: 0, host: '127.0.0.1', process: signals, exit: () => {} }),
    ).rejects.toThrow(/Contrato e rotas divergem/);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    await app.close();
  });
});
