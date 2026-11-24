import { randomUUID } from 'node:crypto';
import {
  type AuthProvider,
  createFakeOAuthProvider,
  createOAuth,
  type FakeOAuthCallback,
  type FakeOAuthFailure,
  type FakeOAuthIdentity,
  type FakeOAuthProvider,
  loadConfig,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  COOKIE,
  createUser,
  type Reply,
  TEST_PASSWORD,
  TEST_USER_AGENT,
  uniqueEmail,
  uniqueIp,
} from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

// Login social, vínculo e cadastro pendente (spec 007, "Fluxo do provedor") pela API inteira, com
// o provedor falso do núcleo em memória: sem rede, com o código de produção dos três provedores.

const SECRET = 'segredo-de-sessao-com-32-letras!-classroom-oauth';
const OAUTH_COOKIE = 'nuva_classroom_oauth';
const PROVIDERS: AuthProvider[] = ['google', 'facebook', 'apple'];

let fake: FakeOAuthProvider;
let test: TestApp;
let off: TestApp;

beforeAll(async () => {
  fake = await createFakeOAuthProvider();
  const env = { SESSION_SECRET: SECRET, NUVA_OAUTH_MOCK_URL: fake.url };
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const config = loadConfig({ env: { NUVA_ENV: 'test', ...env, DATABASE_URL: databaseUrl } });
  test = createTestApp(env, { oauth: createOAuth(config, { fetch: fake.fetch }) });
  // Sem provedor ligado: as rotas do login social respondem `404`.
  off = createTestApp({ SESSION_SECRET: SECRET });
});

afterAll(async () => {
  for (const app of [test, off]) {
    expect(app.logText()).not.toContain(TEST_PASSWORD);
  }
  await Promise.all([test.close(), off.close()]);
});

/** Um navegador que guarda todos os cookies (sessão e retorno) e fala sempre do mesmo IP. */
class OAuthBrowser {
  readonly ip = uniqueIp();
  readonly cookies = new Map<string, string>();
  csrfToken: string | null = null;

  private readonly target: () => TestApp;

  constructor(target: () => TestApp = () => test) {
    this.target = target;
  }

