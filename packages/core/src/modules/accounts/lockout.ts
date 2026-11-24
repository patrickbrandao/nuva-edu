import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { recordAudit } from '../audit/record.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import { type AccountSite, auditContextFor, type RequestContext, requireIp } from './context.ts';
import { tooManyAttempts } from './errors.ts';

// Bloqueio por tentativas (spec 007, RNF-02 e "Bloqueio e dispositivo novo"). Dono de
// `login_attempts`: a API do respectivo site, por estas funções.
//
// - 5 falhas em 15 minutos para o mesmo e-mail, ou do mesmo IP (qualquer e-mail), recusam novas
//   tentativas até a falha que fechou a conta sair da janela (`Retry-After`).
// - Falha = senha errada (inclusive vazia), conta sem senha, e-mail inexistente e as
//   confirmações de senha erradas. Tentativa recusada por já estar bloqueada não é gravada.
// - Redefinir a senha libera a conta: as falhas daquele e-mail anteriores ao último
//   `auth.password_reset` da conta deixam de contar.

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

export type LockScope = 'email' | 'ip';

export type LockStatus =
  | { locked: false }
  | { locked: true; scope: LockScope; retryAfterSeconds: number; until: Date };

interface WindowFailure {
  remaining: number;
  until: Date;
}

const WINDOW = sql.raw(`interval '${LOGIN_FAILURE_WINDOW_SECONDS} seconds'`);

/**
 * As `LOGIN_MAX_FAILURES` falhas mais recentes da janela, da mais nova para a mais antiga, com
 * quanto falta para cada uma sair dela.
 */
async function emailFailures(db: Database, email: string): Promise<WindowFailure[]> {
  const result = await sql<WindowFailure>`
    SELECT extract(epoch FROM la.created_at + ${WINDOW} - now())::float8 AS remaining,
           la.created_at + ${WINDOW} AS until
      FROM login_attempts la
     WHERE la.email = ${email}
       AND la.success = false
       AND la.created_at > now() - ${WINDOW}
       AND la.created_at > COALESCE((
             SELECT max(a.created_at)
               FROM audit_log a
               JOIN users u ON a.target_type = 'user' AND a.target_id = u.id::text
              WHERE u.email = ${email}
                AND u.deleted_at IS NULL
                AND a.action = 'auth.password_reset'
                AND a.created_at > now() - ${WINDOW}
           ), '-infinity'::timestamptz)
     ORDER BY la.created_at DESC
     LIMIT ${LOGIN_MAX_FAILURES}`.execute(db);
  return result.rows;
}

async function ipFailures(db: Database, ip: string): Promise<WindowFailure[]> {
  const result = await sql<WindowFailure>`
    SELECT extract(epoch FROM created_at + ${WINDOW} - now())::float8 AS remaining,
           created_at + ${WINDOW} AS until
      FROM login_attempts
     WHERE ip = ${ip}::inet
       AND success = false
       AND created_at > now() - ${WINDOW}
     ORDER BY created_at DESC
     LIMIT ${LOGIN_MAX_FAILURES}`.execute(db);
  return result.rows;
}

function statusOf(scope: LockScope, failures: readonly WindowFailure[]): LockStatus {
  const closing = failures[LOGIN_MAX_FAILURES - 1];
  if (closing === undefined) {
    return { locked: false };
  }
  return {
    locked: true,
    scope,
    retryAfterSeconds: Math.min(
      LOGIN_FAILURE_WINDOW_SECONDS,
      Math.max(1, Math.ceil(closing.remaining)),
    ),
    until: new Date(closing.until),
  };
}

/** Estado do bloqueio do e-mail (normalizado) e do IP. O do e-mail tem precedência. */
export async function loginLockStatus(
  db: Database,
  input: { email: string; ip: string },
): Promise<LockStatus> {
  const byEmail = statusOf('email', await emailFailures(db, input.email));
  if (byEmail.locked) {
    return byEmail;
  }
  return statusOf('ip', await ipFailures(db, requireIp(input.ip)));
}

