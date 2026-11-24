import type { Config } from '../../config/config.ts';
import type { Database } from '../../db/database.ts';
import {
  isDomainError,
  notFound,
  unauthenticated,
  validationFailed,
} from '../../errors/domain-error.ts';
import { type AccountSite, type RequestContext, requireIp } from '../accounts/context.ts';
import { isValidEmail, normalizeEmail } from '../accounts/credentials.ts';
import { emailTaken } from '../accounts/errors.ts';
import { type AuthProvider, isAuthProvider } from '../accounts/identities.ts';
import { type LoginResult, openLoginSession } from '../accounts/login.ts';
import { createAccount, lockEmail, NAME_MAX_LENGTH } from '../accounts/registration.ts';
import { buildSessionView } from '../accounts/session-view.ts';
import { authenticateSession, type CreatedSession } from '../accounts/sessions.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import type { Role } from '../permissions/roles.ts';
import { acceptTerms, assertTermsAccepted } from '../privacy/terms-acceptance.ts';
import { currentTermsVersions, type TermsVersion } from '../privacy/terms-versions.ts';
import {
  clearOAuthCookie,
  decodeOAuthCookie,
  encodeOAuthCookie,
  OAUTH_FLOW_TTL_SECONDS,
  OAUTH_PENDING_TTL_SECONDS,
  type OAuthCookie,
  type OAuthFlowState,
  type OAuthIntent,
  oauthCookieName,
  oauthCookieOptions,
  pkceChallenge,
  randomUrlToken,
  type SocialPendingData,
  stateMatches,
} from './cookie.ts';
import {
  identityInUse,
  isOAuthCallbackError,
  type OAuthCallbackError,
  OAuthProviderError,
} from './errors.ts';
import { insertIdentity, resolveSocialIdentity } from './linking.ts';
import type { FetchLike, OAuthProvider, ProviderIdentity } from './provider.ts';
import { createOAuthProviders, enabledAuthProviders, type OAuthProviders } from './providers.ts';

// O fluxo do provedor (spec 007, "Fluxo do provedor" e "Cadastro pendente"): início, retorno,
// cadastro pendente e conclusão. As APIs só traduzem HTTP: cookies, `302` e corpo.

/** Destinos do retorno no site (spec 007). */
export const OAUTH_PENDING_PATH = '/cadastro/social';
export const OAUTH_LOGIN_ERROR_PATH = '/entrar';
export const OAUTH_LINK_ERROR_PATH = '/conta/acesso';

/** Erros do provedor que querem dizer "o usuário recusou". */
const DENIED_ERRORS = new Set(['access_denied', 'user_cancelled_authorize', 'user_denied']);

/**
 * `returnTo` só é aceito como caminho do próprio site: começa com `/`, não com `//` nem `/\`,
 * sem caracteres de controle. Qualquer outro valor vira `/`.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    return '/';
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: recusa caracteres de controle.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return '/';
  }
  return value;
}

/** Destino de erro do retorno: `/entrar?erro=` no login, `/conta/acesso?erro=` no vínculo. */
export function oauthErrorLocation(intent: OAuthIntent, code: OAuthCallbackError): string {
  const path = intent === 'link' ? OAUTH_LINK_ERROR_PATH : OAUTH_LOGIN_ERROR_PATH;
  return `${path}?erro=${code}`;
}

/** Endereço de retorno registrado no provedor: `<siteUrl>/api/v1/auth/<provider>/callback`. */
export function oauthCallbackUrl(
  config: Pick<Config, 'classroomUrl' | 'adminUrl'>,
  site: AccountSite,
  provider: AuthProvider,
): string {
  const base = site === 'admin' ? config.adminUrl : config.classroomUrl;
  return `${base}/api/v1/auth/${provider}/callback`;
}

export type OAuthConfig = Pick<
  Config,
  'authProviders' | 'oauthMock' | 'sessionSecret' | 'classroomUrl' | 'adminUrl'
>;

export interface CreateOAuthOptions {
  /** Padrão: o `fetch` global. Nos testes: `fake.fetch` do provedor falso. */
  fetch?: FetchLike;
  /** Provedores prontos, no lugar dos montados da configuração. */
  providers?: OAuthProviders;
  /** Relógio em milissegundos (testes da validade do cookie). */
  now?: () => number;
}

