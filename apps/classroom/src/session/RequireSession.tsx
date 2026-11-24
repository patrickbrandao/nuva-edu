import type { ClassroomSession } from '@nuva-edu/api-client/classroom';
import { LoadingState } from '@nuva-edu/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { LOGIN_PATH } from '../shell/navigation';
import { withReturnTo } from './returnTo';
import { useSession } from './session';

/**
 * Tela que exige login (spec 006, mapa de telas): sem sessão, leva a `/entrar` guardando o
 * endereço atual como destino. Vale também quando a sessão cai no meio do uso (`401`).
 */
export function RequireSession({
  children,
}: {
  children: (session: ClassroomSession) => ReactNode;
}) {
  const { t } = useTranslation();
  const { session, pending } = useSession();
  const { pathname, search } = useLocation();
  if (pending) {
    return (
      <div className="px-4 py-10">
        <LoadingState label={t('common.loading')} />
      </div>
    );
  }
  if (!session) return <Navigate to={withReturnTo(LOGIN_PATH, pathname + search)} replace />;
  return <>{children(session)}</>;
}