/** Lança `429 too_many_attempts` (com `retryAfterSeconds`) se o e-mail ou o IP está bloqueado. */
export async function assertNotLocked(
  db: Database,
  input: { email: string; ip: string },
): Promise<void> {
  const status = await loginLockStatus(db, input);
  if (status.locked) {
    throw tooManyAttempts(status.retryAfterSeconds);
  }
}

export interface LoginAttemptInput {
  /** Já normalizado (`normalizeEmail`). */
  email: string;
  ip: string;
  site: AccountSite;
  success: boolean;
}

/** Grava uma tentativa em `login_attempts`, inclusive a de e-mail inexistente. */
export async function recordLoginAttempt(trx: Database, input: LoginAttemptInput): Promise<void> {
  await trx
    .insertInto('loginAttempts')
    .values({
      email: input.email,
      ip: requireIp(input.ip),
      site: input.site,
      success: input.success,
    })
    .execute();
}

export interface LoginFailureInput {
  email: string;
  site: AccountSite;
  context: RequestContext;
  /** Dono do e-mail, quando existe (e não está excluído): recebe `account.locked`. */
  userId: string | null;
}

export interface LoginFailureResult {
  /** Bloqueios que esta falha fechou (o primeiro de cada janela). */
  locked: LockScope[];
  /**
   * A falha não foi gravada porque outra tentativa simultânea fechou o bloqueio antes (a
   * tentativa recusada por já estar bloqueada não conta de novo).
   */
  alreadyLocked: boolean;
}

/**
 * Grava a falha e, se ela fecha o bloqueio (a quinta da janela), avisa: `account.locked` ao dono
 * do e-mail e `auth.lockout` na auditoria, uma vez por janela e escopo. Exige transação: as
 * travas do e-mail e do IP serializam falhas simultâneas, para a contagem e o aviso valerem uma
 * vez só.
 */
export async function recordLoginFailure(
  trx: Database,
  input: LoginFailureInput,
): Promise<LoginFailureResult> {
  if (!trx.isTransaction) {
    throw new TypeError('recordLoginFailure exige uma transação aberta (db.transaction()).');
  }
  const ip = requireIp(input.context.ip);
  // Sempre o e-mail antes do IP: a ordem fixa evita impasse entre transações.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`login_attempts:email:${input.email}`}, 0))`.execute(
    trx,
  );
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`login_attempts:ip:${ip}`}, 0))`.execute(
    trx,
  );
  const emailBefore = await emailFailures(trx, input.email);
  const ipBefore = await ipFailures(trx, ip);
  if (emailBefore.length >= LOGIN_MAX_FAILURES || ipBefore.length >= LOGIN_MAX_FAILURES) {
    return { locked: [], alreadyLocked: true };
  }
  await recordLoginAttempt(trx, { email: input.email, ip, site: input.site, success: false });

  const locked: LockScope[] = [];
  if (emailBefore.length === LOGIN_MAX_FAILURES - 1) {
    locked.push('email');
    const status = statusOf('email', await emailFailures(trx, input.email));
    await recordAudit(trx, {
      context: auditContextFor(input.site, input.context, null),
      action: 'auth.lockout',
      ...(input.userId === null ? {} : { targetType: 'user', targetId: input.userId }),
      details: { scope: 'email', windowSeconds: LOGIN_FAILURE_WINDOW_SECONDS },
    });
    if (input.userId !== null && status.locked) {
      await enqueueEmail(trx, {
        userId: input.userId,
        type: 'account.locked',
        data: { until: status.until },
      });
    }
  }
  if (ipBefore.length === LOGIN_MAX_FAILURES - 1) {
    locked.push('ip');
    await recordAudit(trx, {
      context: auditContextFor(input.site, input.context, null),
      action: 'auth.lockout',
      details: { scope: 'ip', windowSeconds: LOGIN_FAILURE_WINDOW_SECONDS },
    });
  }
  return { locked, alreadyLocked: false };
}
