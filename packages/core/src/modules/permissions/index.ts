// Papéis e matriz de permissões (spec 008): o que cada papel pode fazer, checado uma única vez
// aqui. Tarefa 142.

export {
  ADMIN_ACTIONS,
  type AdminAction,
  CLASSROOM_ACTIONS,
  type ClassroomAction,
  isPermissionAction,
  PERMISSION_ACTIONS,
  type PermissionAction,
} from './actions.ts';
export {
  assertUserManagement,
  checkUserManagement,
  type ManagedUser,
  requiredUserManagementAction,
  USER_MANAGEMENT_OPERATIONS,
  type UserManagementDecision,
  type UserManagementOperation,
} from './management.ts';
export {
  assertCan,
  can,
  canDeleteOwnAccount,
  type PermissionGroup,
  type PermissionResource,
  type PermissionScope,
  type PermissionUser,
  permissionScope,
  permissionsFor,
} from './matrix.ts';
export { isRole, isStaffRole, ROLES, type Role, STAFF_ROLES, type StaffRole } from './roles.ts';
