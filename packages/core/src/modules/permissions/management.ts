// Regras da spec 008 fora da matriz que valem para a gestão de usuários: ação sobre conta de
// equipe exige `staff.manage`; ninguém muda o próprio papel nem suspende ou reativa a si mesmo;
// `manager` não suspende equipe (consequência da primeira). O último admin ativo depende do banco
// e fica com a gestão de contas (tarefa 149).

import { businessRule, type DomainError, permissionDenied } from '../../errors/domain-error.ts';
import type { PermissionAction } from './actions.ts';
import { can, type PermissionUser } from './matrix.ts';
import { isStaffRole, type Role } from './roles.ts';

/** Operações da equipe sobre a conta de outro usuário. */
export const USER_MANAGEMENT_OPERATIONS = [
  'edit',
  'suspend',
  'reactivate',
  'sessions.revoke',
  'role.change',
] as const;

export type UserManagementOperation = (typeof USER_MANAGEMENT_OPERATIONS)[number];

/** A conta sobre a qual a equipe age. */
export interface ManagedUser {
  readonly id: string;
  readonly role: Role;
}

const STUDENT_ACTION: Readonly<Record<UserManagementOperation, PermissionAction>> = {
  edit: 'users.edit',
  suspend: 'users.suspend',
  reactivate: 'users.suspend',
  'sessions.revoke': 'users.sessions.revoke',
  'role.change': 'staff.manage',
};

/** Operações que ninguém faz sobre si mesmo (spec 008, "Mudança de papel" e "Suspensão"). */
const NOT_ON_SELF: ReadonlySet<UserManagementOperation> = new Set([
  'role.change',
  'suspend',
  'reactivate',
]);

export type UserManagementDecision =
  | { readonly allowed: true; readonly action: PermissionAction }
  | {
      readonly allowed: false;
      readonly action: PermissionAction;
      readonly reason: 'permission_denied' | 'self_action_not_allowed';
    };

/**
 * Ação exigida para a operação sobre `target`: a da matriz para aluno, `staff.manage` para conta
 * de equipe (`instructor`, `manager`, `admin`).
 */
export function requiredUserManagementAction(
  operation: UserManagementOperation,
  target: Pick<ManagedUser, 'role'>,
): PermissionAction {
  return isStaffRole(target.role) ? 'staff.manage' : STUDENT_ACTION[operation];
}

/**
 * Decide a operação sem lançar erro. A permissão é conferida antes da regra de si mesmo, então um
 * `manager` que tenta se suspender recebe `permission_denied` (é conta de equipe).
 */
export function checkUserManagement(
  actor: PermissionUser,
  operation: UserManagementOperation,
  target: ManagedUser,
): UserManagementDecision {
  const action = requiredUserManagementAction(operation, target);
  if (!can(actor, action)) {
    return { allowed: false, action, reason: 'permission_denied' };
  }
  if (actor.id === target.id && NOT_ON_SELF.has(operation)) {
    return { allowed: false, action, reason: 'self_action_not_allowed' };
  }
  return { allowed: true, action };
}

/**
 * Como `checkUserManagement`, mas lança `403` `permission_denied` ou `422`
 * `self_action_not_allowed` (spec 008, "Casos de erro"). Devolve a ação exigida.
 */
export function assertUserManagement(
  actor: PermissionUser,
  operation: UserManagementOperation,
  target: ManagedUser,
): PermissionAction {
  const decision = checkUserManagement(actor, operation, target);
  if (decision.allowed) return decision.action;
  throw decision.reason === 'permission_denied'
    ? permissionDenied()
    : selfActionNotAllowed(operation);
}

function selfActionNotAllowed(operation: UserManagementOperation): DomainError {
  return businessRule(
    'self_action_not_allowed',
    operation === 'role.change'
      ? 'Ninguém muda o próprio papel.'
      : 'Ninguém suspende nem reativa a si mesmo.',
  );
}
