// Emissão dos certificados (spec 015, "Emissão" e "Revogação e emissão manual"; ADR 0026).
// - Worker: emissão automática (`course.completed`), lote retroativo (`certificate.backfill`) e
//   o que `certificate.render` lê e grava.
// - admin-api: emissão manual, reemissão, revogação, restauração e pedido de lote, com auditoria
//   (spec 028) na transação da ação.
// O registro nasce com os dados congelados e a versão do template efetivo; sem template efetivo
// não há certificado.

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  conflict,
  type FieldError,
  notFound,
  validationFailed,
} from '../../errors/domain-error.ts';
import { loadTarget, managementAuditContext } from '../accounts/management/common.ts';
import { recordAudit } from '../audit/record.ts';
import { canAccess } from '../entitlements/access.ts';
import { isUuid } from '../entitlements/types.ts';
import { enqueue } from '../jobs/queue.ts';
import { getCourseCompletion } from '../learning/completion.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import { getSettings } from '../settings/settings.ts';
import { generateCertificateCode } from './code.ts';
import {
  CERTIFICATE_REASON_MAX_LENGTH,
  type CertificateRequest,
  certificateDisabled,
  certificateStudentName,
  certificateTemplateMissing,
  findEffectiveCertificateTemplate,
  loadCertificateCourse,
  requireCertificateAction,
} from './common.ts';
import { type CertificateView, readCertificateView } from './records.ts';
import type { CertificateTemplateData } from './template/values.ts';
import { formatCertificateCode } from './template/values.ts';
import { enqueueCertificateBackfill } from './templates.ts';

/** PDF de no máximo 2 MiB (spec 015, RNF-03; CHECK da migration 0012). */
export const CERTIFICATE_PDF_MAX_BYTES = 2 * 1024 * 1024;

/** Carga horária: o valor fixado no curso ou a soma das aulas publicadas, em horas para cima. */
export function certificateHours(certificateHoursOverride: number | null, durationSeconds: number) {
  return certificateHoursOverride ?? Math.ceil(Math.max(0, durationSeconds) / 3600);
}

interface IssueCourse {
  id: string;
  title: string;
  certificateEnabled: boolean;
  certificateHours: number | null;
  /** Nome de exibição do dono; `null` sem dono ou com a conta dele excluída. */
  instructorName: string | null;
}

async function loadIssueCourse(trx: Database, courseId: string): Promise<IssueCourse | null> {
  const result = await sql<IssueCourse>`
    SELECT c.id, c.title, c.certificate_enabled, c.certificate_hours,
           o.name AS instructor_name
      FROM courses c
      LEFT JOIN users o ON o.id = c.owner_id AND o.deleted_at IS NULL
     WHERE c.id = ${courseId}::uuid`.execute(trx);
  return result.rows[0] ?? null;
}

interface NewCertificate {
  userId: string;
  course: IssueCourse;
  studentName: string;
  hours: number;
  completedAt: Date;
  templateVersionId: string;
  manual?: { issuedBy: string; reason: string };
}

const CODE_ATTEMPTS = 5;

/**
 * Insere o certificado com os dados congelados. `null` quando o par (usuário, curso) já tem um
 * (inclusive o criado por transação concorrente: o `ON CONFLICT` espera o fim dela). Código
 * repetido (31^12 combinações) gera outro e tenta de novo.
 */
async function insertCertificate(
  trx: Database,
  input: NewCertificate,
): Promise<{ id: string; code: string } | null> {
  const settings = await getSettings(trx);
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const row = await trx
      .insertInto('certificates')
      .values({
        userId: input.userId,
        courseId: input.course.id,
        code: generateCertificateCode(),
        studentName: input.studentName,
        courseTitle: input.course.title,
        instructorName: input.course.instructorName,
        hours: input.hours,
        completedAt: input.completedAt,
        schoolName: settings['school.name'],
        signerName: settings['certificate.signer_name'],
        signerRole: settings['certificate.signer_role'],
        templateVersionId: input.templateVersionId,
        ...(input.manual
          ? {
              issuedManually: true,
              issuedBy: input.manual.issuedBy,
              issueReason: input.manual.reason,
            }
          : {}),
      })
      .onConflict((oc) => oc.doNothing())
      .returning(['id', 'code'])
      .executeTakeFirst();
    if (row) return row;
    const existing = await trx
      .selectFrom('certificates')
      .select('id')
      .where('userId', '=', input.userId)
      .where('courseId', '=', input.course.id)
      .executeTakeFirst();
    if (existing) return null;
  }
  throw new Error('certificates: não foi possível gerar um código único.');
}

