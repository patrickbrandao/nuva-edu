import { createSession } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  nextIp,
  TEST_PASSWORD,
  type TestApp,
  uniqueEmail,
} from './helpers.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

type Role = 'student' | 'instructor' | 'manager' | 'admin';

/** Senha do usuário que tem a senha exibida: só pode aparecer na resposta da exibição. */
const REVEALED_PASSWORD = 'Senha-Exibida-Aluno-7Qp#w';
/** Senhas enviadas na criação e na definição pelo admin: não aparecem em resposta nenhuma. */
const CREATED_PASSWORD = 'Senha-Criada-Equipe-3Hv$t';
const DEFINED_PASSWORD = 'Senha-Definida-Admin-5Lm%y';

/** Toda resposta deste arquivo, para a varredura da senha no fim. */
const responses: { url: string; text: string }[] = [];

interface Actor {
  id: string;
  role: Role;
  cookie: string;
  csrf: string;
}

/** Usuário do papel pedido com uma sessão do admin aberta direto no banco. */
async function actor(role: Role): Promise<Actor> {
  const user = await createUser(test.db, { role });
  const session = await test.db.transaction().execute((trx) =>
    createSession(trx, {
      userId: user.id,
      site: 'admin',
      context: { ip: nextIp(), userAgent: null },
    }),
  );
  return { id: user.id, role, cookie: session.token, csrf: session.csrfToken };
}

interface CallOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  as: Actor;
  payload?: object;
  csrf?: string | null;
  requestId?: string;
}

