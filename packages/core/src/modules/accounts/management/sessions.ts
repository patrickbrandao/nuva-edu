import type { Database } from '../../../db/database.ts';
import { recordAudit } from '../../audit/record.ts';
import { listSessions, revokeUserSessions, type SessionInfo } from '../sessions.ts';
import {
  loadTarget,
  type ManagementRequest,
  managementAuditContext,
  requireUserManagement,
} from './common.ts';

// Sessões de um usuário vistas pela equipe (`GET` e `DELETE /users/{id}/sessions`). Aluno:
// `users.sessions.revoke`; equipe: `staff.manage` (spec 008).

/** Ação da auditoria do encerramento das sessões de outro usuário pela equipe. */
export const AUDIT_USER_SESSIONS_REVOKE = 'user.sessions_revoke';

/**
 * `GET /users/{id}/sessions`: as sessões válidas do usuário nos dois sites, a mais recente
 * primeiro; `current` é sempre falso (nenhuma é a de quem pede). Sem permissão: `403`, com a
 * negação gravada na auditoria; inexistente ou excluído: `404`.
 */
export async function listUserSessions(
  db: Database,
  request: ManagementRequest,
  userId: string,
): Promise<{ items: SessionInfo[] }> {
  const target = await loadTarget(db, userId);
  await requireUserManagement(db, request, 'sessions.revoke', target, AUDIT_USER_SESSIONS_REVOKE);
  return { items: await listSessions(db, target.id, null) };
}

/**
 * `DELETE /users/{id}/sessions`: encerra todas as sessões do usuário, nos dois sites, e grava
 * `user.sessions_revoke` com quantas foram. Devolve quantas encerrou.
 */
export async function revokeAllUserSessions(
  db: Database,
  request: ManagementRequest,
  userId: string,
): Promise<{ sessionsRevoked: number }> {
  const target = await loadTarget(db, userId);
  await requireUserManagement(db, request, 'sessions.revoke', target, AUDIT_USER_SESSIONS_REVOKE);
  return db.transaction().execute(async (trx) => {
    const sessionsRevoked = await revokeUserSessions(trx, target.id);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: AUDIT_USER_SESSIONS_REVOKE,
      targetType: 'user',
      targetId: target.id,
      details: { sessionsRevoked },
    });
    return { sessionsRevoked };
  });
}
