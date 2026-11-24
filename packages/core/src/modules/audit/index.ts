// Auditoria (spec 028): gravação dos registros com redação de `details`, consulta com filtros
// (que grava `audit.search`) e expurgo por `audit_log_purge`. Tarefa 143.

export { AUDIT_RETENTION_DEFAULT_DAYS, AUDIT_RETENTION_MIN_DAYS, purgeAudit } from './purge.ts';
export {
  AUDIT_DEFAULT_WINDOW_DAYS,
  AUDIT_DELETED_USER_NAME,
  AUDIT_MAX_WINDOW_DAYS,
  AUDIT_PAGE_DEFAULT_LIMIT,
  AUDIT_PAGE_MAX_LIMIT,
  type AuditFilters,
  type AuditLogEntry,
  type AuditLogEntryDetail,
  type AuditLogPage,
  type AuditSearchOptions,
  type AuditUserRef,
  getAuditEntry,
  searchAuditLog,
} from './query.ts';
export {
  AUDIT_ACTION_PATTERN,
  AUDIT_ORIGINS,
  AUDIT_OUTCOMES,
  AUDIT_TARGET_USER,
  type AuditActorRole,
  type AuditContext,
  type AuditDeniedInput,
  type AuditEntryInput,
  type AuditOrigin,
  type AuditOutcome,
  type RecordedAudit,
  recordAudit,
  recordDenied,
} from './record.ts';
export {
  AUDIT_DETAILS_MAX_BYTES,
  AUDIT_PASSWORD_ACTIONS,
  AUDIT_REDACTED,
  isAuditSensitiveKey,
  limitAuditDetails,
  redactAuditDetails,
} from './redaction.ts';
