import { isIP } from 'node:net';
import type { Database } from '../../db/database.ts';
import { limitAuditDetails, redactAuditDetails } from './redaction.ts';

// Gravação da auditoria (spec 028, "Gravação"). Dono dos dados: admin-api; classroom-api e
// worker inserem eventos de segurança por estas mesmas funções. A aplicação só insere: não há
// função de alteração nem de exclusão de registro (RF-05).

export const AUDIT_ORIGINS = ['admin_panel', 'mcp', 'classroom', 'worker', 'cli'] as const;
export type AuditOrigin = (typeof AUDIT_ORIGINS)[number];

export const AUDIT_OUTCOMES = ['ok', 'denied', 'error'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Papel do ator no momento da ação (restrição `audit_log_actor_role_valid`). */
export type AuditActorRole = 'student' | 'instructor' | 'manager' | 'admin';

/** `target_type` dos registros cujo alvo é um usuário: a consulta traz o nome dele. */
export const AUDIT_TARGET_USER = 'user';

/** Mesmo formato da restrição `audit_log_action_format` da migration 0006. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const USER_AGENT_MAX_LENGTH = 1024;
const REQUEST_ID_MAX_LENGTH = 128;

/** Quem agiu e por onde. As APIs montam este contexto a partir da requisição. */
export interface AuditContext {
  origin: AuditOrigin;
  /** Quem agiu; nulo para `worker` e `cli`. Em chamada MCP, o emissor da chave. */
  actorUserId?: string | null;
  actorRole?: AuditActorRole | null;
  /** Só com `origin = 'mcp'`. */
  mcpKeyId?: string | null;
  /** O mesmo `X-Request-Id` dos logs. */
  requestId?: string | null;
  /** IP real do cliente (`TRUSTED_PROXIES`); texto que não é IP é gravado como nulo. */
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntryInput {
  context: AuditContext;
  /** Código da ação, como `user.password_view` (spec 028, "O que é registrado"). */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Padrão: `ok`. */
  outcome?: AuditOutcome;
  /**
   * Antes e depois dos campos alterados. Quem chama não precisa limpar: senha, token, segredo
   * e chave viram `"[alterado]"` aqui, e o limite de 8 KB é aplicado aqui. Nas ações de senha
   * (`AUDIT_PASSWORD_ACTIONS`) só números e booleanos do primeiro nível são gravados.
   */
  details?: Readonly<Record<string, unknown>>;
}

export interface RecordedAudit {
  id: string;
  createdAt: Date;
}

/**
 * Grava um registro de auditoria. Passe a transação da ação (RNF-02): se a gravação falhar, a
 * ação é desfeita junto. Entrada malformada (ação fora do formato, chave MCP fora da origem
 * `mcp`, alvo sem tipo) é erro de programação e lança `TypeError` antes de ir ao banco.
 */
export async function recordAudit(trx: Database, entry: AuditEntryInput): Promise<RecordedAudit> {
  const { context } = entry;
  assertEntry(entry);
  const details = limitAuditDetails(redactAuditDetails(entry.details ?? {}, entry.action));
  return trx
    .insertInto('auditLog')
    .values({
      actorUserId: context.actorUserId ?? null,
      actorRole: context.actorRole ?? null,
      origin: context.origin,
      mcpKeyId: context.mcpKeyId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      outcome: entry.outcome ?? 'ok',
      ip: normalizeIp(context.ip),
      userAgent: clip(context.userAgent, USER_AGENT_MAX_LENGTH),
      requestId: clip(context.requestId, REQUEST_ID_MAX_LENGTH),
      details: JSON.stringify(details),
    })
    .returning(['id', 'createdAt'])
    .executeTakeFirstOrThrow();
}

export interface AuditDeniedInput {
  context: AuditContext;
  /** A permissão do contrato (`x-permission`) que faltou, como `audit.view`. */
  permission: string;
  /** Ação que seria registrada; padrão: a própria permissão. */
  action?: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Readonly<Record<string, unknown>>;
}

/**
 * Grava a recusa por falta de permissão (`outcome = denied`), fora da transação da ação, que
 * não chega a existir. A permissão vai em `details.permission`.
 */
export async function recordDenied(db: Database, input: AuditDeniedInput): Promise<RecordedAudit> {
  return recordAudit(db, {
    context: input.context,
    action: input.action ?? input.permission,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    outcome: 'denied',
    details: { ...input.details, permission: input.permission },
  });
}

function assertEntry(entry: AuditEntryInput): void {
  const { context } = entry;
  if (!AUDIT_ACTION_PATTERN.test(entry.action)) {
    throw new TypeError(`Ação de auditoria inválida: "${entry.action}".`);
  }
  if (!AUDIT_ORIGINS.includes(context.origin)) {
    throw new TypeError(`Origem de auditoria inválida: "${String(context.origin)}".`);
  }
  if (entry.outcome !== undefined && !AUDIT_OUTCOMES.includes(entry.outcome)) {
    throw new TypeError(`Resultado de auditoria inválido: "${String(entry.outcome)}".`);
  }
  if (context.mcpKeyId && context.origin !== 'mcp') {
    throw new TypeError('mcpKeyId só vale em registro de origem mcp.');
  }
  if (entry.targetId != null && entry.targetType == null) {
    throw new TypeError('targetId exige targetType.');
  }
}

function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) {
    return null;
  }
  const trimmed = ip.trim();
  return isIP(trimmed) === 0 ? null : trimmed;
}

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) {
    return null;
  }
  return text.length > max ? text.slice(0, max) : text;
}
