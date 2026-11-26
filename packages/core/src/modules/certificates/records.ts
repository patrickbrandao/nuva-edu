// Leitura dos certificados para a equipe (spec 015): a visão `Certificate` do contrato da
// admin-api, com os dados congelados e os nomes atuais de quem é citado; a lista com filtros e
// o alcance do instrutor; o PDF para conferência ("Download pela equipe"); e a referência do
// certificado no progresso do aluno. Só `getCertificatePdf` lê a coluna `pdf`.

import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, notFound, validationFailed } from '../../errors/domain-error.ts';
import { isUuid } from '../entitlements/types.ts';
import { normalizeCertificateCode } from './code.ts';
import {
  CERTIFICATE_STATES,
  type CertificatePdfFile,
  type CertificateRequest,
  type CertificateState,
  type CertificateUserRef,
  certificatePdfFilename,
  certificatePreparing,
  certificateStateOf,
  certificateUserRef,
  requireCertificateAction,
} from './common.ts';
import { formatCertificateCode } from './template/values.ts';

/** `Certificate` do contrato da admin-api. */
export interface CertificateView {
  id: string;
  /** Com hífens (`XXXX-XXXX-XXXX`). */
  code: string;
  state: CertificateState;
  /** O titular, com o nome atual (`usuário removido` se a conta foi excluída). */
  user: CertificateUserRef;
  /** O curso, com o título atual. */
  course: { type: 'course'; id: string; title: string };
  /** Congelado; `null` se a conta foi excluída. */
  studentName: string | null;
  courseTitle: string;
  instructorName: string | null;
  hours: number;
  completedAt: Date;
  issuedAt: Date;
  issuedManually: boolean;
  issuedBy: CertificateUserRef | null;
  issueReason: string | null;
  revokedAt: Date | null;
  revokedBy: CertificateUserRef | null;
  revokeReason: string | null;
  pdfRenderedAt: Date | null;
  templateVersionId: string;
}

interface CertificateRow {
  id: string;
  code: string;
  userId: string;
  userName: string;
  userDeletedAt: Date | null;
  courseId: string;
  currentCourseTitle: string;
  studentName: string | null;
  courseTitle: string;
  instructorName: string | null;
  hours: number;
  completedAt: Date;
  issuedAt: Date;
  issuedManually: boolean;
  issuedBy: string | null;
  issuedByName: string | null;
  issuedByDeletedAt: Date | null;
  issueReason: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedByName: string | null;
  revokedByDeletedAt: Date | null;
  revokeReason: string | null;
  pdfRenderedAt: Date | null;
  templateVersionId: string;
}

function toView(row: CertificateRow): CertificateView {
  return {
    id: row.id,
    code: formatCertificateCode(row.code),
    state: certificateStateOf(row),
    user: certificateUserRef(row.userId, row.userName, row.userDeletedAt) as CertificateUserRef,
    course: { type: 'course', id: row.courseId, title: row.currentCourseTitle },
    studentName: row.studentName,
    courseTitle: row.courseTitle,
    instructorName: row.instructorName,
    hours: row.hours,
    completedAt: row.completedAt,
    issuedAt: row.issuedAt,
    issuedManually: row.issuedManually,
    issuedBy: certificateUserRef(row.issuedBy, row.issuedByName, row.issuedByDeletedAt),
    issueReason: row.issueReason,
    revokedAt: row.revokedAt,
    revokedBy: certificateUserRef(row.revokedBy, row.revokedByName, row.revokedByDeletedAt),
    revokeReason: row.revokeReason,
    pdfRenderedAt: row.pdfRenderedAt,
    templateVersionId: row.templateVersionId,
  };
}

/**
 * Certificados (apelido `c`; o curso é `co`) que atendem a `where`, seguidos de `tail` (ordem e
 * limite). Uma consulta.
 */
