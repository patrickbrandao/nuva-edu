import { hashSessionToken } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import { CLASSROOM_RATE_LIMITS } from '../src/rate-limits.ts';
import {
  Browser,
  COOKIE,
  createUser,
  emailToken,
  OTHER_PASSWORD,
  type Reply,
  TEST_PASSWORD,
  uniqueEmail,
} from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

const opened: TestApp[] = [];
function open(...args: Parameters<typeof createTestApp>): TestApp {
  const test = createTestApp(...args);
  opened.push(test);
  return test;
}

const test = open();
const { db } = test;

/** Varredura: nenhuma resposta leva a senha de teste (spec 007, critério de saída da Fase 1). */
function scan(reply: Reply): void {
  const seen = JSON.stringify(reply.headers) + reply.body;
  expect(seen).not.toContain(TEST_PASSWORD);
  expect(seen).not.toContain(OTHER_PASSWORD);
}
const browser = () => new Browser(test.app, scan);

afterAll(async () => {
  // Nem os logs da suíte deste arquivo levam a senha.
  for (const app of opened) {
    expect(app.logText()).not.toContain(TEST_PASSWORD);
    expect(app.logText()).not.toContain(OTHER_PASSWORD);
  }
  await Promise.all(opened.map((app) => app.close()));
});

function outboxTypes(userId: string): Promise<string[]> {
  return db
    .selectFrom('emailOutbox')
    .select('type')
    .where('userId', '=', userId)
    .orderBy('createdAt')
    .execute()
    .then((rows) => rows.map((row) => row.type));
}

