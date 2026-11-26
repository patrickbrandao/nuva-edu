// Pedidos de PDF de exemplo (spec 015, "Pré-visualização"; RNF-06) e o expurgo da 033.
// - admin-api: cria o pedido (valida o HTML ainda não salvo, 20 por hora por usuário, enfileira
//   `certificate.preview`), lê o estado e entrega o PDF, só a quem pediu.
// - worker: lê o pedido com os dados de exemplo, grava o PDF ou a falha, e expurga pedidos com
//   mais de 24 horas e versões de template sem uso há mais de 30 dias.

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { conflict, notFound, rateLimited, validationFailed } from '../../errors/domain-error.ts';
import { isUuid } from '../entitlements/types.ts';
import { enqueue } from '../jobs/queue.ts';
import { getSettings } from '../settings/settings.ts';
import {
  type CertificatePdfFile,
  type CertificateRequest,
  loadCertificateCourse,
  requireCertificateAction,
} from './common.ts';
import { assertCertificatePdfSize } from './issue.ts';
import { type CertificateTemplateData, certificatePreviewData } from './template/values.ts';
import { assertCertificateTemplateValid } from './templates.ts';

/** Pedidos de exemplo por hora, por usuário (RNF-06). */
export const CERTIFICATE_PREVIEW_HOURLY_LIMIT = 20;
/** Vida do pedido de exemplo, em horas (spec 033). */
export const CERTIFICATE_PREVIEW_TTL_HOURS = 24;
/** Idade mínima, em dias, da versão de template sem uso que o expurgo apaga (spec 033). */
export const CERTIFICATE_TEMPLATE_VERSION_RETENTION_DAYS = 30;
/** Limite de `certificate_previews.error` (migration 0012). */
export const CERTIFICATE_PREVIEW_ERROR_MAX_LENGTH = 2000;

export const CERTIFICATE_PREVIEW_STATUSES = ['pending', 'ready', 'failed'] as const;
export type CertificatePreviewStatus = (typeof CERTIFICATE_PREVIEW_STATUSES)[number];

/** `CertificatePreview` do contrato. */
export interface CertificatePreviewView {
  id: string;
  courseId: string | null;
  status: CertificatePreviewStatus;
  /** Motivo, em `failed`. */
  error: string | null;
  createdAt: Date;
  renderedAt: Date | null;
  /** Quando o pedido é apagado (24 h depois de criado). */
  expiresAt: Date;
}

const TTL_MS = CERTIFICATE_PREVIEW_TTL_HOURS * 60 * 60 * 1000;

function toView(row: {
  id: string;
  courseId: string | null;
  status: string;
  error: string | null;
  createdAt: Date;
  renderedAt: Date | null;
}): CertificatePreviewView {
  return {
    id: row.id,
    courseId: row.courseId,
    status: row.status as CertificatePreviewStatus,
    error: row.error,
    createdAt: row.createdAt,
    renderedAt: row.renderedAt,
    expiresAt: new Date(row.createdAt.getTime() + TTL_MS),
  };
}

const PREVIEW_COLUMNS = ['id', 'courseId', 'status', 'error', 'createdAt', 'renderedAt'] as const;

export interface CreateCertificatePreviewInput {
  html: unknown;
  /** Curso que dá o título e o instrutor do exemplo; ausente ou nulo: os de exemplo. */
  courseId?: unknown;
}

/**
 * `POST /certificate-templates/previews` (`certificate.template.edit`): valida o HTML com as
 * regras da gravação (`422` `certificate_template_invalid`), grava o pedido em `pending` e
 * enfileira `certificate.preview`, numa transação. Curso inexistente ou alheio ao instrutor:
 * `404`. Mais de 20 pedidos na última hora: `429` `rate_limited`, com o tempo de espera.
 */
