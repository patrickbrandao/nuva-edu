import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AccountSite,
  type AuthProvider,
  accountNameFor,
  appleUserName,
  authenticateSession,
  closeDatabase,
  createAccount,
  createDatabase,
  createFakeOAuthProvider,
  createOAuth,
  createOAuthProviders,
  createSession,
  createTermsDraft,
  type Database,
  type DomainError,
  decodeOAuthCookie,
  enabledAuthProviders,
  encodeOAuthCookie,
  type FakeOAuthFailure,
  type FakeOAuthIdentity,
  type FakeOAuthProvider,
  isDomainError,
  listIdentities,
  loadConfig,
  loginWithPassword,
  mockProviderEndpoints,
  OAUTH_COOKIE_PATH,
  OAUTH_FLOW_TTL_SECONDS,
  OAUTH_MOCK_CLIENTS,
  OAUTH_PENDING_TTL_SECONDS,
  type OAuth,
  type OAuthCallbackResult,
  oauthCallbackUrl,
  oauthErrorLocation,
  pkceChallenge,
  publishTermsVersion,
  REAL_PROVIDER_ENDPOINTS,
  type RequestContext,
  removeIdentity,
  sanitizeReturnTo,
  stateMatches,
  translateUniqueViolation,
} from '../src/index.ts';

// Login social (spec 007, "Login social e vínculo", "Fluxo do provedor", "Cadastro pendente") com
// o provedor falso em memória: o código de produção roda inteiro (endereço de autorização, PKCE,
// troca do código, `id_token` pela JWKS, `/me` do Graph), sem rede.

const SECRET = 'segredo-de-sessao-com-32-letras!-teste-oauth';
const PASSWORD = 'Senha-de-Teste-OAuth-9Zk';
const PROVIDERS: AuthProvider[] = ['google', 'facebook', 'apple'];
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let testDb: TestDatabase;
let db: Database;
let fake: FakeOAuthProvider;
let oauth: OAuth;
let clock = Date.now();

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 8 });
  fake = await createFakeOAuthProvider();
  const config = loadConfig({
    env: {
      DATABASE_URL: testDb.url,
      NUVA_ENV: 'test',
      SESSION_SECRET: SECRET,
      NUVA_OAUTH_MOCK_URL: fake.url,
    },
  });
  oauth = createOAuth(config, { fetch: fake.fetch, now: () => clock });
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

let ipSeq = 0;
function ctx(): RequestContext {
  ipSeq += 1;
  return { ip: `10.20.${(ipSeq >> 8) & 255}.${ipSeq & 255}`, userAgent: CHROME_MAC };
}

const uniqueEmail = (prefix = 'social') => `${prefix}-${crypto.randomUUID()}@example.com`;
const uniqueSub = () => crypto.randomUUID();

async function makeUser(
  options: {
    email?: string;
    password?: string | null;
    verified?: boolean;
    role?: 'student' | 'manager';
  } = {},
) {
  const email = options.email ?? uniqueEmail('conta');
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: 'Conta Local',
      password: options.password === undefined ? PASSWORD : options.password,
      role: options.role ?? 'student',
      emailVerified: options.verified ?? true,
    }),
  );
  return { id, email, role: options.role ?? 'student' };
}

interface SocialOptions {
  site?: AccountSite;
  intent?: 'login' | 'link';
  user?: { id: string; role: 'student' | 'manager' | 'instructor' | 'admin' } | null;
  failure?: FakeOAuthFailure;
  returnTo?: string;
}

/** Início, "tela" do provedor e retorno, como faria o navegador. */
async function social(
  provider: AuthProvider,
  identity: FakeOAuthIdentity,
  options: SocialOptions = {},
): Promise<OAuthCallbackResult> {
  const site = options.site ?? 'classroom';
  const user = options.user ?? null;
  const started = oauth.start({
    site,
    provider,
    intent: options.intent,
    returnTo: options.returnTo ?? '/painel',
    user,
  });
  const callback = fake.authorize(started.location, identity, options.failure);
  expect(callback.url).toMatch(
    new RegExp(
      `^http://${site === 'admin' ? 'edu-admin' : 'classroom'}\\.localhost(:\\d+)?/api/v1/auth/${provider}/callback$`,
    ),
  );
  expect(callback.method).toBe(provider === 'apple' ? 'POST' : 'GET');
  return oauth.callback(db, {
    site,
    provider,
    params: callback.params,
    cookie: started.cookie.value,
    user,
    context: ctx(),
  });
}

