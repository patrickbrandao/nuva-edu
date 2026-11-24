import type { Database } from '../../db/database.ts';
import type { JsonObject } from '../../db/generated/database.ts';
import { type FieldError, notFound, validationFailed } from '../../errors/domain-error.ts';
import {
  AUDIT_ORIGINS,
  AUDIT_OUTCOMES,
  AUDIT_TARGET_USER,
  type AuditActorRole,
  type AuditContext,
  type AuditOrigin,
  type AuditOutcome,
  recordAudit,
} from './record.ts';

// Consulta da auditoria (spec 028, "Consulta"). Só o `admin` consulta (`audit.view`, spec 008):
// a permissão é conferida por quem chama, com o módulo `permissions`.

/** Nome mostrado no lugar do ator ou do alvo cuja conta foi excluída (spec 030). */
export const AUDIT_DELETED_USER_NAME = 'usuário removido';
/** Período padrão sem `from`: os últimos 30 dias. */
export const AUDIT_DEFAULT_WINDOW_DAYS = 30;
/** Maior janela aceita entre `from` e `to`. */
export const AUDIT_MAX_WINDOW_DAYS = 366;
export const AUDIT_PAGE_DEFAULT_LIMIT = 25;
export const AUDIT_PAGE_MAX_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// O mesmo `pattern` do parâmetro `action` no contrato.
const ACTION_FILTER = /^[a-z][a-z_]*(\.[a-z][a-z_]*)*(\.\*)?$/;
const CURSOR_PREFIX = 'a1:';

export interface AuditFilters {
  /** Início, inclusive. Padrão: `to` menos 30 dias. */
  from?: Date | undefined;
  /** Fim, exclusive. Padrão: agora. */
  to?: Date | undefined;
  actorId?: string | undefined;
  /** Ação exata (`user.suspend`) ou prefixo com `.*` (`user.*`). */
  action?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  origin?: AuditOrigin | undefined;
  mcpKeyId?: string | undefined;
  outcome?: AuditOutcome | undefined;
}

export interface AuditSearchOptions extends AuditFilters {
  /** Padrão 25, máximo 100. */
  limit?: number | undefined;
  /** `nextCursor` da página anterior. */
  cursor?: string | undefined;
  /** Relógio dos testes. */
  now?: Date | undefined;
}

export interface AuditUserRef {
  id: string;
  name: string;
}

/** Item da lista: o registro sem `details` (esquema `AuditEntry` do contrato). */
export interface AuditLogEntry {
  id: string;
  createdAt: Date;
  actor: AuditUserRef | null;
  actorRole: AuditActorRole | null;
  origin: AuditOrigin;
  mcpKeyId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Um registro com `details` (esquema `AuditEntryDetail`). */
export interface AuditLogEntryDetail extends AuditLogEntry {
  details: JsonObject;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
}

/** Filtros já validados, com o período resolvido. */
export interface ResolvedAuditQuery extends AuditFilters {
  from: Date;
  to: Date;
  limit: number;
  /** `id` do último registro da página anterior. */
  afterId?: string | undefined;
}

/**
 * Consulta a auditoria e grava `audit.search` com os filtros, uma vez por chamada (inclusive
 * nas páginas seguintes). Filtro inválido: `400 validation_failed`, sem gravar nada.
 * Recebe o Kysely ou uma transação; sem transação, abre uma para a leitura e o registro.
 */
export async function searchAuditLog(
  db: Database,
  context: AuditContext,
  options: AuditSearchOptions = {},
): Promise<AuditLogPage> {
  const query = resolveAuditQuery(options);
  const run = async (trx: Database): Promise<AuditLogPage> => {
    const page = await listAuditLog(trx, query);
    await recordAudit(trx, {
      context,
      action: 'audit.search',
      details: { filters: describeFilters(query), continued: query.afterId !== undefined },
    });
    return page;
  };
  return db.isTransaction ? run(db) : db.transaction().execute(run);
}

/** Um registro com `details`. Não grava `audit.search`. Inexistente: `404 not_found`. */
export async function getAuditEntry(db: Database, id: string): Promise<AuditLogEntryDetail> {
  if (!UUID.test(id)) {
    throw notFound('Registro de auditoria não encontrado.');
  }
  const row = await db.selectFrom('auditLog').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) {
    throw notFound('Registro de auditoria não encontrado.');
  }
  const names = await loadUserNames(db, [row]);
  return { ...toEntry(row, names), details: asObject(row.details) };
}

