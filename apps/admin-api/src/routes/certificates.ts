import type { FastifyInstance, FastifyReply } from '@nuva-edu/api-kit';
import {
  type CertificatePdfFile,
  type CertificatePreviewView,
  type CertificateTemplateSaved,
  type CertificateTemplateView,
  type CertificateUserRef,
  type CertificateView,
  type Config,
  createCertificatePreview,
  type Database,
  deleteCourseCertificateTemplate,
  deleteSchoolCertificateTemplate,
  getCertificatePdf,
  getCertificatePreview,
  getCertificatePreviewPdf,
  getCertificateSettings,
  getCertificateTemplateReference,
  getCourseCertificateTemplate,
  getSchoolCertificateTemplate,
  issueCertificateManually,
  listCertificates,
  reissueCertificate,
  requestCertificateBackfill,
  restoreCertificate,
  revokeCertificate,
  type SettingsReader,
  saveCourseCertificateTemplate,
  saveSchoolCertificateTemplate,
  updateCertificateSettings,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';
import { type IdParams, iso, isoOrNull } from './catalog-common.ts';

// Certificados pela equipe (spec 015): lista, PDF para conferência, emissão manual, revogação e
// restauração, reemissão, emissão retroativa, templates (do curso e o padrão da escola), a
// referência do editor, os PDFs de exemplo e o signatário. O tratador de `sessionCookie` confere
// a permissão de `x-permission` (só o admin revoga e restaura; gerente e admin emitem e
// reemitem; o instrutor alcança só os próprios cursos); o núcleo confere de novo, aplica o
// alcance (`404` fora dele) e grava a auditoria na transação da ação. Aqui só transporte.

export interface CertificateRoutesOptions {
  db: Database;
  config: Config;
  /** O leitor de configurações do processo: descartado depois de gravar o signatário. */
  settings: SettingsReader;
}

const userRefBody = (user: CertificateUserRef | null) =>
  user === null ? null : { id: user.id, name: user.name };

/** `Certificate` do contrato. */
function certificateBody(view: CertificateView) {
  return {
    id: view.id,
    code: view.code,
    state: view.state,
    user: userRefBody(view.user),
    course: { type: view.course.type, id: view.course.id, title: view.course.title },
    studentName: view.studentName,
    courseTitle: view.courseTitle,
    instructorName: view.instructorName,
    hours: view.hours,
    completedAt: iso(view.completedAt),
    issuedAt: iso(view.issuedAt),
    issuedManually: view.issuedManually,
    issuedBy: userRefBody(view.issuedBy),
    issueReason: view.issueReason,
    revokedAt: isoOrNull(view.revokedAt),
    revokedBy: userRefBody(view.revokedBy),
    revokeReason: view.revokeReason,
    pdfRenderedAt: isoOrNull(view.pdfRenderedAt),
    templateVersionId: view.templateVersionId,
  };
}

/** `CertificateTemplate` do contrato. */
function templateBody(view: CertificateTemplateView) {
  return {
    source: view.source,
    html: view.html,
    versionId: view.versionId,
    updatedAt: isoOrNull(view.updatedAt),
    updatedBy: userRefBody(view.updatedBy),
  };
}

/** `CertificateTemplateSaved` do contrato. */
function savedTemplateBody(saved: CertificateTemplateSaved) {
  return { ...templateBody(saved), backfillQueued: saved.backfillQueued };
}

/** `CertificatePreview` do contrato. */
function previewBody(preview: CertificatePreviewView) {
  return {
    id: preview.id,
    courseId: preview.courseId,
    status: preview.status,
    error: preview.error,
    createdAt: iso(preview.createdAt),
    renderedAt: isoOrNull(preview.renderedAt),
    expiresAt: iso(preview.expiresAt),
  };
}

/**
 * Resposta `Pdf` do contrato: o arquivo como anexo, com o nome sugerido. O `Cache-Control:
 * no-store` vem da opção `noStore` da operação (também nas respostas de erro).
 */
function sendPdf(reply: FastifyReply, file: CertificatePdfFile) {
  return reply
    .status(200)
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${file.filename}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .send(file.pdf);
}

type TemplateBody = { html: string; expectedVersionId: string | null };

export function registerCertificateRoutes(
  app: FastifyInstance,
  options: CertificateRoutesOptions,
): void {
  const { db, config, settings } = options;

  // Certificados.

  // `GET /api/v1/certificates`: mais recentes primeiro; o instrutor só os dos próprios cursos.
  app.operation('listCertificates', async (request) => {
    const query = request.query as {
      courseId?: string;
      userId?: string;
      state?: string;
      code?: string;
      limit?: number;
      cursor?: string;
    };
    const page = await listCertificates(db, managementRequest(request), query);
    return { items: page.items.map(certificateBody), nextCursor: page.nextCursor };
  });

  // `POST /api/v1/certificates`: emissão manual, `201` em preparação.
  app.operation('issueCertificate', async (request, reply) => {
    const body = request.body as { userId: string; courseId: string; reason: string };
    const view = await issueCertificateManually(db, managementRequest(request), {
      userId: body.userId,
      courseId: body.courseId,
      reason: body.reason,
    });
    return reply.status(201).send(certificateBody(view));
  });

  // `POST /api/v1/certificates/{id}/revoke`: só o admin, com motivo.
  app.operation('revokeCertificate', async (request) => {
    const { id } = request.params as IdParams;
    const { reason } = request.body as { reason: string };
    return certificateBody(await revokeCertificate(db, managementRequest(request), id, { reason }));
  });

  // `POST /api/v1/certificates/{id}/restore`: só o admin.
  app.operation('restoreCertificate', async (request) => {
    const { id } = request.params as IdParams;
    return certificateBody(await restoreCertificate(db, managementRequest(request), id));
  });

  // `POST /api/v1/certificates/{id}/reissue`: mantém o código; volta a `preparing`.
  app.operation('reissueCertificate', async (request) => {
    const { id } = request.params as IdParams;
    return certificateBody(await reissueCertificate(db, managementRequest(request), id));
  });

  // `GET /api/v1/certificates/{id}/pdf`: o PDF que o aluno recebeu, também de revogado. Leitura
  // comum: sem auditoria (spec 028).
  app.operation(
    'getCertificatePdf',
    async (request, reply) => {
      const { id } = request.params as IdParams;
      return sendPdf(reply, await getCertificatePdf(db, managementRequest(request), id));
    },
    { noStore: true },
  );

  // `POST /api/v1/courses/{id}/certificates/backfill`: `202`, lote enfileirado.
  app.operation('backfillCourseCertificates', async (request, reply) => {
    const { id } = request.params as IdParams;
    const queued = await requestCertificateBackfill(db, managementRequest(request), id);
    return reply.status(202).send({ courseId: queued.courseId, queued: queued.queued });
  });

  // Template do curso.

  app.operation('getCourseCertificateTemplate', async (request) => {
    const { id } = request.params as IdParams;
    return templateBody(await getCourseCertificateTemplate(db, managementRequest(request), id));
  });

  // O corpo vai até o limite padrão de 1 MB da API; o template em si, até 768 KiB (núcleo).
  app.operation('saveCourseCertificateTemplate', async (request) => {
    const { id } = request.params as IdParams;
    const body = request.body as TemplateBody;
    const saved = await saveCourseCertificateTemplate(db, managementRequest(request), id, {
      html: body.html,
      expectedVersionId: body.expectedVersionId,
    });
    return savedTemplateBody(saved);
  });

  app.operation('deleteCourseCertificateTemplate', async (request) => {
    const { id } = request.params as IdParams;
    return templateBody(await deleteCourseCertificateTemplate(db, managementRequest(request), id));
  });

  // Template padrão da escola.

  app.operation('getSchoolCertificateTemplate', async (request) =>
    templateBody(await getSchoolCertificateTemplate(db, managementRequest(request))),
  );

  app.operation('saveSchoolCertificateTemplate', async (request) => {
    const body = request.body as TemplateBody;
    const saved = await saveSchoolCertificateTemplate(db, managementRequest(request), {
      html: body.html,
      expectedVersionId: body.expectedVersionId,
    });
    return savedTemplateBody(saved);
  });

  app.operation('deleteSchoolCertificateTemplate', async (request) =>
    templateBody(await deleteSchoolCertificateTemplate(db, managementRequest(request))),
  );

  // Editor: referência e PDFs de exemplo.

  // `GET /api/v1/certificate-templates/reference`: exemplos no `NUVA_LOCALE` e no fuso da escola.
  app.operation('getCertificateTemplateReference', async (request) => {
    const reference = await getCertificateTemplateReference(db, managementRequest(request), {
      locale: config.locale,
      classroomUrl: config.classroomUrl,
    });
    return {
      keys: reference.keys.map((key) => ({
        key: key.key,
        placeholder: key.placeholder,
        description: key.description,
        example: key.example,
        required: key.required,
        requiredOneOf: key.requiredOneOf,
      })),
      modelHtml: reference.modelHtml,
    };
  });

  // `POST /api/v1/certificate-templates/previews`: `202`, pedido em `pending`.
  app.operation('createCertificatePreview', async (request, reply) => {
    const body = request.body as { html: string; courseId?: string | null };
    const preview = await createCertificatePreview(db, managementRequest(request), {
      html: body.html,
      ...(body.courseId === undefined ? {} : { courseId: body.courseId }),
    });
    return reply.status(202).send(previewBody(preview));
  });

  app.operation('getCertificatePreview', async (request) => {
    const { id } = request.params as IdParams;
    return previewBody(await getCertificatePreview(db, managementRequest(request), id));
  });

  app.operation(
    'getCertificatePreviewPdf',
    async (request, reply) => {
      const { id } = request.params as IdParams;
      return sendPdf(reply, await getCertificatePreviewPdf(db, managementRequest(request), id));
    },
    { noStore: true },
  );

  // Signatário.

  app.operation('getCertificateSettings', async (request) => {
    const current = await getCertificateSettings(db, managementRequest(request));
    return {
      signerName: current.signerName,
      signerRole: current.signerRole,
      schoolName: current.schoolName,
    };
  });

  app.operation('saveCertificateSettings', async (request) => {
    const body = request.body as { signerName: string | null; signerRole: string | null };
    const saved = await updateCertificateSettings(db, managementRequest(request), {
      signerName: body.signerName,
      signerRole: body.signerRole,
    });
    // Depois de confirmada a transação: a próxima leitura do processo vai ao banco.
    settings.invalidate();
    return {
      signerName: saved.signerName,
      signerRole: saved.signerRole,
      schoolName: saved.schoolName,
    };
  });
}
