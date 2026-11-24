import { ApiNetworkError, isApiError } from '@nuva-edu/api-client/admin';
import { AdminButton, AdminEmpty, ErrorState } from '@nuva-edu/ui';
import { ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HOME_PATH } from '../shell/menu';

/** `403` por papel: a API recusou a ação, mesmo que o botão estivesse à vista. */
export function isPermissionDenied(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && error.code === 'permission_denied';
}

/** Código de erro da resposta, ou `undefined` quando não é erro da API. */
export function problemCode(error: unknown): string | undefined {
  return isApiError(error) ? error.code : undefined;
}

/**
 * Texto genérico de um erro que a tela não trata pelo código: sem conexão, limite de taxa,
 * sem permissão ou falha do servidor; com o identificador da requisição quando houver.
 */
export function useProblemText() {
  const { t } = useTranslation();
  return (error: unknown): { text: string; detail: string | undefined } => {
    const detail =
      isApiError(error) && error.requestId
        ? t('common.requestId', { id: error.requestId })
        : undefined;
    if (error instanceof ApiNetworkError) return { text: t('errors.network'), detail };
    if (isPermissionDenied(error)) return { text: t('errors.permissionDenied'), detail };
    if (isApiError(error) && error.code === 'csrf_token_invalid') {
      return { text: t('errors.csrf'), detail };
    }
    if (isApiError(error) && (error.code === 'rate_limited' || error.status === 429)) {
      return {
        text:
          error.retryAfter !== undefined
            ? t('errors.rateLimitedIn', { count: Math.max(1, Math.ceil(error.retryAfter / 60)) })
            : t('errors.rateLimited'),
        detail,
      };
    }
    return { text: t('errors.unexpected'), detail };
  };
}

/** Tela ou área que o papel não pode abrir (spec 006, RF-10). */
export function ForbiddenState() {
  const { t } = useTranslation();
  return (
    <AdminEmpty
      icon={<ShieldX aria-hidden="true" />}
      title={t('forbidden.title')}
      text={t('forbidden.text')}
    >
      <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
    </AdminEmpty>
  );
}

interface QueryErrorStateProps {
  error: unknown;
  /** O que não carregou, ex.: "Não foi possível carregar os alunos". */
  title: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** Erro de uma leitura: `403` vira "sem permissão"; o resto, erro com "tentar de novo". */
export function QueryErrorState({ error, title, onRetry, retrying = false }: QueryErrorStateProps) {
  const { t } = useTranslation();
  const describe = useProblemText();
  if (isPermissionDenied(error)) return <ForbiddenState />;
  const { text, detail } = describe(error);
  return (
    <ErrorState
      title={title}
      text={text}
      detail={detail}
      retryLabel={t('common.retry')}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}
