// Manipuladores dos certificados (spec 015; spec 005): `course.completed`,
// `course.completion_check`, `certificate.backfill`, `certificate.render` e `certificate.preview`.
// As regras (quem recebe, dados congelados, gravação do PDF) são do `packages/core`; aqui ficam a
// montagem do HTML (valores, QR, imagens em `data:`) e a renderização pelo navegador.
// Todos idempotentes. O log leva só identificadores e desfechos, nunca o nome do aluno.

import {
  type CertificateTemplateData,
  certificateTemplateValues,
  certificateValidationUrl,
  type Database,
  enqueueCourseCompletions,
  failCertificatePreview,
  fillCertificateTemplate,
  getCertificatePreviewJob,
  getCertificateRenderJob,
  getImageVariant,
  getSettings,
  isDomainError,
  issueCertificateOnCompletion,
  type JobHandlers,
  type Logger,
  PermanentJobError,
  runCertificateBackfill,
  saveCertificatePdf,
  saveCertificatePreviewPdf,
  validateCertificateTemplate,
} from '@nuva-edu/core';
import QRCode from 'qrcode';
import { CertificateRenderError, type CertificateRenderer } from './renderer.ts';

export interface CertificateHandlerDependencies {
  db: Database;
  logger: Logger;
  renderer: CertificateRenderer;
  /** `config.classroomUrl`: a URL de validação. */
  classroomUrl: string;
  /** `config.locale` (`NUVA_LOCALE`): o idioma das datas. */
  locale: string;
}

type CertificateJobType =
  | 'course.completed'
  | 'course.completion_check'
  | 'certificate.backfill'
  | 'certificate.render'
  | 'certificate.preview';

/** O HTML preenchido e as imagens que faltaram (apagadas depois de salvar o template). */
interface BuiltDocument {
  html: string;
  missingImages: string[];
}

/** SVG do QR da URL de validação (`qrcode`), sem margem: o tamanho é do CSS do template. */
export function certificateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}

/**
 * Troca o caminho de cada imagem da instalação citada pelos bytes da variante, em `data:`.
 * Imagem apagada ou oculta fica de fora (o preenchimento a troca por um espaço vazio).
 */
async function loadTemplateImages(db: Database, html: string): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  for (const image of validateCertificateTemplate(html).images) {
    try {
      const variant = await getImageVariant(db, image.id, image.width);
      images[image.path] = `data:image/webp;base64,${variant.data.toString('base64')}`;
    } catch (error) {
      if (!isDomainError(error) || error.code !== 'not_found') {
        throw error;
      }
    }
  }
  return images;
}

/** Valida de novo, preenche as palavras-chave, gera o QR e embute as imagens. */
export async function buildCertificateDocument(
  deps: Pick<CertificateHandlerDependencies, 'db' | 'classroomUrl' | 'locale'>,
  html: string,
  data: CertificateTemplateData,
): Promise<BuiltDocument> {
  const settings = await getSettings(deps.db);
  const values = certificateTemplateValues(data, {
    locale: deps.locale,
    timeZone: settings['school.timezone'],
    classroomUrl: deps.classroomUrl,
  });
  const qrSvg = await certificateQrSvg(certificateValidationUrl(deps.classroomUrl, data.code));
  const images = await loadTemplateImages(deps.db, html);
  return fillCertificateTemplate(html, values, { qrSvg, images });
}

/** Regras recusadas do template (sem o texto do template, que pode ter dado pessoal). */
function templateProblemRules(error: unknown): string[] | null {
  if (!isDomainError(error) || error.code !== 'certificate_template_invalid') {
    return null;
  }
  const details = error.extras?.details as { problems?: { rule: string }[] } | undefined;
  return [...new Set((details?.problems ?? []).map((problem) => problem.rule))];
}

/** Motivo gravado no pedido de exemplo que falhou (o editor o vê). */
function previewFailureReason(error: unknown): string {
  const rules = templateProblemRules(error);
  if (rules !== null) {
    return `O template não passou na validação (${rules.join(', ')}).`;
  }
  if (error instanceof CertificateRenderError) {
    return error.message;
  }
  return 'Falha ao gerar o PDF de exemplo.';
}

function isTemplateRenderFailure(error: unknown): boolean {
  return error instanceof CertificateRenderError && error.reason !== 'browser';
}

