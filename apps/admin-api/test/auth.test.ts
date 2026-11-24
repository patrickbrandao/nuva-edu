import { createSession, hashSessionToken, SESSION_RENEW_INTERVAL_SECONDS } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  nextIp,
  sessionCookieOf,
  TEST_PASSWORD,
  type TestApp,
  type TestUser,
} from './helpers.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

/** Toda resposta deste arquivo passa por aqui, para a varredura da senha no fim. */
const bodies: string[] = [];
const headersSeen: string[] = [];

interface CallOptions {
  method: 'GET' | 'POST';
  url: string;
  remoteAddress?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  payload?: string | object;
}

async function call(options: CallOptions) {
  const response = await test.app.inject(options);
  bodies.push(response.body);
  headersSeen.push(JSON.stringify(response.headers));
  return response;
}

async function login(user: Pick<TestUser, 'email' | 'password'>, ip = nextIp()) {
  return call({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: ip,
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/130.0.0.0 Safari/537.36' },
    payload: { email: user.email, password: user.password },
  });
}

/** Login que precisa dar certo: devolve o cookie e o corpo. */
async function signIn(user: TestUser) {
  const response = await login(user);
  expect(response.statusCode).toBe(200);
  const cookie = sessionCookieOf(response.headers['set-cookie']);
  expect(cookie).toBeTruthy();
  return { cookie: cookie as string, body: response.json() };
}

/** Sessão do admin aberta direto no banco, para papéis que o login recusa. */
async function openSession(userId: string, site: 'admin' | 'classroom' = 'admin') {
  return test.db
    .transaction()
    .execute((trx) =>
      createSession(trx, { userId, site, context: { ip: nextIp(), userAgent: null } }),
    );
}

