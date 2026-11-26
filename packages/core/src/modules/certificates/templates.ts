// Templates de certificado (spec 015, "Template" e "Versões"; ADR 0026): o do curso
// (`certificate.template.edit`, o instrutor só nos próprios cursos) e o padrão da escola
// (`settings.manage`). Cada gravação cria uma versão imutável; passar de "sem template efetivo"
// a "com" enfileira a emissão retroativa na mesma transação. Dono da escrita: admin-api.

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { conflict, type FieldError, validationFailed } from '../../errors/domain-error.ts';
import { managementAuditContext } from '../accounts/management/common.ts';
import { recordAudit } from '../audit/record.ts';
import { isCatalogId } from '../catalog/fields.ts';
import { JOB_DEFINITIONS } from '../jobs/registry.ts';
import { getSettings } from '../settings/settings.ts';
import {
  type CertificateRequest,
  type CertificateUserRef,
  certificateUserRef,
  loadCertificateCourse,
  requireCertificateAction,
} from './common.ts';
import {
  CERTIFICATE_TEMPLATE_MAX_PROBLEMS,
  type CertificateTemplateProblem,
  certificateTemplateInvalid,
} from './template/problems.ts';
import {
  type CertificateTemplateReference,
  certificateTemplateReference,
} from './template/reference.ts';
import {
  type CertificateTemplateImageRef,
  validateCertificateTemplate,
} from './template/validate.ts';

export const CERTIFICATE_TEMPLATE_SOURCES = ['course', 'school', 'none'] as const;
/** Origem do template efetivo: o do curso, o padrão da escola ou nenhum. */
export type CertificateTemplateSource = (typeof CERTIFICATE_TEMPLATE_SOURCES)[number];

/** `CertificateTemplate` do contrato: o template do recurso e a origem do efetivo. */
export interface CertificateTemplateView {
  source: CertificateTemplateSource;
  /** O template deste recurso (do curso ou o padrão); `null` quando não tem. */
  html: string | null;
  /** Versão atual, devolvida em `expectedVersionId`. */
  versionId: string | null;
  updatedAt: Date | null;
  updatedBy: CertificateUserRef | null;
}

/** `CertificateTemplateSaved` do contrato. */
export interface CertificateTemplateSaved extends CertificateTemplateView {
  html: string;
  versionId: string;
  updatedAt: Date;
  /** Verdadeiro quando a gravação enfileirou a emissão retroativa. */
  backfillQueued: boolean;
}

export interface SaveCertificateTemplateInput {
  html: unknown;
  /** A versão que o editor abriu; `null` quando não havia template. */
  expectedVersionId: unknown;
}

/** `unique_key` de `certificate.backfill`: um lote ativo por curso. */
export function certificateBackfillKey(courseId: string): string {
  return `certificate.backfill:${courseId.toLowerCase()}`;
}

/** Cursos por `INSERT` ao enfileirar o lote do padrão da escola. */
const BACKFILL_ENQUEUE_CHUNK = 500;

