import {
  type AuthProvider,
  createFakeOAuthProvider,
  createOAuth,
  type FakeOAuthFailure,
  type FakeOAuthIdentity,
  loadConfig,
} from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, nextIp, sessionCookieOf, type TestApp } from './helpers.ts';

// Login social da equipe (spec 007, "Login social e vínculo" e "Fluxo do provedor"), contra o
// provedor falso do núcleo: só `intent=login`, sem cadastro, `staff_only` para quem não é da
// equipe.

const fake = await createFakeOAuthProvider();
const env = {
  SESSION_SECRET: 'segredo-de-sessao-dos-testes-da-admin-api-0123456789',
  NUVA_OAUTH_MOCK_URL: fake.url,
};
const oauthConfig = loadConfig({
  env: { NUVA_ENV: 'test', ...env, DATABASE_URL: process.env.DATABASE_URL ?? '' },
});
const test: TestApp = createTestApp(env, {
  oauth: createOAuth(oauthConfig, { fetch: fake.fetch }),
});
/** Sem `NUVA_OAUTH_MOCK_URL` nem credenciais: os três provedores desligados. */
const off: TestApp = createTestApp({ SESSION_SECRET: env.SESSION_SECRET });
afterAll(async () => {
  await test.close();
  await off.close();
});

const OAUTH_COOKIE = 'nuva_admin_oauth';
const PROVIDERS: AuthProvider[] = ['google', 'facebook', 'apple'];

function setCookies(header: string | string[] | undefined): string[] {
  return Array.isArray(header) ? header : header ? [header] : [];
}

function oauthCookieLine(header: string | string[] | undefined): string | undefined {
  return setCookies(header).find((line) => line.startsWith(`${OAUTH_COOKIE}=`));
}

function cookieValue(line: string | undefined): string {
  return line?.split(';')[0]?.slice(OAUTH_COOKIE.length + 1) ?? '';
}

async function start(provider: string, query = '', ip = nextIp()) {
  return test.app.inject({
    method: 'GET',
    url: `/api/v1/auth/${provider}/start${query}`,
    remoteAddress: ip,
  });
}

interface FlowOptions {
  returnTo?: string;
  failure?: FakeOAuthFailure;
  /** Troca o cookie de retorno da ida (`null`: sem cookie). */
  cookie?: string | null;
}

/** Ida e volta completas: início, "tela" do provedor falso e retorno na API. */
async function flow(
  provider: AuthProvider,
  identity: FakeOAuthIdentity,
  options: FlowOptions = {},
) {
  const ip = nextIp();
  const query =
    options.returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(options.returnTo)}`;
  const started = await start(provider, query, ip);
  expect(started.statusCode).toBe(302);
  const cookie =
    options.cookie === undefined
      ? cookieValue(oauthCookieLine(started.headers['set-cookie']))
      : options.cookie;
  const back = fake.authorize(String(started.headers.location), identity, options.failure);
  const path = new URL(back.url).pathname;
  const cookies = cookie === null ? {} : { [OAUTH_COOKIE]: cookie };
  if (back.method === 'POST') {
    return test.app.inject({
      method: 'POST',
      url: path,
      remoteAddress: ip,
      cookies,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(back.params).toString(),
    });
  }
  return test.app.inject({
    method: 'GET',
    url: `${path}?${new URLSearchParams(back.params).toString()}`,
    remoteAddress: ip,
    cookies,
  });
}

function expectError(
  response: { statusCode: number; headers: Record<string, unknown> },
  code: string,
) {
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe(`/entrar?erro=${code}`);
  const headers = response.headers as { 'set-cookie'?: string | string[] };
  expect(sessionCookieOf(headers['set-cookie'])).toBeNull();
  expect(oauthCookieLine(headers['set-cookie'])).toContain('Max-Age=0');
}

describe('GET /api/v1/auth/{provider}/start', () => {
  it('grava o cookie de retorno assinado (10 min) e redireciona ao provedor', async () => {
    const response = await start('google', '?returnTo=%2Fusuarios');
    expect(response.statusCode).toBe(302);
    expect(response.headers['cache-control']).toBe('no-store');
    const location = new URL(String(response.headers.location));
    expect(location.origin).toBe(new URL(fake.url).origin);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${test.config.adminUrl}/api/v1/auth/google/callback`,
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    const line = oauthCookieLine(response.headers['set-cookie']);
    expect(line).toMatch(/^nuva_admin_oauth=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    expect(line).toContain('Max-Age=600');
    expect(line).toContain('Path=/api/v1/auth');
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=None');
    expect(line).not.toContain('Domain');
  });

  it('intent=link não existe no admin: 400', async () => {
    const response = await start('google', '?intent=link');
    expect(response.statusCode).toBe(400);
    expect(oauthCookieLine(response.headers['set-cookie'])).toBeUndefined();
  });

  it('provedor desligado: 404 no início e nos dois retornos', async () => {
    for (const provider of PROVIDERS) {
      const started = await off.app.inject({
        method: 'GET',
        url: `/api/v1/auth/${provider}/start`,
        remoteAddress: nextIp(),
      });
      expect(started.statusCode).toBe(404);
      const back = await off.app.inject({
        method: 'GET',
        url: `/api/v1/auth/${provider}/callback?code=x&state=y`,
        remoteAddress: nextIp(),
      });
      expect(back.statusCode).toBe(404);
      const form = await off.app.inject({
        method: 'POST',
        url: `/api/v1/auth/${provider}/callback`,
        remoteAddress: nextIp(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'code=x&state=y',
      });
      expect(form.statusCode).toBe(404);
    }
  });

  it('provedor fora da lista: 400 pela validação do contrato', async () => {
    const response = await start('github');
    expect(response.statusCode).toBe(400);
  });
});