export async function createCertificatePreview(
  db: Database,
  request: CertificateRequest,
  input: CreateCertificatePreviewInput,
): Promise<CertificatePreviewView> {
  const scope = await requireCertificateAction(db, request, 'certificate.template.edit');
  const rawCourseId = input.courseId ?? null;
  if (rawCourseId !== null && !isUuid(rawCourseId)) {
    throw validationFailed([{ path: 'body.courseId', message: 'Identificador inválido.' }]);
  }
  const course =
    rawCourseId === null ? null : await loadCertificateCourse(db, request, scope, rawCourseId);
  const html = await assertCertificateTemplateValid(db, input.html);
  return db.transaction().execute(async (trx) => {
    // Um pedido por vez por usuário: a contagem do limite não corre com outro pedido dele.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`nuva.certificate_preview:${request.actor.id}`}))`.execute(
      trx,
    );
    const recent = await sql<{ n: number; retryAfter: number | null }>`
      SELECT count(*)::int AS n,
             ceil(extract(epoch FROM min(created_at) + interval '1 hour' - now()))::int
               AS retry_after
        FROM certificate_previews
       WHERE requested_by = ${request.actor.id}::uuid
         AND created_at > now() - interval '1 hour'`.execute(trx);
    const window = recent.rows[0];
    if (window && window.n >= CERTIFICATE_PREVIEW_HOURLY_LIMIT) {
      throw rateLimited(
        Math.max(1, window.retryAfter ?? 1),
        `O limite é de ${CERTIFICATE_PREVIEW_HOURLY_LIMIT} PDFs de exemplo por hora.`,
      );
    }
    const row = await trx
      .insertInto('certificatePreviews')
      .values({ requestedBy: request.actor.id, courseId: course?.id ?? null, html })
      .returning(PREVIEW_COLUMNS)
      .executeTakeFirstOrThrow();
    await enqueue(trx, 'certificate.preview', { previewId: row.id });
    return toView(row);
  });
}

/** O pedido de quem pede, ainda dentro das 24 horas; de outro usuário ou expirado: `404`. */
async function readOwnPreview<C extends 'pdf' | never>(
  db: Database,
  request: CertificateRequest,
  previewId: unknown,
  extra: readonly C[],
) {
  await requireCertificateAction(db, request, 'certificate.template.edit');
  const row = isUuid(previewId)
    ? await db
        .selectFrom('certificatePreviews')
        .select([...PREVIEW_COLUMNS, ...extra])
        .where('id', '=', previewId.toLowerCase())
        .where('requestedBy', '=', request.actor.id)
        .where(
          sql<boolean>`created_at > now() - make_interval(hours => ${CERTIFICATE_PREVIEW_TTL_HOURS})`,
        )
        .executeTakeFirst()
    : undefined;
  if (!row) throw notFound('Pedido de exemplo não encontrado.');
  return row;
}

/** `GET /certificate-templates/previews/{id}`: o estado do pedido, só para quem pediu. */
export async function getCertificatePreview(
  db: Database,
  request: CertificateRequest,
  previewId: unknown,
): Promise<CertificatePreviewView> {
  return toView(await readOwnPreview(db, request, previewId, []));
}

/**
 * `GET /certificate-templates/previews/{id}/pdf`: o PDF de exemplo, só para quem pediu. Em
 * `pending` ou `failed`: `409` `certificate_preview_not_ready`.
 */
export async function getCertificatePreviewPdf(
  db: Database,
  request: CertificateRequest,
  previewId: unknown,
): Promise<CertificatePdfFile> {
  const row = await readOwnPreview(db, request, previewId, ['pdf']);
  if (row.pdf === null) {
    throw conflict('certificate_preview_not_ready', 'O PDF de exemplo ainda não está pronto.');
  }
  return { pdf: row.pdf, filename: 'certificado-exemplo.pdf' };
}

// Worker.

/** O que o worker precisa para renderizar um exemplo. */
export interface CertificatePreviewJob {
  previewId: string;
  html: string;
  /** Dados fictícios (tarefa 466), com o curso indicado e as configurações da escola. */
  data: CertificateTemplateData;
}

/**
 * Lê o pedido para `certificate.preview`, com os dados de exemplo: título e instrutor do curso
 * indicado (ou os de exemplo), a data de `now` e o nome da escola e o signatário das
 * configurações. `null`: o pedido não existe mais ou já saiu de `pending`.
 */
export async function getCertificatePreviewJob(
  db: Database,
  previewId: string,
  options: { now?: Date } = {},
): Promise<CertificatePreviewJob | null> {
  if (!isUuid(previewId)) return null;
  const result = await sql<{
    id: string;
    html: string;
    courseId: string | null;
    courseTitle: string | null;
    instructorName: string | null;
  }>`
    SELECT p.id, p.html, c.id AS course_id, c.title AS course_title, o.name AS instructor_name
      FROM certificate_previews p
      LEFT JOIN courses c ON c.id = p.course_id
      LEFT JOIN users o ON o.id = c.owner_id AND o.deleted_at IS NULL
     WHERE p.id = ${previewId}::uuid AND p.status = 'pending'`.execute(db);
  const row = result.rows[0];
  if (!row) return null;
  const settings = await getSettings(db);
  return {
    previewId: row.id,
    html: row.html,
    data: certificatePreviewData({
      now: options.now ?? new Date(),
      course:
        row.courseId !== null && row.courseTitle !== null
          ? { title: row.courseTitle, instructorName: row.instructorName }
          : null,
      schoolName: settings['school.name'],
      signerName: settings['certificate.signer_name'],
      signerRole: settings['certificate.signer_role'],
    }),
  };
}

