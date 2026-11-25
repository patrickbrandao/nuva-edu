// Valores das palavras-chave (spec 015): formatação das datas no `NUVA_LOCALE` e no fuso da
// escola, URL de validação e os dados fictícios do PDF de exemplo.

import type { CertificateTemplateValues } from './keywords.ts';

/** Idioma e fuso usados nas datas do certificado. */
export interface CertificateDateContext {
  /** `NUVA_LOCALE` (`Config.locale`), como `pt-BR`. */
  locale: string;
  /** `school.timezone`, como `America/Sao_Paulo`. */
  timeZone: string;
}

/** Contexto completo para montar os valores. */
export interface CertificateTemplateContext extends CertificateDateContext {
  /** Origem do classroom (`Config.classroomUrl`), como `https://classroom.escola.com.br`. */
  classroomUrl: string;
}

/** Dados de um certificado (congelados na emissão, ou os de exemplo). */
export interface CertificateTemplateData {
  studentName: string;
  courseTitle: string;
  /** Horas inteiras, já arredondadas. */
  hours: number;
  /** Nome de exibição do dono do curso; nulo sem dono. */
  instructorName: string | null;
  completedAt: Date;
  issuedAt: Date;
  /** Código com ou sem hífens; sai sempre como `XXXX-XXXX-XXXX`. */
  code: string;
  schoolName: string;
  signerName: string | null;
  signerRole: string | null;
}

/** Data por extenso (`25 de novembro de 2026` em `pt-BR`), no fuso da escola. */
export function formatCertificateDateLong(date: Date, context: CertificateDateContext): string {
  return new Intl.DateTimeFormat(context.locale, {
    dateStyle: 'long',
    timeZone: context.timeZone,
  }).format(date);
}

/** Data curta com ano de quatro dígitos (`25/11/2026` em `pt-BR`), no fuso da escola. */
export function formatCertificateDateShort(date: Date, context: CertificateDateContext): string {
  return new Intl.DateTimeFormat(context.locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: context.timeZone,
  }).format(date);
}

/** Código no formato de exibição, `XXXX-XXXX-XXXX`, em maiúsculas. */
export function formatCertificateCode(code: string): string {
  const compact = code.replaceAll('-', '').toUpperCase();
  if (!/^[A-Z0-9]{12}$/.test(compact)) {
    throw new TypeError('formatCertificateCode: o código tem 12 caracteres alfanuméricos.');
  }
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
}

/** `https://<NUVA_CLASSROOM_HOST>/certificados/<código>` (spec 015, "Validação pública"). */
export function certificateValidationUrl(classroomUrl: string, code: string): string {
  return `${classroomUrl.replace(/\/+$/, '')}/certificados/${formatCertificateCode(code)}`;
}

/** Valores das 12 palavras-chave de texto, prontos para `fillCertificateTemplate`. */
export function certificateTemplateValues(
  data: CertificateTemplateData,
  context: CertificateTemplateContext,
): CertificateTemplateValues {
  if (!Number.isSafeInteger(data.hours) || data.hours < 0) {
    throw new TypeError('certificateTemplateValues: hours é um inteiro não negativo.');
  }
  const code = formatCertificateCode(data.code);
  return {
    'aluno.nome': data.studentName,
    'curso.titulo': data.courseTitle,
    'curso.carga_horaria': String(data.hours),
    'curso.instrutor': data.instructorName ?? '',
    'certificado.data_conclusao': formatCertificateDateLong(data.completedAt, context),
    'certificado.data_conclusao_curta': formatCertificateDateShort(data.completedAt, context),
    'certificado.data_emissao': formatCertificateDateLong(data.issuedAt, context),
    'certificado.codigo': code,
    'certificado.url_validacao': certificateValidationUrl(context.classroomUrl, code),
    'escola.nome': data.schoolName,
    'assinatura.nome': data.signerName ?? '',
    'assinatura.cargo': data.signerRole ?? '',
  };
}

/** Código fixo do PDF de exemplo. */
export const CERTIFICATE_PREVIEW_CODE = 'ABCD-EFGH-JKMN';
export const CERTIFICATE_PREVIEW_STUDENT_NAME = 'Maria Exemplo da Silva';
export const CERTIFICATE_PREVIEW_COURSE_TITLE = 'Curso de exemplo';
export const CERTIFICATE_PREVIEW_INSTRUCTOR_NAME = 'Nome do instrutor';
export const CERTIFICATE_PREVIEW_HOURS = 12;
export const CERTIFICATE_PREVIEW_SIGNER_NAME = 'Nome de quem assina';
export const CERTIFICATE_PREVIEW_SIGNER_ROLE = 'Cargo';

export interface CertificatePreviewInput {
  /** Agora: a data de conclusão e de emissão do exemplo. */
  now: Date;
  /** Curso indicado no pedido de exemplo; nulo sem curso. */
  course?: { title: string; instructorName: string | null } | null | undefined;
  schoolName: string;
  signerName: string | null;
  signerRole: string | null;
}

/**
 * Dados fictícios do PDF de exemplo (spec 015, "Pré-visualização"). Sem curso, o título e o
 * instrutor são os de exemplo; com curso sem dono, o instrutor fica vazio, como no real.
 */
export function certificatePreviewData(input: CertificatePreviewInput): CertificateTemplateData {
  const course = input.course ?? null;
  return {
    studentName: CERTIFICATE_PREVIEW_STUDENT_NAME,
    courseTitle: course?.title ?? CERTIFICATE_PREVIEW_COURSE_TITLE,
    hours: CERTIFICATE_PREVIEW_HOURS,
    instructorName: course === null ? CERTIFICATE_PREVIEW_INSTRUCTOR_NAME : course.instructorName,
    completedAt: input.now,
    issuedAt: input.now,
    code: CERTIFICATE_PREVIEW_CODE,
    schoolName: input.schoolName,
    signerName: input.signerName ?? CERTIFICATE_PREVIEW_SIGNER_NAME,
    signerRole: input.signerRole ?? CERTIFICATE_PREVIEW_SIGNER_ROLE,
  };
}