/** O que segue a criação do registro: o PDF e o e-mail `certificate.issued` (spec 024). */
async function afterIssue(
  trx: Database,
  certificate: { id: string; code: string },
  userId: string,
  courseTitle: string,
): Promise<void> {
  await enqueue(trx, 'certificate.render', { certificateId: certificate.id });
  await enqueueEmail(trx, {
    userId,
    type: 'certificate.issued',
    data: { courseTitle, code: formatCertificateCode(certificate.code) },
  });
}

export const CERTIFICATE_ISSUE_OUTCOMES = [
  'issued',
  'already_issued',
  'course_not_found',
  'user_not_found',
  'certificate_disabled',
  'awaiting_template',
  'not_completed',
  'no_access',
] as const;
/** O que a emissão automática fez; só `issued` cria algo. Nenhum dos demais é falha da tarefa. */
export type CertificateIssueOutcome = (typeof CERTIFICATE_ISSUE_OUTCOMES)[number];

export interface CertificateIssueResult {
  outcome: CertificateIssueOutcome;
  /** O certificado criado (`issued`) ou o que já existia (`already_issued`). */
  certificateId: string | null;
}

/**
 * O trabalho de `course.completed` (spec 015, "Emissão"): confere, na hora, que o curso tem o
 * certificado habilitado e template efetivo, que o usuário tem 100% das aulas publicadas e
 * acessa o curso, e que ainda não há certificado; cria o registro com os dados congelados,
 * enfileira `certificate.render` e o e-mail `certificate.issued`, numa transação. Idempotente:
 * duas chamadas simultâneas criam um só certificado. Sem template efetivo termina em
 * `awaiting_template`, sem criar nada. Dono da escrita: worker.
 */
export async function issueCertificateOnCompletion(
  db: Database,
  input: { userId: string; courseId: string },
): Promise<CertificateIssueResult> {
  const none = (outcome: CertificateIssueOutcome): CertificateIssueResult => ({
    outcome,
    certificateId: null,
  });
  if (!isUuid(input.courseId)) return none('course_not_found');
  if (!isUuid(input.userId)) return none('user_not_found');
  const userId = input.userId.toLowerCase();
  const courseId = input.courseId.toLowerCase();
  return db.transaction().execute(async (trx) => {
    const course = await loadIssueCourse(trx, courseId);
    if (!course) return none('course_not_found');
    if (!course.certificateEnabled) return none('certificate_disabled');
    const existing = await trx
      .selectFrom('certificates')
      .select('id')
      .where('userId', '=', userId)
      .where('courseId', '=', courseId)
      .executeTakeFirst();
    if (existing) return { outcome: 'already_issued', certificateId: existing.id };
    const template = await findEffectiveCertificateTemplate(trx, courseId);
    if (!template) return none('awaiting_template');
    const user = await trx
      .selectFrom('users')
      .select(['id', 'name', 'fullName'])
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!user) return none('user_not_found');
    const completion = await getCourseCompletion(trx, userId, courseId);
    if (!completion.completed || completion.completedAt === null) return none('not_completed');
    const access = await canAccess(trx, { id: userId }, { type: 'course', id: courseId });
    if (!access.allowed) return none('no_access');
    const created = await insertCertificate(trx, {
      userId,
      course,
      studentName: certificateStudentName(user),
      hours: certificateHours(course.certificateHours, completion.durationSeconds),
      completedAt: completion.completedAt,
      templateVersionId: template.versionId,
    });
    if (!created) {
      const other = await trx
        .selectFrom('certificates')
        .select('id')
        .where('userId', '=', userId)
        .where('courseId', '=', courseId)
        .executeTakeFirstOrThrow();
      return { outcome: 'already_issued', certificateId: other.id };
    }
    await afterIssue(trx, created, userId, course.title);
    return { outcome: 'issued', certificateId: created.id };
  });
}

// Lote retroativo.

/** Usuários por consulta na seleção do lote. */
export const CERTIFICATE_BACKFILL_BATCH_SIZE = 500;

/**
 * Seleção do `certificate.backfill`: usuários (contas não excluídas) com 100% das aulas
 * publicadas do curso e sem certificado dele, por id, depois de `after`. O acesso ao curso é
 * conferido na emissão de cada um.
 */