describe('retorno do provedor', () => {
  for (const provider of PROVIDERS) {
    it(`${provider}: equipe com e-mail verificado vincula, entra e volta ao returnTo`, async () => {
      const manager = await createUser(test.db, { role: 'manager' });
      const sub = `sub-${crypto.randomUUID()}`;
      const response = await flow(
        provider,
        { sub, email: manager.email, name: 'Pessoa de Teste' },
        { returnTo: '/usuarios?pagina=2' },
      );
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/usuarios?pagina=2');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(oauthCookieLine(response.headers['set-cookie'])).toContain('Max-Age=0');
      const sessionLine = setCookies(response.headers['set-cookie']).find((line) =>
        line.startsWith('nuva_admin_session='),
      );
      expect(sessionLine).toContain('Max-Age=2592000');
      expect(sessionLine).toContain('SameSite=Lax');
      const session = sessionCookieOf(response.headers['set-cookie']);
      expect(session).toBeTruthy();

      const current = await test.app.inject({
        method: 'GET',
        url: '/api/v1/session',
        cookies: { nuva_admin_session: session as string },
      });
      expect(current.statusCode).toBe(200);
      expect(current.json()).toMatchObject({ user: { id: manager.id, role: 'manager' } });

      const identities = await test.db
        .selectFrom('oauthIdentities')
        .select(['provider', 'providerUserId'])
        .where('userId', '=', manager.id)
        .execute();
      expect(identities).toEqual([{ provider, providerUserId: sub }]);

      const audit = await test.db
        .selectFrom('auditLog')
        .select(['origin', 'outcome', 'details'])
        .where('action', '=', 'auth.login')
        .where('targetId', '=', manager.id)
        .execute();
      expect(audit).toEqual([
        { origin: 'admin_panel', outcome: 'ok', details: { method: provider } },
      ]);

      // Segunda vez: a identidade já vinculada basta, mesmo sem e-mail do provedor.
      const again = await flow(provider, { sub, email: null });
      expect(again.statusCode).toBe(302);
      expect(again.headers.location).toBe('/');
      expect(sessionCookieOf(again.headers['set-cookie'])).toBeTruthy();
    });

    it(`${provider}: aluno e e-mail desconhecido voltam com staff_only, sem cadastro`, async () => {
      const student = await createUser(test.db, { role: 'student' });
      expectError(
        await flow(provider, { sub: `sub-${crypto.randomUUID()}`, email: student.email }),
        'staff_only',
      );

      const unknown = `ninguem-${crypto.randomUUID()}@example.com`;
      expectError(
        await flow(provider, { sub: `sub-${crypto.randomUUID()}`, email: unknown }),
        'staff_only',
      );
      const created = await test.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', unknown)
        .execute();
      expect(created).toEqual([]);
    });
  }

  it('recusa no provedor: oauth_denied', async () => {
    for (const provider of PROVIDERS) {
      expectError(await flow(provider, { sub: 'x' }, { failure: 'deny' }), 'oauth_denied');
    }
  });

  it('state diferente, cookie ausente ou adulterado: oauth_state_invalid', async () => {
    const manager = await createUser(test.db);
    const identity = { sub: `sub-${crypto.randomUUID()}`, email: manager.email };
    expectError(await flow('google', identity, { failure: 'state' }), 'oauth_state_invalid');
    expectError(await flow('google', identity, { cookie: null }), 'oauth_state_invalid');
    expectError(
      await flow('apple', identity, { cookie: 'adulterado.assinatura' }),
      'oauth_state_invalid',
    );
  });

  it('troca do código ou id_token inválido: oauth_provider_error', async () => {
    const manager = await createUser(test.db);
    const identity = { sub: `sub-${crypto.randomUUID()}`, email: manager.email };
    expectError(await flow('facebook', identity, { failure: 'exchange' }), 'oauth_provider_error');
    for (const failure of ['bad_signature', 'bad_nonce', 'bad_audience'] as const) {
      expectError(await flow('google', identity, { failure }), 'oauth_provider_error');
      expectError(await flow('apple', identity, { failure }), 'oauth_provider_error');
    }
  });

  it('conta da equipe suspensa: account_suspended', async () => {
    const instructor = await createUser(test.db, { role: 'instructor' });
    await test.db
      .updateTable('users')
      .set({ suspendedKind: 'full', suspendedAt: new Date() })
      .where('id', '=', instructor.id)
      .execute();
    expectError(
      await flow('google', { sub: `sub-${crypto.randomUUID()}`, email: instructor.email }),
      'account_suspended',
    );
  });

  it('returnTo fora do site vira /', async () => {
    const manager = await createUser(test.db);
    const response = await flow(
      'google',
      { sub: `sub-${crypto.randomUUID()}`, email: manager.email },
      { returnTo: '//evil.example.com/x' },
    );
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('POST de provedor que não é a Apple: oauth_provider_error, sem CSRF', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/callback',
      remoteAddress: nextIp(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'code=x&state=y',
    });
    expectError(response, 'oauth_provider_error');
  });

  it('POST com JSON no retorno da Apple: 415', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/v1/auth/apple/callback',
      remoteAddress: nextIp(),
      payload: { code: 'x', state: 'y' },
    });
    expect(response.statusCode).toBe(415);
  });

  it('20 por minuto por IP nas operações de OAuth: 429', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await start('google', '', ip)).statusCode);
    }
    expect(statuses.slice(0, 20).every((status) => status === 302)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