/** Valida os filtros e resolve o período padrão. Exportada para os testes. */
export function resolveAuditQuery(options: AuditSearchOptions): ResolvedAuditQuery {
  const errors: FieldError[] = [];
  const now = options.now ?? new Date();
  const to = options.to ?? now;
  const from = options.from ?? new Date(to.getTime() - AUDIT_DEFAULT_WINDOW_DAYS * DAY_MS);
  if (Number.isNaN(to.getTime())) {
    errors.push({ path: 'query.to', message: 'Data inválida.' });
  }
  if (Number.isNaN(from.getTime())) {
    errors.push({ path: 'query.from', message: 'Data inválida.' });
  }
  if (errors.length === 0) {
    if (from.getTime() >= to.getTime()) {
      errors.push({ path: 'query.from', message: 'O início precisa ser anterior ao fim.' });
    } else if (to.getTime() - from.getTime() > AUDIT_MAX_WINDOW_DAYS * DAY_MS) {
      errors.push({
        path: 'query.from',
        message: `O período passa de ${AUDIT_MAX_WINDOW_DAYS} dias.`,
      });
    }
  }
  for (const field of ['actorId', 'mcpKeyId'] as const) {
    const value = options[field];
    if (value !== undefined && !UUID.test(value)) {
      errors.push({ path: `query.${field}`, message: 'Identificador inválido.' });
    }
  }
  if (
    options.action !== undefined &&
    (options.action.length > 100 || !ACTION_FILTER.test(options.action))
  ) {
    errors.push({ path: 'query.action', message: 'Ação inválida.' });
  }
  checkLength(errors, 'targetType', options.targetType, 64);
  checkLength(errors, 'targetId', options.targetId, 128);
  if (options.targetId !== undefined && options.targetType === undefined) {
    errors.push({ path: 'query.targetType', message: 'targetId exige targetType.' });
  }
  if (options.origin !== undefined && !AUDIT_ORIGINS.includes(options.origin)) {
    errors.push({ path: 'query.origin', message: 'Origem inválida.' });
  }
  if (options.outcome !== undefined && !AUDIT_OUTCOMES.includes(options.outcome)) {
    errors.push({ path: 'query.outcome', message: 'Resultado inválido.' });
  }
  const limit = options.limit ?? AUDIT_PAGE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_PAGE_MAX_LIMIT) {
    errors.push({ path: 'query.limit', message: `Use de 1 a ${AUDIT_PAGE_MAX_LIMIT}.` });
  }
  let afterId: string | undefined;
  if (options.cursor !== undefined) {
    afterId = decodeCursor(options.cursor);
    if (afterId === undefined) {
      errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
    }
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  return {
    from,
    to,
    limit,
    afterId,
    actorId: options.actorId,
    action: options.action,
    targetType: options.targetType,
    targetId: options.targetId,
    origin: options.origin,
    mcpKeyId: options.mcpKeyId,
    outcome: options.outcome,
  };
}

/**
 * A consulta da página, sem os nomes. Cada filtro casa com um índice da migration 0006; o
 * prefixo de ação vira `action LIKE 'user.%'`, que usa o índice `text_pattern_ops`.
 * Exportada para o teste de `EXPLAIN`.
 */
