import {
  businessRule,
  conflict,
  DomainError,
  notFound,
  rateLimited,
  unauthenticated,
} from '@nuva-edu/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ApiAppOptions,
  ContractMismatchError,
  type OperationHandler,
  parseContract,
} from '../src/index.ts';
import { buildApp, type CapturedLogs, fixtureContract } from './helpers.ts';

const ITEM = { id: 1, name: 'Curso', createdAt: '2026-11-24T13:45:00Z' };
const PROBLEM = /^application\/problem\+json(;|$)/;

type Handlers = Partial<
  Record<'listItems' | 'createItem' | 'getItem' | 'deleteItem' | 'login', OperationHandler>
>;

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** App com todas as operações do contrato de teste; cada teste troca as que interessam. */
function fullApp(handlers: Handlers = {}, overrides: Partial<ApiAppOptions> = {}) {
  const { app, logs } = buildApp({
    security: { sessionCookie: () => {}, csrfToken: () => {}, apiKey: () => {} },
    ...overrides,
  });
  apps.push(app);
  app.operation('listItems', handlers.listItems ?? (() => ({ items: [ITEM], nextCursor: null })));
  app.operation(
    'createItem',
    handlers.createItem ??
      ((_request, reply) => {
        reply.status(201);
        return ITEM;
      }),
  );
  app.operation('getItem', handlers.getItem ?? (() => ITEM));
  app.operation(
    'deleteItem',
    handlers.deleteItem ??
      ((_request, reply) => {
        reply.status(204);
      }),
  );
  app.operation(
    'login',
    handlers.login ??
      ((_request, reply) => {
        reply.status(204);
      }),
  );
  return { app, logs };
}

function requestLine(logs: CapturedLogs) {
  return logs.lines.find((line) => line.msg === 'Requisição atendida');
}

describe('sondas', () => {
  it('/healthz responde ok, com X-Request-Id novo', async () => {
    const { app } = fullApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('/readyz responde 200 quando tudo passa', async () => {
    const { app } = fullApp();
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      checks: { database: 'ok', migrations: 'ok' },
    });
  });

  it('/readyz responde 503 e registra o motivo uma vez, e a volta', async () => {
    let migrated = false;
    const { app, logs } = fullApp(
      {},
      {
        readiness: {
          database: () => true,
          migrations: () => migrated || { ok: false, reason: 'banco na migration 1, espera a 2' },
        },
      },
    );
    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'not_ready',
        checks: { database: 'ok', migrations: 'fail' },
      });
    }
    const warnings = logs.lines.filter((line) => line.msg === 'Serviço não está pronto');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: 'warn',
      reasons: { migrations: 'banco na migration 1, espera a 2' },
    });
    migrated = true;
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    expect(logs.lines.some((line) => line.msg === 'Serviço voltou a estar pronto')).toBe(true);
  });

  it('verificação de prontidão fora do contrato é resposta inválida (500)', async () => {
    const { app } = fullApp({}, { readiness: { database: () => true } });
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe('internal_error');
  });

  it('não registra HEAD automático nem rota fora do contrato', async () => {
    const { app } = fullApp();
    expect((await app.inject({ method: 'HEAD', url: '/healthz' })).statusCode).toBe(404);
    expect(app.checkContract({ csrfExceptions: ['login', 'deleteItem'] }).ok).toBe(true);
  });
});

