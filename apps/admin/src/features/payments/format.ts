import { isApiError } from '@nuva-edu/api-client/admin';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../api/problems';

/*
 * Textos das telas de pagamento. O que a API manda como código — provedor, estado do aviso,
 * tipo do recurso — vira frase pelas traduções do site.
 */

/** Códigos das operações de pagamento (contrato) com texto próprio. */
const KNOWN_ERRORS = ['webhook_event_not_retryable', 'not_found', 'validation_failed'] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

function isKnownError(code: string): code is KnownError {
  return (KNOWN_ERRORS as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação de pagamento. */
export function usePaymentsError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnownError(error.code)) return t(`payments.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

export function providerLabel(t: TFunction, provider: 'mercadopago' | 'fake'): string {
  return t(`payments.provider.${provider}`);
}