export async function listCertificateBackfillCandidates(
  db: Database,
  courseId: string,
  options: { after?: string | null; limit?: number } = {},
): Promise<string[]> {
  if (!isUuid(courseId)) return [];
  const after = options.after ?? null;
  const result = await sql<{ userId: string }>`
    WITH total AS (
      SELECT count(*)::int AS n
        FROM lessons l JOIN modules m ON m.id = l.module_id
       WHERE m.course_id = ${courseId}::uuid AND l.status = 'published'
    )
    SELECT lp.user_id
      FROM lesson_progress lp
      JOIN lessons l ON l.id = lp.lesson_id AND l.status = 'published'
      JOIN users u ON u.id = lp.user_id AND u.deleted_at IS NULL
      CROSS JOIN total
     WHERE lp.course_id = ${courseId}::uuid AND lp.completed_at IS NOT NULL AND total.n > 0
       AND (${after}::uuid IS NULL OR lp.user_id > ${after}::uuid)
       AND NOT EXISTS (SELECT 1 FROM certificates c
                        WHERE c.user_id = lp.user_id AND c.course_id = ${courseId}::uuid)
     GROUP BY lp.user_id, total.n
    HAVING count(*) >= total.n
     ORDER BY lp.user_id
     LIMIT ${options.limit ?? CERTIFICATE_BACKFILL_BATCH_SIZE}`.execute(db);
  return result.rows.map((row) => row.userId);
}

export interface CertificateBackfillResult {
  /** Usuários com 100% e sem certificado examinados. */
  candidates: number;
  /** Certificados criados. */
  issued: number;
}

/**
 * O trabalho de `certificate.backfill`: emite para quem tem, agora, 100% das aulas publicadas e
 * acesso ao curso, uma transação por certificado (a mesma regra de `course.completed`). Curso
 * com certificado desabilitado, sem template efetivo ou inexistente: nada. Repetir é seguro. Com
 * `signal` abortado, para entre dois usuários (a tarefa volta à fila e retoma de onde faltar).
 */
export async function runCertificateBackfill(
  db: Database,
  courseId: string,
  options: { batchSize?: number; signal?: AbortSignal } = {},
): Promise<CertificateBackfillResult> {
  const result: CertificateBackfillResult = { candidates: 0, issued: 0 };
  if (!isUuid(courseId)) return result;
  const course = await loadIssueCourse(db, courseId.toLowerCase());
  if (!course?.certificateEnabled) return result;
  if (!(await findEffectiveCertificateTemplate(db, course.id))) return result;
  const limit = options.batchSize ?? CERTIFICATE_BACKFILL_BATCH_SIZE;
  let after: string | null = null;
  for (;;) {
    const userIds = await listCertificateBackfillCandidates(db, course.id, { after, limit });
    for (const userId of userIds) {
      if (options.signal?.aborted) return result;
      result.candidates += 1;
      const issued = await issueCertificateOnCompletion(db, { userId, courseId: course.id });
      if (issued.outcome === 'issued') result.issued += 1;
      // Template ou certificado retirados no meio do lote: o restante teria o mesmo fim.
      if (issued.outcome === 'awaiting_template' || issued.outcome === 'certificate_disabled') {
        return result;
      }
    }
    if (userIds.length < limit) return result;
    after = userIds.at(-1) ?? null;
  }
}

/**
 * `POST /courses/{id}/certificates/backfill`: enfileira `certificate.backfill` do curso
 * (`course.edit`; o instrutor só nos próprios cursos, alheio é `404`). Certificado desabilitado:
 * `422` `certificate_disabled`; sem template efetivo: `422` `certificate_template_missing`.
 * Havendo um lote ativo do curso, não cria outro. Auditoria `certificate.backfill`.
 */
export async function requestCertificateBackfill(
  db: Database,
  request: CertificateRequest,
  courseId: unknown,
): Promise<{ courseId: string; queued: true }> {
  const scope = await requireCertificateAction(db, request, 'course.edit', {
    action: 'certificate.backfill',
    targetType: 'course',
    targetId: isUuid(courseId) ? courseId.toLowerCase() : null,
  });
  const course = await loadCertificateCourse(db, request, scope, courseId);
  if (!course.certificateEnabled) throw certificateDisabled();
  return db.transaction().execute(async (trx) => {
    if (!(await findEffectiveCertificateTemplate(trx, course.id))) {
      throw certificateTemplateMissing();
    }
    await enqueueCertificateBackfill(trx, course.id);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'certificate.backfill',
      targetType: 'course',
      targetId: course.id,
    });
    return { courseId: course.id, queued: true as const };
  });
}

