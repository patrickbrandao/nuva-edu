import type { Database } from '../../../db/database.ts';
import { recordAudit } from '../../audit/record.ts';
import { assertValidPassword } from '../credentials.ts';
import { applyPasswordChange, confirmPassword } from '../passwords.ts';
import {
  loadTarget,
  type ManagementRequest,
  managementAuditContext,
  requirePermission,
} from './common.ts';

// Exibição e definição da senha de um usuário pelo admin (spec 007, "Exibição da senha";
// ADR 0002, que não se discute). A senha é texto legível; aqui ela só sai no retorno de
// `revealUserPassword`, nunca em log, auditoria, fila ou e-mail.

export interface RevealUserPasswordInput {
  /** A senha do próprio admin, como veio no corpo (`adminPassword`). */
  adminPassword: unknown;
}

/** Corpo de `200` de `POST /users/{id}/password/reveal` (`Cache-Control: no-store`). */
export interface PasswordReveal {
  /** A senha do usuário, ou `null` sem senha definida. */
  password: string | null;
}

/**
 * `POST /users/{id}/password/reveal`: só `admin` (`users.password.view`); `manager` e
 * `instructor` recebem `403`, com a negação gravada na auditoria, antes de qualquer conferência
 * de senha. Inexistente ou excluído: `404`. A senha do admin é conferida contando no bloqueio
 * da conta dele: errada, `422 password_confirmation_invalid`; bloqueado, `429
 * too_many_attempts`. Grava `user.password_view` (admin, alvo, IP; sem o valor) e devolve a
 * senha. Não existe ferramenta MCP equivalente (spec 027): a API do MCP não chama esta função.
 */
export async function revealUserPassword(
  db: Database,
  request: ManagementRequest,
  userId: string,
  input: RevealUserPasswordInput,
): Promise<PasswordReveal> {
  await requirePermission(db, request, 'users.password.view', {
    action: 'user.password_view',
    targetId: typeof userId === 'string' ? safeTargetId(userId) : null,
  });
  const target = await loadTarget(db, userId);
  await confirmPassword(db, {
    userId: request.actor.id,
    password: input.adminPassword,
    site: 'admin',
    context: request.context,
    failure: 'password_confirmation_invalid',
  });
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('users')
      .select('password')
      .where('id', '=', target.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'user.password_view',
      targetType: 'user',
      targetId: target.id,
    });
    return { password: row.password };
  });
}

export interface SetUserPasswordInput {
  /** A nova senha (8 a 128), texto legível (ADR 0002). */
  password: unknown;
}

/**
 * `PUT /users/{id}/password`: só `admin` (`users.password.set`; a negação vai para a
 * auditoria). Inexistente ou excluído: `404`; senha fora de 8 a 128: `400 password_invalid`.
 * Grava a senha, encerra todas as sessões do usuário, grava `user.password_set` (sem o valor) e
 * enfileira `account.password_changed` com `by = admin`.
 */
export async function setUserPassword(
  db: Database,
  request: ManagementRequest,
  userId: string,
  input: SetUserPasswordInput,
): Promise<{ sessionsRevoked: number }> {
  await requirePermission(db, request, 'users.password.set', {
    action: 'user.password_set',
    targetId: typeof userId === 'string' ? safeTargetId(userId) : null,
  });
  const target = await loadTarget(db, userId);
  assertValidPassword(input.password);
  const password = input.password;
  return db.transaction().execute(async (trx) => {
    const current = await loadTarget(trx, target.id, { forUpdate: true });
    return applyPasswordChange(trx, {
      userId: current.id,
      password,
      by: 'admin',
      audit: { context: managementAuditContext(request), action: 'user.password_set' },
    });
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alvo da negação: só um UUID vai para `audit_log.target_id`. */
function safeTargetId(userId: string): string | null {
  return UUID.test(userId) ? userId.toLowerCase() : null;
}
