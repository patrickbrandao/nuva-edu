import { permissionDenied } from '@nuva-edu/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadContract, type PermissionDeniedHandler, parseContract } from '../src/index.ts';
import { authHeaders, buildPhase1App, PHASE1_FIXTURE } from './phase1-helpers.ts';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('302 e Cache-Control por operação', () => {
  it('redireciona com Location e sem corpo', async () => {
    const { app } = buildPhase1App();
    apps.push(app);
    const response = await app.inject({ url: '/api/v1/auth/google/callback?code=c&state=s' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/entrar?erro=oauth_denied');
    expect(response.body).toBe('');
  });

  it('302 que o contrato não declara vira 500, sem Location', async () => {
    const { app, logs } = buildPhase1App(
      {},
      { getSession: () => (_request, reply) => reply.redirect('/', 302) },
    );
    apps.push(app);
    const response = await app.inject({
      url: '/api/v1/session',
      headers: { cookie: 'nuva_admin_session=u1' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.headers.location).toBeUndefined();
    expect(response.json().code).toBe('internal_error');
    expect(logs.text()).toContain('não declara resposta 302');
  });

  it('302 sem Location vira 500', async () => {
    const { app } = buildPhase1App(
      {},
      { oauthCallback: () => (_request, reply) => reply.status(302).send() },
    );
    apps.push(app);
    const response = await app.inject({ url: '/api/v1/auth/google/callback' });
    expect(response.statusCode).toBe(500);
  });

  it('204 que o contrato declara passa; o que não declara vira 500', async () => {
    const { app } = buildPhase1App(
      {},
      { revealUserPassword: () => (_request, reply) => reply.status(204).send() },
    );
    apps.push(app);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.c' },
    });
    expect(ok.statusCode).toBe(204);
    const undeclared = await app.inject({
      method: 'POST',
      url: '/api/v1/users/u2/password/reveal',
      headers: authHeaders(),
    });
    expect(undeclared.statusCode).toBe(500);
  });

  it('noStore põe Cache-Control: no-store no sucesso e no erro', async () => {
    const { app } = buildPhase1App({}, {}, { revealUserPassword: { noStore: true } });
    apps.push(app);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/users/u2/password/reveal',
      headers: authHeaders(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/users/u2/password/reveal',
      headers: authHeaders({ 'x-csrf-token': 'errado' }),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('no-store');
    // Sem a opção, a base não põe o cabeçalho.
    const other = await app.inject({
      url: '/api/v1/session',
      headers: { cookie: 'nuva_admin_session=u1' },
    });
    expect(other.headers['cache-control']).toBeUndefined();
  });
});

describe('x-permission e a negação por permissão', () => {
  it('lê x-permission como texto ou lista', () => {
    const contract = loadContract(PHASE1_FIXTURE);
    expect(contract.operation('revealUserPassword').permissions).toEqual(['users.password.view']);
    expect(contract.operation('updateUser').permissions).toEqual(['users.edit', 'staff.manage']);
    expect(contract.operation('getSession').permissions).toEqual([]);
  });

  it.each([[[]], [''], [42], [['ok', '']]])('x-permission inválido (%j) lança', (value) => {
    const document = structuredClone(loadContract(PHASE1_FIXTURE).document) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const operation = document.paths['/api/v1/session']?.get;
    if (operation) {
      operation['x-permission'] = value;
    }
    expect(() => parseContract(document, 'p.yaml')).toThrow(/x-permission/);
  });

  it('403 permission_denied chama o gancho com a operação e as ações', async () => {
    const calls: { operationId: string; permissions: readonly string[]; ip: string }[] = [];
    const onPermissionDenied: PermissionDeniedHandler = (request, context) => {
      calls.push({
        operationId: context.operation.operationId,
        permissions: context.permissions,
        ip: request.client.ip,
      });
    };
    const { app } = buildPhase1App(
      { onPermissionDenied },
      {
        updateUser: () => () => {
          throw permissionDenied();
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/u2',
      headers: authHeaders(),
      payload: { name: 'x' },
      remoteAddress: '203.0.113.9',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('permission_denied');
    expect(calls).toEqual([
      { operationId: 'updateUser', permissions: ['users.edit', 'staff.manage'], ip: '203.0.113.9' },
    ]);
  });

  it('a negação no tratador de segurança também chama o gancho; outro 403 não', async () => {
    const calls: string[] = [];
    const { app } = buildPhase1App({
      onPermissionDenied: (_request, context) => {
        calls.push(context.operation.operationId);
      },
      security: {
        sessionCookie: (request) => {
          if (request.headers['x-role'] === 'student') {
            throw permissionDenied();
          }
        },
        csrfToken: () => {},
      },
    });
    apps.push(app);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/users/u2/password/reveal',
      headers: { 'x-role': 'student', 'x-csrf-token': 'ok' },
    });
    expect(denied.statusCode).toBe(403);
    expect(calls).toEqual(['revealUserPassword']);

    // Rota inexistente não tem operação: o gancho não roda.
    await app.inject({ url: '/api/v1/nada' });
    expect(calls).toEqual(['revealUserPassword']);
  });

  it('não chama o gancho em csrf_token_invalid', async () => {
    const calls: string[] = [];
    const { app } = buildPhase1App({
      onPermissionDenied: (_request, context) => {
        calls.push(context.operation.operationId);
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/u2/password/reveal',
      headers: authHeaders({ 'x-csrf-token': 'errado' }),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('csrf_token_invalid');
    expect(calls).toEqual([]);
  });

  it('falha do gancho vai para o log e a resposta continua 403', async () => {
    const { app, logs } = buildPhase1App(
      {
        onPermissionDenied: async () => {
          throw new Error('auditoria fora do ar');
        },
      },
      {
        revealUserPassword: () => () => {
          throw permissionDenied();
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/u2/password/reveal',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('permission_denied');
    expect(logs.text()).toContain('Falha ao registrar a negação por permissão');
  });
});

describe('contract-check com os corpos e respostas da Fase 1', () => {
  it('formulário, multipart e 302 sem corpo conferem e o serviço sobe', async () => {
    const { app } = buildPhase1App();
    apps.push(app);
    await app.ready();
    const report = app.checkContract({
      csrfExceptions: ['login', 'oauthCallbackForm'],
    });
    expect(report.ok).toBe(true);
  });
});
