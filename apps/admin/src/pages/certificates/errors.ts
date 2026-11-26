import { isApiError } from '@nuva-edu/api-client/admin';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../api/problems';

/** Códigos das operações de certificado (spec 015 e contrato) com texto próprio. */
const KNOWN = [
  'certificate_template_missing',
  'certificate_exists',
  'certificate_already_revoked',
  'certificate_not_revoked',
  'certificate_preparing',
  'not_found',
  'validation_failed',
] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação de certificado; a genérica leva o código da requisição. */
export function useCertificateError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnown(error.code)) return t(`certificates.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/** `422` `certificate_template_missing`: o curso não tem template efetivo (spec 015). */
export function isTemplateMissing(error: unknown): boolean {
  return isApiError(error) && error.code === 'certificate_template_missing';
}

/** Campos recusados na validação (`body.reason` → `reason`). */
export function refusedFields(error: unknown): Set<string> {
  if (!isApiError(error)) return new Set();
  return new Set(error.fieldErrors.map((field) => field.path.replace(/^body\./, '')));
}
