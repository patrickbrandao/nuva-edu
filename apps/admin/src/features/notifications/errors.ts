import { isApiError } from '@nuva-edu/api-client/admin';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../api/problems';

/*
 * Textos das recusas da central e das preferências. Só os códigos com frase própria aparecem
 * nomeados; o resto cai no aviso genérico (com o código da requisição, quando houver).
 */
const KNOWN = ['not_found', 'validation_failed'] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa numa ação da central ou das preferências. */
export function useNotificationError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnown(error.code)) return t(`notifications.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}
