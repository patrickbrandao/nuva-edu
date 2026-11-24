import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRateLimiter,
  type RateLimitRule,
  rateLimitByIp,
  readApiCookie,
} from '../src/index.ts';
import { buildPhase1App } from './phase1-helpers.ts';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Os limites da admin-api (spec 003, RNF-03), com números pequenos para o teste. */
function adminRules(session = 5, authIp = 2): RateLimitRule[] {
  return [
    {
      name: 'session',
      limit: session,
      windowSeconds: 60,
      key: (request) => readApiCookie(request, 'admin', 'session'),
    },
    {
      name: 'auth-ip',
      limit: authIp,
      windowSeconds: 60,
      key: rateLimitByIp,
      operations: ['login', 'oauthCallback', 'oauthCallbackForm'],
    },
  ];
}

const login = (app: FastifyInstance, ip = '203.0.113.7') =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'a@b.c' },
    remoteAddress: ip,
  });

describe('limite de taxa', () => {
  it('passou do limite por IP nas rotas de autenticação: 429 com Retry-After', async () => {
    const time = clock();
    const { app, logs } = buildPhase1App({
      rateLimits: adminRules(),
      rateLimiter: { now: time.now },
    });
    apps.push(app);
    expect((await login(app)).statusCode).toBe(204);
    time.advance(20_000);
    expect((await login(app)).statusCode).toBe(204);
    const refused = await login(app);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('40');
    expect(refused.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(refused.json()).toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: 40,
    });
    // O grupo é por rota: o retorno OAuth conta junto, outra rota não.
    expect(
      (await app.inject({ url: '/api/v1/auth/google/callback', remoteAddress: '203.0.113.7' }))
        .statusCode,
    ).toBe(429);
    // Outro IP tem a própria conta.
    expect((await login(app, '203.0.113.8')).statusCode).toBe(204);
    expect(logs.lines.some((line) => line.error_code === 'rate_limited')).toBe(true);

    // A janela vira e a conta zera.
    time.advance(40_000);
    expect((await login(app)).statusCode).toBe(204);
  });

  it('usa o IP real atrás de proxy confiável', async () => {
    const { app } = buildPhase1App({ rateLimits: adminRules(5, 1) });
    apps.push(app);
    const viaProxy = (forwarded: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'a@b.c' },
        remoteAddress: '10.0.0.2',
        headers: { 'x-forwarded-for': forwarded },
      });
    expect((await viaProxy('198.51.100.1')).statusCode).toBe(204);
    expect((await viaProxy('198.51.100.2')).statusCode).toBe(204);
    expect((await viaProxy('198.51.100.1')).statusCode).toBe(429);
  });

  it('por sessão em todas as rotas de /api/v1; sem sessão a regra não vale', async () => {
    const { app } = buildPhase1App({ rateLimits: adminRules(2, 100) });
    apps.push(app);
    const session = (id: string) =>
      app.inject({ url: '/api/v1/session', headers: { cookie: `nuva_admin_session=${id}` } });
    expect((await session('a')).statusCode).toBe(200);
    expect((await session('a')).statusCode).toBe(200);
    expect((await session('a')).statusCode).toBe(429);
    expect((await session('b')).statusCode).toBe(200);
    // Sem cookie a chave é nula: a regra "por sessão" não conta.
    for (let i = 0; i < 4; i++) {
      expect((await login(app)).statusCode).toBe(204);
    }
    // Sondas ficam fora.
    for (let i = 0; i < 4; i++) {
      expect(
        (await app.inject({ url: '/healthz', headers: { cookie: 'nuva_admin_session=a' } }))
          .statusCode,
      ).toBe(200);
    }
  });

  it('recusa antes da validação e da rota', async () => {
    let calls = 0;
    const { app } = buildPhase1App(
      { rateLimits: adminRules(5, 1) },
      {
        login: () => (_request, reply) => {
          calls += 1;
          return reply.status(204).send();
        },
      },
    );
    apps.push(app);
    await login(app);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { nada: 1 },
      remoteAddress: '203.0.113.7',
    });
    expect(invalid.statusCode).toBe(429);
    expect(calls).toBe(1);
  });

  it('com duas regras recusando, vale a espera mais longa', () => {
    const time = clock();
    const limiter = createRateLimiter(
      [
        { name: 'curta', limit: 1, windowSeconds: 10, key: () => 'k' },
        { name: 'longa', limit: 1, windowSeconds: 60, key: () => 'k' },
      ],
      { now: time.now, sweepIntervalMs: 0 },
    );
    const operation = { operationId: 'x', path: '/api/v1/x' } as never;
    const request = {} as never;
    expect(limiter.check(request, operation)).toEqual({ allowed: true });
    expect(limiter.check(request, operation)).toEqual({
      allowed: false,
      rule: 'longa',
      retryAfterSeconds: 60,
    });
    expect(limiter.size()).toBe(2);
    time.advance(10_000);
    limiter.sweep();
    expect(limiter.size()).toBe(1);
    time.advance(50_000);
    limiter.sweep();
    expect(limiter.size()).toBe(0);
    limiter.stop();
  });

  it('regra inválida ou repetida lança na montagem', () => {
    const key = () => 'k';
    expect(() =>
      createRateLimiter([
        { name: 'a', limit: 1, windowSeconds: 1, key },
        { name: 'a', limit: 1, windowSeconds: 1, key },
      ]),
    ).toThrow(/repetida/);
    expect(() => createRateLimiter([{ name: 'a', limit: 0, windowSeconds: 1, key }])).toThrow(
      /limit/,
    );
    expect(() => createRateLimiter([{ name: 'a', limit: 1, windowSeconds: 0.5, key }])).toThrow(
      /windowSeconds/,
    );
  });
});
