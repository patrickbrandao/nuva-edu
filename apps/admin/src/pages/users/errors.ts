import { isApiError } from '@nuva-edu/api-client/admin';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../api/problems';

/** Códigos das ações sobre usuários (specs 007 e 008) que têm texto próprio. */
const KNOWN = [
  'last_admin',
  'self_action_not_allowed',
  'already_suspended',
  'not_suspended',
  'version_conflict',
  'email_taken',
  'password_invalid',
  'password_confirmation_invalid',
  'not_found',
  'validation_failed',
] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação sobre usuário, com o código da requisição quando é genérica. */
export function useUserActionError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error)) {
      if (isKnown(error.code)) return t(`users.errors.${error.code}`);
      if (error.code === 'too_many_attempts') {
        return error.retryAfter !== undefined
          ? t('users.errors.too_many_attemptsIn', {
              count: Math.max(1, Math.ceil(error.retryAfter / 60)),
            })
          : t('users.errors.too_many_attempts');
      }
    }
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/** Campos recusados num `400` (`body.email` → `email`). */
export function invalidFields(error: unknown): Set<string> {
  if (!isApiError(error)) return new Set();
  return new Set(error.fieldErrors.map((field) => field.path.replace(/^body\./, '')));
}