describe('POST /api/v1/auth/register', () => {
  it('cria a conta student não confirmada, sem abrir sessão, e enfileira a confirmação', async () => {
    const email = uniqueEmail();
    const reply = await browser().request('POST', '/api/v1/auth/register', {
      payload: {
        name: 'Ana',
        email: email.toUpperCase(),
        password: TEST_PASSWORD,
        acceptedTerms: [],
      },
    });
    expect(reply.statusCode).toBe(204);
    expect(reply.cookies).toEqual([]);
    const user = await db
      .selectFrom('users')
      .select(['id', 'role', 'emailVerifiedAt'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({ role: 'student', emailVerifiedAt: null });
    expect(await outboxTypes(user.id)).toEqual(['account.verify_email']);
  });

  it('e-mail já cadastrado: mesma resposta, nada muda, e o dono recebe account.exists', async () => {
    const existing = await createUser(db);
    const reply = await browser().request('POST', '/api/v1/auth/register', {
      payload: {
        name: 'Outra',
        email: existing.email,
        password: OTHER_PASSWORD,
        acceptedTerms: [],
      },
    });
    expect(reply.statusCode).toBe(204);
    expect(reply.body).toBe('');
    expect(await outboxTypes(existing.id)).toEqual(['account.exists']);
    // A senha não mudou: a antiga continua entrando.
    expect((await browser().login(existing.email)).statusCode).toBe(200);
  });

  it('senha fora de 8 a 128 caracteres: 400 password_invalid', async () => {
    for (const password of ['curta', 'x'.repeat(129), '        ']) {
      const reply = await browser().request('POST', '/api/v1/auth/register', {
        payload: { name: 'Ana', email: uniqueEmail(), password, acceptedTerms: [] },
      });
      expect(reply.statusCode).toBe(400);
      expect(reply.json()).toMatchObject({ code: 'password_invalid' });
    }
  });

  it('campo fora do contrato: 400 validation_failed; corpo que não é JSON: 415', async () => {
    const invalid = await browser().request('POST', '/api/v1/auth/register', {
      payload: { name: '', email: 'nao-e-email', password: TEST_PASSWORD, acceptedTerms: [] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'validation_failed' });

    const form = await browser().request('POST', '/api/v1/auth/register', {
      payload: `name=Ana&email=${uniqueEmail()}&password=${TEST_PASSWORD}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(form.statusCode).toBe(415);
    expect(form.json()).toMatchObject({ code: 'unsupported_media_type' });
  });
});

describe('POST /api/v1/auth/login e GET /api/v1/session', () => {
  it('abre a sessão: cookie HttpOnly/Secure/Lax, corpo Session e no-store', async () => {
    const user = await createUser(db);
    const client = browser();
    const reply = await client.login(user.email.toUpperCase());
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    const cookie = reply.cookies.find((item) => item.name === COOKIE);
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: test.config.retention.sessionDays * 86_400,
    });
    expect(cookie).not.toHaveProperty('domain');
    expect(reply.json()).toMatchObject({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: true,
        role: 'student',
        avatarUrl: null,
        hasPassword: true,
      },
      termsPending: [],
    });
    expect(reply.json().permissions).toContain('account.self_service');
    // O banco guarda só o hash do identificador do cookie.
    const stored = await db
      .selectFrom('sessions')
      .select(['idHash', 'site'])
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ idHash: hashSessionToken(cookie?.value ?? ''), site: 'classroom' });

    const current = await client.request('GET', '/api/v1/session');
    expect(current.statusCode).toBe(200);
    expect(current.headers['cache-control']).toBe('no-store');
    expect(current.json()).toMatchObject({ user: { id: user.id }, csrfToken: client.csrfToken });
  });

  it('qualquer falha de credencial é 401 invalid_credentials, com a mesma resposta', async () => {
    const user = await createUser(db);
    const noPassword = await createUser(db, { password: null });
    const cases = [
      { email: user.email, password: OTHER_PASSWORD },
      { email: user.email, password: '' },
      { email: noPassword.email, password: TEST_PASSWORD },
      { email: uniqueEmail(), password: TEST_PASSWORD },
    ];
    const bodies = [];
    for (const payload of cases) {
      const reply = await browser().request('POST', '/api/v1/auth/login', { payload });
      expect(reply.statusCode).toBe(401);
      expect(reply.cookies).toEqual([]);
      const { instance: _instance, ...body } = reply.json();
      bodies.push(body);
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toMatchObject({ code: 'invalid_credentials' });
  });

  it('5 senhas erradas bloqueiam a conta: 429 too_many_attempts com Retry-After, mesmo com a certa', async () => {
    const user = await createUser(db);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Um IP por tentativa: o bloqueio é o da conta, não o do IP.
      expect((await browser().login(user.email, OTHER_PASSWORD)).statusCode).toBe(401);
    }
    const locked = await browser().login(user.email);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'too_many_attempts' });
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(locked.json().retryAfterSeconds).toBe(Number(locked.headers['retry-after']));
  });

  it('conta com suspensão full: 403 account_suspended só depois de a senha conferir', async () => {
    const user = await createUser(db);
    await db
      .updateTable('users')
      .set({ suspendedKind: 'full', suspendedAt: new Date(), suspendedReason: 'teste' })
      .where('id', '=', user.id)
      .execute();
    const wrong = await browser().login(user.email, OTHER_PASSWORD);
    expect(wrong.json()).toMatchObject({ code: 'invalid_credentials' });
    const right = await browser().login(user.email);
    expect(right.statusCode).toBe(403);
    expect(right.json()).toMatchObject({ code: 'account_suspended' });
    expect(right.cookies).toEqual([]);
  });

  it('sem cookie: 401 sem mexer em cookie; cookie inválido: 401 e o cookie é apagado', async () => {
    const anonymous = await browser().request('GET', '/api/v1/session');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: 'unauthenticated' });
    expect(anonymous.cookies).toEqual([]);

    const stale = browser();
    stale.cookie = 'A'.repeat(43);
    const reply = await stale.request('GET', '/api/v1/session');
    expect(reply.statusCode).toBe(401);
    expect(reply.cookies).toEqual([
      expect.objectContaining({ name: COOKIE, value: '', path: '/', httpOnly: true, secure: true }),
    ]);
    expect(stale.cookie).toBeNull();
  });

  it('sessão vencida, de outro site ou de conta suspensa deixa de valer, e o cookie é apagado', async () => {
    const user = await createUser(db);
    const client = browser();
    await client.login(user.email);
    await db
      .updateTable('sessions')
      .set({
        createdAt: new Date(Date.now() - 2 * 86_400_000),
        lastUsedAt: new Date(Date.now() - 86_400_000),
        expiresAt: new Date(Date.now() - 1_000),
      })
      .where('userId', '=', user.id)
      .execute();
    const reply = await client.request('GET', '/api/v1/session');
    expect(reply.statusCode).toBe(401);
    expect(reply.cookies[0]).toMatchObject({ name: COOKIE, value: '' });

    const other = browser();
    await other.login(user.email);
    await db.updateTable('sessions').set({ site: 'admin' }).where('userId', '=', user.id).execute();
    expect((await other.request('GET', '/api/v1/session')).statusCode).toBe(401);
  });

  it('sessão usada depois de um minuto é renovada e o cookie regravado com o Max-Age cheio', async () => {
    const user = await createUser(db);
    const client = browser();
    await client.login(user.email);
    const token = client.cookie;
    await db
      .updateTable('sessions')
      .set({
        lastUsedAt: new Date(Date.now() - 2 * 60_000),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .where('userId', '=', user.id)
      .execute();
    const reply = await client.request('GET', '/api/v1/session');
    expect(reply.statusCode).toBe(200);
    expect(reply.cookies).toEqual([
      expect.objectContaining({
        name: COOKIE,
        value: token,
        maxAge: test.config.retention.sessionDays * 86_400,
      }),
    ]);
    // Logo em seguida não renova de novo: nenhum cookie na resposta.
    expect((await client.request('GET', '/api/v1/session')).cookies).toEqual([]);
  });
});

describe('POST /api/v1/auth/logout e CSRF', () => {
  it('encerra a sessão, apaga o cookie e a sessão deixa de valer', async () => {
    const user = await createUser(db);
    const client = browser();
    await client.login(user.email);
    const token = client.cookie;
    const reply = await client.request('POST', '/api/v1/auth/logout');
    expect(reply.statusCode).toBe(204);
    expect(reply.cookies[0]).toMatchObject({ name: COOKIE, value: '' });
    const audit = await db
      .selectFrom('auditLog')
      .select('action')
      .where('targetId', '=', user.id)
      .where('action', '=', 'auth.logout')
      .execute();
    expect(audit).toHaveLength(1);

    client.cookie = token;
    expect((await client.request('GET', '/api/v1/session')).statusCode).toBe(401);
  });

  it('escrita sem X-CSRF-Token, ou com outro valor: 403 csrf_token_invalid; sem sessão: 401', async () => {
    const user = await createUser(db);
    const client = browser();
    await client.login(user.email);
    const missing = await client.request('POST', '/api/v1/auth/logout', { csrf: false });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toMatchObject({ code: 'csrf_token_invalid' });
    const wrong = await client.request('POST', '/api/v1/auth/logout', {
      csrf: false,
      headers: { 'x-csrf-token': 'outro-token' },
    });
    expect(wrong.json()).toMatchObject({ code: 'csrf_token_invalid' });
    // A sessão continua aberta.
    expect((await client.request('GET', '/api/v1/session')).statusCode).toBe(200);

    const anonymous = await browser().request('POST', '/api/v1/auth/logout');
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('confirmação de e-mail', () => {
  it('POST /auth/email/verify confirma; o mesmo token de novo é 410 token_expired', async () => {
    const user = await createUser(db, { verified: false });
    const token = await emailToken(db, user.id, 'verify');
    const first = await browser().request('POST', '/api/v1/auth/email/verify', {
      payload: { token },
    });
    expect(first.statusCode).toBe(204);
    const row = await db
      .selectFrom('users')
      .select('emailVerifiedAt')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.emailVerifiedAt).not.toBeNull();

    const again = await browser().request('POST', '/api/v1/auth/email/verify', {
      payload: { token },
    });
    expect(again.statusCode).toBe(410);
    expect(again.json()).toMatchObject({ code: 'token_expired' });
    const unknown = await browser().request('POST', '/api/v1/auth/email/verify', {
      payload: { token: 'desconhecido' },
    });
    expect(unknown.json()).toMatchObject({ code: 'token_expired' });
  });

  it('POST /auth/email/resend enfileira até 3 por hora (429 rate_limited); confirmado, 204 sem envio', async () => {
    const user = await createUser(db, { verified: false });
    const client = browser();
    await client.login(user.email);
    for (let sent = 0; sent < 3; sent += 1) {
      expect((await client.request('POST', '/api/v1/auth/email/resend')).statusCode).toBe(204);
    }
    const limited = await client.request('POST', '/api/v1/auth/email/resend');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    const verified = await createUser(db);
    const other = browser();
    await other.login(verified.email);
    expect((await other.request('POST', '/api/v1/auth/email/resend')).statusCode).toBe(204);
    expect(await outboxTypes(verified.id)).not.toContain('account.verify_email');

    const anonymous = await browser().request('POST', '/api/v1/auth/email/resend');
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('redefinição de senha', () => {
  it('POST /auth/password/forgot responde 204 exista ou não a conta, e só a existente recebe o link', async () => {
    const user = await createUser(db);
    for (const email of [user.email, uniqueEmail()]) {
      const reply = await browser().request('POST', '/api/v1/auth/password/forgot', {
        payload: { email },
      });
      expect(reply.statusCode).toBe(204);
    }
    expect(await outboxTypes(user.id)).toEqual(['account.password_reset']);
  });

  it('POST /auth/password/reset define a senha, encerra as sessões e o token não vale de novo', async () => {
    const user = await createUser(db, { verified: false });
    const client = browser();
    await client.login(user.email);
    const token = await emailToken(db, user.id, 'reset');

    const short = await browser().request('POST', '/api/v1/auth/password/reset', {
      payload: { token, password: 'curta' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ code: 'password_invalid' });

    const reply = await browser().request('POST', '/api/v1/auth/password/reset', {
      payload: { token, password: OTHER_PASSWORD },
    });
    expect(reply.statusCode).toBe(204);
    expect(reply.cookies).toEqual([]);
    expect((await client.request('GET', '/api/v1/session')).statusCode).toBe(401);
    expect((await browser().login(user.email)).statusCode).toBe(401);
    const fresh = await browser().login(user.email, OTHER_PASSWORD);
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().user.emailVerified).toBe(true);

    const reused = await browser().request('POST', '/api/v1/auth/password/reset', {
      payload: { token, password: TEST_PASSWORD },
    });
    expect(reused.statusCode).toBe(410);
    expect(reused.json()).toMatchObject({ code: 'token_expired' });
  });
});

describe('limites de taxa (spec 004, RNF-04)', () => {
  it('login, cadastro e redefinição: 10 por minuto por IP, depois 429 rate_limited com Retry-After', async () => {
    const limited = open({}, { rateLimits: CLASSROOM_RATE_LIMITS });
    const client = new Browser(limited.app, scan);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const reply = await client.request('POST', '/api/v1/auth/password/forgot', {
        payload: { email: uniqueEmail() },
      });
      expect(reply.statusCode).toBe(204);
    }
    const refused = await client.request('POST', '/api/v1/auth/login', {
      payload: { email: uniqueEmail(), password: TEST_PASSWORD },
    });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // Outro IP continua livre; o limite do grupo não vale para as outras rotas.
    const other = new Browser(limited.app, scan);
    expect(
      (
        await other.request('POST', '/api/v1/auth/password/forgot', {
          payload: { email: uniqueEmail() },
        })
      ).statusCode,
    ).toBe(204);
    expect((await client.request('GET', '/api/v1/meta')).statusCode).toBe(200);
  });

  it('visitante: 60 por minuto por IP; com sessão, 120 por minuto por sessão', async () => {
    const limited = open({}, { rateLimits: CLASSROOM_RATE_LIMITS });
    const visitor = new Browser(limited.app, scan);
    for (let call = 0; call < 60; call += 1) {
      expect((await visitor.request('GET', '/api/v1/meta')).statusCode).toBe(200);
    }
    expect((await visitor.request('GET', '/api/v1/meta')).statusCode).toBe(429);

    const user = await createUser(db);
    const member = new Browser(limited.app, scan);
    expect((await member.login(user.email)).statusCode).toBe(200);
    for (let call = 0; call < 120; call += 1) {
      expect((await member.request('GET', '/api/v1/session')).statusCode).toBe(200);
    }
    const refused = await member.request('GET', '/api/v1/session');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate_limited' });
  });
});

describe('varredura da senha de teste', () => {
  it('nem as recusas de validação ecoam a senha (e-mail, nome, termos, tamanho, tipo, token)', async () => {
    const replies: Reply[] = [];
    const client = new Browser(test.app, (reply) => {
      scan(reply);
      replies.push(reply);
    });
    const bodies = [
      { name: 'Ana', email: TEST_PASSWORD, password: TEST_PASSWORD, acceptedTerms: [] },
      {
        name: TEST_PASSWORD.repeat(10),
        email: uniqueEmail(),
        password: TEST_PASSWORD,
        acceptedTerms: [],
      },
      {
        name: 'Ana',
        email: uniqueEmail(),
        password: TEST_PASSWORD,
        acceptedTerms: [TEST_PASSWORD],
      },
      { name: 'Ana', email: uniqueEmail(), password: TEST_PASSWORD.repeat(10), acceptedTerms: [] },
      { name: 'Ana', email: uniqueEmail(), password: [TEST_PASSWORD], acceptedTerms: [] },
    ];
    for (const payload of bodies) {
      await client.request('POST', '/api/v1/auth/register', { payload });
    }
    await client.request('POST', '/api/v1/auth/login', {
      payload: { email: TEST_PASSWORD, password: TEST_PASSWORD },
    });
    await client.request('POST', '/api/v1/auth/password/reset', {
      payload: { token: TEST_PASSWORD, password: TEST_PASSWORD },
    });
    expect(replies.map((reply) => reply.statusCode)).toEqual([400, 400, 400, 400, 400, 400, 410]);
    expect(test.logText()).not.toContain(TEST_PASSWORD);
  });
});