export interface OAuthStartInput {
  site: AccountSite;
  provider: string;
  /** `login` (padrão) ou `link`; o admin só aceita `login`. */
  intent?: unknown;
  returnTo?: unknown;
  /** Dono da sessão, quando há: obrigatório com `intent=link`. */
  user?: { id: string } | null;
}

export interface OAuthStartResult {
  /** Endereço de autorização do provedor, para o `302`. */
  location: string;
  cookie: OAuthCookie;
}

export interface OAuthCallbackInput {
  site: AccountSite;
  provider: string;
  /** A consulta (`GET`) ou o formulário (`POST` da Apple), como vieram. */
  params: Readonly<Record<string, unknown>>;
  /** Valor do cookie `oauthCookieName(site)`. */
  cookie: string | null | undefined;
  /** Dono da sessão válida da requisição, quando há (exigido no vínculo). */
  user: { id: string; role: Role } | null;
  context: RequestContext;
  /** `config.retention.sessionDays`. */
  ttlDays?: number;
}

export type OAuthCallbackOutcome = 'login' | 'linked' | 'pending' | 'error';

export interface OAuthCallbackResult {
  /** Caminho do próprio site para o `302`. */
  location: string;
  /** Apaga o cookie de retorno, ou o regrava no cadastro pendente. */
  cookie: OAuthCookie;
  outcome: OAuthCallbackOutcome;
  error: OAuthCallbackError | null;
  /** Sessão aberta (`outcome = login`): a API grava o cookie `sessionCookieName(site)`. */
  session: CreatedSession | null;
}

/** `SocialPending` do contrato (sem o identificador do provedor). */
export interface SocialPendingView {
  provider: AuthProvider;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  terms: TermsVersion[];
}

export interface SocialCompleteInput {
  cookie: string | null | undefined;
  acceptedTerms: readonly string[];
  /** Só quando o provedor não enviou e-mail; senão é ignorado. */
  email?: unknown;
  context: RequestContext;
  ttlDays?: number;
}

export interface SocialCompleteResult extends LoginResult {
  /** Apaga o cookie de retorno. */
  cookie: OAuthCookie;
  /** O `returnTo` guardado desde o início do fluxo. */
  returnTo: string;
}

export interface OAuth {
  /** `authProviders` de `GET /meta`. */
  readonly enabledProviders: readonly AuthProvider[];
  isEnabled(provider: string): provider is AuthProvider;
  /** `GET /auth/{provider}/start`. */
  start(input: OAuthStartInput): OAuthStartResult;
  /** `GET`/`POST /auth/{provider}/callback`: sempre devolve um destino, nunca lança regra. */
  callback(db: Database, input: OAuthCallbackInput): Promise<OAuthCallbackResult>;
  /** `GET /auth/social/pending` (só classroom); sem cookie válido, `404`. */
  pending(db: Database, cookie: string | null | undefined): Promise<SocialPendingView>;
  /** `POST /auth/social/complete` (só classroom). */
  complete(db: Database, input: SocialCompleteInput): Promise<SocialCompleteResult>;
}

/** Nome da conta: o do provedor, ou a parte local do e-mail; até 80 caracteres. */
export function accountNameFor(name: string | null, email: string): string {
  const base = name?.trim() || email.split('@')[0] || email;
  return [...base].slice(0, NAME_MAX_LENGTH).join('').trim() || 'Aluno';
}

