import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticateSession,
  closeDatabase,
  countActiveAdmins,
  createAccount,
  createDatabase,
  createLogger,
  createUser,
  type Database,
  expireSuspensions,
  getUser,
  isDomainError,
  LOGIN_MAX_FAILURES,
  listUserSessions,
  listUsers,
  loginWithPassword,
  type ManagementRequest,
  type RequestContext,
  type Role,
  reactivateUser,
  readUserDetail,
  revealUserPassword,
  revokeAllUserSessions,
  setUserPassword,
  setUserRole,
  suspendUser,
  updateUser,
} from '../src/index.ts';

// Gestão de usuários pela equipe (tarefa 149; specs 007 e 008). Banco próprio deste arquivo: a
// regra do último admin conta todos os admins do banco.

const PASSWORD = 'Senha-Gestao-de-Teste-9Lm';
const NEW_PASSWORD = 'Nova-Senha-Gestao-4Tz!';
const STAFF_PASSWORD = 'Senha-da-Equipe-Teste-2Hv';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let testDb: TestDatabase;
let db: Database;
const logLines: string[] = [];

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  const logger = createLogger({
    service: 'admin-api',
    level: 'debug',
    write: (line) => logLines.push(line),
  });
  db = createDatabase({ connectionString: testDb.url, maxConnections: 8, logger });
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

let ipSeq = 0;
function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  ipSeq += 1;
  return {
    ip: `10.9.${(ipSeq >> 8) & 255}.${ipSeq & 255}`,
    userAgent: CHROME_MAC,
    requestId: 'req-gestao',
    ...overrides,
  };
}

function uniqueEmail(prefix = 'pessoa'): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

interface TestUser {
  id: string;
  email: string;
  role: Role;
}

async function makeUser(
  role: Role = 'student',
  options: { password?: string | null; name?: string; verified?: boolean } = {},
): Promise<TestUser> {
  const email = uniqueEmail(role);
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: options.name ?? `Pessoa ${role}`,
      password: options.password === undefined ? PASSWORD : options.password,
      role,
      emailVerified: options.verified ?? true,
    }),
  );
  return { id, email, role };
}

function as(user: TestUser, overrides: Partial<ManagementRequest> = {}): ManagementRequest {
  return { actor: { id: user.id, role: user.role }, context: ctx(), ...overrides };
}

async function rejects(promise: Promise<unknown>, code: string, status?: number) {
  try {
    await promise;
  } catch (error) {
    if (!isDomainError(error)) {
      throw error;
    }
    expect(error.code).toBe(code);
    if (status !== undefined) {
      expect(error.status).toBe(status);
    }
    return error;
  }
  throw new Error(`esperava o erro ${code}`);
}

async function auditOf(action: string, targetId?: string) {
  let query = db
    .selectFrom('auditLog')
    .selectAll()
    .where('action', '=', action)
    .orderBy('createdAt', 'asc');
  if (targetId !== undefined) {
    query = query.where('targetId', '=', targetId);
  }
  return query.execute();
}

async function outbox(userId: string, type: string) {
  return db
    .selectFrom('emailOutbox')
    .select(['type', 'data', 'to'])
    .where('userId', '=', userId)
    .where('type', '=', type)
    .orderBy('createdAt', 'asc')
    .execute();
}

async function login(user: TestUser, site: 'classroom' | 'admin' = 'classroom') {
  return loginWithPassword(db, { site, email: user.email, password: PASSWORD, context: ctx() });
}

async function sessionCount(userId: string, site?: 'classroom' | 'admin'): Promise<number> {
  let query = db
    .selectFrom('sessions')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('userId', '=', userId);
  if (site) {
    query = query.where('site', '=', site);
  }
  return (await query.executeTakeFirstOrThrow()).n;
}

let admin: TestUser;
let manager: TestUser;
let instructor: TestUser;

beforeAll(async () => {
  admin = await makeUser('admin');
  manager = await makeUser('manager');
  instructor = await makeUser('instructor');
});

