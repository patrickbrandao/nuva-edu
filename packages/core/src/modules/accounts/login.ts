import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { recordAudit } from '../audit/record.ts';
import { isStaffRole, type Role } from '../permissions/roles.ts';
import { type AccountSite, auditContextFor, type RequestContext, requireIp } from './context.ts';
import { normalizeEmail, passwordMatches } from './credentials.ts';
import { registerLoginDevice } from './devices.ts';
import { accountSuspended, invalidCredentials, staffOnly } from './errors.ts';
import { assertNotLocked, recordLoginAttempt, recordLoginFailure } from './lockout.ts';
import { buildSessionView, type SessionView } from './session-view.ts';
import {
  type AuthenticatedSession,
  authenticateSession,
  type CreatedSession,
  createSession,
} from './sessions.ts';

// Login por senha (spec 007, "Login por senha") e a abertura de sessão comum a todos os métodos.

/** Método do login, gravado em `auth.login` (`details.method`). */
export type LoginMethod = 'password' | 'google' | 'facebook' | 'apple';

export interface OpenLoginSessionInput {
  user: { id: string; role: Role };
  site: AccountSite;
  context: RequestContext;
  method: LoginMethod;
  ttlDays?: number;
}

/**
 * O que todo login bem-sucedido faz, por qualquer método (o login social da tarefa 148 usa esta
 * mesma função): abre a sessão do site, atualiza `users.last_login_at`, grava `auth.login` e
 * confere o dispositivo (`account.new_login`). Exige transação. Não confere suspensão nem papel:
 * quem chama já conferiu.
 */
export async function openLoginSession(
  trx: Database,
  input: OpenLoginSessionInput,
): Promise<CreatedSession> {
  if (!trx.isTransaction) {
    throw new TypeError('openLoginSession exige uma transação aberta (db.transaction()).');
  }
  const created = await createSession(trx, {
    userId: input.user.id,
    site: input.site,
    context: input.context,
    ...(input.ttlDays === undefined ? {} : { ttlDays: input.ttlDays }),
  });
  await trx
    .updateTable('users')
    .set({ lastLoginAt: sql<Date>`now()` })
    .where('id', '=', input.user.id)
    .execute();
  await recordAudit(trx, {
    context: auditContextFor(input.site, input.context, input.user),
    action: 'auth.login',
    targetType: 'user',
    targetId: input.user.id,
    details: { method: input.method },
  });
  await registerLoginDevice(trx, {
    userId: input.user.id,
    site: input.site,
    context: input.context,
  });
  return created;
}

export interface PasswordLoginInput {
  site: AccountSite;
  email: string;
  /** Como veio no corpo: qualquer valor errado, vazio ou só de espaços é `invalid_credentials`. */
  password: unknown;
  context: RequestContext;
}

export interface LoginOptions {
  /** `config.retention.sessionDays`. */
  ttlDays?: number;
}

export interface LoginResult {
  /** Valor do cookie `sessionCookieName(site)`. */
  token: string;
  session: AuthenticatedSession;
  /** Corpo `200` da resposta. */
  view: SessionView;
}

/**
 * `POST /auth/login` nos dois sites. Ordem:
 *
 * 1. E-mail ou IP bloqueado: `429 too_many_attempts` (`retryAfterSeconds`), sem gravar tentativa.
 * 2. A comparação da senha roda sempre, também sem conta, em tempo constante (RNF-04). Conta
 *    inexistente, excluída, sem senha, senha errada, vazia ou só de espaços: grava a falha (que
 *    pode fechar o bloqueio) e responde `401 invalid_credentials`.
 * 3. Senha certa com suspensão `full`: `403 account_suspended`. No admin, papel `student`:
 *    `403 staff_only`. As duas contam como sucesso (a senha conferiu) e não abrem sessão.
 * 4. Sucesso: tentativa gravada, sessão aberta (`openLoginSession`).
 */
export async function loginWithPassword(
  db: Database,
  input: PasswordLoginInput,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const email = normalizeEmail(typeof input.email === 'string' ? input.email : '');
  const ip = requireIp(input.context.ip);
  const context: RequestContext = { ...input.context, ip };
  await assertNotLocked(db, { email, ip });

  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'password', 'suspendedKind'])
    .where('email', '=', email)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!passwordMatches(user?.password ?? null, input.password) || user === undefined) {
    await db.transaction().execute(async (trx) => {
      await recordLoginFailure(trx, {
        email,
        site: input.site,
        context,
        userId: user?.id ?? null,
      });
    });
    throw invalidCredentials();
  }

  const role = user.role as Role;
  if (user.suspendedKind === 'full') {
    await recordLoginAttempt(db, { email, ip, site: input.site, success: true });
    throw accountSuspended();
  }
  if (input.site === 'admin' && !isStaffRole(role)) {
    await recordLoginAttempt(db, { email, ip, site: input.site, success: true });
    throw staffOnly();
  }

  const created = await db.transaction().execute(async (trx) => {
    await recordLoginAttempt(trx, { email, ip, site: input.site, success: true });
    return openLoginSession(trx, {
      user: { id: user.id, role },
      site: input.site,
      context,
      method: 'password',
      ...(options.ttlDays === undefined ? {} : { ttlDays: options.ttlDays }),
    });
  });
  const session = await authenticateSession(db, {
    token: created.token,
    site: input.site,
    ...(options.ttlDays === undefined ? {} : { ttlDays: options.ttlDays }),
  });
  return { token: created.token, session, view: await buildSessionView(db, session) };
}