/** Linha e coluna (a partir de 1) de uma posição do texto. */
function positionOf(html: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = html.indexOf('\n'); index !== -1 && index < offset; ) {
    line += 1;
    lineStart = index + 1;
    index = html.indexOf('\n', lineStart);
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Problemas `image_not_found`: variante citada (`/api/v1/images/<id>/<largura>.webp`) que não
 * existe na instalação, ou cuja imagem está oculta pela moderação. Uma consulta; nenhuma sem
 * imagem citada.
 */
async function missingImageProblems(
  db: Database,
  html: string,
  images: readonly CertificateTemplateImageRef[],
): Promise<CertificateTemplateProblem[]> {
  if (images.length === 0) return [];
  const ids = [...new Set(images.map((image) => image.id))];
  const found = await sql<{ imageId: string; width: number }>`
    SELECT v.image_id, v.width
      FROM image_variants v
      JOIN images i ON i.id = v.image_id AND i.hidden_at IS NULL
     WHERE v.image_id = ANY(${ids}::uuid[])`.execute(db);
  const available = new Set(found.rows.map((row) => `${row.imageId}/${row.width}`));
  return images
    .filter((image) => !available.has(`${image.id}/${image.width}`))
    .map((image) => ({
      rule: 'image_not_found' as const,
      message: `A imagem ${image.path} não existe nesta instalação.`,
      ...positionOf(html, Math.max(0, html.indexOf(image.path))),
    }));
}

/**
 * Valida o template como na gravação e no pedido de exemplo (spec 015, RF-10): palavras-chave e
 * lista de permissões (tarefa 466) e a existência das imagens citadas. Com qualquer problema:
 * `422` `certificate_template_invalid`, com a lista (até 200) em `details.problems`. `html` que
 * não é texto, ou vazio: `400`.
 */
export async function assertCertificateTemplateValid(db: Database, html: unknown): Promise<string> {
  if (typeof html !== 'string' || html.length === 0) {
    throw validationFailed([{ path: 'body.html', message: 'Informe o HTML do template.' }]);
  }
  const validation = validateCertificateTemplate(html);
  const problems = [
    ...validation.problems,
    ...(await missingImageProblems(db, html, validation.images)),
  ].slice(0, CERTIFICATE_TEMPLATE_MAX_PROBLEMS);
  if (problems.length > 0) throw certificateTemplateInvalid(problems);
  return html;
}

function readExpectedVersionId(value: unknown): string | null {
  if (value === null) return null;
  if (!isCatalogId(value)) {
    const errors: FieldError[] = [
      { path: 'body.expectedVersionId', message: 'Informe a versão aberta, ou nulo.' },
    ];
    throw validationFailed(errors);
  }
  return value.toLowerCase();
}

/** Serializa as gravações de template: a transição "sem efetivo → com" é decidida sem corrida. */
async function lockTemplates(trx: Database): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext('nuva.certificate_templates'))`.execute(trx);
}

interface TemplateRow {
  versionId: string;
  html: string;
  updatedAt: Date;
  updatedById: string;
  updatedByName: string;
  updatedByDeletedAt: Date | null;
}

/** O template do recurso (`courseId` nulo: o padrão da escola), com o HTML da versão atual. */
async function readTemplate(db: Database, courseId: string | null): Promise<TemplateRow | null> {
  const row = await db
    .selectFrom('certificateTemplates as t')
    .innerJoin('certificateTemplateVersions as v', 'v.id', 't.versionId')
    .innerJoin('users as u', 'u.id', 't.updatedBy')
    .select([
      't.versionId',
      'v.html',
      't.updatedAt',
      'u.id as updatedById',
      'u.name as updatedByName',
      'u.deletedAt as updatedByDeletedAt',
    ])
    .where((eb) =>
      courseId === null ? eb('t.courseId', 'is', null) : eb('t.courseId', '=', courseId),
    )
    .executeTakeFirst();
  return row ?? null;
}

async function hasSchoolTemplate(db: Database): Promise<boolean> {
  const row = await db
    .selectFrom('certificateTemplates')
    .select('id')
    .where('courseId', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

function toView(
  row: TemplateRow | null,
  source: CertificateTemplateSource,
): CertificateTemplateView {
  return {
    source,
    html: row?.html ?? null,
    versionId: row?.versionId ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row
      ? certificateUserRef(row.updatedById, row.updatedByName, row.updatedByDeletedAt)
      : null,
  };
}

async function courseTemplateView(
  db: Database,
  courseId: string,
): Promise<CertificateTemplateView> {
  const own = await readTemplate(db, courseId);
  if (own) return toView(own, 'course');
  return toView(null, (await hasSchoolTemplate(db)) ? 'school' : 'none');
}

async function schoolTemplateView(db: Database): Promise<CertificateTemplateView> {
  const row = await readTemplate(db, null);
  return toView(row, row ? 'school' : 'none');
}

/** Grava a versão nova e aponta o template para ela; devolve a versão anterior, se havia. */
async function writeTemplate(
  trx: Database,
  request: CertificateRequest,
  courseId: string | null,
  html: string,
  expectedVersionId: string | null,
): Promise<{ versionId: string; previousVersionId: string | null }> {
  const current = await trx
    .selectFrom('certificateTemplates')
    .select(['id', 'versionId'])
    .where((eb) => (courseId === null ? eb('courseId', 'is', null) : eb('courseId', '=', courseId)))
    .forUpdate()
    .executeTakeFirst();
  if ((current?.versionId ?? null) !== expectedVersionId) {
    throw conflict('version_conflict', 'O template foi alterado por outra pessoa. Recarregue.');
  }
  const version = await trx
    .insertInto('certificateTemplateVersions')
    .values({ courseId, html, createdBy: request.actor.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (current) {
    await trx
      .updateTable('certificateTemplates')
      .set({ versionId: version.id, updatedBy: request.actor.id })
      .where('id', '=', current.id)
      .execute();
  } else {
    await trx
      .insertInto('certificateTemplates')
      .values({ courseId, versionId: version.id, updatedBy: request.actor.id })
      .execute();
  }
  return { versionId: version.id, previousVersionId: current?.versionId ?? null };
}

/** Enfileira `certificate.backfill` dos cursos, um `INSERT` por lote; quem já tem lote ativo fica. */
async function enqueueBackfills(trx: Database, courseIds: readonly string[]): Promise<void> {
  const definition = JOB_DEFINITIONS['certificate.backfill'];
  for (let start = 0; start < courseIds.length; start += BACKFILL_ENQUEUE_CHUNK) {
    await trx
      .insertInto('jobs')
      .values(
        courseIds.slice(start, start + BACKFILL_ENQUEUE_CHUNK).map((courseId) => ({
          type: 'certificate.backfill',
          payload: JSON.stringify({ courseId }),
          priority: definition.priority,
          maxAttempts: definition.maxAttempts,
          uniqueKey: certificateBackfillKey(courseId),
        })),
      )
      .onConflict((oc) =>
        // Predicado idêntico ao do índice parcial da fila (ver `enqueue`).
        oc.column('uniqueKey').where(sql<boolean>`status IN ('queued', 'running')`).doNothing(),
      )
      .execute();
  }
}

/**
 * Enfileira o lote de um curso (com a `unique_key` do curso: havendo um lote ativo, nada é
 * criado). Usada também pelo pedido manual de `backfill`.
 */
export async function enqueueCertificateBackfill(trx: Database, courseId: string): Promise<void> {
  await enqueueBackfills(trx, [courseId.toLowerCase()]);
}

const UTF8 = new TextEncoder();

function templateAuditDetails(html: string, versionId: string, previousVersionId: string | null) {
  // Nunca o HTML (spec 028): só a versão e o tamanho.
  return { versionId, previousVersionId, htmlBytes: UTF8.encode(html).length };
}

// Template do curso.

async function requireCourseTemplate(
  db: Database,
  request: CertificateRequest,
  courseId: unknown,
  auditAction?: string,
) {
  const scope = await requireCertificateAction(db, request, 'certificate.template.edit', {
    ...(auditAction === undefined ? {} : { action: auditAction }),
    targetType: 'course',
    targetId: isCatalogId(courseId) ? courseId.toLowerCase() : null,
  });
  return loadCertificateCourse(db, request, scope, courseId);
}

/**
 * `GET /courses/{id}/certificate-template`: o template do curso (ou nulo) e a origem do efetivo.
 * Curso inexistente ou alheio ao instrutor: `404`.
 */
export async function getCourseCertificateTemplate(
  db: Database,
  request: CertificateRequest,
  courseId: unknown,
): Promise<CertificateTemplateView> {
  const course = await requireCourseTemplate(db, request, courseId);
  return courseTemplateView(db, course.id);
}

/**
 * `PUT /courses/{id}/certificate-template`: valida (`422` `certificate_template_invalid`), grava
 * uma versão nova e aponta o template para ela. `expectedVersionId` diferente da versão atual:
 * `409` `version_conflict`. Se o curso não tinha template efetivo (nem próprio nem o padrão) e
 * está com o certificado habilitado, enfileira `certificate.backfill` na mesma transação
 * (`backfillQueued`); editar um template que já existia, ou passar do padrão ao próprio, não
 * enfileira. Auditoria `certificate_template.update`, sem o HTML.
 */
export async function saveCourseCertificateTemplate(
  db: Database,
  request: CertificateRequest,
  courseId: unknown,
  input: SaveCertificateTemplateInput,
): Promise<CertificateTemplateSaved> {
  const course = await requireCourseTemplate(db, request, courseId, 'certificate_template.update');
  const expectedVersionId = readExpectedVersionId(input.expectedVersionId);
  const html = await assertCertificateTemplateValid(db, input.html);
  return db.transaction().execute(async (trx) => {
    await lockTemplates(trx);
    const hadEffective =
      (await hasSchoolTemplate(trx)) || (await readTemplate(trx, course.id)) !== null;
    const written = await writeTemplate(trx, request, course.id, html, expectedVersionId);
    const backfillQueued = !hadEffective && course.certificateEnabled;
    if (backfillQueued) await enqueueBackfills(trx, [course.id]);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'certificate_template.update',
      targetType: 'course',
      targetId: course.id,
      details: {
        ...templateAuditDetails(html, written.versionId, written.previousVersionId),
        backfillQueued,
      },
    });
    const view = await courseTemplateView(trx, course.id);
    return { ...(view as CertificateTemplateSaved), backfillQueued };
  });
}

/**
 * `DELETE /courses/{id}/certificate-template`: o curso volta ao padrão da escola (ou a nenhum).
 * Certificados emitidos não mudam, e as versões ficam para o expurgo. Sem template próprio, nada
 * muda (nem auditoria). Devolve o estado novo.
 */
export async function deleteCourseCertificateTemplate(
  db: Database,
  request: CertificateRequest,
  courseId: unknown,
): Promise<CertificateTemplateView> {
  const course = await requireCourseTemplate(db, request, courseId, 'certificate_template.delete');
  return db.transaction().execute(async (trx) => {
    await lockTemplates(trx);
    const removed = await trx
      .deleteFrom('certificateTemplates')
      .where('courseId', '=', course.id)
      .returning('versionId')
      .executeTakeFirst();
    if (removed) {
      await recordAudit(trx, {
        context: managementAuditContext(request),
        action: 'certificate_template.delete',
        targetType: 'course',
        targetId: course.id,
        details: { versionId: removed.versionId },
      });
    }
    return courseTemplateView(trx, course.id);
  });
}

// Template padrão da escola.

async function requireSchoolTemplate(
  db: Database,
  request: CertificateRequest,
  auditAction?: string,
): Promise<void> {
  await requireCertificateAction(
    db,
    request,
    'settings.manage',
    auditAction === undefined ? {} : { action: auditAction },
  );
}

/** `GET /settings/certificate-template`: o padrão da escola, ou nulo (`source` = `none`). */
export async function getSchoolCertificateTemplate(
  db: Database,
  request: CertificateRequest,
): Promise<CertificateTemplateView> {
  await requireSchoolTemplate(db, request);
  return schoolTemplateView(db);
}

/**
 * `PUT /settings/certificate-template`: como o do curso. Quando não havia padrão, enfileira
 * `certificate.backfill` para cada curso com certificado habilitado e sem template próprio, na
 * mesma transação (`backfillQueued` verdadeiro se houver ao menos um). Alvo da auditoria: a
 * escola (`target_type` = `school`).
 */
export async function saveSchoolCertificateTemplate(
  db: Database,
  request: CertificateRequest,
  input: SaveCertificateTemplateInput,
): Promise<CertificateTemplateSaved> {
  await requireSchoolTemplate(db, request, 'certificate_template.update');
  const expectedVersionId = readExpectedVersionId(input.expectedVersionId);
  const html = await assertCertificateTemplateValid(db, input.html);
  return db.transaction().execute(async (trx) => {
    await lockTemplates(trx);
    const written = await writeTemplate(trx, request, null, html, expectedVersionId);
    let backfillCourses = 0;
    if (written.previousVersionId === null) {
      const courses = await sql<{ id: string }>`
        SELECT c.id
          FROM courses c
         WHERE c.certificate_enabled
           AND NOT EXISTS (SELECT 1 FROM certificate_templates t WHERE t.course_id = c.id)
         ORDER BY c.id`.execute(trx);
      backfillCourses = courses.rows.length;
      await enqueueBackfills(
        trx,
        courses.rows.map((row) => row.id),
      );
    }
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'certificate_template.update',
      targetType: 'school',
      details: {
        ...templateAuditDetails(html, written.versionId, written.previousVersionId),
        backfillCourses,
      },
    });
    const view = await schoolTemplateView(trx);
    return { ...(view as CertificateTemplateSaved), backfillQueued: backfillCourses > 0 };
  });
}

/**
 * `DELETE /settings/certificate-template`: os cursos sem template próprio passam a não ter
 * template efetivo. Certificados emitidos não mudam. Sem padrão, nada muda.
 */
export async function deleteSchoolCertificateTemplate(
  db: Database,
  request: CertificateRequest,
): Promise<CertificateTemplateView> {
  await requireSchoolTemplate(db, request, 'certificate_template.delete');
  return db.transaction().execute(async (trx) => {
    await lockTemplates(trx);
    const removed = await trx
      .deleteFrom('certificateTemplates')
      .where('courseId', 'is', null)
      .returning('versionId')
      .executeTakeFirst();
    if (removed) {
      await recordAudit(trx, {
        context: managementAuditContext(request),
        action: 'certificate_template.delete',
        targetType: 'school',
        details: { versionId: removed.versionId },
      });
    }
    return schoolTemplateView(trx);
  });
}

// Referência do editor.

/**
 * `GET /certificate-templates/reference` (`certificate.template.edit`): as 13 palavras-chave,
 * com o exemplo do PDF de exemplo no idioma (`locale`, o `NUVA_LOCALE`) e no fuso da escola, e o
 * modelo inicial. `classroomUrl` (`Config.classroomUrl`) monta a URL de validação do exemplo.
 */
export async function getCertificateTemplateReference(
  db: Database,
  request: CertificateRequest,
  options: { locale: string; classroomUrl: string; now?: Date },
): Promise<CertificateTemplateReference> {
  await requireCertificateAction(db, request, 'certificate.template.edit');
  const settings = await getSettings(db);
  return certificateTemplateReference({
    now: options.now ?? new Date(),
    schoolName: settings['school.name'],
    signerName: settings['certificate.signer_name'],
    signerRole: settings['certificate.signer_role'],
    locale: options.locale,
    timeZone: settings['school.timezone'],
    classroomUrl: options.classroomUrl,
  });
}
