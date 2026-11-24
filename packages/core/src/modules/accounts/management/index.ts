// Gestão de usuários pela equipe (spec 007, "Equipe criada pelo admin" e "Exibição da senha";
// spec 008, "Mudança de papel" e "Suspensão"): lista e ficha, criação de equipe, edição,
// papel, suspensão e reativação (com o fim do prazo para o worker), senha pelo admin e sessões
// de um usuário. Tarefa 149. Usado pela admin-api (e, na Fase 5, pelo MCP) e pelo worker.

export {
  loadTarget,
  type ManagedTarget,
  type ManagementRequest,
  managementAuditContext,
} from './common.ts';
export {
  type PasswordReveal,
  type RevealUserPasswordInput,
  revealUserPassword,
  type SetUserPasswordInput,
  setUserPassword,
} from './passwords.ts';
export { setUserRole } from './roles.ts';
export {
  AUDIT_USER_SESSIONS_REVOKE,
  listUserSessions,
  revokeAllUserSessions,
} from './sessions.ts';
export {
  type CreateUserInput,
  createUser,
  FULL_NAME_MAX_LENGTH,
  type UpdateUserInput,
  updateUser,
  versionConflict,
} from './staff.ts';
export {
  alreadySuspended,
  expireSuspensions,
  notSuspended,
  reactivateUser,
  SUSPENSION_DURATION_DAYS,
  SUSPENSION_EXPIRE_BATCH,
  SUSPENSION_KINDS,
  SUSPENSION_REASON_MAX_LENGTH,
  type SuspendUserInput,
  suspendUser,
} from './suspensions.ts';
export {
  getUser,
  type ListUsersQuery,
  listUsers,
  readUserDetail,
  type SuspensionKind,
  USER_LIST_DEFAULT_LIMIT,
  USER_LIST_MAX_LIMIT,
  USER_LIST_QUERY_MAX_LENGTH,
  USER_LIST_SORTS,
  USER_LIST_STATUSES,
  type UserDetail,
  type UserListPage,
  type UserListSort,
  type UserListStatus,
  type UserStatus,
  type UserSummary,
  type UserSuspension,
} from './views.ts';
