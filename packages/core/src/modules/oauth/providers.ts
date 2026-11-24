import { createHmac } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import type { AppleCredentials, Config, OAuthCredentials } from '../../config/config.ts';
import { AUTH_PROVIDERS, type AuthProvider } from '../accounts/identities.ts';
import { OAuthProviderError } from './errors.ts';
import {
  buildUrl,
  claimIsTrue,
  createIdTokenVerifier,
  type FetchLike,
  normalizeProviderEmail,
  type OAuthProvider,
  optionalText,
  postForm,
  requestJson,
  requireString,
} from './provider.ts';

// As três implementações (Google OpenID, Facebook Graph, Apple OpenID com `client_secret` em JWT
// ES256 e `form_post`) e a montagem a partir da configuração (reais ou o simulador).

export const FACEBOOK_GRAPH_VERSION = 'v27.0';
export const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';
/** Validade do `client_secret` da Apple (o máximo aceito é 6 meses). */
const APPLE_CLIENT_SECRET_TTL_SECONDS = 5 * 60;

export interface GoogleEndpoints {
  authorization: string;
  token: string;
  jwks: string;
  /** Emissores aceitos no `iss`. */
  issuers: string[];
}

export interface FacebookEndpoints {
  authorization: string;
  token: string;
  me: string;
}

export interface AppleEndpoints {
  authorization: string;
  token: string;
  jwks: string;
  /** `iss` do `id_token` e `aud` do `client_secret`. */
  issuer: string;
}

export interface ProviderEndpoints {
  google: GoogleEndpoints;
  facebook: FacebookEndpoints;
  apple: AppleEndpoints;
}

export const REAL_PROVIDER_ENDPOINTS: ProviderEndpoints = {
  google: {
    authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
  facebook: {
    authorization: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    token: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
    me: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`,
  },
  apple: {
    authorization: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    jwks: 'https://appleid.apple.com/auth/keys',
    issuer: 'https://appleid.apple.com',
  },
};

/**
 * Endereços do simulador (`scripts/oauth-mock/`) e do provedor falso dos testes: o navegador
 * usa `url` (autorização, e o `iss` dos `id_token`); a API usa `internalUrl` na troca do código,
 * na JWKS e no `/me`.
 */
export function mockProviderEndpoints(mock: {
  url: string;
  internalUrl: string;
}): ProviderEndpoints {
  const { url, internalUrl } = mock;
  return {
    google: {
      authorization: `${url}/google/o/oauth2/v2/auth`,
      token: `${internalUrl}/google/token`,
      jwks: `${internalUrl}/google/oauth2/v3/certs`,
      issuers: [`${url}/google`],
    },
    facebook: {
      authorization: `${url}/facebook/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
      token: `${internalUrl}/facebook/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
      me: `${internalUrl}/facebook/${FACEBOOK_GRAPH_VERSION}/me`,
    },
    apple: {
      authorization: `${url}/apple/auth/authorize`,
      token: `${internalUrl}/apple/auth/token`,
      jwks: `${internalUrl}/apple/auth/keys`,
      issuer: `${url}/apple`,
    },
  };
}

export interface ProviderOptions<C, E> {
  credentials: C;
  endpoints: E;
  fetch: FetchLike;
}

export function createGoogleProvider(
  options: ProviderOptions<OAuthCredentials, GoogleEndpoints>,
): OAuthProvider {
  const { credentials, endpoints, fetch } = options;
  const verify = createIdTokenVerifier('google', endpoints.jwks, fetch);
  return {
    name: 'google',
    responseMode: 'query',
    authorizationUrl: (request) =>
      buildUrl(endpoints.authorization, {
        client_id: credentials.clientId,
        redirect_uri: request.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: request.state,
        nonce: request.nonce,
        code_challenge: request.codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }),
    async exchangeCode(exchange) {
      const tokens = await postForm(fetch, 'google', endpoints.token, {
        grant_type: 'authorization_code',
        code: exchange.code,
        code_verifier: exchange.codeVerifier,
        redirect_uri: exchange.redirectUri,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      });
      const claims = await verify(requireString('google', tokens, 'id_token'), {
        issuer: endpoints.issuers,
        audience: credentials.clientId,
        nonce: exchange.nonce,
      });
      const email = normalizeProviderEmail(claims.email);
      return {
        provider: 'google',
        providerUserId: claims.sub as string,
        email,
        emailVerified: email !== null && claimIsTrue(claims.email_verified),
        name: optionalText(claims.name),
        privateRelay: false,
      };
    },
  };
}

export function createFacebookProvider(
  options: ProviderOptions<OAuthCredentials, FacebookEndpoints>,
): OAuthProvider {
  const { credentials, endpoints, fetch } = options;
  return {
    name: 'facebook',
    responseMode: 'query',
    authorizationUrl: (request) =>
      buildUrl(endpoints.authorization, {
        client_id: credentials.clientId,
        redirect_uri: request.redirectUri,
        response_type: 'code',
        scope: 'email,public_profile',
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: 'S256',
      }),
    async exchangeCode(exchange) {
      const tokens = await requestJson(
        fetch,
        'facebook',
        'troca do código',
        buildUrl(endpoints.token, {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          redirect_uri: exchange.redirectUri,
          code: exchange.code,
          code_verifier: exchange.codeVerifier,
        }),
      );
      const accessToken = requireString('facebook', tokens, 'access_token');
      const proof = createHmac('sha256', credentials.clientSecret)
        .update(accessToken)
        .digest('hex');
      const me = await requestJson(
        fetch,
        'facebook',
        'leitura do perfil',
        buildUrl(endpoints.me, { fields: 'id,name,email', appsecret_proof: proof }),
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      const email = normalizeProviderEmail(me.email);
      return {
        provider: 'facebook',
        providerUserId: requireString('facebook', me, 'id'),
        email,
        // Spec 007: o Graph só devolve e-mail confirmado.
        emailVerified: email !== null,
        name: optionalText(me.name),
        privateRelay: false,
      };
    },
  };
}

/** Nome do campo `user` do retorno da Apple (só na primeira autorização). */
export function appleUserName(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [optionalText(parsed.name?.firstName), optionalText(parsed.name?.lastName)];
    const name = parts.filter((part) => part !== null).join(' ');
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

export function createAppleProvider(
  options: ProviderOptions<AppleCredentials, AppleEndpoints>,
): OAuthProvider {
  const { credentials, endpoints, fetch } = options;
  const verify = createIdTokenVerifier('apple', endpoints.jwks, fetch);
  let key: Promise<CryptoKey> | null = null;
  const clientSecret = async (): Promise<string> => {
    key ??= importPKCS8(credentials.privateKey.replaceAll('\\n', '\n'), 'ES256');
    let signingKey: CryptoKey;
    try {
      signingKey = await key;
    } catch (error) {
      key = null;
      throw new OAuthProviderError('apple: APPLE_PRIVATE_KEY inválida', { cause: error });
    }
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: credentials.keyId })
      .setIssuer(credentials.teamId)
      .setSubject(credentials.clientId)
      .setAudience(endpoints.issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + APPLE_CLIENT_SECRET_TTL_SECONDS)
      .sign(signingKey);
  };
  return {
    name: 'apple',
    responseMode: 'form_post',
    authorizationUrl: (request) =>
      buildUrl(endpoints.authorization, {
        client_id: credentials.clientId,
        redirect_uri: request.redirectUri,
        response_type: 'code',
        response_mode: 'form_post',
        scope: 'name email',
        state: request.state,
        nonce: request.nonce,
        code_challenge: request.codeChallenge,
        code_challenge_method: 'S256',
      }),
    async exchangeCode(exchange) {
      const tokens = await postForm(fetch, 'apple', endpoints.token, {
        grant_type: 'authorization_code',
        code: exchange.code,
        code_verifier: exchange.codeVerifier,
        redirect_uri: exchange.redirectUri,
        client_id: credentials.clientId,
        client_secret: await clientSecret(),
      });
      const claims = await verify(requireString('apple', tokens, 'id_token'), {
        issuer: endpoints.issuer,
        audience: credentials.clientId,
        nonce: exchange.nonce,
      });
      const email = normalizeProviderEmail(claims.email);
      const privateRelay =
        email !== null &&
        (claimIsTrue(claims.is_private_email) || email.endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`));
      return {
        provider: 'apple',
        providerUserId: claims.sub as string,
        email,
        // Spec 007: o e-mail de retransmissão é tratado como verificado.
        emailVerified: email !== null && (privateRelay || claimIsTrue(claims.email_verified)),
        name: appleUserName(exchange.callback.user),
        privateRelay,
      };
    },
  };
}

