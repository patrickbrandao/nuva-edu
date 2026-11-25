import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AccountSite,
  applyPasswordChange,
  assertNotLastActiveAdmin,
  assertNotLocked,
  assertTermsGate,
  authenticateSession,
  buildSessionView,
  changePassword,
  closeDatabase,
  confirmPassword,
  countActiveAdmins,
  createAccount,
  createDatabase,
  createLogger,
  createOrPromoteAdmin,
  createSession,
  createTermsDraft,
  type Database,
  EMAIL_RESEND_LIMIT_PER_HOUR,
  ensureInitialAdmin,
  isDomainError,
  issueEmailToken,
  LOGIN_FAILURE_WINDOW_SECONDS,
  LOGIN_MAX_FAILURES,
  listIdentities,
  listSessions,
  loginLockStatus,
  loginWithPassword,
  logout,
  openLoginSession,
  publishTermsVersion,
  type RequestContext,
  recordLoginFailure,
  registerLoginDevice,
  registerWithPassword,
  removeIdentity,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  revokeOtherSessions,
  revokeSession,
  revokeUserSessions,
  SESSION_RENEW_INTERVAL_SECONDS,
  setAvatar,
  verifyEmail,
} from '../src/index.ts';

// Banco próprio deste arquivo: o teste da fila apaga `jobs` e reivindica tarefas, e aqui cada
// login e cada cadastro enfileiram e-mails que a varredura da senha precisa encontrar.

const PASSWORD = 'Senha-de-Teste-7Qx!pZ';
const OTHER_PASSWORD = 'Outra-Senha-de-Teste-3Kw';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

let testDb: TestDatabase;
let db: Database;
const logLines: string[] = [];

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  const logger = createLogger({
    service: 'classroom-api',
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
function nextIp(): string {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { ip: nextIp(), userAgent: CHROME_MAC, requestId: 'req-teste', ...overrides };
}

function uniqueEmail(prefix = 'aluno'): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

interface UserOptions {
  email?: string;
  password?: string | null;
  role?: 'student' | 'instructor' | 'manager' | 'admin';
  verified?: boolean;
}

async function makeUser(options: UserOptions = {}): Promise<{ id: string; email: string }> {
  const email = options.email ?? uniqueEmail();
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: 'Pessoa de Teste',
      password: options.password === undefined ? PASSWORD : options.password,
      role: options.role ?? 'student',
      emailVerified: options.verified ?? false,
    }),
  );
  return { id, email };
}