// Ações da equipe sobre um certificado.

function readReason(value: unknown, errors: FieldError[]): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason === '' || [...reason].length > CERTIFICATE_REASON_MAX_LENGTH) {
    errors.push({
      path: 'body.reason',
      message: `Informe o motivo, com até ${CERTIFICATE_REASON_MAX_LENGTH} caracteres.`,
    });
  }
  return reason;
}

export interface IssueCertificateManuallyInput {
  userId: unknown;
  courseId: unknown;
  reason: unknown;
}

/**
 * `POST /certificates`: emissão manual (`certificate.issue`: gerente e admin), com motivo, para
 * quem não concluiu pelo sistema. Não exige 100% nem acesso; exige o certificado habilitado
 * (`422` `certificate_disabled`) e template efetivo (`422` `certificate_template_missing`).
 * Usuário ou curso inexistente: `404`; o aluno já tem certificado do curso: `409`
 * `certificate_exists`. Data de conclusão: a da última aula, se ele tem 100%; senão, a da
 * emissão. Enfileira o PDF e o e-mail; auditoria `certificate.issue`.
 */
export async function issueCertificateManually(
  db: Database,
  request: CertificateRequest,
  input: IssueCertificateManuallyInput,
): Promise<CertificateView> {
  await requireCertificateAction(db, request, 'certificate.issue', {
    targetType: 'user',
    targetId: isUuid(input.userId) ? input.userId.toLowerCase() : null,
  });
  const errors: FieldError[] = [];
  if (!isUuid(input.userId))
    errors.push({ path: 'body.userId', message: 'Identificador inválido.' });
  if (!isUuid(input.courseId)) {
    errors.push({ path: 'body.courseId', message: 'Identificador inválido.' });
  }
  const reason = readReason(input.reason, errors);
  if (errors.length > 0) throw validationFailed(errors);
  const exists = () => conflict('certificate_exists', 'O aluno já tem certificado deste curso.');
  return db.transaction().execute(async (trx) => {
    const target = await loadTarget(trx, input.userId as string);
    const course = await loadIssueCourse(trx, (input.courseId as string).toLowerCase());
    if (!course) throw notFound('Curso não encontrado.');
    const existing = await trx
      .selectFrom('certificates')
      .select('id')
      .where('userId', '=', target.id)
      .where('courseId', '=', course.id)
      .executeTakeFirst();
    if (existing) throw exists();
    if (!course.certificateEnabled) throw certificateDisabled();
    const template = await findEffectiveCertificateTemplate(trx, course.id);
    if (!template) throw certificateTemplateMissing();
    const completion = await getCourseCompletion(trx, target.id, course.id);
    const created = await insertCertificate(trx, {
      userId: target.id,
      course,
      studentName: certificateStudentName(target),
      hours: certificateHours(course.certificateHours, completion.durationSeconds),
      completedAt: completion.completedAt ?? new Date(),
      templateVersionId: template.versionId,
      manual: { issuedBy: request.actor.id, reason },
    });
    if (!created) throw exists();
    await afterIssue(trx, created, target.id, course.title);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'certificate.issue',
      targetType: 'certificate',
      targetId: created.id,
      details: {
        userId: target.id,
        courseId: course.id,
        reason,
        templateVersionId: template.versionId,
      },
    });
    return readCertificateView(trx, created.id);
  });
}

interface LockedCertificate {
  id: string;
  userId: string;
  courseId: string;
  studentName: string | null;
  templateVersionId: string;
  revokedAt: Date | null;
}

/** Trava o certificado até o fim da transação; id fora do formato ou inexistente: `404`. */
async function lockCertificate(trx: Database, id: unknown): Promise<LockedCertificate> {
  const row = isUuid(id)
    ? await trx
        .selectFrom('certificates')
        .select(['id', 'userId', 'courseId', 'studentName', 'templateVersionId', 'revokedAt'])
        .where('id', '=', id.toLowerCase())
        .forUpdate()
        .executeTakeFirst()
    : undefined;
  if (!row) throw notFound('Certificado não encontrado.');
  return row;
}

const certificateTarget = (id: unknown) => ({
  targetType: 'certificate',
  targetId: isUuid(id) ? id.toLowerCase() : null,
});

