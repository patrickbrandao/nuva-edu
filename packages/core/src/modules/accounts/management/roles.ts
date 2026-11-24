import { sql } from 'kysely';
import type { Database } from '../../../db/database.ts';
import { validationFailed } from '../../../errors/domain-error.ts';
import { recordAudit } from '../../audit/record.ts';
import { enqueueEmail } from '../../notifications/outbox.ts';
import { assertUserManagement } from '../../permissions/management.ts';
import { isRole } from '../../permissions/roles.ts';
import { assertNotLastActiveAdmin } from '../admin.ts';
import { revokeUserSessions } from '../sessions.ts';
import {
  loadTarget,
  type ManagementRequest,
  managementAuditContext,
  requireUserManagement,
} from './common.ts';
import { readUserDetail, type UserDetail } from './views.ts';

// Mudança de papel (spec 008, "Mudança de papel"). Dono: admin-api.

/**
 * `PATCH /users/{id}/role` (só `admin`, `staff.manage`; a negação vai para a auditoria). Mudar
 * o próprio papel: `422 self_action_not_allowed`; rebaixar o último admin ativo: `422
 * last_admin`; papel desconhecido: `400 validation_failed`. Grava o papel, encerra as sessões
 * do usuário no site admin, enfileira `account.role_changed` e grava `user.set_role` com o antes
 * e o depois. O mesmo papel de antes não muda nada e só devolve a ficha.
 *
 * Fora da Fase 1: cursos do ex-instrutor sem dono e chaves MCP revogadas entram com as tabelas
 * de cursos e de chaves (Fases 2 e 5).
 */
export async function setUserRole(
  db: Database,
  request: ManagementRequest,
  userId: string,
  role: unknown,
): Promise<UserDetail> {
  const target = await loadTarget(db, userId);
  await requireUserManagement(db, request, 'role.change', target, 'user.set_role');
  if (!isRole(role)) {
    throw validationFailed([{ path: 'body.role', message: 'Papel desconhecido.' }]);
  }
  return db.transaction().execute(async (trx) => {
    if (role !== 'admin') {
      // Trava dos admins antes da linha: a mesma ordem do admin inicial e do `create-admin`.
      await assertNotLastActiveAdmin(trx, target.id);
    }
    const current = await loadTarget(trx, target.id, { forUpdate: true });
    assertUserManagement(request.actor, 'role.change', current);
    if (current.role === role) {
      return readUserDetail(trx, current.id);
    }
    await trx
      .updateTable('users')
      .set({ role, version: sql<number>`version + 1`, updatedAt: sql<Date>`now()` })
      .where('id', '=', current.id)
      .execute();
    const sessionsRevoked = await revokeUserSessions(trx, current.id, { site: 'admin' });
    await enqueueEmail(trx, { userId: current.id, type: 'account.role_changed', data: { role } });
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'user.set_role',
      targetType: 'user',
      targetId: current.id,
      details: { before: { role: current.role }, after: { role }, sessionsRevoked },
    });
    return readUserDetail(trx, current.id);
  });
}
