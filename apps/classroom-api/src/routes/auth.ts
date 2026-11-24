import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  buildSessionView,
  loginWithPassword,
  logout,
  registerWithPassword,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  verifyEmail,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { clearSessionCookie, requestContext, SITE, writeSessionCookie } from '../session.ts';
import { bodyOf, type RouteContext, requireSession } from './context.ts';

/**
 * Cadastro, login, sessão, confirmação de e-mail e redefinição de senha (spec 007, rotas do
 * classroom). As regras ficam no núcleo; aqui só a tradução HTTP, o cookie e o fluxo SSE.
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, hub, ttlDays } = ctx;

  // `POST /auth/register`: `204` também quando o e-mail já tem conta; não abre sessão.
  app.operation('register', async (request, reply) => {
    const body = bodyOf<{
      name: string;
      email: string;
      password: string;
      acceptedTerms: string[];
    }>(request);
    await registerWithPassword(db, {
      name: body.name,
      email: body.email,
      password: body.password,
      acceptedTerms: body.acceptedTerms,
      context: requestContext(request),
    });
    reply.status(204);
  });

  // `POST /auth/login`: abre a sessão e grava o cookie.
  app.operation(
    'login',
    async (request, reply) => {
      const body = bodyOf<{ email: string; password: string }>(request);
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
      writeSessionCookie(reply, result.token, ttlDays);
      return toWire(result.view);
    },
    { noStore: true },
  );

  // `POST /auth/logout`: encerra a sessão atual, apaga o cookie e fecha os fluxos dela.
  app.operation('logout', async (request, reply) => {
    const current = requireSession(request);
    await logout(db, current, requestContext(request));
    hub.disconnectSession(current.id);
    clearSessionCookie(reply);
    reply.status(204);
  });

  // `GET /session`: dono, token CSRF, ações permitidas e termos pendentes.
  app.operation(
    'getSession',
    async (request) => toWire(await buildSessionView(db, requireSession(request))),
    { noStore: true },
  );

  // `POST /auth/email/verify`: token do link; vencido, usado ou desconhecido: `410`.
  app.operation('verifyEmail', async (request, reply) => {
    await verifyEmail(db, bodyOf<{ token: string }>(request).token);
    reply.status(204);
  });

  // `POST /auth/email/resend`: até 3 por hora (`429`); já confirmado, `204` sem envio.
  app.operation('resendVerificationEmail', async (request, reply) => {
    await resendVerificationEmail(db, requireSession(request).user.id);
    reply.status(204);
  });

  // `POST /auth/password/forgot`: sempre `204`, exista ou não a conta.
  app.operation('requestPasswordReset', async (request, reply) => {
    await requestPasswordReset(db, bodyOf<{ email: string }>(request).email);
    reply.status(204);
  });

  // `POST /auth/password/reset`: define a senha e encerra todas as sessões do usuário.
  app.operation('resetPassword', async (request, reply) => {
    const body = bodyOf<{ token: string; password: string }>(request);
    const { userId } = await resetPassword(db, {
      token: body.token,
      password: body.password,
      context: requestContext(request),
    });
    hub.disconnectUser(userId);
    reply.status(204);
  });
}