async function suspend(userId: string, kind: 'full' | 'posting', by: string): Promise<void> {
  await db
    .updateTable('users')
    .set({
      suspendedAt: sql<Date>`now()`,
      suspendedKind: kind,
      suspendedReason: 'teste',
      suspendedBy: by,
    })
    .where('id', '=', userId)
    .execute();
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

async function outbox(userId: string, type?: string) {
  let query = db
    .selectFrom('emailOutbox')
    .select(['type', 'data', 'to'])
    .where('userId', '=', userId)
    .orderBy('createdAt', 'asc');
  if (type !== undefined) {
    query = query.where('type', '=', type);
  }
  return query.execute();
}

async function auditOf(action: string, targetId?: string) {
  let query = db.selectFrom('auditLog').selectAll().where('action', '=', action);
  if (targetId !== undefined) {
    query = query.where('targetId', '=', targetId);
  }
  return query.execute();
}

async function login(email: string, password: unknown, site: AccountSite = 'classroom', c = ctx()) {
  return loginWithPassword(db, { site, email, password, context: c });
}

/** Volta as tentativas no tempo, para simular a janela de 15 minutos passando. */
async function ageAttempts(email: string, seconds: number): Promise<void> {
  await sql`UPDATE login_attempts SET created_at = created_at - make_interval(secs => ${seconds})
             WHERE email = ${email}`.execute(db);
}

describe('cadastro por senha', () => {
  it('sem termos publicados: cria a conta student, não confirmada, com perfil e verify_email', async () => {
    const email = uniqueEmail();
    await registerWithPassword(db, {
      name: '  Ana  ',
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      acceptedTerms: [],
      context: ctx(),
    });
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({ name: 'Ana', role: 'student', emailVerifiedAt: null });
    expect(user.password).toBe(PASSWORD);
    const profile = await db
      .selectFrom('profiles')
      .selectAll()
      .where('userId', '=', user.id)
      .executeTakeFirst();
    expect(profile?.avatarImageId).toBeNull();
    expect((await outbox(user.id)).map((row) => row.type)).toEqual(['account.verify_email']);
    expect(
      await db.selectFrom('sessions').where('userId', '=', user.id).selectAll().execute(),
    ).toEqual([]);
  });

  it('e-mail existente: mesma resposta, account.exists ao dono e nenhuma alteração', async () => {
    const owner = await makeUser({ password: OTHER_PASSWORD });
    const before = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', owner.id)
      .executeTakeFirstOrThrow();
    const result = await registerWithPassword(db, {
      name: 'Intruso',
      email: owner.email,
      password: PASSWORD,
      acceptedTerms: [],
      context: ctx(),
    });
    expect(result).toBeUndefined();
    const after = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', owner.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect((await outbox(owner.id)).map((row) => row.type)).toEqual(['account.exists']);
    const count = await db
      .selectFrom('users')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('email', '=', owner.email)
      .executeTakeFirstOrThrow();
    expect(count.n).toBe(1);
  });

  it('valida formato antes de tudo: nome, e-mail e senha', async () => {
    const base = { acceptedTerms: [], context: ctx() };
    const invalid = await rejects(
      registerWithPassword(db, { ...base, name: ' ', email: 'x', password: PASSWORD }),
      'validation_failed',
      400,
    );
    expect(invalid.errors?.map((e) => e.path)).toEqual(['body.name', 'body.email']);
    await rejects(
      registerWithPassword(db, { ...base, name: 'Ana', email: uniqueEmail(), password: 'curta' }),
      'password_invalid',
      400,
    );
    await rejects(
      registerWithPassword(db, {
        ...base,
        name: 'Ana',
        email: uniqueEmail(),
        password: ' '.repeat(12),
      }),
      'password_invalid',
    );
  });

  it('com termos publicados: exige o aceite antes de consultar o e-mail e grava os aceites', async () => {
    const versions = await db.transaction().execute(async (trx) => {
      const terms = await createTermsDraft(trx, { document: 'terms', bodyMd: '# Termos' });
      const privacy = await createTermsDraft(trx, { document: 'privacy', bodyMd: '# Privacidade' });
      const audit = { origin: 'cli' as const };
      await publishTermsVersion(trx, terms.id, audit);
      await publishTermsVersion(trx, privacy.id, audit);
      return [terms.id, privacy.id];
    });
    const owner = await makeUser();
    const error = await rejects(
      registerWithPassword(db, {
        name: 'Ana',
        email: owner.email,
        password: PASSWORD,
        acceptedTerms: [versions[0] as string],
        context: ctx(),
      }),
      'terms_acceptance_required',
      422,
    );
    expect(error.errors).toEqual([{ path: 'body.acceptedTerms', message: 'privacy' }]);
    // Recusado antes da consulta: o dono do e-mail não recebeu nada.
    expect(await outbox(owner.id)).toEqual([]);

    const email = uniqueEmail();
    await registerWithPassword(db, {
      name: 'Bia',
      email,
      password: PASSWORD,
      acceptedTerms: versions,
      context: ctx(),
    });
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    const accepted = await db
      .selectFrom('termsAcceptances')
      .select('termsVersionId')
      .where('userId', '=', user.id)
      .execute();
    expect(accepted.map((row) => row.termsVersionId).sort()).toEqual([...versions].sort());
  });
});

describe('login por senha', () => {
  it('sucesso: sessão, last_login_at, auth.login, tentativa gravada e Session montada', async () => {
    const user = await makeUser({ verified: true });
    const context = ctx();
    const result = await login(`  ${user.email.toUpperCase()}`, PASSWORD, 'classroom', context);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.session.user).toMatchObject({ id: user.id, role: 'student', hasPassword: true });
    expect(result.view).toMatchObject({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: true,
        avatarUrl: null,
        hasPassword: true,
      },
      csrfToken: result.session.csrfToken,
      termsPending: expect.any(Array),
    });
    expect(result.view.permissions).toContain('catalog.view');
    expect(result.view.permissions).not.toContain('admin.access');
    const row = await db
      .selectFrom('users')
      .select('lastLoginAt')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.lastLoginAt).toBeInstanceOf(Date);
    const audit = await auditOf('auth.login', user.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ origin: 'classroom', actorUserId: user.id, ip: context.ip });
    expect(audit[0]?.details).toEqual({ method: 'password' });
    const attempts = await db
      .selectFrom('loginAttempts')
      .selectAll()
      .where('email', '=', user.email)
      .execute();
    expect(attempts).toMatchObject([{ success: true, site: 'classroom', ip: context.ip }]);
    const session = await db
      .selectFrom('sessions')
      .selectAll()
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(session.idHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.idHash).not.toContain(result.token);
  });

  it('conta sem senha (só provedor) nunca autentica: vazia, espaços ou qualquer texto', async () => {
    const user = await makeUser({ password: null });
    for (const attempt of ['', '   ', 'qualquer-texto', PASSWORD, undefined]) {
      await rejects(login(user.email, attempt), 'invalid_credentials', 401);
    }
  });

  it('senha errada, vazia, e-mail inexistente e conta excluída: invalid_credentials', async () => {
    const user = await makeUser();
    await rejects(login(user.email, 'errada-errada'), 'invalid_credentials');
    await rejects(login(user.email, ''), 'invalid_credentials');
    await rejects(login(user.email, `${PASSWORD} `), 'invalid_credentials');
    await rejects(login(uniqueEmail('ninguem'), PASSWORD), 'invalid_credentials');
    const deleted = await makeUser();
    await db
      .updateTable('users')
      .set({ deletedAt: sql<Date>`now()` })
      .where('id', '=', deleted.id)
      .execute();
    await rejects(login(deleted.email, PASSWORD), 'invalid_credentials');
    // A de e-mail inexistente também é gravada.
    const failures = await db
      .selectFrom('loginAttempts')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('email', 'in', [user.email, deleted.email])
      .where('success', '=', false)
      .executeTakeFirstOrThrow();
    expect(failures.n).toBe(4);
  });

  it('suspensão full: invalid_credentials sem a senha, account_suspended com ela; posting entra', async () => {
    const admin = await makeUser({ role: 'admin' });
    const full = await makeUser();
    await suspend(full.id, 'full', admin.id);
    await rejects(login(full.email, 'errada-errada'), 'invalid_credentials', 401);
    await rejects(login(full.email, PASSWORD), 'account_suspended', 403);
    expect(
      await db.selectFrom('sessions').selectAll().where('userId', '=', full.id).execute(),
    ).toEqual([]);
    const posting = await makeUser();
    await suspend(posting.id, 'posting', admin.id);
    const result = await login(posting.email, PASSWORD);
    expect(result.session.user.suspendedKind).toBe('posting');
  });

  it('site admin: student recebe staff_only sem sessão (conta como sucesso); equipe entra', async () => {
    const student = await makeUser();
    const c = ctx();
    await rejects(login(student.email, PASSWORD, 'admin', c), 'staff_only', 403);
    expect(
      await db.selectFrom('sessions').selectAll().where('userId', '=', student.id).execute(),
    ).toEqual([]);
    const attempt = await db
      .selectFrom('loginAttempts')
      .selectAll()
      .where('email', '=', student.email)
      .executeTakeFirstOrThrow();
    expect(attempt).toMatchObject({ success: true, site: 'admin' });

    const manager = await makeUser({ role: 'manager' });
    const result = await login(manager.email, PASSWORD, 'admin');
    expect(result.session.site).toBe('admin');
    expect(result.view.permissions).toContain('admin.access');
    expect(result.view.permissions).not.toContain('users.password.view');
    expect(result.view.termsPending).toBeUndefined();
    const audit = await auditOf('auth.login', manager.id);
    expect(audit[0]?.origin).toBe('admin_panel');
  });

  // Medida de tempo real: com outras suítes disputando a CPU e o Postgres, um pico isolado
  // decide o p95 de 20 amostras, e o lado mais lento varia de uma execução para outra (task 281).
  // Diferença sistemática reprova as três tentativas; ruído de carga passa numa delas.
  it('tempo de resposta igual para e-mail inexistente e existente (p95 < 50 ms)', {
    retry: 2,
  }, async () => {
    const rounds = 20;
    const existing = await Promise.all(Array.from({ length: rounds }, () => makeUser()));
    const timeOf = async (email: string) => {
      const start = performance.now();
      await rejects(login(email, 'senha-errada-x'), 'invalid_credentials');
      return performance.now() - start;
    };
    // Aquecimento: conexões abertas e consultas preparadas.
    await timeOf(uniqueEmail('aquecimento'));
    const missing: number[] = [];
    const found: number[] = [];
    for (let index = 0; index < rounds; index += 1) {
      missing.push(await timeOf(uniqueEmail('ninguem')));
      found.push(await timeOf((existing[index] as { email: string }).email));
    }
    const p95 = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.ceil(sorted.length * 0.95) - 1] as number;
    };
    expect(Math.abs(p95(missing) - p95(found))).toBeLessThan(50);
  });
});