describe('POST /api/v1/auth/login', () => {
  it('abre a sessão da equipe: 200 Session, cookie com os atributos da spec e no-store', async () => {
    const manager = await createUser(test.db, { role: 'manager' });
    const response = await login(manager);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body).toMatchObject({
      user: { id: manager.id, email: manager.email, role: 'manager', hasPassword: true },
      csrfToken: expect.any(String),
      permissions: expect.arrayContaining(['admin.access', 'users.list']),
    });
    expect(body).not.toHaveProperty('termsPending');
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^nuva_admin_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain('Max-Age=2592000');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Domain');

    const audit = await test.db
      .selectFrom('auditLog')
      .select(['origin', 'actorUserId', 'outcome'])
      .where('action', '=', 'auth.login')
      .where('targetId', '=', manager.id)
      .execute();
    expect(audit).toEqual([{ origin: 'admin_panel', actorUserId: manager.id, outcome: 'ok' }]);
  });

  it('senha errada e e-mail inexistente: 401 invalid_credentials, sem cookie', async () => {
    const manager = await createUser(test.db);
    for (const attempt of [
      { email: manager.email, password: 'outra-senha-qualquer' },
      { email: 'ninguem@example.com', password: TEST_PASSWORD },
    ]) {
      const response = await login(attempt);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'invalid_credentials' });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('aluno com a senha certa: 403 staff_only, sem sessão', async () => {
    const student = await createUser(test.db, { role: 'student' });
    const response = await login(student);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'staff_only' });
    expect(response.headers['set-cookie']).toBeUndefined();
    const sessions = await test.db
      .selectFrom('sessions')
      .select('id')
      .where('userId', '=', student.id)
      .execute();
    expect(sessions).toEqual([]);
  });

  it('conta com suspensão full: 403 account_suspended', async () => {
    const manager = await createUser(test.db);
    await test.db
      .updateTable('users')
      .set({ suspendedAt: new Date(), suspendedKind: 'full', suspendedReason: 'teste' })
      .where('id', '=', manager.id)
      .execute();
    const response = await login(manager);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'account_suspended' });
  });

  it('5 senhas erradas bloqueiam: 429 too_many_attempts com Retry-After', async () => {
    const manager = await createUser(test.db);
    for (let i = 0; i < 5; i += 1) {
      expect((await login({ email: manager.email, password: `errada-${i}-xyz` })).statusCode).toBe(
        401,
      );
    }
    const response = await login(manager);
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'too_many_attempts' });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.json().retryAfterSeconds).toBe(Number(response.headers['retry-after']));
  });

  it('corpo fora de application/json: 415', async () => {
    const response = await call({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: nextIp(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=a%40b.c&password=x',
    });
    expect(response.statusCode).toBe(415);
  });

  it('limite de 20 por minuto por IP nas rotas de autenticação (003 RNF-03)', async () => {
    const ip = nextIp();
    for (let i = 0; i < 20; i += 1) {
      // Corpo inválido: o limite conta antes da validação, sem tocar no banco.
      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: ip,
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }
    const limited = await call({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ip,
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Outro IP segue livre.
    expect(
      (
        await call({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: nextIp(),
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('GET /api/v1/session', () => {
  it('devolve a sessão aberta no login, com no-store', async () => {
    const instructor = await createUser(test.db, { role: 'instructor' });
    const { cookie, body } = await signIn(instructor);
    const response = await call({
      method: 'GET',
      url: '/api/v1/session',
      cookies: { nuva_admin_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(body);
    expect(response.json().permissions).not.toContain('audit.view');
  });

  it('sem cookie: 401 unauthenticated, sem Set-Cookie', async () => {
    const response = await call({ method: 'GET', url: '/api/v1/session' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('cookie inválido ou de sessão do classroom: 401 e o cookie é apagado', async () => {
    const manager = await createUser(test.db);
    const classroom = await openSession(manager.id, 'classroom');
    for (const value of ['nao-e-uma-sessao', classroom.token]) {
      const response = await call({
        method: 'GET',
        url: '/api/v1/session',
        cookies: { nuva_admin_session: value },
      });
      expect(response.statusCode).toBe(401);
      const setCookie = String(response.headers['set-cookie']);
      expect(setCookie).toMatch(/^nuva_admin_session=;/);
      expect(setCookie).toContain('Path=/');
    }
  });

  it('sessão de aluno: 403 permission_denied e auditoria com outcome denied', async () => {
    const student = await createUser(test.db, { role: 'student' });
    const session = await openSession(student.id);
    const response = await call({
      method: 'GET',
      url: '/api/v1/session',
      remoteAddress: '203.0.113.77',
      headers: { 'x-request-id': 'req-aluno-negado' },
      cookies: { nuva_admin_session: session.token },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
    const denied = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('actorUserId', '=', student.id)
      .where('outcome', '=', 'denied')
      .execute();
    expect(denied).toMatchObject([
      {
        action: 'admin.access',
        origin: 'admin_panel',
        actorRole: 'student',
        requestId: 'req-aluno-negado',
        ip: '203.0.113.77',
      },
    ]);
    expect(denied[0]?.details).toEqual({ operation: 'getSession', permission: 'admin.access' });
  });

  it('renova o cookie com o Max-Age cheio quando a validação renova a sessão', async () => {
    const manager = await createUser(test.db);
    const { cookie } = await signIn(manager);
    // Sem a renovação, nenhum Set-Cookie.
    const fresh = await call({
      method: 'GET',
      url: '/api/v1/session',
      cookies: { nuva_admin_session: cookie },
    });
    expect(fresh.headers['set-cookie']).toBeUndefined();
    await test.db
      .updateTable('sessions')
      .set({
        lastUsedAt: new Date(Date.now() - (SESSION_RENEW_INTERVAL_SECONDS + 5) * 1000),
      })
      .where('idHash', '=', hashSessionToken(cookie))
      .execute();
    const renewed = await call({
      method: 'GET',
      url: '/api/v1/session',
      cookies: { nuva_admin_session: cookie },
    });
    expect(renewed.statusCode).toBe(200);
    const setCookie = String(renewed.headers['set-cookie']);
    expect(setCookie).toContain(`nuva_admin_session=${cookie};`);
    expect(setCookie).toContain('Max-Age=2592000');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('sem X-CSRF-Token válido: 403 csrf_token_invalid e a sessão continua', async () => {
    const manager = await createUser(test.db);
    const { cookie } = await signIn(manager);
    for (const headers of [{}, { 'x-csrf-token': 'token-errado' }]) {
      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/logout',
        remoteAddress: nextIp(),
        headers,
        cookies: { nuva_admin_session: cookie },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'csrf_token_invalid' });
    }
    const session = await call({
      method: 'GET',
      url: '/api/v1/session',
      cookies: { nuva_admin_session: cookie },
    });
    expect(session.statusCode).toBe(200);
  });

  it('encerra a sessão atual: 204, cookie apagado, auth.logout na auditoria', async () => {
    const admin = await createUser(test.db, { role: 'admin' });
    const { cookie, body } = await signIn(admin);
    const other = await signIn(admin);
    const response = await call({
      method: 'POST',
      url: '/api/v1/auth/logout',
      remoteAddress: nextIp(),
      headers: { 'x-csrf-token': body.csrfToken },
      cookies: { nuva_admin_session: cookie },
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(String(response.headers['set-cookie'])).toMatch(/^nuva_admin_session=;/);
    const after = await call({
      method: 'GET',
      url: '/api/v1/session',
      cookies: { nuva_admin_session: cookie },
    });
    expect(after.statusCode).toBe(401);
    // A outra sessão do mesmo usuário continua.
    const kept = await call({
      method: 'GET',
      url: '/api/v1/session',
      cookies: { nuva_admin_session: other.cookie },
    });
    expect(kept.statusCode).toBe(200);
    const audit = await test.db
      .selectFrom('auditLog')
      .select('action')
      .where('targetId', '=', admin.id)
      .where('action', '=', 'auth.logout')
      .execute();
    expect(audit).toHaveLength(1);
  });
});

describe('varredura da senha (ADR 0002, spec 007 RNF-05)', () => {
  it('a senha de teste não aparece em nenhuma resposta nem no log', () => {
    expect(bodies.length).toBeGreaterThan(20);
    for (const text of [...bodies, ...headersSeen, test.logText()]) {
      expect(text).not.toContain(TEST_PASSWORD);
    }
  });
});