export async function queryCertificateViews(
  db: Database,
  where: RawBuilder<unknown>,
  tail: RawBuilder<unknown> = sql``,
): Promise<CertificateView[]> {
  const result = await sql<CertificateRow>`
    SELECT c.id, c.code, c.user_id, u.name AS user_name, u.deleted_at AS user_deleted_at,
           c.course_id, co.title AS current_course_title, c.student_name, c.course_title,
           c.instructor_name, c.hours, c.completed_at, c.issued_at, c.issued_manually,
           c.issued_by, ib.name AS issued_by_name, ib.deleted_at AS issued_by_deleted_at,
           c.issue_reason, c.revoked_at, c.revoked_by, rb.name AS revoked_by_name,
           rb.deleted_at AS revoked_by_deleted_at, c.revoke_reason, c.pdf_rendered_at,
           c.template_version_id
      FROM certificates c
      JOIN users u ON u.id = c.user_id
      JOIN courses co ON co.id = c.course_id
      LEFT JOIN users ib ON ib.id = c.issued_by
      LEFT JOIN users rb ON rb.id = c.revoked_by
     WHERE ${where}
     ${tail}`.execute(db);
  return result.rows.map(toView);
}

/** Um certificado pelo id; inexistente: `404`. */
export async function readCertificateView(db: Database, id: string): Promise<CertificateView> {
  const [view] = await queryCertificateViews(db, sql`c.id = ${id}::uuid`);
  if (!view) throw notFound('Certificado não encontrado.');
  return view;
}

// Lista da equipe.

export const CERTIFICATE_PAGE_DEFAULT_LIMIT = 25;
export const CERTIFICATE_PAGE_MAX_LIMIT = 100;