describe('lista e ficha', () => {
  it('filtra por q, papel e situação; exclui contas excluídas; pagina nas três ordens', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const names = ['Carla', 'Ana', 'Bruno', 'Duda', 'Eva'];
    const users: TestUser[] = [];
    for (const name of names) {
      users.push(await makeUser('student', { name: `${name} ${tag}`, verified: name !== 'Eva' }));
    }
    const [carla, ana, bruno, duda] = users as [TestUser, TestUser, TestUser, TestUser];
    await db
      .updateTable('users')
      .set({ lastLoginAt: sql<Date>`now() - interval '1 day'` })
      .where('id', '=', ana.id)
      .execute();
    await db
      .updateTable('users')
      .set({ lastLoginAt: sql<Date>`now() - interval '2 days'` })
      .where('id', '=', bruno.id)
      .execute();
    await suspendUser(db, as(manager), carla.id, {
      kind: 'posting',
      reason: 'spam',
      durationDays: null,
    });
    await db
      .updateTable('users')
      .set({ deletedAt: sql<Date>`now()` })
      .where('id', '=', duda.id)
      .execute();

    const all = await listUsers(db, as(manager), { q: tag, sort: 'name' });
    expect(all.items.map((u) => u.name.split(' ')[0])).toEqual(['Ana', 'Bruno', 'Carla', 'Eva']);
    expect(all.nextCursor).toBeNull();
    expect(all.items[0]).toMatchObject({
      role: 'student',
      status: 'active',
      emailVerified: true,
      avatarUrl: null,
    });
    expect(all.items[0]).not.toHaveProperty('password');

    // Busca por trecho do e-mail; o `%` é literal.
    const byEmail = await listUsers(db, as(admin), { q: ana.email.slice(0, 20) });
    expect(byEmail.items.map((u) => u.id)).toEqual([ana.id]);
    expect((await listUsers(db, as(admin), { q: `%${tag}` })).items).toEqual([]);

    const suspended = await listUsers(db, as(manager), { q: tag, status: 'suspended' });
    expect(suspended.items.map((u) => u.id)).toEqual([carla.id]);
    expect(suspended.items[0]?.status).toBe('suspended');
    const active = await listUsers(db, as(manager), { q: tag, status: 'active' });
    expect(active.items.map((u) => u.id).sort()).toEqual([ana.id, bruno.id, users[4]?.id].sort());
    const unverified = await listUsers(db, as(manager), { q: tag, status: 'unverified' });
    expect(unverified.items.map((u) => u.id)).toEqual([users[4]?.id]);
    const staff = await listUsers(db, as(manager), { role: 'instructor', limit: 100 });
    expect(staff.items.every((u) => u.role === 'instructor')).toBe(true);
    expect(staff.items.map((u) => u.id)).toContain(instructor.id);

    // Página por página, nas três ordens, sem repetir nem pular.
    for (const sort of ['name', '-createdAt', '-lastLoginAt'] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listUsers(db, as(manager), { q: tag, sort, limit: 1, cursor });
        seen.push(...page.items.map((u) => u.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const full = await listUsers(db, as(manager), { q: tag, sort });
      expect(seen).toEqual(full.items.map((u) => u.id));
      expect(seen).toHaveLength(4);
    }
    const byLogin = await listUsers(db, as(manager), { q: tag, sort: '-lastLoginAt' });
    expect(byLogin.items.slice(0, 2).map((u) => u.id)).toEqual([ana.id, bruno.id]);
    const byCreated = await listUsers(db, as(manager), { q: tag });
    expect(byCreated.items[0]?.id).toBe(users[4]?.id);
  });

  it('parâmetros fora do formato: validation_failed; cursor de outra ordem é recusado', async () => {
    const error = await rejects(
      listUsers(db, as(admin), {
        q: ' ',
        role: 'root',
        status: 'x',
        sort: 'email',
        limit: 0,
      }),
      'validation_failed',
      400,
    );
    expect(error.errors?.map((e) => e.path)).toEqual([
      'query.q',
      'query.role',
      'query.status',
      'query.sort',
      'query.limit',
    ]);
    await rejects(listUsers(db, as(admin), { q: 'x'.repeat(201) }), 'validation_failed');
    await rejects(listUsers(db, as(admin), { limit: 101 }), 'validation_failed');
    const page = await listUsers(db, as(admin), { sort: 'name', limit: 1 });
    expect(page.nextCursor).not.toBeNull();
    await rejects(
      listUsers(db, as(admin), { sort: '-createdAt', cursor: page.nextCursor as string }),
      'validation_failed',
    );
    await rejects(listUsers(db, as(admin), { cursor: 'lixo' }), 'validation_failed');
  });

  it('instructor e student recebem 403 na lista e na ficha, com a negação na auditoria', async () => {
    const student = await makeUser();
    const before = (await auditOf('users.list')).length;
    await rejects(listUsers(db, as(instructor)), 'permission_denied', 403);
    await rejects(getUser(db, as(instructor), student.id), 'permission_denied', 403);
    await rejects(listUsers(db, as(student)), 'permission_denied', 403);
    const denied = await auditOf('users.list');
    expect(denied).toHaveLength(before + 3);
    expect(denied.at(-3)).toMatchObject({
      outcome: 'denied',
      actorUserId: instructor.id,
      actorRole: 'instructor',
      origin: 'admin_panel',
      details: { permission: 'users.list' },
    });
  });

  it('ficha: UserDetail com identidades, sem senha; inexistente, inválido ou excluído é 404', async () => {
    const student = await makeUser('student', { password: null });
    await db
      .insertInto('oauthIdentities')
      .values({
        userId: student.id,
        provider: 'google',
        providerUserId: `g-${student.id}`,
        email: student.email,
        emailVerified: true,
      })
      .execute();
    const detail = await getUser(db, as(manager), student.id.toUpperCase());
    expect(detail).toMatchObject({
      id: student.id,
      hasPassword: false,
      fullName: null,
      suspension: null,
      version: 1,
      identities: [{ provider: 'google', email: student.email }],
    });
    expect(JSON.stringify(detail)).not.toContain(PASSWORD);
    expect(detail).not.toHaveProperty('password');
    await rejects(getUser(db, as(manager), 'nao-e-uuid'), 'not_found', 404);
    await rejects(getUser(db, as(manager), crypto.randomUUID()), 'not_found', 404);
    await db
      .updateTable('users')
      .set({ deletedAt: sql<Date>`now()` })
      .where('id', '=', student.id)
      .execute();
    await rejects(getUser(db, as(manager), student.id), 'not_found', 404);
  });
});

describe('equipe criada pelo admin', () => {
  it('cria com o papel, e-mail não confirmado, verify_email e user.create sem a senha', async () => {
    const email = uniqueEmail('gerente');
    const detail = await createUser(db, as(admin), {
      name: '  Gerente Nova ',
      email: `  ${email.toUpperCase()} `,
      role: 'manager',
      password: STAFF_PASSWORD,
    });
    expect(detail).toMatchObject({
      name: 'Gerente Nova',
      email,
      role: 'manager',
      emailVerified: false,
      hasPassword: true,
      status: 'active',
    });
    const stored = await db
      .selectFrom('users')
      .select('password')
      .where('id', '=', detail.id)
      .executeTakeFirstOrThrow();
    expect(stored.password).toBe(STAFF_PASSWORD);
    expect(await outbox(detail.id, 'account.verify_email')).toHaveLength(1);
    const [audit] = await auditOf('user.create', detail.id);
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      outcome: 'ok',
      details: { role: 'manager' },
    });
    expect(JSON.stringify(audit)).not.toContain(STAFF_PASSWORD);

    await rejects(
      createUser(db, as(admin), { name: 'Outra', email, role: 'instructor', password: PASSWORD }),
      'email_taken',
      409,
    );
    await rejects(
      createUser(db, as(admin), {
        name: 'Outra',
        email: uniqueEmail(),
        role: 'instructor',
        password: 'curta',
      }),
      'password_invalid',
      400,
    );
    const error = await rejects(
      createUser(db, as(admin), { name: '', email: 'x', role: 'root', password: PASSWORD }),
      'validation_failed',
      400,
    );
    expect(error.errors?.map((e) => e.path)).toEqual(['body.name', 'body.email', 'body.role']);
  });

  it('só admin cria: manager recebe 403 e a negação vai para a auditoria', async () => {
    await rejects(
      createUser(db, as(manager), {
        name: 'X',
        email: uniqueEmail(),
        role: 'instructor',
        password: PASSWORD,
      }),
      'permission_denied',
      403,
    );
    const denied = (await auditOf('user.create')).filter((row) => row.outcome === 'denied');
    expect(denied.at(-1)).toMatchObject({
      actorUserId: manager.id,
      details: { permission: 'staff.manage' },
    });
  });
});

