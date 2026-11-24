import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  createTermsDraft,
  type Database,
  listTermsVersions,
  managementAuditContext,
  publishTermsVersion,
  type TermsVersionEntry,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

// Versões dos Termos de Uso e da Política de Privacidade (spec 030, "Termos na Fase 1"): só
// `admin` (`settings.manage`, conferida pelo tratador de `sessionCookie`). A publicação grava
// `terms.publish` na mesma transação; o rascunho não é auditado (spec 028, "O que é
// registrado").

export interface TermsRoutesOptions {
  db: Database;
}

const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/** `TermsVersionEntry` do contrato, sem o texto. */
export function termsEntryBody(entry: TermsVersionEntry) {
  return {
    id: entry.id,
    document: entry.document,
    version: entry.version,
    status: entry.status,
    requiresReacceptance: entry.requiresReacceptance,
    effectiveAt: isoOrNull(entry.effectiveAt),
    publishedAt: isoOrNull(entry.publishedAt),
    createdAt: entry.createdAt.toISOString(),
  };
}

export function registerTermsRoutes(app: FastifyInstance, options: TermsRoutesOptions): void {
  const { db } = options;

  app.operation('listTermsVersions', async (request) => {
    const { document } = request.query as { document: string };
    const items = await listTermsVersions(db, document);
    return { items: items.map(termsEntryBody) };
  });

  app.operation('createTermsDraft', async (request, reply) => {
    const body = request.body as {
      document: string;
      bodyMd: string;
      requiresReacceptance: boolean;
    };
    const entry = await createTermsDraft(db, {
      document: body.document,
      bodyMd: body.bodyMd,
      requiresReacceptance: body.requiresReacceptance,
    });
    return reply.status(201).send(termsEntryBody(entry));
  });

  app.operation('publishTermsVersion', async (request) => {
    const { id } = request.params as { id: string };
    const context = managementAuditContext(managementRequest(request));
    const entry = await db.transaction().execute((trx) => publishTermsVersion(trx, id, context));
    return termsEntryBody(entry);
  });
}