async function userRow(id: string) {
  return db
    .selectFrom('users')
    .select(['email', 'name', 'password', 'emailVerifiedAt', 'role'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

async function auditActions(userId: string) {
  const rows = await db
    .selectFrom('auditLog')
    .select(['action', 'details'])
    .where('targetId', '=', userId)
    .orderBy('createdAt')
    .execute();
  return rows;
}

async function outboxTypes(userId: string) {
  const rows = await db
    .selectFrom('emailOutbox')
    .select('type')
    .where('userId', '=', userId)
    .execute();
  return rows.map((row) => row.type);
}

async function rejects(promise: Promise<unknown>, code: string): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) {
      expect(error.code).toBe(code);
      return error;
    }
    throw error;
  }
  throw new Error(`deveria ter falhado com ${code}`);
}

function sessionUserOf(result: OAuthCallbackResult) {
  expect(result.session).not.toBeNull();
  return authenticateSession(db, { token: result.session?.token ?? '', site: 'classroom' });
}

/** Completa o cadastro pendente de um retorno. */
async function complete(
  result: OAuthCallbackResult,
  extra: { email?: string; acceptedTerms?: string[] } = {},
) {
  return oauth.complete(db, {
    cookie: result.cookie.value,
    acceptedTerms: extra.acceptedTerms ?? [],
    email: extra.email,
    context: ctx(),
  });
}

