import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import type { DomainError } from '../../errors/domain-error.ts';
import type { AuditContext } from '../audit/record.ts';
import { recordAudit } from '../audit/record.ts';
import { consumeEmailToken, tokenExpired } from '../notifications/email-tokens.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import type { Role } from '../permissions/roles.ts';
import { type AccountSite, auditContextFor, type RequestContext, requireIp } from './context.ts';
import {
  assertValidPassword,
  isValidEmail,
  normalizeEmail,
  passwordMatches,
} from './credentials.ts';
import { currentPasswordInvalid, passwordConfirmationInvalid } from './errors.ts';
import { assertNotLocked, recordLoginFailure } from './lockout.ts';
import { revokeUserSessions } from './sessions.ts';

// Definir, trocar e redefinir senha (spec 007, "Definir, trocar e redefinir senha") e a
// confirmação de senha que conta no bloqueio (troca e exibição de senha pelo admin).
// A senha é gravada em texto legível (ADR 0002) e nunca vai para log, auditoria, fila ou e-mail.

export type PasswordChangedBy = 'self' | 'admin';

export interface ApplyPasswordChangeInput {
  userId: string;
  /** Já conferida por `assertValidPassword`. */
  password: string;
  /** Quem mudou, para `account.password_changed`. */
  by: PasswordChangedBy;
  /** Registro de auditoria da mudança (`user.password_set` ou `auth.password_reset`). */
  audit: { context: AuditContext; action: 'user.password_set' | 'auth.password_reset' };
  /** Mantém esta sessão aberta (troca pelo próprio usuário); sem ela, encerra todas. */
  keepSessionId?: string | null;
  /** Confirma o e-mail junto (redefinição pelo link). */
  confirmEmail?: boolean;
}

/**
 * O que toda mudança de senha faz (definir, trocar, redefinir, definida pelo admin): grava a
 * senha, encerra as outras sessões (ou todas), grava a auditoria sem o valor e enfileira
 * `account.password_changed`. Exige transação. A gestão pela equipe (tarefa 149) usa esta
 * função para `PUT /users/{id}/password`.
 */
export async function applyPasswordChange(
  trx: Database,
  input: ApplyPasswordChangeInput,
): Promise<{ sessionsRevoked: number }> {
  if (!trx.isTransaction) {
    throw new TypeError('applyPasswordChange exige uma transação aberta (db.transaction()).');
  }
  assertValidPassword(input.password);
  await trx
    .updateTable('users')
    .set({
      password: input.password,
      version: sql<number>`version + 1`,
      ...(input.confirmEmail
        ? { emailVerifiedAt: sql<Date>`coalesce(email_verified_at, now())` }
        : {}),
    })
    .where('id', '=', input.userId)
    .execute();
  const sessionsRevoked = await revokeUserSessions(trx, input.userId, {
    exceptSessionId: input.keepSessionId ?? null,
  });
  await recordAudit(trx, {
    context: input.audit.context,
    action: input.audit.action,
    targetType: 'user',
    targetId: input.userId,
    details: { sessionsRevoked },
  });
  await enqueueEmail(trx, {
    userId: input.userId,
    type: 'account.password_changed',
    data: { by: input.by },
  });
  return { sessionsRevoked };
}

export interface ConfirmPasswordInput {
  userId: string;
  /** Como veio no corpo. */
  password: unknown;
  site: AccountSite;
  context: RequestContext;
  /** Erro da senha errada: `current_password_invalid` (padrão) ou `password_confirmation_invalid`. */
  failure?: 'current_password_invalid' | 'password_confirmation_invalid';
}

/**
 * Confere a senha do próprio usuário (troca de senha, exibição de senha pelo admin). Bloqueado
 * por tentativas: `429 too_many_attempts`. Errada (ou conta sem senha): a falha conta no
 * bloqueio da conta e responde `422` com o código pedido.
 */
