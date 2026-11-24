import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequestState, parseContract } from '../src/index.ts';
import { buildApp, fixtureContract } from './helpers.ts';

interface TestSession {
  userId: string;
}

// O mecanismo de extensão de tipos: a API declara os campos próprios nas interfaces do kit,
// sem importar `fastify`. Nas APIs o módulo é `@nuva-edu/api-kit`.
declare module '../src/app.ts' {
  interface ApiRequestExtensions {
    testSession: TestSession | null;
  }
  interface ApiInstanceExtensions {
    testClock: () => number;
  }
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function appWith(register: (app: FastifyInstance) => void, pendingGetItem = false) {
  const document = structuredClone(fixtureContract().document) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  if (pendingGetItem) {
    for (const method of ['get', 'delete']) {
      const operation = document.paths['/api/v1/items/{id}']?.[method];
      if (operation) {
        operation['x-nuva-pending'] = true;
      }
    }
  }
  const built = buildApp({
    contract: parseContract(document, 'extensao.yaml'),
    security: { sessionCookie: () => {}, csrfToken: () => {}, apiKey: () => {} },
  });
  const { app } = built;
  apps.push(app);
  app.operation('createItem', (_request, reply) => reply.status(201).send({}));
  app.operation('login', (_request, reply) => reply.status(204).send());
  register(app);
  return built;
}

describe('dados da API na requisição', () => {
  it('createRequestState guarda um valor tipado por requisição', async () => {
    const session = createRequestState<TestSession>('session');
    const seen: unknown[] = [];
    const { app } = buildApp({
      security: {
        sessionCookie: (request) => {
          seen.push(session.get(request));
          session.set(request, { userId: String(request.headers['x-user']) });
        },
        csrfToken: () => {},
        apiKey: () => {},
      },
    });
    apps.push(app);
    app.operation('createItem', (_request, reply) => reply.status(201).send({}));
    app.operation('login', (_request, reply) => reply.status(204).send());
    app.operation('deleteItem', (_request, reply) => reply.status(204).send());
    app.operation('listItems', (request) => {
      // Operação pública: ninguém guardou nada.
      seen.push(session.get(request));
      expect(() => session.require(request)).toThrow('Nenhum valor de "session"');
      return { items: [], nextCursor: null };
    });
    app.operation('getItem', (request) => {
      const user: TestSession = session.require(request);
      return { id: 1, name: user.userId, createdAt: '2026-11-24T13:45:00Z' };
    });

    const one = await app.inject({ url: '/api/v1/items/1', headers: { 'x-user': 'ana' } });
    const two = await app.inject({ url: '/api/v1/items/1', headers: { 'x-user': 'bia' } });
    expect(one.json().name).toBe('ana');
    expect(two.json().name).toBe('bia');
    await app.inject({ url: '/api/v1/items' });
    // Cada requisição começa sem valor: nada vaza de uma para a outra.
    expect(seen).toEqual([undefined, undefined, undefined]);
  });

  it('ApiRequestExtensions e ApiInstanceExtensions dão tipo aos campos decorados', async () => {
    const { app } = appWith((instance) => {
      instance.decorate('testClock', () => 42);
      instance.decorateRequest('testSession', null);
      instance.addHook('onRequest', async (request) => {
        request.testSession = { userId: 'ana' };
      });
      instance.operation('listItems', () => ({ items: [], nextCursor: null }));
      instance.operation('deleteItem', (_request, reply) => reply.status(204).send());
      instance.operation('getItem', (request) => {
        // Sem conversão de tipo: os campos existem em FastifyRequest e FastifyInstance.
        const user: TestSession | null = request.testSession;
        const now: number = instance.testClock();
        return { id: now, name: user?.userId ?? '', createdAt: '2026-11-24T13:45:00Z' };
      });
    });
    const response = await app.inject({ url: '/api/v1/items/1' });
    expect(response.json()).toMatchObject({ id: 42, name: 'ana' });
  });
});

describe('operação pendente na subida', () => {
  it('o serviço sobe sem a rota da operação pendente, informa no log e responde 404 nela', async () => {
    const { app, logs } = appWith((instance) => {
      instance.operation('listItems', () => ({ items: [], nextCursor: null }));
    }, true);
    await expect(app.ready()).resolves.toBeDefined();
    expect(logs.lines.some((line) => line.level === 'warn')).toBe(false);
    expect(logs.lines.find((line) => String(line.msg).includes('x-nuva-pending'))).toMatchObject({
      level: 'info',
      msg: 'Operações do contrato com x-nuva-pending ainda sem rota',
      operations: ['DELETE /api/v1/items/{id}', 'GET /api/v1/items/{id}'],
    });
    const response = await app.inject({ url: '/api/v1/items/1' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not_found');
    const report = app.checkContract({ csrfExceptions: ['login', 'deleteItem'] });
    expect(report.ok).toBe(true);
    expect(report.pendingOperations).toHaveLength(2);
  });

  it('com a rota já registrada também sobe, com aviso na subida e no checkContract', async () => {
    const { app, logs } = appWith((instance) => {
      instance.operation('listItems', () => ({ items: [], nextCursor: null }));
      instance.operation('getItem', () => ({}));
      instance.operation('deleteItem', (_request, reply) => reply.status(204).send());
    }, true);
    await expect(app.ready()).resolves.toBeDefined();
    const warnings = () => logs.lines.filter((line) => line.level === 'warn');
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatchObject({
      msg: 'Operações com x-nuva-pending já têm rota: a marca precisa sair do contrato',
      operations: ['DELETE /api/v1/items/{id}', 'GET /api/v1/items/{id}'],
    });
    // O teste de contrato de cada API chama `checkContract`: o aviso sai de novo ali.
    const report = app.checkContract({ csrfExceptions: ['login', 'deleteItem'] });
    expect(report.ok).toBe(true);
    expect(report.pendingWithRoute).toHaveLength(2);
    expect(warnings()).toHaveLength(2);
    expect(app.checkContract({ allowPending: false }).pendingNotAllowed).toHaveLength(2);
  });

  it('operação não pendente sem rota continua impedindo a subida', async () => {
    const { app } = appWith(() => {}, true);
    await expect(app.ready()).rejects.toThrow('operação do contrato sem rota: GET /api/v1/items');
  });
});

describe('esquema avulso do contrato', () => {
  it('app.contractSchema valida um valor contra components.schemas', () => {
    const { app } = buildApp();
    apps.push(app);
    const item = app.contractSchema('Item');
    expect(item({ id: 1, name: 'Curso', createdAt: '2026-11-24T13:45:00Z' })).toEqual([]);
    expect(item({ id: '1', name: 'Curso', extra: true })).toEqual([
      { path: 'Item.createdAt', message: 'Campo obrigatório.' },
      { path: 'Item.extra', message: 'Campo não aceito.' },
      { path: 'Item.id', message: 'Deve ser do tipo integer.' },
    ]);
    expect(item({}, 'data')[0]?.path).toBe('data.id');
    expect(() => app.contractSchema('NaoExiste')).toThrow('não existe o esquema "NaoExiste"');
  });
});

describe('entradas sem Fastify', () => {
  it('@nuva-edu/api-kit/metrics e /health carregam sem o Fastify, o Ajv e a base HTTP', () => {
    // Processo à parte, sem o vitest: registra tudo o que a importação resolve.
    const script = `
      import { registerHooks } from 'node:module';
      const seen = [];
      registerHooks({
        resolve(specifier, context, next) {
          const resolved = next(specifier, context);
          seen.push(resolved.url);
          return resolved;
        },
      });
      const metrics = await import('@nuva-edu/api-kit/metrics');
      const health = await import('@nuva-edu/api-kit/health');
      const registry = metrics.createMetricsRegistry();
      registry.counter({ name: 'jobs_total', help: 'Tarefas.' }).inc({ type: 'x' });
      const report = await health.runReadinessChecks({ queue: () => true });
      console.log(JSON.stringify({
        seen,
        text: registry.render(),
        report,
        exports: [typeof health.databaseReadiness, typeof health.createReadinessLogger],
      }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout) as {
      seen: string[];
      text: string;
      report: unknown;
      exports: string[];
    };
    expect(output.text).toContain('jobs_total{type="x"} 1');
    expect(output.report).toEqual({ status: 'ready', checks: { queue: 'ok' }, reasons: {} });
    expect(output.exports).toEqual(['function', 'function']);
    expect(output.seen.some((url) => url.endsWith('/api-kit/src/health.ts'))).toBe(true);
    const forbidden = output.seen.filter((url) =>
      /\/node_modules\/(fastify|ajv|ajv-formats|yaml)\/|\/api-kit\/src\/(app|server|index|validation|contract)\.ts$/.test(
        url,
      ),
    );
    expect(forbidden).toEqual([]);
  });
});