describe('bloqueio por tentativas', () => {
  it('5 falhas do mesmo e-mail bloqueiam por 15 minutos, mesmo com a senha certa; avisa uma vez', async () => {
    const user = await makeUser();
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      await rejects(login(user.email, `errada-${index}-xx`), 'invalid_credentials');
    }
    const locked = await rejects(login(user.email, PASSWORD), 'too_many_attempts', 429);
    const retry = locked.extras?.retryAfterSeconds as number;
    expect(retry).toBeGreaterThan(LOGIN_FAILURE_WINDOW_SECONDS - 60);
    expect(retry).toBeLessThanOrEqual(LOGIN_FAILURE_WINDOW_SECONDS);
    await rejects(login(user.email, 'errada-de-novo'), 'too_many_attempts');
    // Recusada por bloqueio não conta de novo.
    const failures = await db
      .selectFrom('loginAttempts')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('email', '=', user.email)
      .executeTakeFirstOrThrow();
    expect(failures.n).toBe(LOGIN_MAX_FAILURES);
    const locks = await outbox(user.id, 'account.locked');
    expect(locks).toHaveLength(1);
    const until = (locks[0]?.data as { until?: string } | undefined)?.until ?? '';
    expect(Date.parse(until)).toBeGreaterThan(Date.now());
    const audit = await auditOf('auth.lockout', user.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ scope: 'email' });
    expect(
      await db.selectFrom('sessions').selectAll().where('userId', '=', user.id).execute(),
    ).toEqual([]);

    // A janela passa: a mais antiga das cinco sai e a conta volta a entrar.
    await ageAttempts(user.email, LOGIN_FAILURE_WINDOW_SECONDS + 1);
    await expect(loginLockStatus(db, { email: user.email, ip: nextIp() })).resolves.toEqual({
      locked: false,
    });
    await expect(login(user.email, PASSWORD)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('5 falhas do mesmo IP (qualquer e-mail) bloqueiam o IP, contadas à parte do e-mail', async () => {
    const ip = nextIp();
    const user = await makeUser();
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      await rejects(
        login(uniqueEmail('varredura'), 'qualquer-senha', 'classroom', ctx({ ip })),
        'invalid_credentials',
      );
    }
    const locked = await rejects(
      login(user.email, PASSWORD, 'classroom', ctx({ ip })),
      'too_many_attempts',
      429,
    );
    expect(locked.extras?.retryAfterSeconds).toBeGreaterThan(0);
    // De outro IP a conta entra: o bloqueio do e-mail é outro.
    await expect(login(user.email, PASSWORD)).resolves.toBeDefined();
    const ipLock = (await auditOf('auth.lockout')).filter((row) => row.ip === ip);
    expect(ipLock).toHaveLength(1);
    expect(ipLock[0]?.details).toMatchObject({ scope: 'ip' });
  });

  it('e-mail inexistente também bloqueia; sem dono, ninguém recebe aviso', async () => {
    const email = uniqueEmail('fantasma');
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      await rejects(login(email, 'qualquer-senha'), 'invalid_credentials');
    }
    await rejects(login(email, 'qualquer-senha'), 'too_many_attempts');
  });

  it('redefinir a senha libera a conta', async () => {
    const user = await makeUser();
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      await rejects(login(user.email, `errada-${index}-xx`), 'invalid_credentials');
    }
    await rejects(login(user.email, PASSWORD), 'too_many_attempts');
    const token = await db.transaction().execute((trx) => issueEmailToken(trx, user.id, 'reset'));
    await resetPassword(db, { token: token.token, password: OTHER_PASSWORD, context: ctx() });
    await expect(login(user.email, OTHER_PASSWORD)).resolves.toBeDefined();
  });

  it('falha simultânea depois do bloqueio fechado não é gravada', async () => {
    const email = uniqueEmail('corrida');
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      await rejects(login(email, 'x-x-x-x-x'), 'invalid_credentials');
    }
    const result = await db
      .transaction()
      .execute((trx) =>
        recordLoginFailure(trx, { email, site: 'classroom', context: ctx(), userId: null }),
      );
    expect(result).toEqual({ locked: [], alreadyLocked: true });
    await expect(
      recordLoginFailure(db, { email, site: 'classroom', context: ctx(), userId: null }),
    ).rejects.toThrow(TypeError);
  });

  it('assertNotLocked passa sem falhas', async () => {
    await expect(
      assertNotLocked(db, { email: uniqueEmail(), ip: nextIp() }),
    ).resolves.toBeUndefined();
  });
});