export function createCertificateHandlers(
  deps: CertificateHandlerDependencies,
): Pick<Required<JobHandlers>, CertificateJobType> {
  const { db, logger, renderer } = deps;

  return {
    // Emissão (spec 015): o núcleo confere tudo na hora e cria um só certificado por (aluno,
    // curso), mesmo com duas tarefas simultâneas. Nenhum desfecho além de erro é falha.
    'course.completed': async (job, context) => {
      context.signal.throwIfAborted();
      const result = await issueCertificateOnCompletion(db, job.payload);
      logger.info(
        {
          job_id: job.id,
          course_id: job.payload.courseId,
          outcome: result.outcome,
          certificate_id: result.certificateId,
        },
        'Conclusão de curso processada',
      );
    },
    // Aula despublicada ou excluída (spec 014): enfileira `course.completed` de quem tem 100%.
    'course.completion_check': async (job, context) => {
      context.signal.throwIfAborted();
      const result = await enqueueCourseCompletions(db, job.payload.courseId);
      logger.info(
        { job_id: job.id, course_id: job.payload.courseId, ...result },
        'Conclusões do curso conferidas',
      );
    },
    // Lote retroativo (spec 015): repetir é seguro; abortado, volta à fila e retoma.
    'certificate.backfill': async (job, context) => {
      const result = await runCertificateBackfill(db, job.payload.courseId, {
        signal: context.signal,
      });
      context.signal.throwIfAborted();
      logger.info(
        { job_id: job.id, course_id: job.payload.courseId, ...result },
        'Lote de certificados processado',
      );
    },
    // PDF do certificado, com a versão do template guardada nele. Falha de navegador, tempo ou
    // tamanho repete (spec 005); template que deixou de passar na validação não melhora.
    'certificate.render': async (job, context) => {
      context.signal.throwIfAborted();
      const render = await getCertificateRenderJob(db, job.payload.certificateId);
      const log = { job_id: job.id, certificate_id: job.payload.certificateId };
      if (!render) {
        logger.info({ ...log, outcome: 'gone' }, 'Certificado sem PDF a gerar');
        return;
      }
      let document: BuiltDocument;
      try {
        document = await buildCertificateDocument(deps, render.html, render.data);
      } catch (error) {
        const rules = templateProblemRules(error);
        if (rules !== null) {
          throw new PermanentJobError(
            `certificate.render: o template ${render.templateVersionId} não passa na validação (${rules.join(', ')})`,
          );
        }
        throw error;
      }
      if (document.missingImages.length > 0) {
        logger.warn(
          { ...log, images: document.missingImages },
          'Imagem do template não existe mais; o lugar fica vazio',
        );
      }
      const pdf = await renderer.render(document.html, {
        kind: 'certificate',
        signal: context.signal,
      });
      const outcome = await saveCertificatePdf(db, render, pdf);
      logger.info({ ...log, outcome, bytes: pdf.byteLength }, 'PDF do certificado gerado');
    },
    // PDF de exemplo (spec 015, "Pré-visualização"): falha grava `failed` com o motivo.
    'certificate.preview': async (job, context) => {
      context.signal.throwIfAborted();
      const previewId = job.payload.previewId;
      const preview = await getCertificatePreviewJob(db, previewId);
      const log = { job_id: job.id, preview_id: previewId };
      if (!preview) {
        logger.info({ ...log, outcome: 'gone' }, 'Pedido de exemplo já resolvido ou apagado');
        return;
      }
      let pdf: Uint8Array;
      try {
        const document = await buildCertificateDocument(deps, preview.html, preview.data);
        if (document.missingImages.length > 0) {
          logger.warn({ ...log, images: document.missingImages }, 'Imagem do exemplo não existe');
        }
        pdf = await renderer.render(document.html, { kind: 'preview', signal: context.signal });
      } catch (error) {
        // Encerramento do worker: o pedido continua `pending` e a tarefa volta à fila.
        context.signal.throwIfAborted();
        await failCertificatePreview(db, previewId, previewFailureReason(error));
        logger.warn({ ...log, err: error, outcome: 'failed' }, 'PDF de exemplo falhou');
        // Problema do template (validação, tempo, tamanho) é do pedido; navegador fora do ar ou
        // erro inesperado também falha a tarefa, para aparecer na operação (spec 005).
        if (templateProblemRules(error) !== null || isTemplateRenderFailure(error)) {
          return;
        }
        throw error;
      }
      const saved = await saveCertificatePreviewPdf(db, previewId, pdf);
      logger.info(
        { ...log, outcome: saved ? 'ready' : 'gone', bytes: pdf.byteLength },
        'PDF de exemplo gerado',
      );
    },
  };
}