export type OAuthProviders = Partial<Record<AuthProvider, OAuthProvider>>;

export interface CreateOAuthProvidersOptions {
  /** Padrão: o `fetch` global. Nos testes, o do provedor falso. */
  fetch?: FetchLike;
}

/**
 * Os provedores configurados: os reais, ou os três apontados para o simulador quando
 * `NUVA_OAUTH_MOCK_URL` está definida (a configuração já trocou as credenciais pelas de teste).
 * Provedor sem credencial fica de fora (desligado: `404` no início do fluxo).
 */
export function createOAuthProviders(
  config: Pick<Config, 'authProviders' | 'oauthMock'>,
  options: CreateOAuthProvidersOptions = {},
): OAuthProviders {
  const fetch = options.fetch ?? globalThis.fetch;
  const endpoints =
    config.oauthMock === null ? REAL_PROVIDER_ENDPOINTS : mockProviderEndpoints(config.oauthMock);
  const { google, facebook, apple } = config.authProviders;
  const providers: OAuthProviders = {};
  if (google) {
    providers.google = createGoogleProvider({
      credentials: google,
      endpoints: endpoints.google,
      fetch,
    });
  }
  if (facebook) {
    providers.facebook = createFacebookProvider({
      credentials: facebook,
      endpoints: endpoints.facebook,
      fetch,
    });
  }
  if (apple) {
    providers.apple = createAppleProvider({
      credentials: apple,
      endpoints: endpoints.apple,
      fetch,
    });
  }
  return providers;
}

/** `authProviders` de `GET /api/v1/meta` (RF-13): os ligados, na ordem fixa. */
export function enabledAuthProviders(config: Pick<Config, 'authProviders'>): AuthProvider[] {
  return AUTH_PROVIDERS.filter((provider) => config.authProviders[provider] !== null);
}
