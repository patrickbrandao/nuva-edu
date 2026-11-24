import type { FastifyInstance, FastifyReply, FastifyRequest } from '@nuva-edu/api-kit';
import {
  type AuthenticatedSession,
  clearOAuthCookie,
  notFound,
  type OAuth,
  type OAuthCookie,
  oauthCookieName,
  oauthErrorLocation,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { requestContext, SITE, writeSessionCookie } from '../session.ts';
import { bodyOf, paramsOf, type RouteContext } from './context.ts';

/** O que as rotas do login social recebem além do contexto comum. */
export interface OAuthRouteContext extends RouteContext {
  oauth: OAuth;
  /**
   * A sessão do cookie, quando há e vale; `null` em qualquer outro caso. As operações do login
   * social são públicas no contrato: a sessão só importa no vínculo (`intent=link`).
   */
  optionalSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | null>;
}

/**
 * Grava o cookie de retorno como o núcleo o montou: o valor já vem assinado por ele
 * (HMAC-SHA256 com `SESSION_SECRET`), então não passa pela assinatura do `@fastify/cookie`.
 */
function writeOAuthCookie(reply: FastifyReply, cookie: OAuthCookie): void {
  reply.setCookie(cookie.name, cookie.value, cookie.options);
}

function readOAuthCookie(request: FastifyRequest): string | null {
  const value = request.cookies?.[oauthCookieName(SITE)];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Login social, vínculo e cadastro pendente (spec 007, "Login social e vínculo", "Fluxo do
 * provedor" e "Cadastro pendente"). As regras e o cookie de retorno são do núcleo
 * (`createOAuth`); aqui só a tradução HTTP: `302`, cookies e corpo.
 */
export function registerOAuthRoutes(app: FastifyInstance, ctx: OAuthRouteContext): void {
  const { db, oauth, ttlDays } = ctx;

  // `GET /auth/{provider}/start`: provedor desligado `404`; `intent=link` sem sessão `401`.
  app.operation('startOAuth', async (request, reply) => {
    const { provider } = paramsOf<{ provider: string }>(request);
    const query = request.query as { intent?: string; returnTo?: string };
    const current = query.intent === 'link' ? await ctx.optionalSession(request, reply) : null;
    const started = oauth.start({
      site: SITE,
      provider,
      intent: query.intent,
      returnTo: query.returnTo,
      user: current ? { id: current.user.id } : null,
    });
    writeOAuthCookie(reply, started.cookie);
    reply.header('cache-control', 'no-store');
    return reply.redirect(started.location, 302);
  });

  // Retorno do provedor: sempre `302` para o próprio site, nunca corpo de erro.
  const finishCallback = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: Readonly<Record<string, unknown>>,
  ) => {
    const { provider } = paramsOf<{ provider: string }>(request);
    const current = await ctx.optionalSession(request, reply);
    const result = await oauth.callback(db, {
      site: SITE,
      provider,
      params,
      cookie: readOAuthCookie(request),
      user: current ? { id: current.user.id, role: current.user.role } : null,
      context: requestContext(request),
      ttlDays,
    });
    writeOAuthCookie(reply, result.cookie);
    if (result.session) {
      writeSessionCookie(reply, result.session.token, ttlDays);
    }
    reply.header('cache-control', 'no-store');
    return reply.redirect(result.location, 302);
  };

  // `GET /auth/{provider}/callback` (Google, Facebook): `code`, `state` ou `error` na consulta.
  app.operation('oauthCallback', async (request, reply) => {
    const { provider } = paramsOf<{ provider: string }>(request);
    if (!oauth.isEnabled(provider)) {
      throw notFound('Provedor de login desligado.');
    }
    return finishCallback(request, reply, request.query as Record<string, unknown>);
  });

  // `POST /auth/{provider}/callback` (Apple, `form_post`): só `apple` usa este método.
  app.operation('oauthCallbackForm', async (request, reply) => {
    const { provider } = paramsOf<{ provider: string }>(request);
    if (!oauth.isEnabled(provider)) {
      throw notFound('Provedor de login desligado.');
    }
    if (provider !== 'apple') {
      writeOAuthCookie(reply, clearOAuthCookie(SITE));
      reply.header('cache-control', 'no-store');
      return reply.redirect(oauthErrorLocation('login', 'oauth_provider_error'), 302);
    }
    return finishCallback(request, reply, (request.body ?? {}) as Record<string, unknown>);
  });

  // `GET /auth/social/pending`: o que o provedor informou e os termos vigentes; sem cookie, `404`.
  app.operation(
    'getSocialPending',
    async (request) => toWire(await oauth.pending(db, readOAuthCookie(request))),
    { noStore: true },
  );

  // `POST /auth/social/complete`: cria a conta e o vínculo, apaga o cookie e abre a sessão.
  app.operation(
    'completeSocialSignup',
    async (request, reply) => {
      const body = bodyOf<{ acceptedTerms: string[]; email?: string }>(request);
      const result = await oauth.complete(db, {
        cookie: readOAuthCookie(request),
        acceptedTerms: body.acceptedTerms,
        ...(body.email === undefined ? {} : { email: body.email }),
        context: requestContext(request),
        ttlDays,
      });
      writeOAuthCookie(reply, result.cookie);
      writeSessionCookie(reply, result.token, ttlDays);
      return toWire(result.view);
    },
    { noStore: true },
  );
}
