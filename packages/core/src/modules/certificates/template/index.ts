// Template do certificado (spec 015; ADR 0026): validação, palavras-chave, valores e
// preenchimento. Funções puras, sem banco e sem navegador (tarefa 466). A tarefa 415 liga este
// arquivo ao `index.ts` do módulo `certificates`.

export {
  CERTIFICATE_EMPTY_IMAGE,
  escapeCertificateHtml,
  type FillCertificateTemplateOptions,
  type FilledCertificateTemplate,
  fillCertificateTemplate,
} from './fill.ts';
export {
  CERTIFICATE_QRCODE_KEY,
  CERTIFICATE_TEMPLATE_KEY_DESCRIPTIONS,
  CERTIFICATE_TEMPLATE_KEYS,
  CERTIFICATE_TEMPLATE_REQUIRED_KEYS,
  CERTIFICATE_TEMPLATE_VALIDATION_KEYS,
  type CertificateTemplateKey,
  type CertificateTemplateTextKey,
  type CertificateTemplateValues,
  isCertificateTemplateKey,
} from './keywords.ts';
export {
  CERTIFICATE_TEMPLATE_MAX_PROBLEMS,
  type CertificateTemplateProblem,
  certificateTemplateInvalid,
} from './problems.ts';
export {
  CERTIFICATE_TEMPLATE_MODEL_HTML,
  type CertificateTemplateKeyReference,
  type CertificateTemplateReference,
  certificateTemplateReference,
} from './reference.ts';
export {
  CERTIFICATE_TEMPLATE_MAX_BYTES,
  CERTIFICATE_TEMPLATE_RULES,
  type CertificateTemplateRule,
} from './rules.ts';
export {
  type CertificateTemplateImageRef,
  type CertificateTemplateValidation,
  validateCertificateTemplate,
} from './validate.ts';
export {
  CERTIFICATE_PREVIEW_CODE,
  CERTIFICATE_PREVIEW_COURSE_TITLE,
  CERTIFICATE_PREVIEW_HOURS,
  CERTIFICATE_PREVIEW_INSTRUCTOR_NAME,
  CERTIFICATE_PREVIEW_SIGNER_NAME,
  CERTIFICATE_PREVIEW_SIGNER_ROLE,
  CERTIFICATE_PREVIEW_STUDENT_NAME,
  type CertificateDateContext,
  type CertificatePreviewInput,
  type CertificateTemplateContext,
  type CertificateTemplateData,
  certificatePreviewData,
  certificateTemplateValues,
  certificateValidationUrl,
  formatCertificateCode,
  formatCertificateDateLong,
  formatCertificateDateShort,
} from './values.ts';