/**
 * `POST /certificates/{id}/reissue` (`certificate.issue`): congela de novo o nome atual do aluno
 * e a versão do template efetivo atual, apaga o PDF (o certificado volta a `preparing`) e
 * enfileira `certificate.render`. Mantém o código e os demais dados; não envia e-mail. Sem
 * template efetivo: `422` `certificate_template_missing`; revogado: `409`
 * `certificate_already_revoked`; titular que excluiu a conta: `409`
 * `certificate_holder_removed`. Auditoria `certificate.reissue`.
 */
export async function reissueCertificate(
  db: Database,
  request: CertificateRequest,
  certificateId: unknown,
): Promise<CertificateView> {
  await requireCertificateAction(db, request, 'certificate.issue', {
    action: 'certificate.reissue',
    ...certificateTarget(certificateId),
  });
  return db.transaction().execute(async (trx) => {
    const certificate = await lockCertificate(trx, certificateId);
    if (certificate.revokedAt !== null) {
      throw conflict('certificate_already_revoked', 'O certificado está revogado.');
    }
    const user = await trx
      .selectFrom('users')
      .select(['name', 'fullName'])
      .where('id', '=', certificate.userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!user || certificate.studentName === null) {
      throw conflict('certificate_holder_removed', 'O titular do certificado excluiu a conta.');
    }
    const template = await findEffectiveCertificateTemplate(trx, certificate.courseId);
    if (!template) throw certificateTemplateMissing();
    const studentName = certificateStudentName(user);
    await trx
      .updateTable('certificates')
      .set({
        studentName,
        templateVersionId: template.versionId,
        pdf: null,
        pdfRenderedAt: null,
      })
      .where('id', '=', certificate.id)
      .execute();
    await enqueue(trx, 'certificate.render', { certificateId: certificate.id });
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'certificate.reissue',
      targetType: 'certificate',
      targetId: certificate.id,
      details: {
        userId: certificate.userId,
        courseId: certificate.courseId,
        before: {
          studentName: certificate.studentName,
          templateVersionId: certificate.templateVersionId,
        },
        after: { studentName, templateVersionId: template.versionId },
      },
    });
    return readCertificateView(trx, certificate.id);
  });
}

/**
 * `POST /certificates/{id}/revoke` (`certificate.revoke`: só admin), com motivo. A validação
 * pública passa a mostrar a revogação e o aluno deixa de baixar o PDF. Já revogado: `409`
 * `certificate_already_revoked`. Auditoria `certificate.revoke`.
 */
export async function revokeCertificate(
  db: Database,
  request: CertificateRequest,
  certificateId: unknown,
  input: { reason: unknown },
): Promise<CertificateView> {
  await requireCertificateAction(
    db,
    request,
    'certificate.revoke',
    certificateTarget(certificateId),
  );
  const errors: FieldError[] = [];
  const reason = readReason(input.reason, errors);
  if (errors.length > 0) throw validationFailed(errors);
  return db.transaction().execute(async (trx) => {
    const certificate = await lockCertificate(trx, certificateId);
    if (certificate.revokedAt !== null) {
      throw conflict('certificate_already_revoked', 'O certificado já está revogado.');
    }
    await trx
      .updateTable('certificates')
      .set({ revokedAt: sql`now()`, revokedBy: request.actor.id, revokeReason: reason })
      .where('id', '=', certificate.id)
      .execute();
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'certificate.revoke',
      targetType: 'certificate',
      targetId: certificate.id,
      details: { userId: certificate.userId, courseId: certificate.courseId, reason },
    });
    return readCertificateView(trx, certificate.id);
  });
}

/**
 * `POST /certificates/{id}/restore` (`certificate.revoke`: só admin): desfaz a revogação. Não
 * revogado: `409` `certificate_not_revoked`. Auditoria `certificate.restore`.
 */
export async function restoreCertificate(
  db: Database,
  request: CertificateRequest,
  certificateId: unknown,
): Promise<CertificateView> {
  await requireCertificateAction(db, request, 'certificate.revoke', {
    action: 'certificate.restore',
    ...certificateTarget(certificateId),
  });
  return db.transaction().execute(async (trx) => {
    const certificate = await lockCertificate(trx, certificateId);
    if (certificate.revokedAt === null) {
      throw conflict('certificate_not_revoked', 'O certificado não está revogado.');
    }
    await trx
      .updateTable('certificates')
      .set({ revokedAt: null, revokedBy: null, revokeReason: null })
      .where('id', '=', certificate.id)
      .execute();
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'certificate.restore',
      targetType: 'certificate',
      targetId: certificate.id,
      details: { userId: certificate.userId, courseId: certificate.courseId },
    });
    return readCertificateView(trx, certificate.id);
  });
}