describe('id de requisição e log', () => {
  it('reaproveita o X-Request-Id do proxy e o grava no log da requisição', async () => {
    const { app, logs } = fullApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/items/7?x=1',
      headers: { 'x-request-id': 'traefik-abc.123' },
    });
    expect(response.headers['x-request-id']).toBe('traefik-abc.123');
    const line = requestLine(logs);
    expect(line).toMatchObject({
      level: 'info',
      service: 'api-kit-test',
      request_id: 'traefik-abc.123',
      method: 'GET',
      route: '/api/v1/items/:id',
      status: 200,
      client_ip: '127.0.0.1',
      client_ip_source: 'tcp',
      peer_ip: '127.0.0.1',
    });
    expect(typeof line?.duration_ms).toBe('number');
    expect(typeof line?.time).toBe('string');
  });

  it('troca um X-Request-Id com forma insegura', async () => {
    const { app, logs } = fullApp();
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'injeção "de" log\t' },
    });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(logs.text()).not.toContain('injeção');
  });

  it('sondas só aparecem no log em debug', async () => {
    const { app, logs } = fullApp();
    await app.inject({ method: 'GET', url: '/healthz' });
    expect(requestLine(logs)).toMatchObject({ level: 'debug', route: '/healthz' });
  });

  it('o log da rota (request.log) leva o mesmo request_id', async () => {
    const { app, logs } = fullApp({
      getItem: (request) => {
        request.log.info({ item: 7 }, 'Dentro da rota');
        return ITEM;
      },
    });
    await app.inject({ method: 'GET', url: '/api/v1/items/7', headers: { 'x-request-id': 'r-1' } });
    expect(logs.lines.find((line) => line.msg === 'Dentro da rota')).toMatchObject({
      request_id: 'r-1',
      item: 7,
    });
  });

  it('nunca escreve senha, cookie, token ou consulta no log', async () => {
    const { app, logs } = fullApp({
      login: () => {
        throw new Error('falha inesperada');
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login?token=tok-na-url',
      headers: {
        cookie: 'session=valor-do-cookie',
        authorization: 'Bearer chave-secreta',
        'x-csrf-token': 'csrf-secreto',
      },
      payload: { email: 'ana@example.com', password: 'senha-da-ana' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ana@example.com', password: 12345678 },
    });
    const text = logs.text();
    expect(text).toContain('falha inesperada');
    for (const secret of [
      'senha-da-ana',
      '12345678',
      'valor-do-cookie',
      'chave-secreta',
      'csrf-secreto',
      'tok-na-url',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('IP real', () => {
  it('usa o X-Forwarded-For quando a conexão vem de proxy confiável', async () => {
    const seen: unknown[] = [];
    const { app, logs } = fullApp({
      getItem: (request) => {
        seen.push(request.client, request.ip);
        return ITEM;
      },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/items/1',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '6.6.6.6, 45.80.10.20, 10.0.0.9' },
    });
    expect(seen).toEqual([
      { ip: '45.80.10.20', source: 'x-forwarded-for', peerIp: '10.0.0.5' },
      '45.80.10.20',
    ]);
    expect(requestLine(logs)).toMatchObject({
      client_ip: '45.80.10.20',
      client_ip_source: 'x-forwarded-for',
      peer_ip: '10.0.0.5',
    });
  });

  it('ignora cabeçalho forjado de conexão fora de TRUSTED_PROXIES', async () => {
    const { app, logs } = fullApp();
    await app.inject({
      method: 'GET',
      url: '/api/v1/items/1',
      remoteAddress: '45.80.10.20',
      headers: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' },
    });
    expect(requestLine(logs)).toMatchObject({
      client_ip: '45.80.10.20',
      client_ip_source: 'tcp',
      peer_ip: '45.80.10.20',
    });
  });

  it('falha na criação com TRUSTED_PROXIES inválido', () => {
    expect(() => buildApp({ trustedProxies: ['10.0.0.0/8', 'abc'] })).toThrow(/"abc"/);
  });
});

describe('validação da requisição', () => {
  it('converte parâmetros e entrega o padrão à rota', async () => {
    const seen: unknown[] = [];
    const { app } = fullApp({
      listItems: (request) => {
        seen.push(request.query);
        return { items: [], nextCursor: null };
      },
      getItem: (request) => {
        seen.push(request.params);
        return ITEM;
      },
    });
    await app.inject({ method: 'GET', url: '/api/v1/items?tag=a&tag=b' });
    await app.inject({ method: 'GET', url: '/api/v1/items/42' });
    expect(seen).toEqual([{ limit: 25, tag: ['a', 'b'] }, { id: 42 }]);
  });

  it('responde 400 validation_failed em problem+json, com os campos', async () => {
    const { app, logs } = fullApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/items?limit=0',
      headers: { 'x-request-id': 'req-400' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(PROBLEM);
    expect(response.headers['x-request-id']).toBe('req-400');
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Dados inválidos',
      status: 400,
      code: 'validation_failed',
      detail: 'A requisição não confere com o contrato da API.',
      instance: '/api/v1/items',
      errors: [{ path: 'query.limit', message: 'Deve ser maior ou igual a 1.' }],
    });
    expect(requestLine(logs)).toMatchObject({ status: 400, error_code: 'validation_failed' });
    // Recusa prevista não é erro do serviço: nada em nível error.
    expect(logs.lines.some((line) => line.level === 'error')).toBe(false);
  });

  it('valida o corpo e não chama a rota quando ele é recusado', async () => {
    let called = false;
    const { app } = fullApp({
      createItem: () => {
        called = true;
        return ITEM;
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      payload: { name: 'x', outro: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual([
      { path: 'body.outro', message: 'Campo não aceito.' },
      { path: 'body.name', message: 'Deve ter no mínimo 2 caracteres.' },
    ]);
    expect(called).toBe(false);
  });

  it('corpo ausente e JSON malformado são 400; tipo não aceito é 415; corpo grande demais é 413', async () => {
    const { app } = fullApp({}, { bodyLimit: 200 });
    const post = (headers: Record<string, string>, payload?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/items',
        headers,
        ...(payload ? { payload } : {}),
      });

    const absent = await post({});
    const malformed = await post({ 'content-type': 'application/json' }, '{"name": ');
    for (const response of [absent, malformed]) {
      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toMatch(PROBLEM);
      expect(response.json().code).toBe('validation_failed');
      expect(response.json().errors[0].path).toBe('body');
    }
    expect(absent.json().errors[0].message).toBe('O corpo da requisição é obrigatório.');
    expect(malformed.json().errors[0].message).toBe('O corpo não é um JSON válido.');

    // `text/plain` o Fastify sabe ler, mas a operação não declara; `application/xml` nem ele lê.
    const wrongType = await post({ 'content-type': 'text/plain' }, 'nome');
    const unknownType = await post({ 'content-type': 'application/xml' }, '<a/>');
    for (const response of [wrongType, unknownType]) {
      expect(response.statusCode).toBe(415);
      expect(response.headers['content-type']).toMatch(PROBLEM);
      expect(response.json()).toMatchObject({ status: 415, code: 'unsupported_media_type' });
      expect(response.json().errors).toBeUndefined();
    }
    expect(wrongType.json().detail).toBe('Tipo de conteúdo não aceito. Use application/json.');

    const tooLarge = await post(
      { 'content-type': 'application/json' },
      JSON.stringify({ name: 'a'.repeat(300) }),
    );
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.headers['content-type']).toMatch(PROBLEM);
    expect(tooLarge.json()).toMatchObject({
      status: 413,
      code: 'payload_too_large',
      detail: 'O corpo da requisição passa do tamanho permitido.',
    });
  });

  it('413 e 415 chegam ao cliente mesmo sem estarem declarados na operação, e a rota não roda', async () => {
    let called = false;
    const { app, logs } = fullApp(
      {
        createItem: () => {
          called = true;
          return ITEM;
        },
      },
      { bodyLimit: 200 },
    );
    // O contrato de teste é como os reais antes da tarefa 029: sem 413 nem 415 em `createItem`.
    expect(Object.keys(app.contract.operation('createItem').responses)).not.toContain('413');
    expect(Object.keys(app.contract.operation('createItem').responses)).not.toContain('415');

    const tooLarge = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'a'.repeat(300) }),
    });
    const wrongType = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: { 'content-type': 'text/plain' },
      payload: 'nome',
    });
    expect([tooLarge.statusCode, wrongType.statusCode]).toEqual([413, 415]);
    expect(called).toBe(false);
    expect(logs.lines.some((line) => line.level === 'error')).toBe(false);
    // O log da requisição leva o código, para o painel separar do `validation_failed`.
    expect(
      logs.lines.filter((line) => line.msg === 'Requisição atendida').map((l) => l.error_code),
    ).toEqual(['payload_too_large', 'unsupported_media_type']);
  });

  it('Content-Length divergente e corpo vazio com application/json são 400 validation_failed', async () => {
    const { app } = fullApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const empty = await fetch(`http://127.0.0.1:${port}/api/v1/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'body' }],
    });

    // Corpo menor do que o Content-Length anunciado, com a escrita encerrada pelo cliente.
    const { connect } = await import('node:net');
    const send = (text: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => socket.end(text));
        let data = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
          data += chunk;
        });
        socket.on('close', () => resolve(data));
        socket.on('error', reject);
      });
    const raw = await send(
      'POST /api/v1/items HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n' +
        'Content-Length: 40\r\nConnection: close\r\n\r\n{"name":"a"}',
    );
    expect(raw).toMatch(/^HTTP\/1\.1 400 /);
    expect(raw).toContain('"code":"validation_failed"');
    expect(raw).toContain('"path":"body"');
    expect(raw).toMatch(/\r\nContent-Type: application\/problem\+json\r\n/);
    expect(raw).toMatch(/\r\nX-Request-Id: [\w-]+\r\n/);

    // HTTP que o Node nem consegue ler: mesma resposta, sem campo apontado.
    const garbage = await send('ISTO NAO E HTTP\r\n\r\n');
    expect(garbage).toMatch(/^HTTP\/1\.1 400 /);
    expect(garbage).toContain('"code":"validation_failed"');
    expect(garbage).toContain('"errors":[]');

    // O mesmo erro visto pelo Fastify (requisição injetada, sem o analisador HTTP do Node).
    const injected = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: { 'content-type': 'application/json', 'content-length': '40' },
      payload: '{"name":"a"}',
    });
    expect(injected.statusCode).toBe(400);
    expect(injected.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'body', message: 'O Content-Length não confere com o corpo enviado.' }],
    });
  });

  it('bodyLimit por operação vale no lugar do padrão', async () => {
    const { app, logs } = buildApp({
      bodyLimit: 50,
      security: { sessionCookie: () => {}, csrfToken: () => {}, apiKey: () => {} },
    });
    apps.push(app);
    app.operation('createItem', (_request, reply) => reply.status(201).send(ITEM), {
      bodyLimit: 10_000,
    });
    app.operation('listItems', () => ({ items: [], nextCursor: null }));
    app.operation('getItem', () => ITEM);
    app.operation('deleteItem', (_request, reply) => reply.status(204).send());
    app.operation('login', (_request, reply) => reply.status(204).send());
    const payload = { name: 'Curso', tags: Array.from({ length: 30 }, (_, i) => `tag-${i}`) };
    const response = await app.inject({ method: 'POST', url: '/api/v1/items', payload });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(ITEM);
    expect(logs.lines.some((line) => line.level === 'error')).toBe(false);
    // O padrão do serviço continua valendo nas outras operações.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ana@example.com', password: 'x'.repeat(100) },
    });
    expect(login.statusCode).toBe(413);
  });
});

describe('validação da resposta', () => {
  it('resposta fora do esquema vira 500 internal_error e vai para o log', async () => {
    const { app, logs } = fullApp({
      getItem: () => ({ id: 1, name: 'Curso', password: 'senha-da-ana' }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/items/1' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toMatch(PROBLEM);
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Erro interno',
      status: 500,
      code: 'internal_error',
      instance: '/api/v1/items/1',
    });
    const error = logs.lines.find((line) => line.level === 'error');
    expect(error).toMatchObject({
      msg: 'Erro ao atender a requisição',
      operation: 'getItem',
      error_code: 'internal_error',
      err: { type: 'ResponseContractError', reason: 'schema_mismatch' },
    });
    expect(JSON.stringify(error)).toContain('additionalProperties (password)');
    expect(logs.text()).not.toContain('senha-da-ana');
  });

  it('status que o contrato não declara vira 500', async () => {
    const { app } = fullApp({
      getItem: (_request, reply) => {
        reply.status(202);
        return ITEM;
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/items/1' });
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe('internal_error');
  });

  it('resposta sem corpo onde o contrato exige corpo vira 500, e 204 sem corpo passa', async () => {
    const { app } = fullApp({
      getItem: (_request, reply) => {
        reply.status(204);
      },
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/items/1' })).statusCode).toBe(500);
    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/items/1' });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');
  });

  it('corpo onde o contrato não tem corpo vira 500', async () => {
    const { app } = fullApp({
      deleteItem: (_request, reply) => {
        reply.status(204);
        return { removed: true };
      },
    });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/items/1' })).statusCode).toBe(500);
  });
});

describe('erros', () => {
  it('DomainError sai com o próprio código e status', async () => {
    const { app } = fullApp({
      getItem: () => {
        throw notFound('Item não existe.');
      },
      createItem: () => {
        throw businessRule('item_limit_reached', 'Limite de itens atingido.');
      },
    });
    const missing = await app.inject({ method: 'GET', url: '/api/v1/items/9?secret=1' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toMatch(PROBLEM);
    expect(missing.json()).toEqual({
      type: 'about:blank',
      title: 'Não encontrado',
      status: 404,
      code: 'not_found',
      detail: 'Item não existe.',
      instance: '/api/v1/items/9',
    });
    const rule = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      payload: { name: 'Curso' },
    });
    expect(rule.statusCode).toBe(422);
    expect(rule.json().code).toBe('item_limit_reached');
  });

  it('rate_limited leva Retry-After', async () => {
    const { app } = fullApp({
      createItem: () => {
        throw rateLimited(17);
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      payload: { name: 'Curso' },
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('17');
    expect(response.json()).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 17 });
  });

  it('erro inesperado vira 500 sem detalhe; o original vai para o log com a pilha', async () => {
    const { app, logs } = fullApp({
      getItem: () => {
        throw new TypeError('coluna "oculta" não existe');
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/items/1' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('oculta');
    expect(response.json().code).toBe('internal_error');
    const error = logs.lines.find((line) => line.level === 'error') as
      | { err?: { type?: string; stack?: string }; request_id?: string }
      | undefined;
    expect(error?.err?.type).toBe('TypeError');
    expect(error?.err?.stack).toContain('coluna "oculta" não existe');
    expect(error?.request_id).toBe(response.headers['x-request-id']);
  });

  it('banco fora do ar vira 503 database_unavailable', async () => {
    const { app } = fullApp({
      listItems: () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
          code: 'ECONNREFUSED',
        });
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/items' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'database_unavailable', status: 503 });
  });

  it('erro com status que o contrato não declara chega ao cliente, com aviso no log', async () => {
    const { app, logs } = fullApp({
      getItem: () => {
        throw conflict('version_conflict');
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/items/1' });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('version_conflict');
    expect(
      logs.lines.find(
        (line) => line.msg === 'Resposta de erro com status que o contrato não declara',
      ),
    ).toMatchObject({ level: 'warn', operation: 'getItem', status: 409 });
  });

  it('rota inexistente responde 404 not_found em problem+json, com X-Request-Id', async () => {
    const { app, logs } = fullApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/nada?x=1' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(PROBLEM);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.json()).toMatchObject({ code: 'not_found', instance: '/api/v1/nada' });
    expect(requestLine(logs)).toMatchObject({ route: 'unmatched', status: 404 });
  });
});

describe('segurança (pontos de extensão)', () => {
  it('roda sessão antes do CSRF, e os dois antes da validação e da rota', async () => {
    const calls: string[] = [];
    const { app } = fullApp(
      {
        createItem: (_request, reply) => {
          calls.push('rota');
          reply.status(201);
          return ITEM;
        },
      },
      {
        security: {
          sessionCookie: (_request, context) => {
            calls.push(`${context.scheme}:${context.operation.operationId}`);
          },
          csrfToken: (request) => {
            calls.push('csrfToken');
            if (request.headers['x-csrf-token'] !== 'certo') {
              throw new DomainError({
                code: 'csrf_token_invalid',
                status: 403,
                title: 'Token CSRF inválido',
              });
            }
          },
          apiKey: () => {},
        },
      },
    );
    // Corpo inválido e sem token: a recusa é 403, não 400 (spec 003).
    const refused = await app.inject({ method: 'POST', url: '/api/v1/items', payload: {} });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('csrf_token_invalid');
    expect(calls).toEqual(['sessionCookie:createItem', 'csrfToken']);

    calls.length = 0;
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: { 'x-csrf-token': 'certo' },
      payload: { name: 'Curso' },
    });
    expect(accepted.statusCode).toBe(201);
    expect(calls).toEqual(['sessionCookie:createItem', 'csrfToken', 'rota']);
  });

  it('sem sessão responde 401 e não chega à rota', async () => {
    let called = false;
    const { app } = fullApp(
      {
        getItem: () => {
          called = true;
          return ITEM;
        },
      },
      {
        security: {
          sessionCookie: () => {
            throw unauthenticated();
          },
          csrfToken: () => {},
          apiKey: () => {},
        },
      },
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/items/abc' });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('unauthenticated');
    expect(called).toBe(false);
    // Operação pública não passa pelo tratador.
    expect((await app.inject({ method: 'GET', url: '/api/v1/items' })).statusCode).toBe(200);
  });

  it('basta uma alternativa do security; se nenhuma passar, vale o erro da primeira', async () => {
    let keyOk = true;
    const { app } = fullApp(
      {},
      {
        security: {
          sessionCookie: () => {
            throw unauthenticated('Sem sessão.');
          },
          csrfToken: () => {},
          apiKey: () => {
            if (!keyOk) {
              throw unauthenticated('Chave inválida.');
            }
          },
        },
      },
    );
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/items/1' })).statusCode).toBe(204);
    keyOk = false;
    const refused = await app.inject({ method: 'DELETE', url: '/api/v1/items/1' });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().detail).toBe('Sem sessão.');
  });

  it('recusa registrar operação cujo esquema de segurança não tem tratador', () => {
    const { app } = buildApp();
    apps.push(app);
    expect(() => app.operation('getItem', () => ITEM)).toThrow(
      /"getItem" exige o esquema de segurança "sessionCookie"/,
    );
    // Operação pública não precisa de tratador nenhum.
    expect(() => app.operation('listItems', () => ({ items: [], nextCursor: null }))).not.toThrow();
  });
});

describe('/metrics', () => {
  it('expõe as métricas HTTP por rota, método e status, sem contar a si mesma', async () => {
    const { app } = fullApp();
    await app.inject({ method: 'GET', url: '/api/v1/items/1' });
    await app.inject({ method: 'GET', url: '/api/v1/items/2' });
    await app.inject({ method: 'GET', url: '/api/v1/items/abc' });
    await app.inject({ method: 'GET', url: '/qualquer/coisa' });
    await app.inject({ method: 'GET', url: '/metrics' });
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    const text = response.body;
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/v1/items/:id",status="200"} 2',
    );
    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/v1/items/:id",status="400"} 1',
    );
    expect(text).toContain('http_requests_total{method="GET",route="unmatched",status="404"} 1');
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/v1/items/:id"} 3',
    );
    expect(text).toContain('process_resident_memory_bytes');
    expect(text).not.toContain('route="/metrics"');
  });

  it('permite às APIs registrar as próprias métricas', async () => {
    const { app } = fullApp();
    app.metrics
      .counter({ name: 'login_attempts_total', help: 'Tentativas.' })
      .inc({ outcome: 'ok' });
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toContain('login_attempts_total{outcome="ok"} 1');
  });

  it('responde 404 a quem chega pelo proxy ou de fora da rede interna', async () => {
    const { app } = fullApp();
    const viaProxy = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '45.80.10.20' },
    });
    const viaHost = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { 'x-forwarded-host': 'edu-admin.exemplo.com' },
    });
    const fromOutside = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '45.80.10.20',
    });
    for (const response of [viaProxy, viaHost, fromOutside]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('not_found');
      expect(response.body).not.toContain('http_requests_total');
    }
    const internal = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '172.18.0.9',
    });
    expect(internal.statusCode).toBe(200);
  });
});

describe('contrato na subida', () => {
  it('sobe quando toda operação tem rota', async () => {
    const { app } = fullApp();
    await expect(app.ready()).resolves.toBeDefined();
  });

  it('não sobe com operação do contrato sem rota', async () => {
    const { app } = buildApp();
    apps.push(app);
    app.operation('listItems', () => ({ items: [], nextCursor: null }));
    const failure = await app.ready().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ContractMismatchError);
    expect((failure as ContractMismatchError).message).toContain(
      'operação do contrato sem rota: POST /api/v1/items',
    );
    expect((failure as ContractMismatchError).report.operationsMissingInApp).toHaveLength(4);
  });

  it('não sobe com rota registrada fora do contrato', async () => {
    const { app } = fullApp();
    app.get('/api/v1/atalho', () => ({ ok: true }));
    await expect(app.ready()).rejects.toThrow(
      'rota registrada fora do contrato: GET /api/v1/atalho',
    );
  });

  it('aceita rota interna declarada pelo serviço', async () => {
    const { app } = fullApp({}, { internalRoutes: ['POST /mcp'] });
    app.post('/mcp', () => ({ ok: true }));
    await expect(app.ready()).resolves.toBeDefined();
  });

  it('registrar duas vezes a mesma operação falha', () => {
    const { app } = fullApp();
    expect(() => app.operation('listItems', () => ({ items: [], nextCursor: null }))).toThrow();
  });

  it('checkContract devolve o relatório para o teste de contrato', () => {
    const { app } = fullApp();
    expect(app.registeredRoutes()).toContainEqual({ method: 'GET', path: '/metrics' });
    const report = app.checkContract();
    expect(report.writesWithoutCsrf).toEqual(['deleteItem', 'login']);
    expect(report.routesMissingInContract).toEqual([]);
  });
});

describe('operação pendente (x-nuva-pending) no serviço', () => {
  const PENDING_INFO = 'Operações do contrato com x-nuva-pending ainda sem rota';
  const PENDING_WARNING =
    'Operações com x-nuva-pending já têm rota: a marca precisa sair do contrato';

  /** O contrato de teste com `getItem` e `deleteItem` marcadas como pendentes. */
  function pendingContract() {
    const document = structuredClone(fixtureContract().document) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    for (const method of ['get', 'delete']) {
      const operation = document.paths['/api/v1/items/{id}']?.[method];
      if (operation) {
        operation['x-nuva-pending'] = true;
      }
    }
    return parseContract(document, 'pendente.yaml');
  }

  /** App sem as rotas das operações pendentes. */
  function appWithoutPendingRoutes() {
    const { app, logs } = buildApp({
      contract: pendingContract(),
      security: { sessionCookie: () => {}, csrfToken: () => {}, apiKey: () => {} },
    });
    apps.push(app);
    app.operation('listItems', () => ({ items: [ITEM], nextCursor: null }));
    app.operation('createItem', (_request, reply) => reply.status(201).send(ITEM));
    app.operation('login', (_request, reply) => reply.status(204).send());
    return { app, logs };
  }

  it('sem rota: o serviço sobe, só informa no log, e o teste de contrato passa', async () => {
    const { app, logs } = appWithoutPendingRoutes();
    await expect(app.ready()).resolves.toBeDefined();
    expect(logs.lines.find((line) => line.msg === PENDING_INFO)).toMatchObject({
      level: 'info',
      operations: ['DELETE /api/v1/items/{id}', 'GET /api/v1/items/{id}'],
    });
    expect(logs.lines.some((line) => line.level === 'warn')).toBe(false);

    const report = app.checkContract({ csrfExceptions: ['deleteItem', 'login'] });
    expect(report.ok).toBe(true);
    expect(report.operationsMissingInApp).toEqual([]);
  });

  it('com rota: o serviço sobe, com aviso no log da subida e a cada checkContract', async () => {
    const { app, logs } = fullApp({}, { contract: pendingContract() });
    await expect(app.ready()).resolves.toBeDefined();
    const warnings = () => logs.lines.filter((line) => line.msg === PENDING_WARNING);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatchObject({
      level: 'warn',
      operations: ['DELETE /api/v1/items/{id}', 'GET /api/v1/items/{id}'],
    });
    expect(logs.lines.some((line) => line.msg === PENDING_INFO)).toBe(false);

    const report = app.checkContract({ csrfExceptions: ['deleteItem', 'login'] });
    expect(report.ok).toBe(true);
    expect(report.pendingWithRoute).toHaveLength(2);
    expect(warnings()).toHaveLength(2);

    // A rota de uma operação pendente atende como qualquer outra.
    const response = await app.inject({ method: 'GET', url: '/api/v1/items/1' });
    expect(response.statusCode).toBe(200);
  });

  it('requisição para operação pendente sem rota responde 404 not_found', async () => {
    const { app } = appWithoutPendingRoutes();
    for (const method of ['GET', 'DELETE'] as const) {
      const response = await app.inject({ method, url: '/api/v1/items/1' });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toMatch(PROBLEM);
      expect(response.json()).toMatchObject({
        status: 404,
        code: 'not_found',
        instance: '/api/v1/items/1',
      });
    }
  });

  it('checkContract com allowPending: false recusa as pendentes (check-contract --no-pending)', () => {
    const { app } = appWithoutPendingRoutes();
    const report = app.checkContract({
      csrfExceptions: ['deleteItem', 'login'],
      allowPending: false,
    });
    expect(report.ok).toBe(false);
    expect(report.pendingNotAllowed).toEqual([
      'DELETE /api/v1/items/{id}',
      'GET /api/v1/items/{id}',
    ]);
  });
});
