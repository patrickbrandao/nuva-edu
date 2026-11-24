import { ApiNetworkError, isApiError } from '@nuva-edu/api-client/classroom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/** Mensagem pronta para a tela e, quando houver, o código da requisição para o suporte. */
export interface ErrorText {
  message: string;
  /** "Código da requisição: …", já traduzido. */
  detail?: string;
  /** `code` do problem+json, ou `network` sem resposta. */
  code: string;
}

/** Tempo de espera legível ("15 minutos", "40 segundos"), arredondado para cima. */
export function formatWait(t: TFunction, seconds: number): string {
  if (seconds < 60) return t('errors.wait.seconds', { count: Math.max(1, Math.ceil(seconds)) });
  return t('errors.wait.minutes', { count: Math.ceil(seconds / 60) });
}

/**
 * Traduz um erro da API. `messages` leva os códigos próprios da tela (spec 007, "Casos de erro")
 * para o texto; o resto cai nas mensagens gerais. Rota que ainda não existe (`404` sem código
 * próprio), falha de rede e `5xx` viram um aviso tratado, nunca uma tela quebrada.
 */
export function describeError(
  t: TFunction,
  error: unknown,
  messages: Partial<Record<string, string>> = {},
): ErrorText {
  if (!isApiError(error)) {
    return {
      code: 'network',
      message: error instanceof ApiNetworkError ? t('errors.network') : t('errors.generic'),
    };
  }
  const detail = error.requestId ? t('common.requestId', { id: error.requestId }) : undefined;
  const withDetail = (message: string): ErrorText =>
    detail ? { code: error.code, message, detail } : { code: error.code, message };

  const own = messages[error.code];
  if (own) return withDetail(own);
  if (error.status === 429) {
    return withDetail(
      error.retryAfter !== undefined
        ? t('errors.rateLimitedFor', { time: formatWait(t, error.retryAfter) })
        : t('errors.rateLimited'),
    );
  }
  if (error.code === 'terms_acceptance_pending') return withDetail(t('errors.termsPending'));
  if (error.code === 'unauthenticated') return withDetail(t('errors.unauthenticated'));
  if (error.status === 400) return withDetail(t('errors.validation'));
  if (error.status === 404) return withDetail(t('errors.notAvailable'));
  if (error.status >= 500) return withDetail(t('errors.unavailable'));
  return withDetail(t('errors.generic'));
}

/** `describeError` com o `t` da tela. */
export function useDescribeError() {
  const { t } = useTranslation();
  return (error: unknown, messages?: Partial<Record<string, string>>) =>
    describeError(t, error, messages);
}

/** Erros de campo do `400` (`errors[].path`, ex.: `body.email`), por nome do campo. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {};
  const fields: Record<string, string> = {};
  for (const item of error.fieldErrors) {
    const name = item.path.replace(/^body\./, '').split('.')[0];
    if (name && !fields[name]) fields[name] = item.message;
  }
  return fields;
}