// O que `certificate.render` lê e grava.

/** O que o worker precisa para gerar o PDF de um certificado. */
export interface CertificateRenderJob {
  certificateId: string;
  /** Sem hífens. */
  code: string;
  /** A versão congelada no certificado: repetir a renderização usa sempre esta. */
  templateVersionId: string;
  /** O HTML dessa versão. */
  html: string;
  /** Dados congelados, prontos para `certificateTemplateValues`. */
  data: CertificateTemplateData;
}

/**
 * Lê o certificado para `certificate.render`. `null`: não existe, ou o titular excluiu a conta
 * (não há mais nome nem PDF a gerar); a tarefa termina sem efeito. Certificado revogado continua
 * sendo renderizado (a equipe ainda o baixa).
 */
export async function getCertificateRenderJob(
  db: Database,
  certificateId: string,
): Promise<CertificateRenderJob | null> {
  if (!isUuid(certificateId)) return null;
  const row = await db
    .selectFrom('certificates as c')
    .innerJoin('certificateTemplateVersions as v', 'v.id', 'c.templateVersionId')
    .select([
      'c.id',
      'c.code',
      'c.templateVersionId',
      'v.html',
      'c.studentName',
      'c.courseTitle',
      'c.instructorName',
      'c.hours',
      'c.completedAt',
      'c.issuedAt',
      'c.schoolName',
      'c.signerName',
      'c.signerRole',
    ])
    .where('c.id', '=', certificateId.toLowerCase())
    .executeTakeFirst();
  if (!row || row.studentName === null) return null;
  return {
    certificateId: row.id,
    code: row.code,
    templateVersionId: row.templateVersionId,
    html: row.html,
    data: {
      studentName: row.studentName,
      courseTitle: row.courseTitle,
      hours: row.hours,
      instructorName: row.instructorName,
      completedAt: row.completedAt,
      issuedAt: row.issuedAt,
      code: row.code,
      schoolName: row.schoolName,
      signerName: row.signerName,
      signerRole: row.signerRole,
    },
  };
}

/**
 * `saved`: PDF gravado. `stale`: o certificado foi reemitido depois da leitura (outro nome ou
 * outra versão do template); a tarefa `certificate.render` da reemissão gera o PDF certo.
 * `gone`: o certificado não existe mais ou o titular excluiu a conta.
 */
export type SaveCertificatePdfResult = 'saved' | 'stale' | 'gone';

/**
 * Grava o PDF gerado a partir de `job`, só se o certificado ainda tem o nome e a versão do
 * template com que foi renderizado. PDF vazio ou acima de 2 MiB: `RangeError` (falha da tarefa,
 * spec 015, "PDF"). Dono da escrita: worker.
 */
export async function saveCertificatePdf(
  db: Database,
  job: Pick<CertificateRenderJob, 'certificateId' | 'templateVersionId' | 'data'>,
  pdf: Uint8Array,
): Promise<SaveCertificatePdfResult> {
  assertCertificatePdfSize(pdf);
  const updated = await db
    .updateTable('certificates')
    .set({ pdf: Buffer.from(pdf), pdfRenderedAt: sql`now()` })
    .where('id', '=', job.certificateId)
    .where('templateVersionId', '=', job.templateVersionId)
    .where('studentName', '=', job.data.studentName)
    .returning('id')
    .executeTakeFirst();
  if (updated) return 'saved';
  const current = await db
    .selectFrom('certificates')
    .select('studentName')
    .where('id', '=', job.certificateId)
    .executeTakeFirst();
  return current && current.studentName !== null ? 'stale' : 'gone';
}

/** PDF de 1 byte a 2 MiB; fora disso, `RangeError`. */
export function assertCertificatePdfSize(pdf: Uint8Array): void {
  if (pdf.byteLength === 0 || pdf.byteLength > CERTIFICATE_PDF_MAX_BYTES) {
    throw new RangeError(
      `PDF com ${pdf.byteLength} bytes: o limite é de 1 a ${CERTIFICATE_PDF_MAX_BYTES} bytes.`,
    );
  }
}
