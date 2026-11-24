import type { Database } from '../../../db/database.ts';
import { notFound, permissionDenied } from '../../../errors/domain-error.ts';
import { type AuditContext, recordDenied } from '../../audit/record.ts';
import type { PermissionAction } from '../../permissions/actions.ts';
import {
  assertUserManagement,
  checkUserManagement,
  type UserManagementOperation,
} from '../../permissions/management.ts';
import { can } from '../../permissions/matrix.ts';
import type { Role } from '../../permissions/roles.ts';
import { type AccountActor, auditContextFor, type RequestContext } from '../context.ts';

// Base da gestão de usuários pela equipe (spec 007, "Equipe criada pelo admin"; spec 008): quem
// pede, a auditoria de cada chamada e a conferência de permissão que registra a negação.
// Dono dos dados escritos aqui: admin-api (papel, suspensão, senha definida pelo admin, equipe
// criada; spec 007, "Dados").

/** Quem pede e por onde: a sessão do site admin ou, na Fase 5, uma chave MCP. */
export interface ManagementRequest {
  /** O usuário da sessão (ou o emissor da chave MCP), com o papel lido nesta requisição. */
  actor: AccountActor;
  context: RequestContext;
  /** Chamada MCP (spec 027): a auditoria vai com `origin = mcp` e esta chave. */
  mcpKeyId?: string | null;
}

/** Contexto da auditoria: `admin_panel`, ou `mcp` com a chave. */
export function managementAuditContext(request: ManagementRequest): AuditContext {
  const base = auditContextFor('admin', request.context, request.actor);
  return request.mcpKeyId ? { ...base, origin: 'mcp', mcpKeyId: request.mcpKeyId } : base;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A conta sobre a qual a equipe age, como as regras precisam dela. */
export interface ManagedTarget {
  id: string;
  role: Role;
  email: string;
  name: string;
  fullName: string | null;
  emailVerified: boolean;
  suspended: boolean;
  version: number;
}

/**
 * Lê a conta alvo (não excluída). Identificador fora do formato UUID, inexistente ou excluído:
 * `404`. Com `forUpdate`, trava a linha até o fim da transação.
 */
export async function loadTarget(
  db: Database,
  userId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ManagedTarget> {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw notFound('Usuário não encontrado.');
  }
  let query = db
    .selectFrom('users')
    .select([
      'id',
      'role',
      'email',
      'name',
      'fullName',
      'emailVerifiedAt',
      'suspendedAt',
      'version',
    ])
    .where('id', '=', userId.toLowerCase())
    .where('deletedAt', 'is', null);
  if (options.forUpdate) {
    query = query.forUpdate();
  }
  const row = await query.executeTakeFirst();
  if (!row) {
    throw notFound('Usuário não encontrado.');
  }
  return {
    id: row.id,
    role: row.role as Role,
    email: row.email,
    name: row.name,
    fullName: row.fullName,
    emailVerified: row.emailVerifiedAt !== null,
    suspended: row.suspendedAt !== null,
    version: row.version,
  };
}

/**
 * Exige a ação da matriz. Sem ela, grava a negação na auditoria (`outcome = denied`, fora de
 * transação) e lança `403 permission_denied`. A API não grava a negação de novo.
 */
export async function requirePermission(
  db: Database,
  request: ManagementRequest,
  permission: PermissionAction,
  audit: { action: string; targetId?: string | null },
): Promise<void> {
  if (can(request.actor, permission)) {
    return;
  }
  await denied(db, request, permission, audit);
}

/**
 * Exige a operação sobre `target` (spec 008): `staff.manage` para conta de equipe e a regra de
 * si mesmo. A negação por permissão é gravada na auditoria antes do `403`; a regra de si mesmo
 * responde `422 self_action_not_allowed`, sem registro (não é falta de permissão).
 */
export async function requireUserManagement(
  db: Database,
  request: ManagementRequest,
  operation: UserManagementOperation,
  target: Pick<ManagedTarget, 'id' | 'role'>,
  auditAction: string,
): Promise<void> {
  const decision = checkUserManagement(request.actor, operation, target);
  if (decision.allowed) {
    return;
  }
  if (decision.reason === 'permission_denied') {
    await denied(db, request, decision.action, { action: auditAction, targetId: target.id });
  }
  // A regra de si mesmo: o erro vem da mesma função que a decidiu.
  assertUserManagement(request.actor, operation, target);
}

async function denied(
  db: Database,
  request: ManagementRequest,
  permission: PermissionAction,
  audit: { action: string; targetId?: string | null },
): Promise<never> {
  await recordDenied(db, {
    context: managementAuditContext(request),
    permission,
    action: audit.action,
    targetType: audit.targetId ? 'user' : null,
    targetId: audit.targetId ?? null,
  });
  throw permissionDenied();
}
