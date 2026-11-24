import { isApiError } from '@nuva-edu/api-client/admin';
import { ErrorState, LoadingState } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useProblemText } from '../api/problems';
import { NoAccessPage } from '../pages/NoAccessPage';
import { StandalonePage } from '../shell/StandalonePage';
import { loginPath } from './destination';
import { SESSION_KEY, SessionProvider, useSessionQuery } from './session';

function isUnauthenticated(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

/**
 * Guarda das telas do painel (spec 006, "Sessão"): carrega `GET /api/v1/session`; sem sessão
 * (`401`) leva a `/entrar` guardando o destino; `403` por papel mostra "sem acesso ao painel".
 * Um `401` em qualquer outra chamada também volta à tela de entrada.
 */
export function SessionGate() {
  const { t } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useSessionQuery();
  const describe = useProblemText();

  useEffect(() => {
    const expire = (error: unknown) => {
      if (isUnauthenticated(error)) void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    };
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        event.query.queryKey[0] !== SESSION_KEY[0]
      ) {
        expire(event.action.error);
      }
    });
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') expire(event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient]);

  if (session.isPending) {
    return (
      <StandalonePage title={t('session.loadingTitle')} tabTitle={t('menu.items.dashboard')}>
        <LoadingState label={t('session.loading')} />
      </StandalonePage>
    );
  }

  if (session.isError) {
    if (isUnauthenticated(session.error)) {
      return <Navigate to={loginPath(`${location.pathname}${location.search}`)} replace />;
    }
    if (isApiError(session.error) && session.error.status === 403) return <NoAccessPage />;
    if (!session.data) {
      const { text, detail } = describe(session.error);
      return (
        <StandalonePage
          title={t('session.errorTitle')}
          tabTitle={t('menu.items.dashboard')}
          width="md"
        >
          <ErrorState
            text={text}
            detail={detail}
            retryLabel={t('common.retry')}
            onRetry={() => void session.refetch()}
            retrying={session.isFetching}
          />
        </StandalonePage>
      );
    }
  }

  return (
    <SessionProvider session={session.data}>
      <Outlet />
    </SessionProvider>
  );
}