describe('dispositivo novo', () => {
  it('primeiro login não avisa; dispositivo novo avisa; conhecido só atualiza', async () => {
    const user = await makeUser();
    await login(user.email, PASSWORD, 'classroom', ctx({ userAgent: CHROME_MAC }));
    expect(await outbox(user.id, 'account.new_login')).toEqual([]);
    const ip = nextIp();
    await login(user.email, PASSWORD, 'classroom', ctx({ ip, userAgent: FIREFOX_WINDOWS }));
    const notices = await outbox(user.id, 'account.new_login');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.data).toMatchObject({
      ip,
      browser: 'Firefox',
      os: 'Windows',
      site: 'classroom',
    });
    await login(user.email, PASSWORD, 'classroom', ctx({ userAgent: CHROME_MAC }));
    expect(await outbox(user.id, 'account.new_login')).toHaveLength(1);
    const devices = await db
      .selectFrom('userDevices')
      .select('deviceKey')
      .where('userId', '=', user.id)
      .execute();
    expect(devices.map((row) => row.deviceKey).sort()).toEqual(['Chrome|macOS', 'Firefox|Windows']);
  });

  it('registerLoginDevice informa o resultado', async () => {
    const user = await makeUser();
    const first = await db.transaction().execute((trx) =>
      registerLoginDevice(trx, {
        userId: user.id,
        site: 'admin',
        context: ctx({ userAgent: null }),
      }),
    );
    expect(first).toEqual({ deviceKey: 'Outro|Outro', isNew: true, notified: false });
    const again = await db.transaction().execute((trx) =>
      registerLoginDevice(trx, {
        userId: user.id,
        site: 'admin',
        context: ctx({ userAgent: null }),
      }),
    );
    expect(again).toEqual({ deviceKey: 'Outro|Outro', isNew: false, notified: false });
  });
});