/**
 * Grava o PDF do exemplo e passa o pedido a `ready`. `false`: o pedido não está mais em
 * `pending` (apagado pelo expurgo ou já resolvido). PDF vazio ou acima de 2 MiB: `RangeError`.
 */
export async function saveCertificatePreviewPdf(
  db: Database,
  previewId: string,
  pdf: Uint8Array,
): Promise<boolean> {
  assertCertificatePdfSize(pdf);
  const updated = await db
    .updateTable('certificatePreviews')
    .set({ status: 'ready', pdf: Buffer.from(pdf), renderedAt: sql`now()` })
    .where('id', '=', previewId)
    .where('status', '=', 'pending')
    .returning('id')
    .executeTakeFirst();
  return updated !== undefined;
}

/**
 * Passa o pedido a `failed` com o motivo (cortado em 2.000 caracteres; não ponha dado pessoal
 * nele). `false`: o pedido não está mais em `pending`.
 */
export async function failCertificatePreview(
  db: Database,
  previewId: string,
  error: string,
): Promise<boolean> {
  const message = error.trim() === '' ? 'Falha ao gerar o PDF de exemplo.' : error.trim();
  const updated = await db
    .updateTable('certificatePreviews')
    .set({
      status: 'failed',
      error: [...message].slice(0, CERTIFICATE_PREVIEW_ERROR_MAX_LENGTH).join(''),
    })
    .where('id', '=', previewId)
    .where('status', '=', 'pending')
    .returning('id')
    .executeTakeFirst();
  return updated !== undefined;
}

// Expurgo (spec 033, "Retenção").

export interface CertificatePurgeOptions {
  /** Linhas por `DELETE`. Padrão: 500. */
  batchSize?: number;
  /** Para entre dois lotes quando abortado. */
  signal?: AbortSignal;
}

const PURGE_BATCH_SIZE = 500;

async function purgeInBatches(
  options: CertificatePurgeOptions,
  deleteBatch: (limit: number) => Promise<number>,
): Promise<number> {
  const limit = options.batchSize ?? PURGE_BATCH_SIZE;
  let total = 0;
  for (;;) {
    if (options.signal?.aborted) return total;
    const deleted = await deleteBatch(limit);
    total += deleted;
    if (deleted < limit) return total;
  }
}

/** Apaga os pedidos de exemplo com mais de 24 horas, em lotes. Devolve quantos apagou. */
export function purgeCertificatePreviews(
  db: Database,
  options: CertificatePurgeOptions & { olderThanHours?: number } = {},
): Promise<number> {
  const hours = options.olderThanHours ?? CERTIFICATE_PREVIEW_TTL_HOURS;
  return purgeInBatches(options, async (limit) => {
    const result = await sql`
      DELETE FROM certificate_previews
       WHERE id IN (SELECT id FROM certificate_previews
                     WHERE created_at < now() - make_interval(hours => ${hours})
                     ORDER BY created_at
                     LIMIT ${limit})`.execute(db);
    return Number(result.numAffectedRows ?? 0);
  });
}

/**
 * Apaga as versões de template com mais de 30 dias que nenhum certificado e nenhum template
 * referenciam, em lotes. A condição vale no próprio `DELETE`, e as chaves `RESTRICT` garantem
 * que versão em uso nunca some. Devolve quantas apagou.
 */
export function purgeCertificateTemplateVersions(
  db: Database,
  options: CertificatePurgeOptions & { olderThanDays?: number } = {},
): Promise<number> {
  const days = options.olderThanDays ?? CERTIFICATE_TEMPLATE_VERSION_RETENTION_DAYS;
  return purgeInBatches(options, async (limit) => {
    const result = await sql`
      DELETE FROM certificate_template_versions
       WHERE id IN (SELECT v.id FROM certificate_template_versions v
                     WHERE v.created_at < now() - make_interval(days => ${days})
                       AND NOT EXISTS (SELECT 1 FROM certificates c
                                        WHERE c.template_version_id = v.id)
                       AND NOT EXISTS (SELECT 1 FROM certificate_templates t
                                        WHERE t.version_id = v.id)
                     ORDER BY v.created_at
                     LIMIT ${limit})`.execute(db);
    return Number(result.numAffectedRows ?? 0);
  });
}