async function call(options: CallOptions) {
  const headers: Record<string, string> = {
    'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/130.0.0.0 Safari/537.36',
  };
  const csrf = options.csrf === undefined ? options.as.csrf : options.csrf;
  if (options.method !== 'GET' && csrf !== null) {
    headers['x-csrf-token'] = csrf;
  }
  if (options.requestId) {
    headers['x-request-id'] = options.requestId;
  }
  const response = await test.app.inject({
    method: options.method,
    url: options.url,
    headers,
    remoteAddress: '203.0.113.20',
    cookies: { nuva_admin_session: options.as.cookie },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
  responses.push({
    url: options.url,
    text: `${response.body}\n${JSON.stringify(response.headers)}`,
  });
  return response;
}

async function auditOf(targetId: string, action: string) {
  return test.db
    .selectFrom('auditLog')
    .selectAll()
    .where('targetId', '=', targetId)
    .where('action', '=', action)
    .execute();
}

async function deniedBy(actorId: string) {
  return test.db
    .selectFrom('auditLog')
    .selectAll()
    .where('actorUserId', '=', actorId)
    .where('outcome', '=', 'denied')
    .execute();
}

describe('GET /api/v1/users', () => {
  it('manager lista com busca e filtro; sem campo de senha', async () => {
    const manager = await actor('manager');
    const student = await createUser(test.db, { role: 'student' });
    const email = (
      await test.db
        .selectFrom('users')
        .select('email')
        .where('id', '=', student.id)
        .executeTakeFirstOrThrow()
    ).email;
    const response = await call({
      method: 'GET',
      url: `/api/v1/users?q=${encodeURIComponent(email)}&role=student&status=active`,
      as: manager,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: student.id, role: 'student', status: 'active' });
    expect(body.items[0]).not.toHaveProperty('password');
  });

  it('pagina por cursor', async () => {
    const manager = await actor('manager');
    const first = await call({ method: 'GET', url: '/api/v1/users?limit=1', as: manager });
    expect(first.statusCode).toBe(200);
    const { items, nextCursor } = first.json();
    expect(items).toHaveLength(1);
    expect(nextCursor).toEqual(expect.any(String));
    const second = await call({
      method: 'GET',
      url: `/api/v1/users?limit=1&cursor=${encodeURIComponent(nextCursor)}`,
      as: manager,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items[0].id).not.toBe(items[0].id);
  });

  it('instructor: 403 com uma só negação na auditoria (a do núcleo)', async () => {
    const instructor = await actor('instructor');
    const response = await call({ method: 'GET', url: '/api/v1/users', as: instructor });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
    const denied = await deniedBy(instructor.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ action: 'users.list', origin: 'admin_panel' });
  });

  it('aluno: 403 e a negação gravada', async () => {
    const student = await actor('student');
    const response = await call({ method: 'GET', url: '/api/v1/users', as: student });
    expect(response.statusCode).toBe(403);
    expect(await deniedBy(student.id)).toHaveLength(1);
  });
});

describe('POST /api/v1/users', () => {
  it('admin cria gerente: 201 UserDetail, e-mail não confirmado e user.create sem a senha', async () => {
    const admin = await actor('admin');
    const email = uniqueEmail('gerente');
    const response = await call({
      method: 'POST',
      url: '/api/v1/users',
      as: admin,
      requestId: 'req-cria-gerente',
      payload: { name: 'Gerente Nova', email, role: 'manager', password: CREATED_PASSWORD },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      email,
      role: 'manager',
      emailVerified: false,
      hasPassword: true,
      suspension: null,
      identities: [],
      version: 1,
    });
    expect(body).not.toHaveProperty('password');
    const audit = await auditOf(body.id, 'user.create');
    expect(audit).toMatchObject([
      {
        actorUserId: admin.id,
        actorRole: 'admin',
        origin: 'admin_panel',
        outcome: 'ok',
        requestId: 'req-cria-gerente',
        ip: '203.0.113.20',
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain(CREATED_PASSWORD);
  });

  it('e-mail já cadastrado: 409 email_taken; senha curta: 400 password_invalid', async () => {
    const admin = await actor('admin');
    const existing = await createUser(test.db, { role: 'student' });
    const taken = await call({
      method: 'POST',
      url: '/api/v1/users',
      as: admin,
      payload: { name: 'X', email: existing.email, role: 'manager', password: CREATED_PASSWORD },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'email_taken' });
    const short = await call({
      method: 'POST',
      url: '/api/v1/users',
      as: admin,
      payload: { name: 'X', email: uniqueEmail(), role: 'manager', password: 'curta' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ code: 'password_invalid' });
  });

  it('manager: 403 (staff.manage) e uma negação; sem X-CSRF-Token: 403 csrf_token_invalid', async () => {
    const manager = await actor('manager');
    const payload = {
      name: 'X',
      email: uniqueEmail(),
      role: 'manager',
      password: CREATED_PASSWORD,
    };
    const denied = await call({ method: 'POST', url: '/api/v1/users', as: manager, payload });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'permission_denied' });
    const rows = await deniedBy(manager.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toEqual({ operation: 'createUser', permission: 'staff.manage' });

    const admin = await actor('admin');
    const noCsrf = await call({
      method: 'POST',
      url: '/api/v1/users',
      as: admin,
      csrf: null,
      payload,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });
  });
});

describe('GET e PATCH /api/v1/users/{id}', () => {
  it('ficha; inexistente: 404', async () => {
    const manager = await actor('manager');
    const student = await createUser(test.db, { role: 'student' });
    const response = await call({ method: 'GET', url: `/api/v1/users/${student.id}`, as: manager });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: student.id, hasPassword: true, fullName: null });
    const missing = await call({
      method: 'GET',
      url: `/api/v1/users/${crypto.randomUUID()}`,
      as: manager,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('manager edita aluno: user.update na auditoria; version velho: 409 version_conflict', async () => {
    const manager = await actor('manager');
    const student = await createUser(test.db, { role: 'student' });
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/users/${student.id}`,
      as: manager,
      payload: { name: 'Nome Novo', fullName: 'Nome Completo Novo', version: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'Nome Novo',
      fullName: 'Nome Completo Novo',
      version: 2,
    });
    expect(await auditOf(student.id, 'user.update')).toMatchObject([
      { actorUserId: manager.id, outcome: 'ok' },
    ]);
    const stale = await call({
      method: 'PATCH',
      url: `/api/v1/users/${student.id}`,
      as: manager,
      payload: { name: 'Outro', version: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version_conflict' });
  });

  it('manager editando conta de equipe: 403 e uma só negação (a do núcleo)', async () => {
    const manager = await actor('manager');
    const instructor = await createUser(test.db, { role: 'instructor' });
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/users/${instructor.id}`,
      as: manager,
      payload: { name: 'Nome', version: 1 },
    });
    expect(response.statusCode).toBe(403);
    const rows = await deniedBy(manager.id);
    expect(rows).toMatchObject([{ action: 'user.update', targetId: instructor.id }]);
  });
});

describe('PATCH /api/v1/users/{id}/role', () => {
  it('admin promove aluno a instrutor: user.set_role; o próprio papel: 422', async () => {
    const admin = await actor('admin');
    const student = await createUser(test.db, { role: 'student' });
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/users/${student.id}/role`,
      as: admin,
      payload: { role: 'instructor' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: 'instructor' });
    expect(await auditOf(student.id, 'user.set_role')).toMatchObject([
      { actorUserId: admin.id, outcome: 'ok' },
    ]);
    const self = await call({
      method: 'PATCH',
      url: `/api/v1/users/${admin.id}/role`,
      as: admin,
      payload: { role: 'manager' },
    });
    expect(self.statusCode).toBe(422);
    expect(self.json()).toMatchObject({ code: 'self_action_not_allowed' });
  });

  it('manager: 403', async () => {
    const manager = await actor('manager');
    const student = await createUser(test.db, { role: 'student' });
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/users/${student.id}/role`,
      as: manager,
      payload: { role: 'admin' },
    });
    expect(response.statusCode).toBe(403);
    expect(await deniedBy(manager.id)).toHaveLength(1);
  });
});

describe('suspensão e reativação', () => {
  it('manager suspende aluno (full): sessões encerradas, user.suspend; de novo: 409; reativa: user.unsuspend', async () => {
    const manager = await actor('manager');
    const student = await actor('student');
    const response = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/suspend`,
      as: manager,
      payload: { kind: 'full', reason: 'Spam no fórum', durationDays: 7 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      status: 'suspended',
      suspension: { kind: 'full', reason: 'Spam no fórum', createdBy: { id: manager.id } },
    });
    expect(Date.parse(body.suspension.endsAt)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const sessions = await test.db
      .selectFrom('sessions')
      .select('id')
      .where('userId', '=', student.id)
      .execute();
    expect(sessions).toEqual([]);
    expect(await auditOf(student.id, 'user.suspend')).toMatchObject([
      { actorUserId: manager.id, outcome: 'ok' },
    ]);

    const again = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/suspend`,
      as: manager,
      payload: { kind: 'posting', reason: 'De novo', durationDays: null },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'already_suspended' });

    const reactivated = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/reactivate`,
      as: manager,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({ status: 'active', suspension: null });
    expect(await auditOf(student.id, 'user.unsuspend')).toMatchObject([{ outcome: 'ok' }]);

    const notSuspended = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/reactivate`,
      as: manager,
    });
    expect(notSuspended.statusCode).toBe(409);
    expect(notSuspended.json()).toMatchObject({ code: 'not_suspended' });
  });

  it('manager suspendendo equipe: 403 e uma só negação; durationDays fora da lista: 400', async () => {
    const manager = await actor('manager');
    const instructor = await createUser(test.db, { role: 'instructor' });
    const response = await call({
      method: 'POST',
      url: `/api/v1/users/${instructor.id}/suspend`,
      as: manager,
      payload: { kind: 'full', reason: 'Motivo', durationDays: null },
    });
    expect(response.statusCode).toBe(403);
    expect(await deniedBy(manager.id)).toMatchObject([
      { action: 'user.suspend', targetId: instructor.id },
    ]);
    const invalid = await call({
      method: 'POST',
      url: `/api/v1/users/${instructor.id}/suspend`,
      as: manager,
      payload: { kind: 'full', reason: 'Motivo', durationDays: 3 },
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('POST /api/v1/users/{id}/password/reveal', () => {
  it('admin vê a senha com no-store; user.password_view sem o valor', async () => {
    const admin = await actor('admin');
    const student = await createUser(test.db, { role: 'student', password: REVEALED_PASSWORD });
    const response = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/password/reveal`,
      as: admin,
      requestId: 'req-exibe-senha',
      payload: { adminPassword: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ password: REVEALED_PASSWORD });
    const audit = await auditOf(student.id, 'user.password_view');
    expect(audit).toMatchObject([
      {
        actorUserId: admin.id,
        actorRole: 'admin',
        outcome: 'ok',
        requestId: 'req-exibe-senha',
        ip: '203.0.113.20',
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain(REVEALED_PASSWORD);
  });

  it('usuário sem senha: password null', async () => {
    const admin = await actor('admin');
    const student = await createUser(test.db, { role: 'student', password: null });
    const response = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/password/reveal`,
      as: admin,
      payload: { adminPassword: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ password: null });
  });

  it('senha do admin errada: 422 password_confirmation_invalid, no-store e nada gravado', async () => {
    const admin = await actor('admin');
    const student = await createUser(test.db, { role: 'student', password: REVEALED_PASSWORD });
    const response = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/password/reveal`,
      as: admin,
      payload: { adminPassword: 'senha-errada-do-admin' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ code: 'password_confirmation_invalid' });
    expect(await auditOf(student.id, 'user.password_view')).toEqual([]);
  });

  it('manager: 403 permission_denied, com a negação na auditoria', async () => {
    const manager = await actor('manager');
    const student = await createUser(test.db, { role: 'student', password: REVEALED_PASSWORD });
    const response = await call({
      method: 'POST',
      url: `/api/v1/users/${student.id}/password/reveal`,
      as: manager,
      payload: { adminPassword: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
    expect(await deniedBy(manager.id)).toMatchObject([
      {
        action: 'users.password.view',
        details: { operation: 'revealUserPassword', permission: 'users.password.view' },
      },
    ]);
    expect(await auditOf(student.id, 'user.password_view')).toEqual([]);
  });
});

describe('PUT /api/v1/users/{id}/password', () => {
  it('admin define a senha: 204, sessões encerradas, user.password_set sem o valor', async () => {
    const admin = await actor('admin');
    const student = await actor('student');
    const response = await call({
      method: 'PUT',
      url: `/api/v1/users/${student.id}/password`,
      as: admin,
      payload: { password: DEFINED_PASSWORD },
    });
    expect(response.statusCode).toBe(204);
    const sessions = await test.db
      .selectFrom('sessions')
      .select('id')
      .where('userId', '=', student.id)
      .execute();
    expect(sessions).toEqual([]);
    const audit = await auditOf(student.id, 'user.password_set');
    expect(audit).toMatchObject([{ actorUserId: admin.id, outcome: 'ok' }]);
    expect(JSON.stringify(audit)).not.toContain(DEFINED_PASSWORD);
  });

  it('manager: 403; senha curta: 400 password_invalid', async () => {
    const manager = await actor('manager');
    const student = await createUser(test.db, { role: 'student' });
    const denied = await call({
      method: 'PUT',
      url: `/api/v1/users/${student.id}/password`,
      as: manager,
      payload: { password: DEFINED_PASSWORD },
    });
    expect(denied.statusCode).toBe(403);
    expect(await deniedBy(manager.id)).toHaveLength(1);
    const admin = await actor('admin');
    const short = await call({
      method: 'PUT',
      url: `/api/v1/users/${student.id}/password`,
      as: admin,
      payload: { password: 'curta' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ code: 'password_invalid' });
  });
});

describe('sessões de um usuário', () => {
  it('manager lista e encerra as do aluno: user.sessions_revoke com a contagem', async () => {
    const manager = await actor('manager');
    const student = await actor('student');
    await test.db.transaction().execute((trx) =>
      createSession(trx, {
        userId: student.id,
        site: 'classroom',
        context: { ip: nextIp(), userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130.0.0.0' },
      }),
    );
    const list = await call({
      method: 'GET',
      url: `/api/v1/users/${student.id}/sessions`,
      as: manager,
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items).toHaveLength(2);
    expect(items.every((item: { current: boolean }) => item.current === false)).toBe(true);

    const revoke = await call({
      method: 'DELETE',
      url: `/api/v1/users/${student.id}/sessions`,
      as: manager,
    });
    expect(revoke.statusCode).toBe(204);
    const audit = await auditOf(student.id, 'user.sessions_revoke');
    expect(audit).toMatchObject([{ actorUserId: manager.id, outcome: 'ok' }]);
    expect(audit[0]?.details).toMatchObject({ sessionsRevoked: 2 });
    // A sessão encerrada não entra mais.
    const after = await call({ method: 'GET', url: '/api/v1/session', as: student });
    expect(after.statusCode).toBe(401);
  });

  it('manager sobre conta de equipe: 403 e uma só negação', async () => {
    const manager = await actor('manager');
    const admin = await createUser(test.db, { role: 'admin' });
    const response = await call({
      method: 'DELETE',
      url: `/api/v1/users/${admin.id}/sessions`,
      as: manager,
    });
    expect(response.statusCode).toBe(403);
    expect(await deniedBy(manager.id)).toMatchObject([
      { action: 'user.sessions_revoke', targetId: admin.id },
    ]);
  });
});

describe('varredura da senha (ADR 0002, spec 007 RNF-05)', () => {
  it('a senha só aparece na resposta da exibição; nunca no log nem em outra resposta', () => {
    expect(responses.length).toBeGreaterThan(30);
    const log = test.logText();
    for (const secret of [REVEALED_PASSWORD, CREATED_PASSWORD, DEFINED_PASSWORD, TEST_PASSWORD]) {
      expect(log).not.toContain(secret);
    }
    for (const { url, text } of responses) {
      if (!url.endsWith('/password/reveal')) {
        expect(text).not.toContain(REVEALED_PASSWORD);
      }
      for (const secret of [CREATED_PASSWORD, DEFINED_PASSWORD, TEST_PASSWORD]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(responses.filter(({ text }) => text.includes(REVEALED_PASSWORD))).toHaveLength(1);
  });
});
