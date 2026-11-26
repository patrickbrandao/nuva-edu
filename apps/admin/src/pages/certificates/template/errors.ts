import { isApiError } from '@nuva-edu/api-client/admin';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../../api/problems';

/** Códigos das operações do template (spec 015 e contrato) com texto próprio. */
const KNOWN = [
  'certificate_template_invalid',
  'certificate_preview_not_ready',
  'version_conflict',
  'not_found',
  'validation_failed',
] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa da API no editor do template; a genérica leva o código da requisição. */
export function useTemplateError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnown(error.code)) {
      return t(`certificateTemplate.errors.${error.code}`);
    }
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/** `409` `version_conflict`: outra pessoa gravou o template no meio da edição. */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === 'version_conflict';
}
