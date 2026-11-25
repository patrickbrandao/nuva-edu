import { isApiError } from '@nuva-edu/api-client/admin';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../api/problems';

/** Códigos da concessão e da revogação manual (spec 010 e contrato) com texto próprio. */
const KNOWN = [
  'expires_at_in_past',
  'entitlement_not_revocable',
  'entitlement_already_revoked',
  'not_found',
  'validation_failed',
] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa da API ao conceder ou revogar; a genérica leva o código da requisição. */
export function useAccessError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnown(error.code)) return t(`access.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/**
 * Campos recusados (`body.reason` → `reason`). `expires_at_in_past` não lista o campo: o código
 * aponta a validade.
 */
export function refusedAccessFields(error: unknown): Set<string> {
  if (!isApiError(error)) return new Set();
  const fields = new Set(error.fieldErrors.map((field) => field.path.replace(/^body\./, '')));
  if (fields.size === 0 && error.code === 'expires_at_in_past') fields.add('expiresAt');
  return fields;
}
