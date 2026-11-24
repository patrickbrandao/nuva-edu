import { clearApiCookie, type FastifyInstance, setApiCookie } from '@nuva-edu/api-kit';
import {
  buildSessionView,
  type Database,
  loginWithPassword,
  logout,
  type SessionView,
} from '@nuva-edu/core';
import { markSessionEnded, requestContext, requireSession, SITE } from '../session.ts';

// Login, saída e sessão atual da equipe (spec 007, "Login por senha", "Sessões" e "Cookies").

export interface AuthRoutesOptions {
  db: Database;
  /** `config.retention.sessionDays`. */
  ttlDays: number;
}

/** Corpo `Session` do contrato: no admin não há `termsPending`; datas em ISO 8601. */
export function sessionBody(view: SessionView) {
  return {
    user: view.user,
    csrfToken: view.csrfToken,
    permissions: view.permissions,
    expiresAt: view.expiresAt.toISOString(),
  };
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const { db, ttlDays } = options;
  const maxAgeSeconds = ttlDays * 86_400;

  // `POST /api/v1/auth/login`: o núcleo responde `invalid_credentials`, `account_suspended`,
  // `staff_only` (papel `student`) e `too_many_attempts`; nenhum deles abre sessão.
  app.operation(
    'login',
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const result = await loginWithPassword(
        db,
        {
          site: SITE,
          email: body.email,
          password: body.password,
          context: requestContext(request),
        },
        { ttlDays },
      );
      setApiCookie(reply, SITE, 'session', result.token, { maxAgeSeconds });
      return sessionBody(result.view);
    },
    { noStore: true },
  );

  // `POST /api/v1/auth/logout`: encerra só a sessão atual, grava `auth.logout` e apaga o cookie.
  app.operation('logout', async (request, reply) => {
    await logout(db, requireSession(request), requestContext(request));
    markSessionEnded(request);
    clearApiCookie(reply, SITE, 'session');
    return reply.status(204).send();
  });

  // `GET /api/v1/session`: dono, token CSRF e ações permitidas, para o site montar o menu.
  app.operation(
    'getSession',
    async (request) => sessionBody(await buildSessionView(db, requireSession(request))),
    { noStore: true },
  );
}