export interface CertificateListQuery {
  courseId?: unknown;
  userId?: unknown;
  state?: unknown;
  /** Com ou sem hífens, sem diferenciar maiúsculas. */
  code?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

/** Página por cursor opaco (`CertificatePage` do contrato). */
export interface CertificatePage {
  items: CertificateView[];
  nextCursor: string | null;
}

const CURSOR_PREFIX = 'certificates:';

function encodeCursor(view: CertificateView): string {
  return Buffer.from(`${CURSOR_PREFIX}${view.issuedAt.toISOString()}|${view.id}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: unknown): { issuedAt: Date; id: string } | undefined {
  if (typeof cursor !== 'string') return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!text.startsWith(CURSOR_PREFIX)) return undefined;
  const [iso, id] = text.slice(CURSOR_PREFIX.length).split('|');
  const issuedAt = new Date(iso ?? '');
  if (Number.isNaN(issuedAt.getTime()) || !isUuid(id)) return undefined;
  return { issuedAt, id: id.toLowerCase() };
}

const STATE_CONDITION: Record<CertificateState, RawBuilder<unknown>> = {
  revoked: sql`c.revoked_at IS NOT NULL`,
  issued: sql`c.revoked_at IS NULL AND (c.pdf_rendered_at IS NOT NULL OR c.student_name IS NULL)`,
  preparing: sql`c.revoked_at IS NULL AND c.pdf_rendered_at IS NULL AND c.student_name IS NOT NULL`,
};

/**
 * `GET /certificates` (`progress.view`): mais recentes primeiro (emissão, depois id), com filtros
 * por curso, aluno, estado e código; o instrutor vê só os dos próprios cursos. Paginada por
 * cursor opaco. Parâmetro fora do formato: `400`; código que não é um código: página vazia. Uma
 * consulta.
 */
export async function listCertificates(
  db: Database,
  request: CertificateRequest,
  query: CertificateListQuery = {},
): Promise<CertificatePage> {
  const scope = await requireCertificateAction(db, request, 'progress.view');
  const errors: FieldError[] = [];
  const conditions: RawBuilder<unknown>[] = [];
  if (query.courseId !== undefined) {
    if (isUuid(query.courseId))
      conditions.push(sql`c.course_id = ${query.courseId.toLowerCase()}::uuid`);
    else errors.push({ path: 'query.courseId', message: 'Identificador inválido.' });
  }
  if (query.userId !== undefined) {
    if (isUuid(query.userId)) conditions.push(sql`c.user_id = ${query.userId.toLowerCase()}::uuid`);
    else errors.push({ path: 'query.userId', message: 'Identificador inválido.' });
  }
  if (query.state !== undefined) {
    const state = query.state as CertificateState;
    if (CERTIFICATE_STATES.includes(state)) conditions.push(STATE_CONDITION[state]);
    else errors.push({ path: 'query.state', message: 'Estado desconhecido.' });
  }
  let emptyByCode = false;
  if (query.code !== undefined) {
    if (typeof query.code !== 'string' || query.code.length < 1 || query.code.length > 32) {
      errors.push({ path: 'query.code', message: 'Use de 1 a 32 caracteres.' });
    } else {
      const code = normalizeCertificateCode(query.code);
      if (code === null) emptyByCode = true;
      else conditions.push(sql`c.code = ${code}`);
    }
  }
  const limit = query.limit ?? CERTIFICATE_PAGE_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > CERTIFICATE_PAGE_MAX_LIMIT
  ) {
    errors.push({ path: 'query.limit', message: `Use de 1 a ${CERTIFICATE_PAGE_MAX_LIMIT}.` });
  }
  if (query.cursor !== undefined) {
    const after = decodeCursor(query.cursor);
    if (after === undefined) errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
    else
      conditions.push(
        sql`(c.issued_at, c.id) < (${after.issuedAt}::timestamptz, ${after.id}::uuid)`,
      );
  }
  if (errors.length > 0) throw validationFailed(errors);
  if (emptyByCode) return { items: [], nextCursor: null };
  if (scope === 'own') conditions.push(sql`co.owner_id = ${request.actor.id}::uuid`);
  const size = limit as number;
  const where = conditions.length === 0 ? sql`true` : sql.join(conditions, sql` AND `);
  const rows = await queryCertificateViews(
    db,
    where,
    sql`ORDER BY c.issued_at DESC, c.id DESC LIMIT ${size + 1}`,
  );
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > size && last ? encodeCursor(last) : null };
}

/**
 * `GET /certificates/{id}/pdf` na admin-api (`progress.view`; o instrutor só nos próprios
 * cursos): o mesmo PDF que o aluno recebeu, sem nova renderização, também de certificado
 * revogado. Inexistente, de curso alheio ao instrutor, ou com o PDF apagado pela exclusão da
 * conta do titular: `404`. PDF ainda não gerado: `409` `certificate_preparing`. Leitura comum:
 * não grava auditoria (spec 028).
 */
export async function getCertificatePdf(
  db: Database,
  request: CertificateRequest,
  certificateId: unknown,
): Promise<CertificatePdfFile> {
  const scope = await requireCertificateAction(db, request, 'progress.view');
  const row = isUuid(certificateId)
    ? await db
        .selectFrom('certificates as c')
        .innerJoin('courses as co', 'co.id', 'c.courseId')
        .select(['c.code', 'c.pdf', 'c.studentName', 'co.ownerId'])
        .where('c.id', '=', certificateId.toLowerCase())
        .executeTakeFirst()
    : undefined;
  if (!row || (scope === 'own' && row.ownerId !== request.actor.id) || row.studentName === null) {
    throw notFound('Certificado não encontrado.');
  }
  if (row.pdf === null) throw certificatePreparing();
  return { pdf: row.pdf, filename: certificatePdfFilename(row.code) };
}

/** `CertificateRef` do contrato. */
export interface CertificateRef {
  id: string;
  /** Com hífens. */
  code: string;
  state: CertificateState;
}

/**
 * O certificado de um usuário em cada curso pedido (`certificate` de `UserCourseProgress`), numa
 * consulta. Curso sem certificado fica fora do mapa. O alcance é de quem chama (a leitura do
 * progresso já o conferiu).
 */
export async function getCertificateRefs(
  db: Database,
  userId: string,
  courseIds: readonly string[],
): Promise<Map<string, CertificateRef>> {
  const ids = [...new Set(courseIds.filter(isUuid).map((id) => id.toLowerCase()))];
  const refs = new Map<string, CertificateRef>();
  if (ids.length === 0 || !isUuid(userId)) return refs;
  const rows = await db
    .selectFrom('certificates')
    .select(['id', 'courseId', 'code', 'revokedAt', 'pdfRenderedAt', 'studentName'])
    .where('userId', '=', userId.toLowerCase())
    .where('courseId', 'in', ids)
    .execute();
  for (const row of rows) {
    refs.set(row.courseId, {
      id: row.id,
      code: formatCertificateCode(row.code),
      state: certificateStateOf(row),
    });
  }
  return refs;
}