describe('início do fluxo', () => {
  it('liga os três provedores pelo simulador e responde 404 para provedor desligado', () => {
    expect(oauth.enabledProviders).toEqual(['google', 'facebook', 'apple']);
    expect(oauth.isEnabled('google')).toBe(true);
    expect(oauth.isEnabled('github')).toBe(false);
    expect(() => oauth.start({ site: 'classroom', provider: 'github' })).toThrow(
      expect.objectContaining({ code: 'not_found', status: 404 }),
    );
    const off = createOAuth(
      { ...loadConfig({ env: { DATABASE_URL: testDb.url, SESSION_SECRET: SECRET } }) },
      { fetch: fake.fetch },
    );
    expect(off.enabledProviders).toEqual([]);
    expect(() => off.start({ site: 'classroom', provider: 'google' })).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('gera state, nonce e PKCE S256 e grava o cookie assinado de 10 minutos', () => {
    const started = oauth.start({ site: 'classroom', provider: 'google', returnTo: '/cursos?x=1' });
    const url = new URL(started.location);
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.url}/google/o/oauth2/v2/auth`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(started.cookie).toMatchObject({
      name: 'nuva_classroom_oauth',
      options: {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: OAUTH_COOKIE_PATH,
        maxAge: OAUTH_FLOW_TTL_SECONDS,
      },
    });
    const payload = decodeOAuthCookie(
      SECRET,
      started.cookie.value,
      'classroom',
      Math.floor(clock / 1000),
    );
    expect(payload?.kind).toBe('flow');
    if (payload?.kind !== 'flow') return;
    expect(payload.flow).toMatchObject({
      provider: 'google',
      intent: 'login',
      returnTo: '/cursos?x=1',
    });
    expect(url.searchParams.get('state')).toBe(payload.flow.state);
    expect(url.searchParams.get('nonce')).toBe(payload.flow.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(payload.flow.codeVerifier));
    expect(payload.flow.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.exp).toBe(Math.floor(clock / 1000) + OAUTH_FLOW_TTL_SECONDS);
    // Admin: cookie próprio.
    expect(oauth.start({ site: 'admin', provider: 'apple' }).cookie.name).toBe('nuva_admin_oauth');
  });

  it('intent=link exige sessão e não existe no admin; intent desconhecido é 400', () => {
    expect(() => oauth.start({ site: 'classroom', provider: 'google', intent: 'link' })).toThrow(
      expect.objectContaining({ code: 'unauthenticated' }),
    );
    expect(() =>
      oauth.start({ site: 'admin', provider: 'google', intent: 'link', user: { id: 'x' } }),
    ).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    expect(() => oauth.start({ site: 'classroom', provider: 'google', intent: 'outro' })).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });

  it('returnTo só aceita caminho do próprio site', () => {
    expect(sanitizeReturnTo('/cursos/1?a=b#c')).toBe('/cursos/1?a=b#c');
    for (const bad of [
      '//evil.test',
      '/\\evil.test',
      'https://evil.test',
      'cursos',
      '',
      42,
      null,
      '/a\nb',
      `/${'a'.repeat(3000)}`,
    ]) {
      expect(sanitizeReturnTo(bad)).toBe('/');
    }
    const started = oauth.start({ site: 'classroom', provider: 'google', returnTo: '//evil.test' });
    const payload = decodeOAuthCookie(
      SECRET,
      started.cookie.value,
      'classroom',
      Math.floor(clock / 1000),
    );
    expect(payload?.kind === 'flow' && payload.flow.returnTo).toBe('/');
  });
});

describe('cookie de retorno', () => {
  const now = 1_800_000_000;
  const value = encodeOAuthCookie(SECRET, {
    kind: 'pending',
    site: 'classroom',
    exp: now + 60,
    pending: {
      provider: 'google',
      providerUserId: 'sub-1',
      email: null,
      emailVerified: false,
      name: null,
      returnTo: '/',
    },
  });

  it('lê o cookie íntegro e recusa adulterado, de outro site, vencido, de outro segredo ou malformado', () => {
    expect(decodeOAuthCookie(SECRET, value, 'classroom', now)?.kind).toBe('pending');
    const [body, signature] = value.split('.') as [string, string];
    const forged = Buffer.from(
      Buffer.from(body, 'base64url').toString('utf8').replace('sub-1', 'sub-2'),
    ).toString('base64url');
    expect(decodeOAuthCookie(SECRET, `${forged}.${signature}`, 'classroom', now)).toBeNull();
    expect(
      decodeOAuthCookie(SECRET, `${body}.${signature.slice(0, -2)}AA`, 'classroom', now),
    ).toBeNull();
    expect(decodeOAuthCookie(SECRET, value, 'admin', now)).toBeNull();
    expect(decodeOAuthCookie(SECRET, value, 'classroom', now + 60)).toBeNull();
    expect(decodeOAuthCookie(`${SECRET}-outro`, value, 'classroom', now)).toBeNull();
    for (const bad of [undefined, null, '', 'sem-ponto', 'a.b.c', '.x']) {
      expect(decodeOAuthCookie(SECRET, bad, 'classroom', now)).toBeNull();
    }
    const notJson = Buffer.from('{quebrado').toString('base64url');
    const signedNotJson = encodeOAuthCookie(SECRET, JSON.parse('{"kind":"x"}'));
    expect(decodeOAuthCookie(SECRET, `${notJson}.${signature}`, 'classroom', now)).toBeNull();
    expect(decodeOAuthCookie(SECRET, signedNotJson, 'classroom', now)).toBeNull();
  });

  it('exige SESSION_SECRET', () => {
    expect(() => decodeOAuthCookie(null, value, 'classroom', now)).toThrow(TypeError);
  });

  it('compara o state em tempo constante', () => {
    expect(stateMatches('abc', 'abc')).toBe(true);
    expect(stateMatches('abc', 'abd')).toBe(false);
    expect(stateMatches('abc', undefined)).toBe(false);
  });
});

describe('retorno: state, recusa e falhas do provedor', () => {
  it.each(PROVIDERS)(
    '%s: state alterado leva a /entrar?erro=oauth_state_invalid sem sessão',
    async (provider) => {
      const result = await social(
        provider,
        { sub: uniqueSub(), email: uniqueEmail() },
        { failure: 'state' },
      );
      expect(result).toMatchObject({
        location: '/entrar?erro=oauth_state_invalid',
        outcome: 'error',
        session: null,
        cookie: { value: '', options: { maxAge: 0 } },
      });
    },
  );

  it('cookie ausente, adulterado, vencido ou de outro provedor: oauth_state_invalid', async () => {
    const started = oauth.start({ site: 'classroom', provider: 'google' });
    const callback = fake.authorize(started.location, { sub: uniqueSub() });
    const run = (cookie: string | undefined, provider = 'google') =>
      oauth.callback(db, {
        site: 'classroom',
        provider,
        params: callback.params,
        cookie,
        user: null,
        context: ctx(),
      });
    expect((await run(undefined)).error).toBe('oauth_state_invalid');
    expect((await run(`${started.cookie.value}x`)).error).toBe('oauth_state_invalid');
    expect((await run(started.cookie.value, 'facebook')).error).toBe('oauth_state_invalid');
    clock += (OAUTH_FLOW_TTL_SECONDS + 1) * 1000;
    try {
      expect((await run(started.cookie.value)).error).toBe('oauth_state_invalid');
    } finally {
      clock -= (OAUTH_FLOW_TTL_SECONDS + 1) * 1000;
    }
  });

  it.each(PROVIDERS)('%s: recusa no provedor vira oauth_denied', async (provider) => {
    const result = await social(provider, { sub: uniqueSub() }, { failure: 'deny' });
    expect(result.location).toBe('/entrar?erro=oauth_denied');
  });

  it('outro erro do provedor ou retorno sem código: oauth_provider_error', async () => {
    const started = oauth.start({ site: 'classroom', provider: 'google' });
    const state = new URL(started.location).searchParams.get('state') ?? '';
    for (const params of [{ state, error: 'server_error' }, { state }]) {
      const result = await oauth.callback(db, {
        site: 'classroom',
        provider: 'google',
        params,
        cookie: started.cookie.value,
        user: null,
        context: ctx(),
      });
      expect(result.error).toBe('oauth_provider_error');
    }
  });

  const failures: [AuthProvider, FakeOAuthFailure][] = [
    ['google', 'exchange'],
    ['facebook', 'exchange'],
    ['apple', 'exchange'],
    ['google', 'bad_signature'],
    ['apple', 'bad_signature'],
    ['google', 'bad_nonce'],
    ['apple', 'bad_nonce'],
    ['google', 'bad_audience'],
  ];
  it.each(failures)('%s: falha %s vira oauth_provider_error', async (provider, failure) => {
    const email = uniqueEmail();
    const result = await social(provider, { sub: uniqueSub(), email }, { failure });
    expect(result).toMatchObject({ location: '/entrar?erro=oauth_provider_error', session: null });
    const created = await db.selectFrom('users').select('id').where('email', '=', email).execute();
    expect(created).toEqual([]);
  });

  it('provedor fora do ar (fetch falha): oauth_provider_error', async () => {
    const down = createOAuth(
      loadConfig({
        env: { DATABASE_URL: testDb.url, SESSION_SECRET: SECRET, NUVA_OAUTH_MOCK_URL: fake.url },
      }),
      {
        fetch: () => Promise.reject(new TypeError('fetch failed')),
      },
    );
    for (const provider of PROVIDERS) {
      const started = down.start({ site: 'classroom', provider });
      const callback = fake.authorize(started.location, { sub: uniqueSub() });
      const result = await down.callback(db, {
        site: 'classroom',
        provider,
        params: callback.params,
        cookie: started.cookie.value,
        user: null,
        context: ctx(),
      });
      expect(result.error).toBe('oauth_provider_error');
    }
  });
});

describe('tabela de vínculo: login', () => {
  it.each(PROVIDERS)(
    '%s: identidade já vinculada entra na conta (auth.login com o método)',
    async (provider) => {
      const sub = uniqueSub();
      const email = uniqueEmail();
      const first = await social(provider, { sub, email, name: 'Pessoa Social' });
      expect(first.outcome).toBe('pending');
      const done = await complete(first);
      const second = await social(
        provider,
        { sub, email, name: 'Pessoa Social' },
        { returnTo: '/cursos' },
      );
      expect(second).toMatchObject({ outcome: 'login', location: '/cursos', error: null });
      expect(second.cookie.options.maxAge).toBe(0);
      const session = await sessionUserOf(second);
      expect(session.user.id).toBe(done.session.user.id);
      const logins = (await auditActions(done.session.user.id)).filter(
        (row) => row.action === 'auth.login',
      );
      expect(logins.map((row) => row.details)).toEqual([
        { method: provider },
        { method: provider },
      ]);
    },
  );

  it.each(PROVIDERS)(
    '%s: e-mail verificado de conta existente vincula e entra',
    async (provider) => {
      const user = await makeUser({ verified: true });
      const result = await social(provider, { sub: uniqueSub(), email: user.email.toUpperCase() });
      expect(result.outcome).toBe('login');
      expect((await sessionUserOf(result)).user.id).toBe(user.id);
      const identities = await listIdentities(db, user.id);
      expect(identities).toMatchObject({
        hasPassword: true,
        items: [{ provider, email: user.email }],
      });
      expect((await userRow(user.id)).password).toBe(PASSWORD);
      const link = (await auditActions(user.id)).find((row) => row.action === 'auth.provider_link');
      expect(link?.details).toEqual({ provider, via: 'email' });
      // A mesma conta entra por senha também (RF-04).
      await loginWithPassword(db, {
        site: 'classroom',
        email: user.email,
        password: PASSWORD,
        context: ctx(),
      });
    },
  );

  it.each(PROVIDERS)(
    '%s: conta sem e-mail confirmado passa a ter, perde a senha anterior e as sessões',
    async (provider) => {
      const user = await makeUser({ verified: false });
      const squatter = await db
        .transaction()
        .execute((trx) =>
          createSession(trx, { userId: user.id, site: 'classroom', context: ctx() }),
        );
      const result = await social(provider, { sub: uniqueSub(), email: user.email });
      expect(result.outcome).toBe('login');
      const row = await userRow(user.id);
      expect(row.password).toBeNull();
      expect(row.emailVerifiedAt).not.toBeNull();
      await rejects(
        loginWithPassword(db, {
          site: 'classroom',
          email: user.email,
          password: PASSWORD,
          context: ctx(),
        }),
        'invalid_credentials',
      );
      await rejects(
        authenticateSession(db, { token: squatter.token, site: 'classroom' }),
        'unauthenticated',
      );
      expect((await sessionUserOf(result)).user.id).toBe(user.id);
    },
  );

  it.each(PROVIDERS)('%s: e-mail verificado sem conta vira cadastro pendente', async (provider) => {
    const email = uniqueEmail();
    const result = await social(provider, { sub: uniqueSub(), email, name: 'Nova Pessoa' });
    expect(result).toMatchObject({
      outcome: 'pending',
      location: '/cadastro/social',
      session: null,
    });
    expect(result.cookie.options.maxAge).toBe(OAUTH_PENDING_TTL_SECONDS);
    const pending = await oauth.pending(db, result.cookie.value);
    expect(pending).toEqual({
      provider,
      email,
      emailVerified: true,
      name: 'Nova Pessoa',
      terms: [],
    });
    expect(Object.keys(pending)).not.toContain('providerUserId');
    const done = await complete(result);
    expect(done.returnTo).toBe('/painel');
    expect(done.cookie.options.maxAge).toBe(0);
    expect(done.view.user).toMatchObject({
      email,
      name: 'Nova Pessoa',
      emailVerified: true,
      hasPassword: false,
      role: 'student',
    });
    const row = await userRow(done.session.user.id);
    expect(row.password).toBeNull();
    expect(await outboxTypes(done.session.user.id)).not.toContain('account.verify_email');
    const link = (await auditActions(done.session.user.id)).find(
      (r) => r.action === 'auth.provider_link',
    );
    expect(link?.details).toEqual({ provider, via: 'signup' });
    // Conta criada pelo provedor, sem senha: o login por senha é recusado (critério da 007).
    for (const password of ['', '   ', 'qualquer-texto-1']) {
      await rejects(
        loginWithPassword(db, { site: 'classroom', email, password, context: ctx() }),
        'invalid_credentials',
      );
    }
  });

  it.each(['google', 'apple'] as const)(
    '%s: e-mail não verificado não vincula por e-mail; a conta nasce não confirmada',
    async (provider) => {
      const owner = await makeUser({ verified: true });
      const result = await social(provider, {
        sub: uniqueSub(),
        email: owner.email,
        emailVerified: false,
      });
      expect(result.outcome).toBe('pending');
      expect(await listIdentities(db, owner.id)).toMatchObject({ items: [] });
      const pending = await oauth.pending(db, result.cookie.value);
      expect(pending).toMatchObject({ email: owner.email, emailVerified: false });
      // O e-mail do provedor é de outra conta: email_taken.
      await rejects(complete(result), 'email_taken');

      const email = uniqueEmail();
      const fresh = await social(provider, { sub: uniqueSub(), email, emailVerified: false });
      const done = await complete(fresh, { email: uniqueEmail('ignorado') });
      expect(done.view.user).toMatchObject({ email, emailVerified: false });
      expect(await outboxTypes(done.session.user.id)).toContain('account.verify_email');
    },
  );

  it.each(PROVIDERS)('%s: sem e-mail, o cadastro pendente pede o e-mail', async (provider) => {
    const result = await social(provider, { sub: uniqueSub(), email: null, name: null });
    const pending = await oauth.pending(db, result.cookie.value);
    expect(pending).toMatchObject({ provider, email: null, emailVerified: false, name: null });
    await rejects(complete(result), 'validation_failed');
    await rejects(complete(result, { email: 'nao-e-email' }), 'validation_failed');
    const taken = await makeUser();
    await rejects(complete(result, { email: taken.email }), 'email_taken');
    const email = uniqueEmail('digitado');
    const done = await complete(result, { email: `  ${email.toUpperCase()} ` });
    expect(done.view.user).toMatchObject({
      email,
      emailVerified: false,
      name: email.split('@')[0],
    });
    expect(await outboxTypes(done.session.user.id)).toContain('account.verify_email');
    expect((await listIdentities(db, done.session.user.id)).items).toMatchObject([
      { provider, email: null },
    ]);
  });

  it('facebook: e-mail não confirmado não chega (o Graph não devolve) e não vincula por e-mail', async () => {
    const owner = await makeUser();
    const result = await social('facebook', {
      sub: uniqueSub(),
      email: owner.email,
      emailVerified: false,
    });
    expect(result.outcome).toBe('pending');
    expect(await oauth.pending(db, result.cookie.value)).toMatchObject({
      email: null,
      emailVerified: false,
    });
  });

  it('apple com e-mail oculto: conta própria com o e-mail de retransmissão, verificado', async () => {
    const owner = await makeUser();
    const sub = uniqueSub();
    const result = await social('apple', {
      sub,
      email: owner.email,
      hideEmail: true,
      name: 'Ana Maçã',
    });
    expect(result.outcome).toBe('pending');
    const pending = await oauth.pending(db, result.cookie.value);
    expect(pending.email).toMatch(/@privaterelay\.appleid\.com$/);
    expect(pending).toMatchObject({ emailVerified: true, name: 'Ana Maçã' });
    const done = await complete(result);
    expect(done.view.user).toMatchObject({ email: pending.email, emailVerified: true });
    expect(done.session.user.id).not.toBe(owner.id);
    // Unida à outra conta só pelo vínculo manual: aqui já está em uso.
    const ownerSession = { id: owner.id, role: 'student' as const };
    const link = await social(
      'apple',
      { sub, hideEmail: true },
      { intent: 'link', user: ownerSession },
    );
    expect(link.location).toBe('/conta/acesso?erro=identity_in_use');
  });

  it('apple: o nome vem só na primeira autorização; sem nome, a parte local do e-mail', async () => {
    const email = uniqueEmail('maca');
    const result = await social('apple', {
      sub: uniqueSub(),
      email,
      name: 'Nome',
      firstAuthorization: false,
    });
    const done = await complete(result);
    expect(done.view.user.name).toBe(email.split('@')[0]);
    expect(appleUserName('{"name":{"firstName":"Ana","lastName":"Souza"}}')).toBe('Ana Souza');
    expect(appleUserName('{"name":{}}')).toBeNull();
    expect(appleUserName('{quebrado')).toBeNull();
    expect(appleUserName(undefined)).toBeNull();
    expect(accountNameFor('  ', 'ze@example.com')).toBe('ze');
    expect([...accountNameFor('x'.repeat(200), 'a@b.c')]).toHaveLength(80);
  });

  it('conta com suspensão full: account_suspended, sem sessão e sem vínculo', async () => {
    const admin = await makeUser({ role: 'manager' });
    const user = await makeUser();
    await db
      .updateTable('users')
      .set({
        suspendedAt: new Date(),
        suspendedKind: 'full',
        suspendedReason: 'teste',
        suspendedBy: admin.id,
      })
      .where('id', '=', user.id)
      .execute();
    const result = await social('google', { sub: uniqueSub(), email: user.email });
    expect(result).toMatchObject({ location: '/entrar?erro=account_suspended', session: null });
    expect((await listIdentities(db, user.id)).items).toEqual([]);
  });

  it('e-mail verificado de conta que já tem outra identidade do provedor: provider_already_linked', async () => {
    const user = await makeUser();
    expect((await social('google', { sub: uniqueSub(), email: user.email })).outcome).toBe('login');
    const second = await social('google', { sub: uniqueSub(), email: user.email });
    expect(second.location).toBe('/entrar?erro=provider_already_linked');
  });
});

describe('tabela de vínculo: vínculo manual (intent=link)', () => {
  it.each(PROVIDERS)(
    '%s: vincula à conta logada, grava auth.provider_link e volta ao returnTo',
    async (provider) => {
      const user = await makeUser();
      const me = { id: user.id, role: 'student' as const };
      const sub = uniqueSub();
      const result = await social(
        provider,
        { sub, email: uniqueEmail('outro') },
        {
          intent: 'link',
          user: me,
          returnTo: '/conta/acesso',
        },
      );
      expect(result).toMatchObject({ outcome: 'linked', location: '/conta/acesso', session: null });
      expect((await listIdentities(db, user.id)).items).toMatchObject([{ provider }]);
      const link = (await auditActions(user.id)).find((row) => row.action === 'auth.provider_link');
      expect(link?.details).toEqual({ provider, via: 'manual' });
      // A mesma identidade de novo conta como vínculo feito.
      const again = await social(provider, { sub }, { intent: 'link', user: me });
      expect(again.outcome).toBe('linked');
      // Outra identidade do mesmo provedor: provider_already_linked.
      const other = await social(provider, { sub: uniqueSub() }, { intent: 'link', user: me });
      expect(other.location).toBe('/conta/acesso?erro=provider_already_linked');
      // A identidade em outra conta: identity_in_use.
      const stranger = await makeUser();
      const taken = await social(
        provider,
        { sub },
        { intent: 'link', user: { id: stranger.id, role: 'student' } },
      );
      expect(taken.location).toBe('/conta/acesso?erro=identity_in_use');
      // Login pela identidade vinculada entra na conta.
      const login = await social(provider, { sub });
      expect((await sessionUserOf(login)).user.id).toBe(user.id);
    },
  );

  it('o retorno do vínculo exige a mesma sessão que o iniciou', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const started = oauth.start({ site: 'classroom', provider: 'google', intent: 'link', user });
    const callback = fake.authorize(started.location, { sub: uniqueSub() });
    for (const sessionUser of [null, { id: other.id, role: 'student' as const }]) {
      const result = await oauth.callback(db, {
        site: 'classroom',
        provider: 'google',
        params: callback.params,
        cookie: started.cookie.value,
        user: sessionUser,
        context: ctx(),
      });
      expect(result.location).toBe('/conta/acesso?erro=oauth_state_invalid');
    }
  });

  it('remover o último método é recusado; com senha, remove (auth.provider_unlink)', async () => {
    const pending = await social('google', { sub: uniqueSub(), email: uniqueEmail() });
    const done = await complete(pending);
    const me = { id: done.session.user.id, role: 'student' as const };
    const remove = (provider: string) =>
      removeIdentity(db, { user: me, provider, site: 'classroom', context: ctx() });
    await rejects(remove('google'), 'last_login_method');
    expect(
      (await social('facebook', { sub: uniqueSub() }, { intent: 'link', user: me })).outcome,
    ).toBe('linked');
    await remove('google');
    expect((await listIdentities(db, me.id)).items).toMatchObject([{ provider: 'facebook' }]);
  });

  it('segunda identidade Google na mesma conta é recusada também pelo banco', async () => {
    const user = await makeUser();
    await db
      .insertInto('oauthIdentities')
      .values({ userId: user.id, provider: 'google', providerUserId: uniqueSub() })
      .execute();
    let caught: unknown;
    try {
      await db
        .insertInto('oauthIdentities')
        .values({ userId: user.id, provider: 'google', providerUserId: uniqueSub() })
        .execute();
    } catch (error) {
      caught = error;
    }
    expect(translateUniqueViolation(caught)).toMatchObject({
      code: 'provider_already_linked',
      status: 409,
    });
    const sub = uniqueSub();
    await db
      .insertInto('oauthIdentities')
      .values({ userId: user.id, provider: 'apple', providerUserId: sub })
      .execute();
    const stranger = await makeUser();
    try {
      await db
        .insertInto('oauthIdentities')
        .values({ userId: stranger.id, provider: 'apple', providerUserId: sub })
        .execute();
      caught = null;
    } catch (error) {
      caught = error;
    }
    expect(translateUniqueViolation(caught)).toMatchObject({
      code: 'identity_in_use',
      status: 409,
    });
    const other = new Error('outro');
    expect(translateUniqueViolation(other)).toBe(other);
  });
});

describe('site admin', () => {
  it.each(PROVIDERS)(
    '%s: equipe vinculada por e-mail entra; aluno e desconhecido voltam com staff_only',
    async (provider) => {
      const manager = await makeUser({ role: 'manager' });
      const sub = uniqueSub();
      const entered = await social(
        provider,
        { sub, email: manager.email },
        { site: 'admin', returnTo: '/usuarios' },
      );
      expect(entered).toMatchObject({ outcome: 'login', location: '/usuarios' });
      expect(entered.cookie.name).toBe('nuva_admin_oauth');
      const session = await authenticateSession(db, {
        token: entered.session?.token ?? '',
        site: 'admin',
      });
      expect(session.user.id).toBe(manager.id);
      // Já vinculada: entra de novo pela identidade.
      expect((await social(provider, { sub }, { site: 'admin' })).outcome).toBe('login');

      const student = await makeUser();
      const refused = await social(
        provider,
        { sub: uniqueSub(), email: student.email },
        { site: 'admin' },
      );
      expect(refused).toMatchObject({ location: '/entrar?erro=staff_only', session: null });
      expect((await listIdentities(db, student.id)).items).toEqual([]);
      // Sem conta: não há cadastro pelo admin.
      const unknown = await social(
        provider,
        { sub: uniqueSub(), email: uniqueEmail() },
        { site: 'admin' },
      );
      expect(unknown.location).toBe('/entrar?erro=staff_only');
    },
  );

  it('identidade vinculada a um aluno: staff_only no admin', async () => {
    const result = await social('google', { sub: uniqueSub(), email: uniqueEmail() });
    const done = await complete(result);
    const sub = (
      await db
        .selectFrom('oauthIdentities')
        .select('providerUserId')
        .where('userId', '=', done.session.user.id)
        .executeTakeFirstOrThrow()
    ).providerUserId;
    expect((await social('google', { sub }, { site: 'admin' })).location).toBe(
      '/entrar?erro=staff_only',
    );
  });

  it('o cadastro pendente não vale fora do classroom e some sem cookie', async () => {
    await rejects(oauth.pending(db, undefined), 'not_found');
    await rejects(
      oauth.complete(db, { cookie: 'x.y', acceptedTerms: [], context: ctx() }),
      'not_found',
    );
    const started = oauth.start({ site: 'classroom', provider: 'google' });
    // Cookie de ida (não pendente) também não serve.
    await rejects(oauth.pending(db, started.cookie.value), 'not_found');
  });
});

describe('cadastro pendente com termos publicados', () => {
  it('exige o aceite das vigentes e grava os aceites', async () => {
    const ids = await db.transaction().execute(async (trx) => {
      const terms = await createTermsDraft(trx, { document: 'terms', bodyMd: '# Termos' });
      const privacy = await createTermsDraft(trx, { document: 'privacy', bodyMd: '# Privacidade' });
      await publishTermsVersion(trx, terms.id, { origin: 'cli' });
      await publishTermsVersion(trx, privacy.id, { origin: 'cli' });
      return [terms.id, privacy.id];
    });
    const result = await social('facebook', {
      sub: uniqueSub(),
      email: uniqueEmail(),
      name: 'Com Termos',
    });
    const pending = await oauth.pending(db, result.cookie.value);
    expect(pending.terms.map((version) => version.id).sort()).toEqual([...ids].sort());
    await rejects(
      complete(result, { acceptedTerms: [ids[0] as string] }),
      'terms_acceptance_required',
    );
    const done = await complete(result, { acceptedTerms: ids });
    const accepted = await db
      .selectFrom('termsAcceptances')
      .select('termsVersionId')
      .where('userId', '=', done.session.user.id)
      .execute();
    expect(accepted.map((row) => row.termsVersionId).sort()).toEqual([...ids].sort());
    expect(done.view.termsPending).toEqual([]);
    // O mesmo cookie não cria uma segunda conta.
    await rejects(complete(result, { acceptedTerms: ids }), 'identity_in_use');
  });
});

describe('montagem dos provedores', () => {
  it('reais por padrão, simulador com NUVA_OAUTH_MOCK_URL, internos na troca do código', () => {
    const endpoints = mockProviderEndpoints({
      url: 'http://oauth-mock.localhost',
      internalUrl: 'http://oauth-mock:8080',
    });
    expect(endpoints.google).toEqual({
      authorization: 'http://oauth-mock.localhost/google/o/oauth2/v2/auth',
      token: 'http://oauth-mock:8080/google/token',
      jwks: 'http://oauth-mock:8080/google/oauth2/v3/certs',
      issuers: ['http://oauth-mock.localhost/google'],
    });
    expect(endpoints.apple.issuer).toBe('http://oauth-mock.localhost/apple');
    expect(endpoints.facebook.me).toBe('http://oauth-mock:8080/facebook/v27.0/me');
    expect(REAL_PROVIDER_ENDPOINTS.apple.issuer).toBe('https://appleid.apple.com');

    const onlyGoogle = {
      authProviders: { google: { clientId: 'id', clientSecret: 's' }, facebook: null, apple: null },
      oauthMock: null,
    };
    const providers = createOAuthProviders(onlyGoogle);
    expect(Object.keys(providers)).toEqual(['google']);
    expect(enabledAuthProviders(onlyGoogle)).toEqual(['google']);
    expect(
      providers.google?.authorizationUrl({
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
        redirectUri: 'https://x/cb',
      }),
    ).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  });

  it('chave da Apple inválida vira oauth_provider_error', async () => {
    const config = loadConfig({
      env: { DATABASE_URL: testDb.url, SESSION_SECRET: SECRET, NUVA_OAUTH_MOCK_URL: fake.url },
    });
    const broken = createOAuth(
      {
        ...config,
        authProviders: {
          ...config.authProviders,
          apple: { ...OAUTH_MOCK_CLIENTS.apple, privateKey: 'nada' },
        },
      },
      { fetch: fake.fetch },
    );
    const started = broken.start({ site: 'classroom', provider: 'apple' });
    const callback = fake.authorize(started.location, { sub: uniqueSub() });
    const result = await broken.callback(db, {
      site: 'classroom',
      provider: 'apple',
      params: callback.params,
      cookie: started.cookie.value,
      user: null,
      context: ctx(),
    });
    expect(result.error).toBe('oauth_provider_error');
  });

  it('destinos de erro e endereço de retorno', () => {
    expect(oauthErrorLocation('login', 'oauth_denied')).toBe('/entrar?erro=oauth_denied');
    expect(oauthErrorLocation('link', 'identity_in_use')).toBe(
      '/conta/acesso?erro=identity_in_use',
    );
    expect(
      oauthCallbackUrl({ classroomUrl: 'https://c', adminUrl: 'https://a' }, 'admin', 'apple'),
    ).toBe('https://a/api/v1/auth/apple/callback');
  });

  it('o provedor falso recusa cliente, PKCE e endereço errados', async () => {
    const started = oauth.start({ site: 'classroom', provider: 'google' });
    const url = new URL(started.location);
    url.searchParams.set('client_id', 'outro');
    expect(() => fake.authorize(url.toString(), { sub: 'x' })).toThrow(/client_id/);
    const noPkce = new URL(started.location);
    noPkce.searchParams.delete('code_challenge');
    expect(() => fake.authorize(noPkce.toString(), { sub: 'x' })).toThrow(/code_challenge/);
    expect(() => fake.authorize('https://outro.test/google/x', { sub: 'x' })).toThrow(/fora/);
    await expect(fake.fetch('https://outro.test/x')).rejects.toThrow(TypeError);
    expect((await fake.fetch(`${fake.url}/nada`)).status).toBe(404);
    expect(fake.requests.length).toBeGreaterThan(0);
  });
});