describe('edição dos dados', () => {
  it('manager edita aluno: nome, nome completo e e-mail (anula a confirmação e avisa o novo)', async () => {
    const student = await makeUser();
    const newEmail = uniqueEmail('novo');
    const detail = await updateUser(db, as(manager), student.id, {
      name: 'Nome Novo',
      fullName: ' Nome Completo Novo ',
      email: newEmail.toUpperCase(),
      version: 1,
    });
    expect(detail).toMatchObject({
      name: 'Nome Novo',
      fullName: 'Nome Completo Novo',
      email: newEmail,
      emailVerified: false,
      version: 2,
    });
    const mails = await outbox(student.id, 'account.verify_email');
    expect(mails.map((m) => m.to)).toEqual([newEmail]);
    const [audit] = await auditOf('user.update', student.id);
    expect(audit?.details).toEqual({
      before: { name: 'Pessoa student', fullName: null, email: student.email },
      after: { name: 'Nome Novo', fullName: 'Nome Completo Novo', email: newEmail },
    });

    // Versão antiga: conflito; sem alteração: devolve a ficha sem gravar.
    await rejects(
      updateUser(db, as(manager), student.id, { name: 'Outro', version: 1 }),
      'version_conflict',
      409,
    );
    const same = await updateUser(db, as(manager), student.id, { name: 'Nome Novo', version: 2 });
    expect(same.version).toBe(2);
    expect(await auditOf('user.update', student.id)).toHaveLength(1);
    // `null` apaga o nome completo; o mesmo e-mail não reenvia confirmação.
    const cleared = await updateUser(db, as(admin), student.id, {
      fullName: null,
      email: newEmail,
      version: 2,
    });
    expect(cleared).toMatchObject({ fullName: null, version: 3 });
    expect(await outbox(student.id, 'account.verify_email')).toHaveLength(1);
  });

  it('e-mail de outra conta: email_taken; campos inválidos: validation_failed', async () => {
    const student = await makeUser();
    const other = await makeUser();
    await rejects(
      updateUser(db, as(manager), student.id, { email: other.email, version: 1 }),
      'email_taken',
      409,
    );
    const error = await rejects(
      updateUser(db, as(manager), student.id, {
        name: ' ',
        fullName: 'x'.repeat(161),
        email: 'sem-arroba',
        version: 0,
      }),
      'validation_failed',
      400,
    );
    expect(error.errors?.map((e) => e.path)).toEqual([
      'body.name',
      'body.fullName',
      'body.email',
      'body.version',
    ]);
    await rejects(
      updateUser(db, as(manager), student.id, { fullName: 3, version: 1 }),
      'validation_failed',
    );
    await rejects(
      updateUser(db, as(manager), crypto.randomUUID(), { version: 1 }),
      'not_found',
      404,
    );
  });

  it('conta de equipe exige staff.manage: manager recebe 403 (auditado); admin edita', async () => {
    const staff = await makeUser('instructor');
    await rejects(
      updateUser(db, as(manager), staff.id, { name: 'X', version: 1 }),
      'permission_denied',
      403,
    );
    const denied = (await auditOf('user.update', staff.id)).filter((r) => r.outcome === 'denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]?.details).toMatchObject({ permission: 'staff.manage' });
    await rejects(
      updateUser(db, as(instructor), (await makeUser()).id, { name: 'X', version: 1 }),
      'permission_denied',
    );
    await expect(
      updateUser(db, as(admin), staff.id, { name: 'Instrutor Editado', version: 1 }),
    ).resolves.toMatchObject({ name: 'Instrutor Editado' });
  });
});

describe('mudança de papel', () => {
  it('rebaixa: grava, encerra só as sessões do admin, avisa por e-mail e audita antes e depois', async () => {
    const target = await makeUser('manager');
    await login(target, 'admin');
    await login(target, 'classroom');
    const detail = await setUserRole(db, as(admin), target.id, 'student');
    expect(detail).toMatchObject({ role: 'student', version: 2 });
    expect(await sessionCount(target.id, 'admin')).toBe(0);
    expect(await sessionCount(target.id, 'classroom')).toBe(1);
    const mails = await outbox(target.id, 'account.role_changed');
    expect(mails.map((m) => m.data)).toEqual([{ role: 'student' }]);
    const [audit] = await auditOf('user.set_role', target.id);
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      details: { before: { role: 'manager' }, after: { role: 'student' }, sessionsRevoked: 1 },
    });
    // O mesmo papel não muda nada.
    const same = await setUserRole(db, as(admin), target.id, 'student');
    expect(same.version).toBe(2);
    expect(await auditOf('user.set_role', target.id)).toHaveLength(1);
    // Promover aluno a admin também é do admin.
    await expect(setUserRole(db, as(admin), target.id, 'admin')).resolves.toMatchObject({
      role: 'admin',
    });
  });

  it('só admin muda papel; ninguém muda o próprio; papel desconhecido é recusado', async () => {
    const student = await makeUser();
    await rejects(setUserRole(db, as(manager), student.id, 'instructor'), 'permission_denied', 403);
    const denied = (await auditOf('user.set_role', student.id)).filter(
      (r) => r.outcome === 'denied',
    );
    expect(denied[0]?.details).toMatchObject({ permission: 'staff.manage' });
    await rejects(setUserRole(db, as(admin), admin.id, 'manager'), 'self_action_not_allowed', 422);
    await rejects(setUserRole(db, as(admin), student.id, 'root'), 'validation_failed', 400);
    await rejects(setUserRole(db, as(admin), crypto.randomUUID(), 'student'), 'not_found', 404);
  });
});

