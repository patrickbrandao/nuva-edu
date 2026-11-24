import {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  setApiCookie,
} from '@nuva-edu/api-kit';
import {
  clearOAuthCookie,
  type Database,
  notFound,
  type OAuth,
  type OAuthCookie,
  oauthCookieName,
  oauthErrorLocation,
} from '@nuva-edu/core';
import { requestContext, SITE } from '../session.ts';

// Login social da equipe (spec 007, "Login social e vínculo" e "Fluxo do provedor"). No admin só
// existe `intent=login`: sem cadastro nem vínculo; quem não é da equipe volta com `staff_only`.
// As regras (state, PKCE, troca do código, `id_token`, tabela de vínculo) são do núcleo; aqui só
// cookies e `302`.

export interface OAuthRoutesOptions {
  db: Database;
  oauth: OAuth;
  /** `config.retention.sessionDays`. */
  ttlDays: number;
}

/** O único provedor que volta por formulário (`response_mode=form_post`). */
const FORM_POST_PROVIDER = 'apple';

/**
 * Grava o cookie de retorno como o núcleo o montou. O valor já vem assinado pelo núcleo
 * (HMAC com `SESSION_SECRET`): não passa pela assinatura do `@fastify/cookie`.
 */
function writeOAuthCookie(reply: FastifyReply, cookie: OAuthCookie): void {
  reply.setCookie(cookie.name, cookie.value, cookie.options);
}

export function registerOAuthRoutes(app: FastifyInstance, options: OAuthRoutesOptions): void {
  const { db, oauth, ttlDays } = options;
  const maxAgeSeconds = ttlDays * 86_400;

  const providerOf = (params: unknown): string => {
    const provider = (params as { provider: string }).provider;
    // Provedor sem as variáveis desta instalação: `404` (fora de `authProviders` do `/meta`).
    if (!oauth.isEnabled(provider)) {
      throw notFound('Provedor de login desligado.');
    }
    return provider;
  };

  /** Retorno do provedor, por consulta ou formulário: sempre `302` para o próprio site. */
  const handleCallback = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: Readonly<Record<string, unknown>>,
  ) => {
    const provider = providerOf(request.params);
    const result = await oauth.callback(db, {
      site: SITE,
      provider,
      params,
      cookie: request.cookies?.[oauthCookieName(SITE)] ?? null,
      // No admin não há vínculo: a sessão da requisição não entra no retorno.
      user: null,
      context: requestContext(request),
      ttlDays,
    });
    writeOAuthCookie(reply, result.cookie);
    if (result.session !== null) {
      setApiCookie(reply, SITE, 'session', result.session.token, { maxAgeSeconds });
    }
    return reply.redirect(result.location, 302);
  };

  // `GET /api/v1/auth/{provider}/start`: grava o cookie de retorno (10 minutos) e redireciona
  // para a autorização do provedor. `intent=link` não existe no admin: `400`.
  app.operation(
    'startOAuth',
    async (request, reply) => {
      const provider = providerOf(request.params);
      const query = request.query as { returnTo?: string; intent?: unknown };
      const started = oauth.start({
        site: SITE,
        provider,
        returnTo: query.returnTo,
        ...(query.intent === undefined ? {} : { intent: query.intent }),
      });
      writeOAuthCookie(reply, started.cookie);
      return reply.redirect(started.location, 302);
    },
    { noStore: true },
  );

  // `GET /api/v1/auth/{provider}/callback`: Google e Facebook voltam com `code` e `state`.
  app.operation(
    'oauthCallback',
    (request, reply) =>
      handleCallback(request, reply, request.query as Readonly<Record<string, unknown>>),
    { noStore: true },
  );

  // `POST /api/v1/auth/{provider}/callback`: a Apple volta por formulário. Outro provedor não usa
  // este método: `302` para `/entrar?erro=oauth_provider_error`, com o cookie de retorno apagado.
  app.operation(
    'oauthCallbackForm',
    async (request, reply) => {
      const provider = providerOf(request.params);
      if (provider !== FORM_POST_PROVIDER) {
        writeOAuthCookie(reply, clearOAuthCookie(SITE));
        return reply.redirect(oauthErrorLocation('login', 'oauth_provider_error'), 302);
      }
      return handleCallback(request, reply, (request.body ?? {}) as Record<string, unknown>);
    },
    { noStore: true },
  );
}
