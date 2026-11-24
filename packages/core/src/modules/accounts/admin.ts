import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type AuditContext, recordAudit } from '../audit/record.ts';
import { assertValidPassword, isValidEmail, normalizeEmail } from './credentials.ts';
import { lastAdmin } from './errors.ts';
import { createAccount, findUserIdByEmail, lockEmail } from './registration.ts';
import { revokeUserSessions } from './sessions.ts';

// Admin inicial, comando `create-admin` e a regra do último admin ativo (spec 007, "Admin
// inicial"; spec 008). Dono: admin-api.

const CLI_CONTEXT: AuditContext = { origin: 'cli', actorUserId: null, actorRole: null };

async function lockAdmins(trx: Database): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended('users:admins', 0))`.execute(trx);
}

/** Nome do admin criado pelas variáveis: a parte local do e-mail. */
function localPart(email: string): string {
  const name = email.split('@')[0]?.trim();
  return name ? name : email;
}

export type InitialAdminStatus =
  /** Já existe admin (excluído não conta): as variáveis são ignoradas. */
  | 'exists'
  /** Sem admin e sem `ADMIN_EMAIL` ou `ADMIN_PASSWORD`: a API sobe e avisa no log. */
  | 'missing_variables'
  | 'created'
  /** A conta do e-mail existia e foi promovida a `admin`, com a senha das variáveis. */
  | 'promoted';

export interface InitialAdminResult {
  status: InitialAdminStatus;
  userId: string | null;
}

/**
 * Na subida da `admin-api` (`config.admin`): sem nenhum `admin` não excluído, cria o admin com
 * e-mail confirmado, nome igual à parte local do e-mail e `user.create` na auditoria
 * (`origin = cli`); conta existente com o e-mail é promovida e recebe a senha. Com admin já
 * existente, nada muda. Senha fora de 8 a 128 já impede a subida em `loadConfig`; aqui lança
 * `password_invalid` se chegar assim.
 */
export async function ensureInitialAdmin(
  db: Database,
  admin: { email: string | null; password: string | null },
): Promise<InitialAdminResult> {
  return db.transaction().execute(async (trx) => {
    await lockAdmins(trx);
    const existing = await trx
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'admin')
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (existing) {
      return { status: 'exists', userId: null };
    }
    if (admin.email === null || admin.password === null) {
      return { status: 'missing_variables', userId: null };
    }
    const result = await createOrPromote(trx, admin.email, admin.password);
    return { status: result.created ? 'created' : 'promoted', userId: result.userId };
  });
}

export interface CreateAdminResult {
  userId: string;
  created: boolean;
  /** Sessões encerradas da conta promovida. */
  sessionsRevoked: number;
}

/**
 * Comando de emergência `create-admin` (a senha vem do terminal, nunca de argumento): cria ou
 * promove a conta, confirma o e-mail, encerra as sessões e grava na auditoria com
 * `origin = cli`. E-mail inválido: `TypeError`; senha fora de 8 a 128: `password_invalid`.
 */
export async function createOrPromoteAdmin(
  db: Database,
  input: { email: string; password: string },
): Promise<CreateAdminResult> {
  return db.transaction().execute(async (trx) => {
    await lockAdmins(trx);
    const result = await createOrPromote(trx, input.email, input.password);
    const sessionsRevoked = result.created ? 0 : await revokeUserSessions(trx, result.userId);
    return { ...result, sessionsRevoked };
  });
}

async function createOrPromote(
  trx: Database,
  rawEmail: string,
  password: string,
): Promise<{ userId: string; created: boolean }> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    throw new TypeError('E-mail do admin inválido.');
  }
  assertValidPassword(password, 'ADMIN_PASSWORD');
  await lockEmail(trx, email);
  const userId = await findUserIdByEmail(trx, email);
  if (userId === undefined) {
    const id = await createAccount(trx, {
      email,
      name: localPart(email),
      password,
      role: 'admin',
      emailVerified: true,
    });
    await recordAudit(trx, {
      context: CLI_CONTEXT,
      action: 'user.create',
      targetType: 'user',
      targetId: id,
      details: { role: 'admin' },
    });
    return { userId: id, created: true };
  }
  const before = await trx
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  await trx
    .updateTable('users')
    .set({
      role: 'admin',
      password,
      emailVerifiedAt: sql<Date>`coalesce(email_verified_at, now())`,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', userId)
    .execute();
  if (before.role !== 'admin') {
    await recordAudit(trx, {
      context: CLI_CONTEXT,
      action: 'user.set_role',
      targetType: 'user',
      targetId: userId,
      details: { before: { role: before.role }, after: { role: 'admin' } },
    });
  }
  await recordAudit(trx, {
    context: CLI_CONTEXT,
    action: 'user.password_set',
    targetType: 'user',
    targetId: userId,
  });
  return { userId, created: false };
}

/** Admins ativos: papel `admin`, sem suspensão e não excluídos. */
export async function countActiveAdmins(db: Database, exceptUserId?: string): Promise<number> {
  let query = db
    .selectFrom('users')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('role', '=', 'admin')
    .where('suspendedAt', 'is', null)
    .where('deletedAt', 'is', null);
  if (exceptUserId !== undefined) {
    query = query.where('id', '<>', exceptUserId);
  }
  const row = await query.executeTakeFirstOrThrow();
  return row.count;
}

/**
 * Regra do último admin ativo (spec 007 e 008): antes de rebaixar, suspender ou excluir
 * `userId`, lança `422 last_admin` se ele é admin ativo e não resta outro. Exige transação: a
 * trava dos admins vale até o fim dela, então duas ações simultâneas não removem os dois
 * últimos. Conta que não é admin ativo passa sem conferir.
 */
export async function assertNotLastActiveAdmin(trx: Database, userId: string): Promise<void> {
  if (!trx.isTransaction) {
    throw new TypeError('assertNotLastActiveAdmin exige uma transação aberta (db.transaction()).');
  }
  await lockAdmins(trx);
  const target = await trx
    .selectFrom('users')
    .select(['role', 'suspendedAt', 'deletedAt'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (target?.role !== 'admin' || target.suspendedAt !== null || target.deletedAt !== null) {
    return;
  }
  if ((await countActiveAdmins(trx, userId)) === 0) {
    throw lastAdmin();
  }
}