  async request(
    method: 'GET' | 'POST',
    url: string,
    options: { payload?: string | Record<string, unknown>; headers?: Record<string, string> } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = { 'user-agent': TEST_USER_AGENT };
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const response = await this.target().app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: { ...headers, ...options.headers },
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    });
    const reply = response as unknown as Reply;
    for (const cookie of reply.cookies) {
      if (cookie.maxAge === 0 || cookie.value === '') {
        this.cookies.delete(cookie.name);
      } else {
        this.cookies.set(cookie.name, cookie.value);
      }
    }
    const seen = JSON.stringify(reply.headers) + reply.body;
    expect(seen).not.toContain(TEST_PASSWORD);
    return reply;
  }

  /** Entra por senha (para o vínculo). */
  async login(email: string): Promise<void> {
    const reply = await this.request('POST', '/api/v1/auth/login', {
      payload: { email, password: TEST_PASSWORD },
    });
    expect(reply.statusCode).toBe(200);
    this.csrfToken = reply.json().csrfToken;
  }

  /** O navegador volta do provedor: `GET` com consulta ou `POST` de formulário (Apple). */
  callback(back: FakeOAuthCallback): Promise<Reply> {
    const path = new URL(back.url).pathname;
    const params = new URLSearchParams(back.params).toString();
    if (back.method === 'GET') {
      return this.request('GET', `${path}?${params}`);
    }
    return this.request('POST', path, {
      payload: params,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  /** Início, "tela" do provedor falso e retorno. */
  async social(
    provider: AuthProvider,
    identity: FakeOAuthIdentity,
    options: { intent?: 'login' | 'link'; returnTo?: string; failure?: FakeOAuthFailure } = {},
  ): Promise<Reply> {
    const query = new URLSearchParams();
    if (options.intent) query.set('intent', options.intent);
    if (options.returnTo) query.set('returnTo', options.returnTo);
    const start = await this.request('GET', `/api/v1/auth/${provider}/start?${query}`);
    expect(start.statusCode).toBe(302);
    return this.callback(fake.authorize(String(start.headers.location), identity, options.failure));
  }
}

function cookieOf(reply: Reply, name: string) {
  return reply.cookies.find((cookie) => cookie.name === name);
}

function identity(overrides: Partial<FakeOAuthIdentity> = {}): FakeOAuthIdentity {
  return {
    sub: `sub-${randomUUID()}`,
    email: uniqueEmail('social'),
    name: 'Rita Social',
    ...overrides,
  };
}

describe('GET /api/v1/meta', () => {
  it('lista os três provedores com o simulador ligado e nenhum sem ele', async () => {
    const on = await new OAuthBrowser().request('GET', '/api/v1/meta');
    expect(on.json().authProviders).toEqual(['google', 'facebook', 'apple']);
    const none = await new OAuthBrowser(() => off).request('GET', '/api/v1/meta');
    expect(none.json().authProviders).toEqual([]);
  });
});

describe('GET /api/v1/auth/{provider}/start', () => {
  it.each(PROVIDERS)('%s: 302 para o provedor e grava o cookie de retorno', async (provider) => {
    const reply = await new OAuthBrowser().request(
      'GET',
      `/api/v1/auth/${provider}/start?returnTo=/cursos`,
    );
    expect(reply.statusCode).toBe(302);
    expect(String(reply.headers.location).startsWith(`${fake.url}/${provider}/`)).toBe(true);
    expect(cookieOf(reply, OAUTH_COOKIE)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      path: '/api/v1/auth',
      maxAge: 600,
    });
    expect(cookieOf(reply, COOKIE)).toBeUndefined();
  });

  it('provedor desligado: 404 no início e nos dois retornos', async () => {
    const browser = new OAuthBrowser(() => off);
    expect((await browser.request('GET', '/api/v1/auth/google/start')).statusCode).toBe(404);
    expect(
      (await browser.request('GET', '/api/v1/auth/google/callback?code=x&state=y')).statusCode,
    ).toBe(404);
    const form = await browser.request('POST', '/api/v1/auth/apple/callback', {
      payload: 'code=x&state=y',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(form.statusCode).toBe(404);
  });

  it('intent=link sem sessão: 401', async () => {
    const reply = await new OAuthBrowser().request('GET', '/api/v1/auth/google/start?intent=link');
    expect(reply.statusCode).toBe(401);
    expect(reply.json().code).toBe('unauthenticated');
  });
});

describe('login social: cadastro pendente e conclusão', () => {
  it.each(PROVIDERS)('%s: cadastra pelo pendente e depois entra direto', async (provider) => {
    const browser = new OAuthBrowser();
    const who = identity();
    const back = await browser.social(provider, who, { returnTo: '/cursos/abc' });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe('/cadastro/social');
    expect(cookieOf(back, OAUTH_COOKIE)).toMatchObject({ maxAge: 1800 });
    expect(cookieOf(back, COOKIE)).toBeUndefined();

    const pending = await browser.request('GET', '/api/v1/auth/social/pending');
    expect(pending.statusCode).toBe(200);
    expect(pending.headers['cache-control']).toContain('no-store');
    expect(pending.json()).toMatchObject({
      provider,
      email: who.email,
      emailVerified: true,
      name: 'Rita Social',
    });
    expect(pending.body).not.toContain(who.sub);

    const done = await browser.request('POST', '/api/v1/auth/social/complete', {
      payload: { acceptedTerms: [] },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().user).toMatchObject({ email: who.email, role: 'student' });
    expect(cookieOf(done, COOKIE)).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookieOf(done, OAUTH_COOKIE)?.maxAge).toBe(0);
    expect((await browser.request('GET', '/api/v1/session')).statusCode).toBe(200);

    // Segunda vez: a identidade já está vinculada; entra e volta ao `returnTo`.
    const again = new OAuthBrowser();
    const login = await again.social(
      provider,
      { ...who, firstAuthorization: false },
      {
        returnTo: '/painel',
      },
    );
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toBe('/painel');
    expect(cookieOf(login, COOKIE)?.value).toBeTruthy();
    expect(cookieOf(login, OAUTH_COOKIE)?.maxAge).toBe(0);
    const session = await again.request('GET', '/api/v1/session');
    expect(session.statusCode).toBe(200);
    expect(session.json().user.email).toBe(who.email);
  });

  it('e-mail verificado de conta existente: vincula e entra', async () => {
    const user = await createUser(test.db);
    const browser = new OAuthBrowser();
    const reply = await browser.social('google', identity({ email: user.email }));
    expect(reply.headers.location).toBe('/');
    const list = await browser.request('GET', '/api/v1/account/identities');
    expect(list.json().items.map((item: { provider: string }) => item.provider)).toEqual([
      'google',
    ]);
  });

  it('returnTo de outro site vira /', async () => {
    const user = await createUser(test.db);
    const reply = await new OAuthBrowser().social('google', identity({ email: user.email }), {
      returnTo: '//evil.example.com/x',
    });
    expect(reply.headers.location).toBe('/');
  });

  it('provedor sem e-mail: pede o e-mail na conclusão e enfileira a confirmação', async () => {
    const browser = new OAuthBrowser();
    await browser.social('facebook', identity({ email: null }));
    const pending = await browser.request('GET', '/api/v1/auth/social/pending');
    expect(pending.json()).toMatchObject({ email: null, emailVerified: false });

    const missing = await browser.request('POST', '/api/v1/auth/social/complete', {
      payload: { acceptedTerms: [] },
    });
    expect(missing.statusCode).toBe(400);

    const taken = await createUser(test.db);
    const conflict = await browser.request('POST', '/api/v1/auth/social/complete', {
      payload: { acceptedTerms: [], email: taken.email },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('email_taken');

    const email = uniqueEmail('digitado');
    const done = await browser.request('POST', '/api/v1/auth/social/complete', {
      payload: { acceptedTerms: [], email },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().user).toMatchObject({ email, emailVerified: false });
    const outbox = await test.db
      .selectFrom('emailOutbox')
      .select('type')
      .where('userId', '=', done.json().user.id)
      .execute();
    expect(outbox.map((row) => row.type)).toEqual(['account.verify_email']);
  });

  it('sem cookie de retorno: pendente e conclusão respondem 404', async () => {
    const browser = new OAuthBrowser();
    expect((await browser.request('GET', '/api/v1/auth/social/pending')).statusCode).toBe(404);
    const done = await browser.request('POST', '/api/v1/auth/social/complete', {
      payload: { acceptedTerms: [] },
    });
    expect(done.statusCode).toBe(404);
  });

  it('conclusão só aceita JSON: 415', async () => {
    const reply = await new OAuthBrowser().request('POST', '/api/v1/auth/social/complete', {
      payload: 'acceptedTerms=',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(reply.statusCode).toBe(415);
  });
});

describe('retorno com erro', () => {
  it.each(PROVIDERS)('%s: state adulterado vira oauth_state_invalid', async (provider) => {
    const reply = await new OAuthBrowser().social(provider, identity(), { failure: 'state' });
    expect(reply.statusCode).toBe(302);
    expect(reply.headers.location).toBe('/entrar?erro=oauth_state_invalid');
    expect(cookieOf(reply, OAUTH_COOKIE)?.maxAge).toBe(0);
    expect(cookieOf(reply, COOKIE)).toBeUndefined();
  });

  it.each(PROVIDERS)('%s: recusa no provedor vira oauth_denied', async (provider) => {
    const reply = await new OAuthBrowser().social(provider, identity(), { failure: 'deny' });
    expect(reply.headers.location).toBe('/entrar?erro=oauth_denied');
  });

  it.each(PROVIDERS)('%s: troca recusada vira oauth_provider_error', async (provider) => {
    const reply = await new OAuthBrowser().social(provider, identity(), { failure: 'exchange' });
    expect(reply.headers.location).toBe('/entrar?erro=oauth_provider_error');
  });

  it('id_token com assinatura inválida vira oauth_provider_error', async () => {
    const reply = await new OAuthBrowser().social('google', identity(), {
      failure: 'bad_signature',
    });
    expect(reply.headers.location).toBe('/entrar?erro=oauth_provider_error');
  });

  it('retorno sem cookie de retorno vira oauth_state_invalid', async () => {
    const start = await new OAuthBrowser().request('GET', '/api/v1/auth/google/start');
    const back = fake.authorize(String(start.headers.location), identity());
    // Outro navegador (sem o cookie) chega ao retorno.
    const reply = await new OAuthBrowser().callback(back);
    expect(reply.headers.location).toBe('/entrar?erro=oauth_state_invalid');
  });

  it('POST de formulário de provedor que não é a Apple: oauth_provider_error', async () => {
    const reply = await new OAuthBrowser().request('POST', '/api/v1/auth/google/callback', {
      payload: 'code=x&state=y',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(reply.statusCode).toBe(302);
    expect(reply.headers.location).toBe('/entrar?erro=oauth_provider_error');
  });

  it('conta com suspensão full: account_suspended, sem sessão', async () => {
    const admin = await createUser(test.db, { role: 'admin' });
    const user = await createUser(test.db);
    await test.db
      .updateTable('users')
      .set({
        suspendedAt: new Date(),
        suspendedKind: 'full',
        suspendedReason: 'teste',
        suspendedBy: admin.id,
      })
      .where('id', '=', user.id)
      .execute();
    const reply = await new OAuthBrowser().social('google', identity({ email: user.email }));
    expect(reply.headers.location).toBe('/entrar?erro=account_suspended');
    expect(cookieOf(reply, COOKIE)).toBeUndefined();
  });
});

describe('vínculo (intent=link)', () => {
  it.each(PROVIDERS)('%s: vincula à conta da sessão e volta ao returnTo', async (provider) => {
    const user = await createUser(test.db);
    const browser = new OAuthBrowser();
    await browser.login(user.email);
    const reply = await browser.social(provider, identity(), {
      intent: 'link',
      returnTo: '/conta/acesso',
    });
    expect(reply.statusCode).toBe(302);
    expect(reply.headers.location).toBe('/conta/acesso');
    const list = await browser.request('GET', '/api/v1/account/identities');
    expect(list.json().items.map((item: { provider: string }) => item.provider)).toEqual([
      provider,
    ]);
  });

  it('identidade de outra conta: /conta/acesso?erro=identity_in_use', async () => {
    const owner = await createUser(test.db);
    const who = identity({ email: owner.email });
    await new OAuthBrowser().social('google', who);
    const other = await createUser(test.db);
    const browser = new OAuthBrowser();
    await browser.login(other.email);
    const reply = await browser.social('google', who, { intent: 'link' });
    expect(reply.headers.location).toBe('/conta/acesso?erro=identity_in_use');
  });

  it('outra identidade do mesmo provedor: provider_already_linked', async () => {
    const user = await createUser(test.db);
    const browser = new OAuthBrowser();
    await browser.login(user.email);
    await browser.social('facebook', identity(), { intent: 'link' });
    const reply = await browser.social('facebook', identity(), { intent: 'link' });
    expect(reply.headers.location).toBe('/conta/acesso?erro=provider_already_linked');
  });

  it('retorno do vínculo depois de sair: oauth_state_invalid', async () => {
    const user = await createUser(test.db);
    const browser = new OAuthBrowser();
    await browser.login(user.email);
    const start = await browser.request('GET', '/api/v1/auth/google/start?intent=link');
    expect(start.statusCode).toBe(302);
    const back = fake.authorize(String(start.headers.location), identity());
    browser.cookies.delete(COOKIE);
    const reply = await browser.callback(back);
    expect(reply.headers.location).toBe('/conta/acesso?erro=oauth_state_invalid');
  });
});

describe('cookie de sessão inválido nas operações públicas', () => {
  it('intent=link com sessão inválida: 401 e o cookie inválido é apagado', async () => {
    const browser = new Browser(test.app);
    browser.cookie = 'cookie-que-nao-vale-nada-0000000000000000000';
    const reply = await browser.request('GET', '/api/v1/auth/google/start?intent=link');
    expect(reply.statusCode).toBe(401);
    expect(browser.cookie).toBeNull();
  });
});