export async function confirmPassword(db: Database, input: ConfirmPasswordInput): Promise<void> {
  const ip = requireIp(input.context.ip);
  const user = await db
    .selectFrom('users')
    .select(['email', 'password'])
    .where('id', '=', input.userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirstOrThrow();
  await assertNotLocked(db, { email: user.email, ip });
  if (passwordMatches(user.password, input.password)) {
    return;
  }
  await db.transaction().execute(async (trx) => {
    await recordLoginFailure(trx, {
      email: user.email,
      site: input.site,
      context: { ...input.context, ip },
      userId: input.userId,
    });
  });
  const error: DomainError =
    input.failure === 'password_confirmation_invalid'
      ? passwordConfirmationInvalid()
      : currentPasswordInvalid();
  throw error;
}

export interface ChangePasswordInput {
  /** A sessão de quem troca: as outras são encerradas. */
  session: { id: string; site: AccountSite; user: { id: string; role: Role } };
  newPassword: unknown;
  /** Exigida quando a conta já tem senha. */
  currentPassword?: unknown;
  context: RequestContext;
}

/**
 * `PUT /account/password`: define (conta sem senha, basta a sessão) ou troca (exige a atual;
 * errada: `422 current_password_invalid`, contando no bloqueio). Nova fora de 8 a 128: `400
 * password_invalid`. Encerra as outras sessões, grava `user.password_set` e enfileira
 * `account.password_changed`.
 */
export async function changePassword(db: Database, input: ChangePasswordInput): Promise<void> {
  assertValidPassword(input.newPassword, 'body.newPassword');
  const newPassword = input.newPassword;
  const { session } = input;
  const current = await db
    .selectFrom('users')
    .select(sql<boolean>`password IS NOT NULL`.as('hasPassword'))
    .where('id', '=', session.user.id)
    .executeTakeFirstOrThrow();
  if (current.hasPassword) {
    await confirmPassword(db, {
      userId: session.user.id,
      password: input.currentPassword,
      site: session.site,
      context: input.context,
    });
  }
  await db.transaction().execute(async (trx) => {
    await applyPasswordChange(trx, {
      userId: session.user.id,
      password: newPassword,
      by: 'self',
      keepSessionId: session.id,
      audit: {
        context: auditContextFor(session.site, input.context, session.user),
        action: 'user.password_set',
      },
    });
  });
}

/**
 * `POST /auth/password/forgot` (sempre `204`): conta existente e não excluída recebe
 * `account.password_reset` (o worker cria o link de 24 h). Conta só com provedor também: o link
 * define a primeira senha. O retorno não diz se a conta existe.
 */
export async function requestPasswordReset(db: Database, email: string): Promise<void> {
  const normalized = normalizeEmail(typeof email === 'string' ? email : '');
  if (!isValidEmail(normalized)) {
    return;
  }
  await db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom('users')
      .select('id')
      .where('email', '=', normalized)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (user) {
      await enqueueEmail(trx, { userId: user.id, type: 'account.password_reset', data: {} });
    }
  });
}

export interface ResetPasswordInput {
  token: string;
  password: unknown;
  context: RequestContext;
}

/**
 * `POST /auth/password/reset`: senha nova fora de 8 a 128 é `400 password_invalid` (antes de
 * gastar o link); token vencido, usado ou desconhecido, `410 token_expired`. Define a senha,
 * confirma o e-mail, invalida os outros tokens `reset`, encerra todas as sessões, grava
 * `auth.password_reset` (que libera o bloqueio da conta) e enfileira `account.password_changed`.
 * Não abre sessão.
 */
export async function resetPassword(
  db: Database,
  input: ResetPasswordInput,
): Promise<{ userId: string }> {
  assertValidPassword(input.password);
  const password = input.password;
  return db.transaction().execute(async (trx) => {
    const { userId } = await consumeEmailToken(trx, input.token, 'reset');
    const user = await trx
      .selectFrom('users')
      .select(['id', 'role'])
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!user) {
      throw tokenExpired();
    }
    await trx
      .updateTable('emailTokens')
      .set({ usedAt: sql<Date>`now()` })
      .where('userId', '=', userId)
      .where('purpose', '=', 'reset')
      .where('usedAt', 'is', null)
      .execute();
    await applyPasswordChange(trx, {
      userId,
      password,
      by: 'self',
      confirmEmail: true,
      audit: {
        context: auditContextFor('classroom', input.context, {
          id: user.id,
          role: user.role as Role,
        }),
        action: 'auth.password_reset',
      },
    });
    return { userId };
  });
}
