import { describe, expect, it } from 'vitest';
import {
  assertUserManagement,
  checkUserManagement,
  isDomainError,
  type ManagedUser,
  type PermissionUser,
  ROLES,
  type Role,
  requiredUserManagementAction,
  USER_MANAGEMENT_OPERATIONS,
  type UserManagementOperation,
} from '../src/index.ts';

const person = (role: Role, id = `id-${role}`): PermissionUser & ManagedUser => ({ id, role });

function outcome(actor: PermissionUser, operation: UserManagementOperation, target: ManagedUser) {
  try {
    return assertUserManagement(actor, operation, target);
  } catch (error) {
    return isDomainError(error) ? `${error.status} ${error.code}` : 'outro';
  }
}

describe('ação exigida sobre a conta', () => {
  it('aluno: a da matriz; equipe: staff.manage', () => {
    expect(requiredUserManagementAction('edit', { role: 'student' })).toBe('users.edit');
    expect(requiredUserManagementAction('suspend', { role: 'student' })).toBe('users.suspend');
    expect(requiredUserManagementAction('reactivate', { role: 'student' })).toBe('users.suspend');
    expect(requiredUserManagementAction('sessions.revoke', { role: 'student' })).toBe(
      'users.sessions.revoke',
    );
    expect(requiredUserManagementAction('role.change', { role: 'student' })).toBe('staff.manage');
    for (const role of ['instructor', 'manager', 'admin'] as const) {
      for (const operation of USER_MANAGEMENT_OPERATIONS) {
        expect(requiredUserManagementAction(operation, { role })).toBe('staff.manage');
      }
    }
  });
});

describe('gestão de usuários', () => {
  it('manager edita, suspende, reativa e encerra sessões de aluno, mas não muda papel', () => {
    const manager = person('manager');
    const student = person('student');
    for (const operation of ['edit', 'suspend', 'reactivate', 'sessions.revoke'] as const) {
      expect(outcome(manager, operation, student)).not.toMatch(/^\d/);
    }
    expect(outcome(manager, 'role.change', student)).toBe('403 permission_denied');
  });

  it('manager não age sobre equipe (não suspende equipe)', () => {
    const manager = person('manager');
    for (const role of ['instructor', 'manager', 'admin'] as const) {
      for (const operation of USER_MANAGEMENT_OPERATIONS) {
        expect(outcome(manager, operation, person(role, 'outro'))).toBe('403 permission_denied');
      }
    }
  });

  it('admin age sobre qualquer conta de outro', () => {
    const admin = person('admin');
    for (const role of ROLES) {
      for (const operation of USER_MANAGEMENT_OPERATIONS) {
        expect(checkUserManagement(admin, operation, person(role, 'outro')).allowed).toBe(true);
      }
    }
  });

  it('student e instructor não gerem ninguém', () => {
    for (const actor of [person('student'), person('instructor')]) {
      for (const operation of USER_MANAGEMENT_OPERATIONS) {
        expect(outcome(actor, operation, person('student', 'outro'))).toBe('403 permission_denied');
      }
    }
  });

  it('ninguém muda o próprio papel nem se suspende ou reativa', () => {
    const admin = person('admin');
    expect(outcome(admin, 'role.change', admin)).toBe('422 self_action_not_allowed');
    expect(outcome(admin, 'suspend', admin)).toBe('422 self_action_not_allowed');
    expect(outcome(admin, 'reactivate', admin)).toBe('422 self_action_not_allowed');
    expect(checkUserManagement(admin, 'suspend', admin)).toEqual({
      allowed: false,
      action: 'staff.manage',
      reason: 'self_action_not_allowed',
    });
  });

  it('a permissão vem antes da regra de si mesmo', () => {
    const manager = person('manager');
    expect(outcome(manager, 'suspend', manager)).toBe('403 permission_denied');
  });

  it('editar os próprios dados e encerrar as próprias sessões não é barrado pela regra', () => {
    const admin = person('admin');
    expect(outcome(admin, 'edit', admin)).toBe('staff.manage');
    expect(outcome(admin, 'sessions.revoke', admin)).toBe('staff.manage');
  });
});