describe('suspensão e reativação', () => {
  it('full: linha no histórico, espelho, todas as sessões encerradas, login recusado, e-mail sem motivo', async () => {
    const student = await makeUser();
    const classroom = await login(student, 'classroom');
    const detail = await suspendUser(db, as(manager), student.id, {
      kind: 'full',
      reason: '  Motivo interno da equipe ',
      durationDays: 7,
    });
    expect(detail.status).toBe('suspended');
    expect(detail.suspension).toMatchObject({
      kind: 'full',
      reason: 'Motivo interno da equipe',
      createdBy: { id: manager.id, name: 'Pessoa manager' },
    });
    const suspension = detail.suspension as NonNullable<typeof detail.suspension>;
    const days =
      ((suspension.endsAt as Date).getTime() - suspension.startsAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 5);
    expect(await sessionCount(student.id)).toBe(0);
    await expect(
      authenticateSession(db, { token: classroom.token, site: 'classroom' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await rejects(login(student), 'account_suspended', 403);

    const user = await db
      .selectFrom('users')
      .select(['suspendedAt', 'suspendedKind', 'suspendedReason', 'suspendedBy'])
      .where('id', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({
      suspendedKind: 'full',
      suspendedReason: 'Motivo interno da equipe',
      suspendedBy: manager.id,
    });
    const [mail] = await outbox(student.id, 'moderation.suspended');
    expect(mail?.data).toEqual({
      kind: 'full',
      endsAt: (suspension.endsAt as Date).toISOString(),
    });
    expect(JSON.stringify(mail)).not.toContain('Motivo');
    const [audit] = await auditOf('user.suspend', student.id);
    expect(audit).toMatchObject({
      actorUserId: manager.id,
      details: { kind: 'full', durationDays: 7, sessionsRevoked: 1 },
    });

    await rejects(
      suspendUser(db, as(manager), student.id, { kind: 'posting', reason: 'x', durationDays: 1 }),
      'already_suspended',
      409,
    );

    const reactivated = await reactivateUser(db, as(manager), student.id);
    expect(reactivated).toMatchObject({ status: 'active', suspension: null });
    const history = await db
      .selectFrom('userSuspensions')
      .select('liftedAt')
      .where('userId', '=', student.id)
      .execute();
    expect(history).toHaveLength(1);
    expect(history[0]?.liftedAt).not.toBeNull();
    expect(await auditOf('user.unsuspend', student.id)).toHaveLength(1);
    // Sessões não voltam sozinhas, mas o login volta a funcionar.
    expect(await sessionCount(student.id)).toBe(0);
    await expect(login(student)).resolves.toBeDefined();
    await rejects(reactivateUser(db, as(manager), student.id), 'not_suspended', 409);
  });

  it('posting mantém as sessões; sem prazo, endsAt nulo', async () => {
    const student = await makeUser();
    await login(student);
    const detail = await suspendUser(db, as(admin), student.id, {
      kind: 'posting',
      reason: 'flood',
      durationDays: null,
    });
    expect(detail.suspension).toMatchObject({ kind: 'posting', endsAt: null });
    expect(await sessionCount(student.id)).toBe(1);
    const [mail] = await outbox(student.id, 'moderation.suspended');
    expect(mail?.data).toEqual({ kind: 'posting', endsAt: null });
  });

  it('manager não suspende nem reativa equipe (403 auditado); ninguém suspende a si mesmo', async () => {
    const staff = await makeUser('instructor');
    await rejects(
      suspendUser(db, as(manager), staff.id, { kind: 'full', reason: 'x', durationDays: 1 }),
      'permission_denied',
      403,
    );
    const denied = (await auditOf('user.suspend', staff.id)).filter((r) => r.outcome === 'denied');
    expect(denied[0]?.details).toMatchObject({ permission: 'staff.manage' });
    await rejects(reactivateUser(db, as(manager), staff.id), 'permission_denied', 403);
    // Gerente sobre si mesmo: é conta de equipe, então a permissão falta antes.
    await rejects(
      suspendUser(db, as(manager), manager.id, { kind: 'full', reason: 'x', durationDays: 1 }),
      'permission_denied',
    );
    await rejects(
      suspendUser(db, as(admin), admin.id, { kind: 'full', reason: 'x', durationDays: 1 }),
      'self_action_not_allowed',
      422,
    );
    await rejects(reactivateUser(db, as(admin), admin.id), 'self_action_not_allowed', 422);
    // Admin suspende equipe.
    await expect(
      suspendUser(db, as(admin), staff.id, { kind: 'posting', reason: 'x', durationDays: 30 }),
    ).resolves.toMatchObject({ status: 'suspended' });
  });

  it('corpo fora do formato: validation_failed', async () => {
    const student = await makeUser();
    const error = await rejects(
      suspendUser(db, as(manager), student.id, {
        kind: 'temporary',
        reason: ' ',
        durationDays: 3,
      }),
      'validation_failed',
      400,
    );
    expect(error.errors?.map((e) => e.path)).toEqual([
      'body.kind',
      'body.reason',
      'body.durationDays',
    ]);
    await rejects(
      suspendUser(db, as(manager), student.id, {
        kind: 'full',
        reason: 'x'.repeat(501),
        durationDays: null,
      }),
      'validation_failed',
    );
  });

  it('expireSuspensions encerra só as vencidas, com user.unsuspend de origem worker', async () => {
    const due = await makeUser();
    const notDue = await makeUser();
    const forever = await makeUser();
    for (const [user, durationDays] of [
      [due, 1],
      [notDue, 1],
      [forever, null],
    ] as const) {
      await suspendUser(db, as(manager), user.id, { kind: 'full', reason: 'x', durationDays });
    }
    await sql`UPDATE user_suspensions
              SET starts_at = starts_at - interval '2 days', ends_at = ends_at - interval '2 days'
              WHERE user_id = ${due.id}`.execute(db);
    await expect(expireSuspensions(db, { limit: 0 })).rejects.toThrow(TypeError);
    expect(await expireSuspensions(db)).toBeGreaterThanOrEqual(1);
    expect((await readUserDetail(db, due.id)).status).toBe('active');
    expect((await readUserDetail(db, notDue.id)).status).toBe('suspended');
    expect((await readUserDetail(db, forever.id)).status).toBe('suspended');
    const [audit] = await auditOf('user.unsuspend', due.id);
    expect(audit).toMatchObject({
      origin: 'worker',
      actorUserId: null,
      details: { reason: 'expired' },
    });
    // Nada mais vencido: a segunda chamada não encerra nada.
    expect(await expireSuspensions(db)).toBe(0);
  });
});

describe('exibição e definição da senha pelo admin', () => {
  it('manager e instructor recebem 403 sem conferir senha; a negação vai para a auditoria', async () => {
    const student = await makeUser();
    const attemptsBefore = await attemptsOf(manager.email);
    await rejects(
      revealUserPassword(db, as(manager), student.id, { adminPassword: PASSWORD }),
      'permission_denied',
      403,
    );
    await rejects(
      revealUserPassword(db, as(instructor), student.id, { adminPassword: PASSWORD }),
      'permission_denied',
      403,
    );
    expect(await attemptsOf(manager.email)).toBe(attemptsBefore);
    const denied = await auditOf('user.password_view', student.id);
    expect(denied.map((r) => [r.outcome, r.actorUserId])).toEqual([
      ['denied', manager.id],
      ['denied', instructor.id],
    ]);
    // Nas ações de senha, `details` só guarda números e booleanos: a permissão (texto) sai.
    expect(denied[0]?.details).toEqual({});
  });

  it('admin vê a senha com a própria confirmação; user.password_view sem o valor', async () => {
    const student = await makeUser();
    const request = as(admin, { context: ctx({ ip: '203.0.113.7' }) });
    await expect(
      revealUserPassword(db, request, student.id, { adminPassword: PASSWORD }),
    ).resolves.toEqual({ password: PASSWORD });
    const [audit] = await auditOf('user.password_view', student.id);
    expect(audit).toMatchObject({
      outcome: 'ok',
      actorUserId: admin.id,
      actorRole: 'admin',
      ip: '203.0.113.7',
      details: {},
    });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    const social = await makeUser('student', { password: null });
    await expect(
      revealUserPassword(db, as(admin), social.id, { adminPassword: PASSWORD }),
    ).resolves.toEqual({ password: null });
    await rejects(
      revealUserPassword(db, as(admin), crypto.randomUUID(), { adminPassword: PASSWORD }),
      'not_found',
      404,
    );
  });

  it('confirmação errada: password_confirmation_invalid, conta no bloqueio do admin e bloqueia', async () => {
    const otherAdmin = await makeUser('admin');
    const student = await makeUser();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      await rejects(
        revealUserPassword(db, as(otherAdmin), student.id, { adminPassword: 'errada-123' }),
        'password_confirmation_invalid',
        422,
      );
    }
    expect(await attemptsOf(otherAdmin.email)).toBe(LOGIN_MAX_FAILURES);
    await rejects(
      revealUserPassword(db, as(otherAdmin), student.id, { adminPassword: PASSWORD }),
      'too_many_attempts',
      429,
    );
    expect(
      (await auditOf('user.password_view', student.id)).filter((r) => r.outcome === 'ok'),
    ).toHaveLength(0);
  });

  it('admin define a senha: todas as sessões encerradas, e-mail com by=admin, auditado sem o valor', async () => {
    const student = await makeUser();
    await login(student, 'classroom');
    await login(student, 'classroom');
    await expect(
      setUserPassword(db, as(admin), student.id, { password: NEW_PASSWORD }),
    ).resolves.toEqual({ sessionsRevoked: 2 });
    expect(await sessionCount(student.id)).toBe(0);
    const stored = await db
      .selectFrom('users')
      .select('password')
      .where('id', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(stored.password).toBe(NEW_PASSWORD);
    const mails = await outbox(student.id, 'account.password_changed');
    expect(mails.map((m) => m.data)).toEqual([{ by: 'admin' }]);
    const [audit] = await auditOf('user.password_set', student.id);
    expect(audit).toMatchObject({ actorUserId: admin.id, details: { sessionsRevoked: 2 } });
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);

    await rejects(
      setUserPassword(db, as(admin), student.id, { password: '       ' }),
      'password_invalid',
      400,
    );
    await rejects(
      setUserPassword(db, as(manager), student.id, { password: NEW_PASSWORD }),
      'permission_denied',
      403,
    );
    await rejects(
      setUserPassword(db, as(admin), 'x', { password: NEW_PASSWORD }),
      'not_found',
      404,
    );
  });
});

describe('sessões de um usuário', () => {
  it('lista e encerra todas, nos dois sites; conta de equipe exige staff.manage', async () => {
    const student = await makeUser();
    await login(student, 'classroom');
    const staff = await makeUser('instructor');
    await login(staff, 'admin');

    const list = await listUserSessions(db, as(manager), student.id);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ site: 'classroom', current: false, browser: 'Chrome' });
    await expect(revokeAllUserSessions(db, as(manager), student.id)).resolves.toEqual({
      sessionsRevoked: 1,
    });
    expect(await sessionCount(student.id)).toBe(0);
    const [audit] = await auditOf('user.sessions_revoke', student.id);
    expect(audit).toMatchObject({ actorUserId: manager.id, details: { sessionsRevoked: 1 } });

    await rejects(listUserSessions(db, as(manager), staff.id), 'permission_denied', 403);
    await rejects(revokeAllUserSessions(db, as(manager), staff.id), 'permission_denied', 403);
    await rejects(listUserSessions(db, as(instructor), student.id), 'permission_denied', 403);
    expect(
      (await auditOf('user.sessions_revoke', staff.id)).filter((r) => r.outcome === 'denied'),
    ).toHaveLength(2);
    await expect(revokeAllUserSessions(db, as(admin), staff.id)).resolves.toEqual({
      sessionsRevoked: 1,
    });
  });

  it('chamada MCP grava origin mcp com a chave', async () => {
    const student = await makeUser();
    const keyId = crypto.randomUUID();
    await revokeAllUserSessions(db, as(manager, { mcpKeyId: keyId }), student.id);
    const [audit] = await auditOf('user.sessions_revoke', student.id);
    expect(audit).toMatchObject({ origin: 'mcp', mcpKeyId: keyId, actorUserId: manager.id });
  });
});

describe('último admin ativo', () => {
  it('rebaixar e suspender o último admin ativo são recusados com last_admin', async () => {
    // Deixa um único admin ativo: os demais ficam com suspensão `posting` (continuam agindo).
    const last = await makeUser('admin');
    const actor = await makeUser('admin');
    await db
      .updateTable('users')
      .set({
        suspendedAt: sql<Date>`now()`,
        suspendedKind: 'posting',
        suspendedReason: 'teste do último admin',
        suspendedBy: last.id,
      })
      .where('role', '=', 'admin')
      .where('id', '<>', last.id)
      .where('suspendedAt', 'is', null)
      .execute();
    expect(await countActiveAdmins(db)).toBe(1);

    await rejects(setUserRole(db, as(actor), last.id, 'manager'), 'last_admin', 422);
    await rejects(
      suspendUser(db, as(actor), last.id, { kind: 'full', reason: 'x', durationDays: null }),
      'last_admin',
      422,
    );
    const user = await readUserDetail(db, last.id);
    expect(user).toMatchObject({ role: 'admin', status: 'active', version: 1 });
    expect(await db.selectFrom('userSuspensions').where('userId', '=', last.id).execute()).toEqual(
      [],
    );
    // Promover outro admin ativo libera.
    await reactivateUser(db, as(last), actor.id);
    await expect(setUserRole(db, as(actor), last.id, 'manager')).resolves.toMatchObject({
      role: 'manager',
    });
  });
});

describe('varredura das senhas de teste', () => {
  it('não aparecem em log, audit_log, jobs.payload nem email_outbox', async () => {
    const secrets = [PASSWORD, NEW_PASSWORD, STAFF_PASSWORD];
    const audit = JSON.stringify(await db.selectFrom('auditLog').selectAll().execute());
    const jobs = JSON.stringify(await db.selectFrom('jobs').selectAll().execute());
    const mails = JSON.stringify(await db.selectFrom('emailOutbox').selectAll().execute());
    for (const secret of secrets) {
      expect(audit).not.toContain(secret);
      expect(jobs).not.toContain(secret);
      expect(mails).not.toContain(secret);
      expect(logLines.join('\n')).not.toContain(secret);
    }
  });
});

async function attemptsOf(email: string): Promise<number> {
  const row = await db
    .selectFrom('loginAttempts')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('email', '=', email)
    .where('success', '=', false)
    .executeTakeFirstOrThrow();
  return row.n;
}
