import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type AuditLogEntry,
  type AuditOrigin,
  type AuditOutcome,
  type Database,
  getAuditEntry,
  managementAuditContext,
  searchAuditLog,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

// Consulta da auditoria (spec 028, "Consulta"): só `admin` (`audit.view`, conferida pelo
// tratador de `sessionCookie`). A lista grava `audit.search` com os filtros; abrir um registro
// não grava nada.

export interface AuditRoutesOptions {
  db: Database;
}

/** `AuditEntry` do contrato: o registro sem `details`, com a data em ISO 8601. */
export function auditEntryBody(entry: AuditLogEntry) {
  return {
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    actor: entry.actor,
    actorRole: entry.actorRole,
    origin: entry.origin,
    mcpKeyId: entry.mcpKeyId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetName: entry.targetName,
    outcome: entry.outcome,
    ip: entry.ip,
    userAgent: entry.userAgent,
    requestId: entry.requestId,
  };
}

const dateOrUndefined = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

export function registerAuditRoutes(app: FastifyInstance, options: AuditRoutesOptions): void {
  const { db } = options;

  app.operation('listAuditEntries', async (request) => {
    const query = request.query as {
      from?: string;
      to?: string;
      actorId?: string;
      action?: string;
      targetType?: string;
      targetId?: string;
      origin?: AuditOrigin;
      mcpKeyId?: string;
      outcome?: AuditOutcome;
      limit?: number;
      cursor?: string;
    };
    const page = await searchAuditLog(db, managementAuditContext(managementRequest(request)), {
      from: dateOrUndefined(query.from),
      to: dateOrUndefined(query.to),
      actorId: query.actorId,
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      origin: query.origin,
      mcpKeyId: query.mcpKeyId,
      outcome: query.outcome,
      limit: query.limit,
      cursor: query.cursor,
    });
    return { items: page.items.map(auditEntryBody), nextCursor: page.nextCursor };
  });

  app.operation('getAuditEntry', async (request) => {
    const { id } = request.params as { id: string };
    const entry = await getAuditEntry(db, id);
    return { ...auditEntryBody(entry), details: entry.details };
  });
}
