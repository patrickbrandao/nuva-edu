import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { conflict, notFound, validationFailed } from '../../errors/domain-error.ts';
import { type AuditContext, recordAudit } from '../audit/record.ts';

// Versões dos Termos de Uso e da Política de Privacidade (spec 030, "Termos na Fase 1"). Dono
// de `terms_versions`: admin-api (criar rascunho e publicar). As leituras da vigente servem às
// duas APIs. Versão publicada é imutável: o gatilho da migration 0007 recusa UPDATE e DELETE.

export const TERMS_DOCUMENTS = ['terms', 'privacy'] as const;
export type TermsDocument = (typeof TERMS_DOCUMENTS)[number];

/** `bodyMd` de 1 a 100.000 caracteres (spec 030; restrição `terms_versions_body_md_length`). */
export const TERMS_BODY_MAX_LENGTH = 100_000;

export type TermsStatus = 'draft' | 'published';

/** Item da lista do admin (`TermsVersionEntry` do contrato da admin-api). */
export interface TermsVersionEntry {
  id: string;
  document: TermsDocument;
  version: number | null;
  status: TermsStatus;
  requiresReacceptance: boolean;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

/** Uma versão publicada, sem o texto (`TermsVersion` da sessão e do cadastro social). */
export interface TermsVersion {
  id: string;
  document: TermsDocument;
  version: number;
  effectiveAt: Date;
}

/** A vigente com o texto (`LegalDocument`, `GET /api/v1/legal/{document}`). */
export interface LegalDocument extends TermsVersion {
  bodyMd: string;
}

export interface TermsDraftInput {
  document: string;
  bodyMd: string;
  requiresReacceptance?: boolean;
}

export function isTermsDocument(value: unknown): value is TermsDocument {
  return typeof value === 'string' && (TERMS_DOCUMENTS as readonly string[]).includes(value);
}

/** `409 terms_already_published`: a versão já foi publicada e não muda mais. */
export function termsAlreadyPublished(): ReturnType<typeof conflict> {
  return conflict('terms_already_published', 'Esta versão já foi publicada e não pode mudar.');
}

/**
 * Trava da numeração de um documento até o fim da transação. A publicação a toma exclusiva
 * (duas publicações simultâneas não disputam o mesmo número); o aceite a toma compartilhada,
 * para que a vigente conferida não mude antes de o aceite ser gravado.
 */
export async function lockTermsDocument(
  trx: Database,
  document: TermsDocument,
  mode: 'exclusive' | 'shared',
): Promise<void> {
  const key = `terms_versions:${document}`;
  if (mode === 'exclusive') {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
  } else {
    await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`.execute(trx);
  }
}

const ENTRY_COLUMNS = [
  'id',
  'document',
  'version',
  'requiresReacceptance',
  'effectiveAt',
  'publishedAt',
  'createdAt',
] as const;

interface EntryRow {
  id: string;
  document: string;
  version: number | null;
  requiresReacceptance: boolean;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

function toEntry(row: EntryRow): TermsVersionEntry {
  return {
    id: row.id,
    document: row.document as TermsDocument,
    version: row.version,
    status: row.version === null ? 'draft' : 'published',
    requiresReacceptance: row.requiresReacceptance,
    effectiveAt: row.effectiveAt,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function assertDocument(document: unknown, path: string): asserts document is TermsDocument {
  if (!isTermsDocument(document)) {
    throw validationFailed([{ path, message: `deve ser um de: ${TERMS_DOCUMENTS.join(', ')}` }]);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Cria um rascunho (admin-api, `POST /api/v1/terms`). Rascunho não é editado: para mudar o
 * texto, cria-se outro. O número da versão só é dado na publicação.
 */
export async function createTermsDraft(
  db: Database,
  input: TermsDraftInput,
): Promise<TermsVersionEntry> {
  assertDocument(input.document, 'body.document');
  const length = typeof input.bodyMd === 'string' ? [...input.bodyMd].length : 0;
  if (length < 1 || length > TERMS_BODY_MAX_LENGTH) {
    throw validationFailed([
      { path: 'body.bodyMd', message: `deve ter de 1 a ${TERMS_BODY_MAX_LENGTH} caracteres` },
    ]);
  }
  const row = await db
    .insertInto('termsVersions')
    .values({
      document: input.document,
      bodyMd: input.bodyMd,
      requiresReacceptance: input.requiresReacceptance ?? false,
    })
    .returning(ENTRY_COLUMNS)
    .executeTakeFirstOrThrow();
  return toEntry(row);
}

/**
 * Publica um rascunho (admin-api, `POST /api/v1/terms/{id}/publish`): recebe o próximo número
 * do documento, `effective_at = published_at = now()`, vira a vigente e fica imutável. Grava
 * `terms.publish` na auditoria na mesma transação. Inexistente: `404`; já publicado: `409`
 * `terms_already_published`.
 */
export async function publishTermsVersion(
  trx: Database,
  id: string,
  context: AuditContext,
): Promise<TermsVersionEntry> {
  if (!trx.isTransaction) {
    throw new TypeError('publishTermsVersion exige uma transação aberta (db.transaction()).');
  }
  if (!isUuid(id)) {
    throw notFound('Versão dos termos não encontrada.');
  }
  // FOR UPDATE: uma segunda publicação do mesmo rascunho espera a primeira e o vê publicado.
  const draft = await trx
    .selectFrom('termsVersions')
    .select(['id', 'document', 'publishedAt'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (draft === undefined) {
    throw notFound('Versão dos termos não encontrada.');
  }
  if (draft.publishedAt !== null) {
    throw termsAlreadyPublished();
  }
  const document = draft.document as TermsDocument;
  await lockTermsDocument(trx, document, 'exclusive');
  const last = await trx
    .selectFrom('termsVersions')
    .select((eb) => eb.fn.max('version').as('version'))
    .where('document', '=', document)
    .where('version', 'is not', null)
    .executeTakeFirst();
  const version = (last?.version ?? 0) + 1;
  const row = await trx
    .updateTable('termsVersions')
    .set({ version, effectiveAt: sql<Date>`now()`, publishedAt: sql<Date>`now()` })
    .where('id', '=', id)
    .returning(ENTRY_COLUMNS)
    .executeTakeFirstOrThrow();
  await recordAudit(trx, {
    context,
    action: 'terms.publish',
    targetType: 'terms_version',
    targetId: id,
    // `kind`, não `document`: a redação da auditoria mascara toda chave com "document" (CPF/CNPJ).
    details: { kind: document, version, requiresReacceptance: row.requiresReacceptance },
  });
  return toEntry(row);
}

/** Lista do admin (`GET /api/v1/terms?document=`): mais nova primeiro, rascunhos inclusos. */
export async function listTermsVersions(
  db: Database,
  document: string,
): Promise<TermsVersionEntry[]> {
  assertDocument(document, 'query.document');
  const rows = await db
    .selectFrom('termsVersions')
    .select(ENTRY_COLUMNS)
    .where('document', '=', document)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map(toEntry);
}

/**
 * A vigente de cada documento: a publicada de maior `version`. Documento sem versão publicada
 * vale `null` (o cadastro não exige aceite dele e o painel do admin mostra o aviso fixo).
 */
export async function currentTermsVersions(
  db: Database,
): Promise<Record<TermsDocument, TermsVersion | null>> {
  const rows = await db
    .selectFrom('termsVersions')
    .select(['id', 'document', 'version', 'effectiveAt'])
    .distinctOn('document')
    .where('version', 'is not', null)
    .orderBy('document')
    .orderBy('version', 'desc')
    .execute();
  const current: Record<TermsDocument, TermsVersion | null> = { terms: null, privacy: null };
  for (const row of rows) {
    if (isTermsDocument(row.document) && row.version !== null && row.effectiveAt !== null) {
      current[row.document] = {
        id: row.id,
        document: row.document,
        version: row.version,
        effectiveAt: row.effectiveAt,
      };
    }
  }
  return current;
}

/**
 * A vigente com o texto (classroom-api, `GET /api/v1/legal/{document}`, público). Documento
 * desconhecido ou sem versão publicada: `404`.
 */
export async function getLegalDocument(db: Database, document: string): Promise<LegalDocument> {
  if (!isTermsDocument(document)) {
    throw notFound('Documento não encontrado.');
  }
  const row = await db
    .selectFrom('termsVersions')
    .select(['id', 'document', 'version', 'effectiveAt', 'bodyMd'])
    .where('document', '=', document)
    .where('version', 'is not', null)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (row === undefined || row.version === null || row.effectiveAt === null) {
    throw notFound('Documento ainda não publicado.');
  }
  return {
    id: row.id,
    document,
    version: row.version,
    effectiveAt: row.effectiveAt,
    bodyMd: row.bodyMd,
  };
}