describe('sessões', () => {
  it('valida a cada requisição: site, vencimento, exclusão e suspensão full', async () => {
    const user = await makeUser();
    const { token } = await login(user.email, PASSWORD);
    const session = await authenticateSession(db, { token, site: 'classroom' });
    expect(session).toMatchObject({ site: 'classroom', renewed: false, user: { id: user.id } });
    await rejects(authenticateSession(db, { token, site: 'admin' }), 'unauthenticated', 401);
    await rejects(
      authenticateSession(db, { token: undefined, site: 'classroom' }),
      'unauthenticated',
    );
    await rejects(
      authenticateSession(db, { token: 'curto', site: 'classroom' }),
      'unauthenticated',
    );
    await rejects(
      authenticateSession(db, { token: 'A'.repeat(43), site: 'classroom' }),
      'unauthenticated',
    );

    const admin = await makeUser({ role: 'admin' });
    await suspend(user.id, 'full', admin.id);
    await rejects(authenticateSession(db, { token, site: 'classroom' }), 'unauthenticated');
    await db
      .updateTable('users')
      .set({ suspendedAt: null, suspendedKind: null, suspendedReason: null, suspendedBy: null })
      .where('id', '=', user.id)
      .execute();
    await expect(authenticateSession(db, { token, site: 'classroom' })).resolves.toBeDefined();

    await db
      .updateTable('users')
      .set({ deletedAt: sql<Date>`now()` })
      .where('id', '=', user.id)
      .execute();
    await rejects(authenticateSession(db, { token, site: 'classroom' }), 'unauthenticated');
  });

  it('sessão vencida é recusada', async () => {
    const user = await makeUser();
    const { token, session } = await login(user.email, PASSWORD);
    await sql`UPDATE sessions SET created_at = now() - interval '40 days',
                                  last_used_at = now() - interval '31 days',
                                  expires_at = now() - interval '1 day'
               WHERE id = ${session.id}`.execute(db);
    await rejects(authenticateSession(db, { token, site: 'classroom' }), 'unauthenticated');
  });

  it('renova last_used_at e expires_at no máximo uma vez por minuto', async () => {
    const user = await makeUser();
    const { token, session } = await login(user.email, PASSWORD);
    const again = await authenticateSession(db, { token, site: 'classroom' });
    expect(again.renewed).toBe(false);
    await sql`UPDATE sessions SET created_at = now() - interval '1 hour',
                                  last_used_at = now() - make_interval(secs => ${SESSION_RENEW_INTERVAL_SECONDS + 5}),
                                  expires_at = now() + interval '1 day'
               WHERE id = ${session.id}`.execute(db);
    const renewed = await authenticateSession(db, { token, site: 'classroom', ttlDays: 30 });
    expect(renewed.renewed).toBe(true);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const next = await authenticateSession(db, { token, site: 'classroom' });
    expect(next.renewed).toBe(false);
  });

  it('lista, encerra uma, as outras e todas; logout grava auth.logout', async () => {
    const user = await makeUser();
    const a = await login(user.email, PASSWORD, 'classroom', ctx({ userAgent: FIREFOX_WINDOWS }));
    const b = await login(user.email, PASSWORD);
    const c = await login(user.email, PASSWORD);
    const list = await listSessions(db, user.id, a.session.id);
    expect(list).toHaveLength(3);
    expect(list.find((item) => item.id === a.session.id)).toMatchObject({
      current: true,
      browser: 'Firefox',
      os: 'Windows',
      site: 'classroom',
    });
    expect(list.filter((item) => item.current)).toHaveLength(1);

    await revokeSession(db, { userId: user.id, sessionId: b.session.id });
    await rejects(
      revokeSession(db, { userId: user.id, sessionId: b.session.id }),
      'not_found',
      404,
    );
    await rejects(revokeSession(db, { userId: user.id, sessionId: 'nao-e-uuid' }), 'not_found');
    const stranger = await makeUser();
    await rejects(revokeSession(db, { userId: stranger.id, sessionId: c.session.id }), 'not_found');

    expect(await revokeOtherSessions(db, a.session)).toBe(1);
    await rejects(
      authenticateSession(db, { token: c.token, site: 'classroom' }),
      'unauthenticated',
    );
    await expect(
      authenticateSession(db, { token: a.token, site: 'classroom' }),
    ).resolves.toBeDefined();

    await logout(db, a.session, ctx());
    await rejects(
      authenticateSession(db, { token: a.token, site: 'classroom' }),
      'unauthenticated',
    );
    expect(await auditOf('auth.logout', user.id)).toHaveLength(1);

    const manager = await makeUser({ role: 'manager' });
    await login(manager.email, PASSWORD, 'admin');
    await login(manager.email, PASSWORD, 'classroom');
    expect(await revokeUserSessions(db, manager.id, { site: 'admin' })).toBe(1);
    expect(await listSessions(db, manager.id)).toMatchObject([
      { site: 'classroom', current: false },
    ]);
    expect(await revokeUserSessions(db, manager.id)).toBe(1);
  });

  it('createSession recusa validade inválida', async () => {
    const user = await makeUser();
    await expect(
      db
        .transaction()
        .execute((trx) =>
          createSession(trx, { userId: user.id, site: 'classroom', context: ctx(), ttlDays: 0 }),
        ),
    ).rejects.toThrow(TypeError);
    await expect(
      openLoginSession(db, {
        user: { id: user.id, role: 'student' },
        site: 'classroom',
        context: ctx(),
        method: 'google',
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe('termos pendentes na sessão', () => {
  it('termsPending no classroom e a trava terms_acceptance_pending com as exceções', async () => {
    const user = await makeUser();
    const { session, view } = await login(user.email, PASSWORD);
    // Os termos foram publicados no cadastro acima; esta conta não aceitou.
    expect(view.termsPending?.map((version) => version.document).sort()).toEqual([
      'privacy',
      'terms',
    ]);
    await rejects(
      assertTermsGate(db, session, { method: 'PUT', path: '/api/v1/account/password' }),
      'terms_acceptance_pending',
      403,
    );
    await expect(
      assertTermsGate(db, session, { method: 'POST', path: '/api/v1/auth/logout' }),
    ).resolves.toBeUndefined();
    await expect(
      assertTermsGate(db, session, { method: 'GET', path: '/api/v1/session' }),
    ).resolves.toBeUndefined();

    const manager = await makeUser({ role: 'manager' });
    const admin = await login(manager.email, PASSWORD, 'admin');
    await expect(
      assertTermsGate(db, admin.session, { method: 'PUT', path: '/api/v1/users/x' }),
    ).resolves.toBeUndefined();
  });
});

describe('confirmação de e-mail', () => {
  it('confirma com o token; usado, vencido ou de conta excluída é token_expired', async () => {
    const user = await makeUser();
    const { token } = await db
      .transaction()
      .execute((trx) => issueEmailToken(trx, user.id, 'verify'));
    await verifyEmail(db, token);
    const row = await db
      .selectFrom('users')
      .select('emailVerifiedAt')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    await rejects(verifyEmail(db, token), 'token_expired', 410);
    await rejects(verifyEmail(db, 'desconhecido'), 'token_expired');

    const gone = await makeUser();
    const second = await db.transaction().execute((trx) => issueEmailToken(trx, gone.id, 'verify'));
    await db
      .updateTable('users')
      .set({ deletedAt: sql<Date>`now()` })
      .where('id', '=', gone.id)
      .execute();
    await rejects(verifyEmail(db, second.token), 'token_expired');
  });

  it('reenvio: até 3 por hora; e-mail confirmado não envia', async () => {
    const user = await makeUser();
    for (let index = 0; index < EMAIL_RESEND_LIMIT_PER_HOUR; index += 1) {
      await expect(resendVerificationEmail(db, user.id)).resolves.toEqual({ sent: true });
    }
    const limited = await rejects(resendVerificationEmail(db, user.id), 'rate_limited', 429);
    expect(limited.extras?.retryAfterSeconds).toBeGreaterThan(3000);
    const verified = await makeUser({ verified: true });
    await expect(resendVerificationEmail(db, verified.id)).resolves.toEqual({ sent: false });
  });
});

describe('senha: esqueci, redefinir, definir e trocar', () => {
  it('esqueci a senha: só a conta existente recebe o link; inexistente e inválido não falham', async () => {
    const user = await makeUser({ password: null });
    await requestPasswordReset(db, `  ${user.email.toUpperCase()}`);
    expect(await outbox(user.id, 'account.password_reset')).toHaveLength(1);
    await expect(requestPasswordReset(db, uniqueEmail('ninguem'))).resolves.toBeUndefined();
    await expect(requestPasswordReset(db, 'nao-e-email')).resolves.toBeUndefined();
  });

  it('redefinir: define a senha, confirma o e-mail, invalida os outros links, encerra todas as sessões', async () => {
    const user = await makeUser();
    const first = await login(user.email, PASSWORD);
    const second = await login(user.email, PASSWORD);
    const token = await db.transaction().execute((trx) => issueEmailToken(trx, user.id, 'reset'));
    await rejects(
      resetPassword(db, { token: token.token, password: 'curta', context: ctx() }),
      'password_invalid',
    );
    // O link não foi gasto pela senha inválida.
    await resetPassword(db, { token: token.token, password: OTHER_PASSWORD, context: ctx() });
    await rejects(
      resetPassword(db, { token: token.token, password: OTHER_PASSWORD, context: ctx() }),
      'token_expired',
      410,
    );
    for (const { token: cookie } of [first, second]) {
      await rejects(
        authenticateSession(db, { token: cookie, site: 'classroom' }),
        'unauthenticated',
      );
    }
    const row = await db
      .selectFrom('users')
      .select(['password', 'emailVerifiedAt'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.password).toBe(OTHER_PASSWORD);
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    await rejects(login(user.email, PASSWORD), 'invalid_credentials');
    await expect(login(user.email, OTHER_PASSWORD)).resolves.toBeDefined();
    expect(await auditOf('auth.password_reset', user.id)).toHaveLength(1);
    expect(await outbox(user.id, 'account.password_changed')).toMatchObject([
      { data: { by: 'self' } },
    ]);
  });

  it('redefinir com token de conta excluída é token_expired', async () => {
    const user = await makeUser();
    const token = await db.transaction().execute((trx) => issueEmailToken(trx, user.id, 'reset'));
    await db
      .updateTable('users')
      .set({ deletedAt: sql<Date>`now()` })
      .where('id', '=', user.id)
      .execute();
    await rejects(
      resetPassword(db, { token: token.token, password: OTHER_PASSWORD, context: ctx() }),
      'token_expired',
    );
  });

  it('trocar exige a atual; errada é current_password_invalid e conta no bloqueio', async () => {
    const user = await makeUser();
    const current = await login(user.email, PASSWORD);
    const other = await login(user.email, PASSWORD);
    const base = { session: current.session, context: ctx() };
    await rejects(
      changePassword(db, { ...base, newPassword: 'curta', currentPassword: PASSWORD }),
      'password_invalid',
    );
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      await rejects(
        changePassword(db, {
          ...base,
          newPassword: OTHER_PASSWORD,
          currentPassword: 'errada-errada',
        }),
        'current_password_invalid',
        422,
      );
    }
    await rejects(
      changePassword(db, { ...base, newPassword: OTHER_PASSWORD, currentPassword: PASSWORD }),
      'too_many_attempts',
      429,
    );
    await ageAttempts(user.email, LOGIN_FAILURE_WINDOW_SECONDS + 1);
    await changePassword(db, { ...base, newPassword: OTHER_PASSWORD, currentPassword: PASSWORD });
    await expect(
      authenticateSession(db, { token: current.token, site: 'classroom' }),
    ).resolves.toBeDefined();
    await rejects(
      authenticateSession(db, { token: other.token, site: 'classroom' }),
      'unauthenticated',
    );
    expect(await auditOf('user.password_set', user.id)).toHaveLength(1);
    expect(await outbox(user.id, 'account.password_changed')).toHaveLength(1);
  });

  it('definir (conta sem senha) basta a sessão', async () => {
    const user = await makeUser({ password: null });
    const created = await db.transaction().execute((trx) =>
      openLoginSession(trx, {
        user: { id: user.id, role: 'student' },
        site: 'classroom',
        context: ctx(),
        method: 'google',
      }),
    );
    const session = await authenticateSession(db, { token: created.token, site: 'classroom' });
    expect(session.user.hasPassword).toBe(false);
    await changePassword(db, { session, newPassword: OTHER_PASSWORD, context: ctx() });
    await expect(login(user.email, OTHER_PASSWORD)).resolves.toBeDefined();
  });

  it('confirmPassword com password_confirmation_invalid e applyPasswordChange exige transação', async () => {
    const admin = await makeUser({ role: 'admin' });
    await rejects(
      confirmPassword(db, {
        userId: admin.id,
        password: 'errada-errada',
        site: 'admin',
        context: ctx(),
        failure: 'password_confirmation_invalid',
      }),
      'password_confirmation_invalid',
      422,
    );
    await expect(
      confirmPassword(db, { userId: admin.id, password: PASSWORD, site: 'admin', context: ctx() }),
    ).resolves.toBeUndefined();
    await expect(
      applyPasswordChange(db, {
        userId: admin.id,
        password: OTHER_PASSWORD,
        by: 'admin',
        audit: { context: { origin: 'admin_panel' }, action: 'user.password_set' },
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe('provedores vinculados', () => {
  it('lista e remove; o último método é recusado', async () => {
    const user = await makeUser({ password: null });
    await db
      .insertInto('oauthIdentities')
      .values([
        {
          userId: user.id,
          provider: 'google',
          providerUserId: `g-${user.id}`,
          email: user.email,
          emailVerified: true,
        },
        { userId: user.id, provider: 'apple', providerUserId: `a-${user.id}`, email: null },
      ])
      .execute();
    const list = await listIdentities(db, user.id);
    expect(list.hasPassword).toBe(false);
    expect(list.items.map((item) => item.provider).sort()).toEqual(['apple', 'google']);
    const input = {
      user: { id: user.id, role: 'student' as const },
      site: 'classroom' as const,
      context: ctx(),
    };
    await rejects(removeIdentity(db, { ...input, provider: 'facebook' }), 'not_found', 404);
    await rejects(removeIdentity(db, { ...input, provider: 'github' }), 'not_found');
    await removeIdentity(db, { ...input, provider: 'apple' });
    await rejects(removeIdentity(db, { ...input, provider: 'google' }), 'last_login_method', 422);
    expect(await auditOf('auth.provider_unlink', user.id)).toHaveLength(1);

    const withPassword = await makeUser();
    await db
      .insertInto('oauthIdentities')
      .values({
        userId: withPassword.id,
        provider: 'google',
        providerUserId: `g-${withPassword.id}`,
      })
      .execute();
    await removeIdentity(db, {
      ...input,
      user: { id: withPassword.id, role: 'student' },
      provider: 'google',
    });
    expect((await listIdentities(db, withPassword.id)).items).toEqual([]);
  });
});

describe('avatar', () => {
  async function image(ownerUserId: string, purpose: string): Promise<string> {
    const row = await db
      .insertInto('images')
      .values({ ownerUserId, purpose, originalWidth: 256, originalHeight: 256 })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it('associa, recusa de outra finalidade ou de outro usuário, e remove', async () => {
    const user = await makeUser();
    const avatar = await image(user.id, 'avatar');
    await expect(
      setAvatar(db, { userId: user.id, imageId: avatar.toUpperCase() }),
    ).resolves.toEqual({
      avatarUrl: `/api/v1/images/${avatar}/256.webp`,
    });
    const { session } = await login(user.email, PASSWORD);
    expect((await buildSessionView(db, session)).user.avatarUrl).toBe(
      `/api/v1/images/${avatar}/256.webp`,
    );
    await rejects(
      setAvatar(db, { userId: user.id, imageId: await image(user.id, 'school_logo') }),
      'image_purpose_mismatch',
      422,
    );
    const stranger = await makeUser();
    await rejects(
      setAvatar(db, { userId: user.id, imageId: await image(stranger.id, 'avatar') }),
      'not_found',
      404,
    );
    await rejects(setAvatar(db, { userId: user.id, imageId: crypto.randomUUID() }), 'not_found');
    await rejects(setAvatar(db, { userId: user.id, imageId: 'x' }), 'not_found');
    await expect(setAvatar(db, { userId: user.id, imageId: null })).resolves.toEqual({
      avatarUrl: null,
    });
  });
});

describe('admin inicial, create-admin e último admin', () => {
  // Roda num banco à parte: a regra depende de não existir nenhum admin.
  let adminTestDb: TestDatabase;
  let adb: Database;

  beforeAll(async () => {
    adminTestDb = await createTestDatabase();
    adb = createDatabase({ connectionString: adminTestDb.url, maxConnections: 4 });
  });

  afterAll(async () => {
    await closeDatabase(adb);
    await adminTestDb.drop();
  });

  it('sem variáveis e sem admin: missing_variables', async () => {
    await expect(ensureInitialAdmin(adb, { email: null, password: null })).resolves.toEqual({
      status: 'missing_variables',
      userId: null,
    });
  });

  it('primeira subida cria o admin; a segunda, com valores diferentes, não altera nada', async () => {
    const first = await ensureInitialAdmin(adb, {
      email: ' Diretora@Escola.test ',
      password: PASSWORD,
    });
    expect(first.status).toBe('created');
    const admin = await adb
      .selectFrom('users')
      .selectAll()
      .where('id', '=', first.userId as string)
      .executeTakeFirstOrThrow();
    expect(admin).toMatchObject({
      email: 'diretora@escola.test',
      name: 'diretora',
      role: 'admin',
      password: PASSWORD,
    });
    expect(admin.emailVerifiedAt).toBeInstanceOf(Date);
    const audit = await adb
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'user.create')
      .execute();
    expect(audit).toMatchObject([{ origin: 'cli', actorUserId: null, targetId: admin.id }]);

    const second = await ensureInitialAdmin(adb, {
      email: 'outra@escola.test',
      password: OTHER_PASSWORD,
    });
    expect(second).toEqual({ status: 'exists', userId: null });
    const after = await adb
      .selectFrom('users')
      .selectAll()
      .where('id', '=', admin.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(admin);
    expect(
      await adb.selectFrom('users').select('id').where('email', '=', 'outra@escola.test').execute(),
    ).toEqual([]);
  });

  it('último admin ativo: recusado; com outro admin ativo, liberado', async () => {
    const [only] = await adb.selectFrom('users').select('id').where('role', '=', 'admin').execute();
    const onlyId = (only as { id: string }).id;
    expect(await countActiveAdmins(adb)).toBe(1);
    await rejects(
      adb.transaction().execute((trx) => assertNotLastActiveAdmin(trx, onlyId)),
      'last_admin',
      422,
    );
    await expect(assertNotLastActiveAdmin(adb, onlyId)).rejects.toThrow(TypeError);
    const student = await adb
      .transaction()
      .execute((trx) =>
        createAccount(trx, { email: uniqueEmail(), name: 'Aluno', password: null }),
      );
    await expect(
      adb.transaction().execute((trx) => assertNotLastActiveAdmin(trx, student)),
    ).resolves.toBeUndefined();

    // create-admin promove a conta existente, confirma o e-mail e encerra as sessões.
    const email = (
      await adb
        .selectFrom('users')
        .select('email')
        .where('id', '=', student)
        .executeTakeFirstOrThrow()
    ).email;
    await adb
      .transaction()
      .execute((trx) => createSession(trx, { userId: student, site: 'classroom', context: ctx() }));
    const promoted = await createOrPromoteAdmin(adb, { email, password: OTHER_PASSWORD });
    expect(promoted).toEqual({ userId: student, created: false, sessionsRevoked: 1 });
    const row = await adb
      .selectFrom('users')
      .selectAll()
      .where('id', '=', student)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ role: 'admin', password: OTHER_PASSWORD });
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    const roleAudit = await adb
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'user.set_role')
      .execute();
    expect(roleAudit).toMatchObject([
      {
        origin: 'cli',
        targetId: student,
        details: { before: { role: 'student' }, after: { role: 'admin' } },
      },
    ]);
    expect(await countActiveAdmins(adb)).toBe(2);
    await expect(
      adb.transaction().execute((trx) => assertNotLastActiveAdmin(trx, onlyId)),
    ).resolves.toBeUndefined();

    const created = await createOrPromoteAdmin(adb, {
      email: 'emergencia@escola.test',
      password: PASSWORD,
    });
    expect(created).toMatchObject({ created: true, sessionsRevoked: 0 });
    await rejects(
      createOrPromoteAdmin(adb, { email: 'nova@escola.test', password: 'curta' }),
      'password_invalid',
    );
    await expect(
      createOrPromoteAdmin(adb, { email: 'sem-arroba', password: PASSWORD }),
    ).rejects.toThrow(TypeError);
  });

  it('existindo a conta e nenhum admin, promove', async () => {
    const other = await createTestDatabase();
    const odb = createDatabase({ connectionString: other.url, maxConnections: 2 });
    try {
      const email = uniqueEmail('gerente');
      await odb
        .transaction()
        .execute((trx) =>
          createAccount(trx, { email, name: 'Gerente', password: null, role: 'manager' }),
        );
      const result = await ensureInitialAdmin(odb, { email, password: PASSWORD });
      expect(result.status).toBe('promoted');
      const row = await odb
        .selectFrom('users')
        .select(['role', 'password'])
        .where('email', '=', email)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ role: 'admin', password: PASSWORD });
    } finally {
      await closeDatabase(odb);
      await other.drop();
    }
  });
});

describe('varredura da senha de teste (RNF-05)', () => {
  it('não aparece em log, audit_log, jobs.payload nem email_outbox', async () => {
    const tables = [
      'audit_log',
      'jobs',
      'email_outbox',
      'login_attempts',
      'sessions',
      'user_devices',
    ];
    for (const table of tables) {
      const result = await sql<{
        t: string;
      }>`SELECT t::text AS t FROM ${sql.table(table)} t`.execute(db);
      const text = result.rows.map((row) => row.t).join('\n');
      expect(text.length, table).toBeGreaterThan(0);
      expect(text, table).not.toContain(PASSWORD);
      expect(text, table).not.toContain(OTHER_PASSWORD);
    }
    const logs = logLines.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain(OTHER_PASSWORD);
  });
});