function stringParams(params: Readonly<Record<string, unknown>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Monta o login social de uma API. Exige `SESSION_SECRET` (assina o cookie de retorno) ao
 * iniciar ou ler um fluxo.
 */
export function createOAuth(config: OAuthConfig, options: CreateOAuthOptions = {}): OAuth {
  const providers =
    options.providers ??
    createOAuthProviders(config, options.fetch ? { fetch: options.fetch } : {});
  const enabled = enabledAuthProviders(config).filter((name) => providers[name] !== undefined);
  const nowSeconds = () => Math.floor((options.now?.() ?? Date.now()) / 1000);
  const secret = config.sessionSecret;

  const providerFor = (name: string): OAuthProvider | undefined =>
    isAuthProvider(name) && enabled.includes(name) ? providers[name] : undefined;

  const readPending = (cookie: string | null | undefined): SocialPendingData => {
    const payload = decodeOAuthCookie(secret, cookie, 'classroom', nowSeconds());
    if (payload?.kind !== 'pending') {
      throw notFound('Não há cadastro social pendente.');
    }
    return payload.pending;
  };

  return {
    enabledProviders: enabled,

    isEnabled: (provider: string): provider is AuthProvider => providerFor(provider) !== undefined,

    start(input) {
      const provider = providerFor(input.provider);
      if (provider === undefined) {
        throw notFound('Provedor de login desligado.');
      }
      const intent = input.intent ?? 'login';
      if (intent !== 'login' && (intent !== 'link' || input.site === 'admin')) {
        throw validationFailed([
          {
            path: 'query.intent',
            message: input.site === 'admin' ? 'Só login.' : 'Use login ou link.',
          },
        ]);
      }
      if (intent === 'link' && !input.user) {
        throw unauthenticated('Entre para vincular um provedor.');
      }
      const flow: OAuthFlowState = {
        provider: provider.name,
        intent,
        returnTo: sanitizeReturnTo(input.returnTo),
        state: randomUrlToken(),
        nonce: randomUrlToken(),
        codeVerifier: randomUrlToken(),
        linkUserId: intent === 'link' ? (input.user?.id ?? null) : null,
      };
      const location = provider.authorizationUrl({
        state: flow.state,
        nonce: flow.nonce,
        codeChallenge: pkceChallenge(flow.codeVerifier),
        redirectUri: oauthCallbackUrl(config, input.site, provider.name),
      });
      const value = encodeOAuthCookie(secret, {
        kind: 'flow',
        site: input.site,
        exp: nowSeconds() + OAUTH_FLOW_TTL_SECONDS,
        flow,
      });
      return {
        location,
        cookie: {
          name: oauthCookieName(input.site),
          value,
          options: oauthCookieOptions(OAUTH_FLOW_TTL_SECONDS),
        },
      };
    },

    async callback(db, input) {
      const { site } = input;
      const cleared = clearOAuthCookie(site);
      const fail = (intent: OAuthIntent, code: OAuthCallbackError): OAuthCallbackResult => ({
        location: oauthErrorLocation(intent, code),
        cookie: cleared,
        outcome: 'error',
        error: code,
        session: null,
      });

      const payload = decodeOAuthCookie(secret, input.cookie, site, nowSeconds());
      if (payload?.kind !== 'flow' || payload.flow.provider !== input.provider) {
        return fail('login', 'oauth_state_invalid');
      }
      const { flow } = payload;
      const params = stringParams(input.params);
      if (!stateMatches(flow.state, params.state)) {
        return fail(flow.intent, 'oauth_state_invalid');
      }
      if (flow.intent === 'link' && (input.user === null || input.user.id !== flow.linkUserId)) {
        return fail('link', 'oauth_state_invalid');
      }
      if (params.error !== undefined) {
        return fail(
          flow.intent,
          DENIED_ERRORS.has(params.error) ? 'oauth_denied' : 'oauth_provider_error',
        );
      }
      const provider = providerFor(flow.provider);
      if (provider === undefined || !params.code) {
        return fail(flow.intent, 'oauth_provider_error');
      }

      let identity: ProviderIdentity;
      try {
        identity = await provider.exchangeCode({
          code: params.code,
          codeVerifier: flow.codeVerifier,
          redirectUri: oauthCallbackUrl(config, site, provider.name),
          nonce: flow.nonce,
          callback: params,
        });
      } catch (error) {
        if (error instanceof OAuthProviderError) {
          return fail(flow.intent, 'oauth_provider_error');
        }
        throw error;
      }

      const context: RequestContext = { ...input.context, ip: requireIp(input.context.ip) };
      try {
        return await db.transaction().execute(async (trx): Promise<OAuthCallbackResult> => {
          const decision = await resolveSocialIdentity(trx, {
            site,
            intent: flow.intent,
            identity,
            linkUser: flow.intent === 'link' ? input.user : null,
            context,
          });
          if (decision.kind === 'linked') {
            return {
              location: flow.returnTo,
              cookie: cleared,
              outcome: 'linked',
              error: null,
              session: null,
            };
          }
          if (decision.kind === 'pending') {
            const pending: SocialPendingData = {
              provider: identity.provider,
              providerUserId: identity.providerUserId,
              email: identity.email,
              emailVerified: identity.email !== null && identity.emailVerified,
              name: identity.name,
              returnTo: flow.returnTo,
            };
            return {
              location: OAUTH_PENDING_PATH,
              cookie: {
                name: oauthCookieName(site),
                value: encodeOAuthCookie(secret, {
                  kind: 'pending',
                  site,
                  exp: nowSeconds() + OAUTH_PENDING_TTL_SECONDS,
                  pending,
                }),
                options: oauthCookieOptions(OAUTH_PENDING_TTL_SECONDS),
              },
              outcome: 'pending',
              error: null,
              session: null,
            };
          }
          const session = await openLoginSession(trx, {
            user: decision.user,
            site,
            context,
            method: identity.provider,
            ...(input.ttlDays === undefined ? {} : { ttlDays: input.ttlDays }),
          });
          return {
            location: flow.returnTo,
            cookie: cleared,
            outcome: 'login',
            error: null,
            session,
          };
        });
      } catch (error) {
        if (isDomainError(error) && isOAuthCallbackError(error.code)) {
          return fail(flow.intent, error.code);
        }
        throw error;
      }
    },

    async pending(db, cookie) {
      const pending = readPending(cookie);
      const current = await currentTermsVersions(db);
      return {
        provider: pending.provider,
        email: pending.email,
        emailVerified: pending.emailVerified,
        name: pending.name,
        terms: [current.terms, current.privacy].filter(
          (version): version is TermsVersion => version !== null,
        ),
      };
    },

    async complete(db, input) {
      const pending = readPending(input.cookie);
      let email = pending.email;
      let emailVerified = pending.emailVerified;
      if (email === null) {
        const typed = normalizeEmail(typeof input.email === 'string' ? input.email : '');
        if (!isValidEmail(typed)) {
          throw validationFailed([{ path: 'body.email', message: 'Informe um e-mail válido.' }]);
        }
        email = typed;
        emailVerified = false;
      }
      const accepted = await assertTermsAccepted(db, input.acceptedTerms);
      const context: RequestContext = { ...input.context, ip: requireIp(input.context.ip) };
      const accountEmail = email;

      const created = await db.transaction().execute(async (trx) => {
        await lockEmail(trx, accountEmail);
        const taken = await trx
          .selectFrom('oauthIdentities')
          .select('id')
          .where('provider', '=', pending.provider)
          .where('providerUserId', '=', pending.providerUserId)
          .executeTakeFirst();
        if (taken !== undefined) {
          throw identityInUse();
        }
        const owner = await trx
          .selectFrom('users')
          .select('id')
          .where('email', '=', accountEmail)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();
        if (owner !== undefined) {
          throw emailTaken();
        }
        const userId = await createAccount(trx, {
          email: accountEmail,
          name: accountNameFor(pending.name, accountEmail),
          password: null,
          emailVerified,
        });
        const user = { id: userId, role: 'student' as const };
        await insertIdentity(trx, {
          userId,
          identity: {
            provider: pending.provider,
            providerUserId: pending.providerUserId,
            email: pending.email,
            emailVerified: pending.emailVerified,
          },
          via: 'signup',
          site: 'classroom',
          context,
          actor: user,
        });
        await acceptTerms(
          trx,
          userId,
          accepted.map((version) => version.id),
          context.ip,
          context.userAgent ?? null,
        );
        if (!emailVerified) {
          await enqueueEmail(trx, { userId, type: 'account.verify_email', data: {} });
        }
        return openLoginSession(trx, {
          user,
          site: 'classroom',
          context,
          method: pending.provider,
          ...(input.ttlDays === undefined ? {} : { ttlDays: input.ttlDays }),
        });
      });
      const session = await authenticateSession(db, {
        token: created.token,
        site: 'classroom',
        ...(input.ttlDays === undefined ? {} : { ttlDays: input.ttlDays }),
      });
      return {
        token: created.token,
        session,
        view: await buildSessionView(db, session),
        cookie: clearOAuthCookie('classroom'),
        returnTo: pending.returnTo,
      };
    },
  };
}