export function buildAuditListQuery(db: Database, query: ResolvedAuditQuery) {
  let builder = db
    .selectFrom('auditLog')
    .select([
      'id',
      'createdAt',
      'actorUserId',
      'actorRole',
      'origin',
      'mcpKeyId',
      'action',
      'targetType',
      'targetId',
      'outcome',
      'ip',
      'userAgent',
      'requestId',
    ])
    .where('createdAt', '>=', query.from)
    .where('createdAt', '<', query.to);
  if (query.actorId !== undefined) {
    builder = builder.where('actorUserId', '=', query.actorId);
  }
  if (query.action !== undefined) {
    builder = query.action.endsWith('.*')
      ? builder.where('action', 'like', `${escapeLike(query.action.slice(0, -2))}.%`)
      : builder.where('action', '=', query.action);
  }
  if (query.targetType !== undefined) {
    builder = builder.where('targetType', '=', query.targetType);
  }
  if (query.targetId !== undefined) {
    builder = builder.where('targetId', '=', query.targetId);
  }
  if (query.origin !== undefined) {
    builder = builder.where('origin', '=', query.origin);
  }
  if (query.mcpKeyId !== undefined) {
    builder = builder.where('mcpKeyId', '=', query.mcpKeyId);
  }
  if (query.outcome !== undefined) {
    builder = builder.where('outcome', '=', query.outcome);
  }
  const afterId = query.afterId;
  if (afterId !== undefined) {
    // Depois do último da página anterior na ordem (created_at desc, id desc). A data vem do
    // próprio registro, no banco: em JavaScript ela perderia os microssegundos.
    builder = builder.where((eb) => {
      const cursorAt = eb
        .selectFrom('auditLog as c')
        .select('c.createdAt')
        .where('c.id', '=', afterId);
      return eb.and([
        eb('createdAt', '<=', cursorAt),
        eb.or([eb('createdAt', '<', cursorAt), eb('id', '<', afterId)]),
      ]);
    });
  }
  return builder
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(query.limit + 1);
}

/** A página, com os nomes; não grava `audit.search` (use `searchAuditLog`). */
export async function listAuditLog(db: Database, query: ResolvedAuditQuery): Promise<AuditLogPage> {
  const rows = await buildAuditListQuery(db, query).execute();
  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const names = await loadUserNames(db, pageRows);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => toEntry(row, names)),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}

interface AuditRow {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  actorRole: string | null;
  origin: string;
  mcpKeyId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Nome atual de cada usuário citado como ator ou alvo, numa consulta só. */
async function loadUserNames(
  db: Database,
  rows: readonly AuditRow[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.actorUserId) {
      ids.add(row.actorUserId);
    }
    if (row.targetType === AUDIT_TARGET_USER && row.targetId && UUID.test(row.targetId)) {
      ids.add(row.targetId.toLowerCase());
    }
  }
  const names = new Map<string, string>();
  if (ids.size === 0) {
    return names;
  }
  const users = await db
    .selectFrom('users')
    .select(['id', 'name', 'deletedAt'])
    .where('id', 'in', [...ids])
    .execute();
  for (const user of users) {
    names.set(user.id, user.deletedAt ? AUDIT_DELETED_USER_NAME : user.name);
  }
  return names;
}

function toEntry(row: AuditRow, names: ReadonlyMap<string, string>): AuditLogEntry {
  const targetName =
    row.targetType === AUDIT_TARGET_USER && row.targetId
      ? (names.get(row.targetId.toLowerCase()) ?? null)
      : null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    actor: row.actorUserId
      ? { id: row.actorUserId, name: names.get(row.actorUserId) ?? AUDIT_DELETED_USER_NAME }
      : null,
    actorRole: row.actorRole as AuditActorRole | null,
    origin: row.origin as AuditOrigin,
    mcpKeyId: row.mcpKeyId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName,
    outcome: row.outcome as AuditOutcome,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
  };
}

function describeFilters(query: ResolvedAuditQuery): JsonObject {
  const filters: JsonObject = {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    limit: query.limit,
  };
  for (const key of [
    'actorId',
    'action',
    'targetType',
    'targetId',
    'origin',
    'mcpKeyId',
    'outcome',
  ] as const) {
    const value = query[key];
    if (value !== undefined) {
      filters[key] = value;
    }
  }
  return filters;
}

function checkLength(
  errors: FieldError[],
  field: string,
  value: string | undefined,
  max: number,
): void {
  if (value !== undefined && (value.length < 1 || value.length > max)) {
    errors.push({ path: `query.${field}`, message: `Use de 1 a ${max} caracteres.` });
  }
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function encodeCursor(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string | undefined {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!text.startsWith(CURSOR_PREFIX)) {
    return undefined;
  }
  const id = text.slice(CURSOR_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : undefined;
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
