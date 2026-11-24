import { createHash, randomBytes } from 'node:crypto';
import {
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from 'jose';
import { OAUTH_MOCK_CLIENTS } from '../../config/config.ts';
import type { AuthProvider } from '../accounts/identities.ts';
import type { FetchLike } from './provider.ts';
import { APPLE_PRIVATE_RELAY_DOMAIN, FACEBOOK_GRAPH_VERSION } from './providers.ts';

// Provedor falso em memória, sem rede (spec 007, "Provedor simulado"; ADR 0024), para os testes
// do core e das APIs. Imita os mesmos endereços do simulador (`scripts/oauth-mock/`) com as
// credenciais fixas de teste: basta carregar a configuração com `NUVA_OAUTH_MOCK_URL = fake.url`
// e passar `fetch: fake.fetch` a `createOAuth`. O código de produção roda inteiro: endereço de
// autorização, PKCE, troca do código, `id_token` assinado e conferido pela JWKS, `/me` do Graph.
// Só para testes: qualquer um escolhe a identidade.

export const FAKE_OAUTH_URL = 'https://oauth-fake.test';

/** A pessoa escolhida na "tela" do provedor falso. */
export interface FakeOAuthIdentity {
  /** `sub` (Google, Apple) ou `id` (Facebook). */
  sub: string;
  /** Sem e-mail: o campo não vai. */
  email?: string | null;
  /** Padrão `true`. Facebook: falso faz o `/me` não devolver o e-mail, como o Graph. */
  emailVerified?: boolean;
  name?: string | null;
  /** Apple: e-mail de retransmissão no lugar do informado. */
  hideEmail?: boolean;
  /** Apple: envia o campo `user` (com o nome) no retorno. Padrão `true`. */
  firstAuthorization?: boolean;
}

/** Falhas que o provedor falso sabe simular. */
export type FakeOAuthFailure =
  | 'deny'
  | 'state'
  | 'exchange'
  | 'bad_signature'
  | 'bad_nonce'
  | 'bad_audience';

/** O que o navegador leva ao retorno da API: consulta (`GET`) ou formulário (`POST`, Apple). */
export interface FakeOAuthCallback {
  method: 'GET' | 'POST';
  /** O `redirect_uri` pedido (o retorno da API). */
  url: string;
  params: Record<string, string>;
}

export interface FakeOAuthProvider {
  readonly url: string;
  /** Passe a `createOAuth({ ... }, { fetch })`. */
  readonly fetch: FetchLike;
  /**
   * A "tela de autorização": recebe o endereço do `302` do início e devolve o que o navegador
   * enviaria ao retorno. Cliente ou PKCE errados lançam (o real pararia na tela do provedor).
   */
  authorize(
    authorizationUrl: string,
    identity: FakeOAuthIdentity,
    failure?: FakeOAuthFailure,
  ): FakeOAuthCallback;
  /** Chamadas recebidas (método e caminho), para conferir o que o código pediu. */
  readonly requests: readonly string[];
}

interface CodeEntry {
  provider: AuthProvider;
  clientId: string;
  redirectUri: string;
  challenge: string;
  nonce: string | null;
  identity: FakeOAuthIdentity;
  failure: FakeOAuthFailure | null;
}

const CLIENT_IDS: Record<AuthProvider, string> = {
  google: OAUTH_MOCK_CLIENTS.google.clientId,
  facebook: OAUTH_MOCK_CLIENTS.facebook.clientId,
  apple: OAUTH_MOCK_CLIENTS.apple.clientId,
};

const token = () => randomBytes(16).toString('base64url');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function providerOf(pathname: string): AuthProvider | null {
  const first = pathname.split('/')[1];
  return first === 'google' || first === 'facebook' || first === 'apple' ? first : null;
}

function relayEmail(sub: string): string {
  const letters = createHash('sha256').update(sub).digest('hex').replace(/\d/g, '').slice(0, 10);
  return `${letters.padEnd(10, 'x')}@${APPLE_PRIVATE_RELAY_DOMAIN}`;
}

/** Cria o provedor falso, com um par de chaves RSA novo (a JWKS de Google e Apple). */
export async function createFakeOAuthProvider(url = FAKE_OAUTH_URL): Promise<FakeOAuthProvider> {
  const base = url.replace(/\/$/, '');
  const keys = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256');
  const kid = token();
  const publicJwk: JWK = { ...(await exportJWK(keys.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, CodeEntry>();
  const accessTokens = new Map<string, CodeEntry>();
  const requests: string[] = [];

  const signIdToken = (entry: CodeEntry, extra: Record<string, unknown>) => {
    const { identity } = entry;
    const audience = entry.failure === 'bad_audience' ? 'outro-cliente' : entry.clientId;
    const nonce = entry.failure === 'bad_nonce' ? 'nonce-diferente' : entry.nonce;
    return new SignJWT({ ...extra, ...(nonce === null ? {} : { nonce }) })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(`${base}/${entry.provider}`)
      .setAudience(audience)
      .setSubject(identity.sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(entry.failure === 'bad_signature' ? other.privateKey : keys.privateKey);
  };

  const emailClaims = (entry: CodeEntry, asText: boolean): Record<string, unknown> => {
    const { identity } = entry;
    const verified = identity.emailVerified ?? true;
    if (entry.provider === 'apple' && identity.hideEmail) {
      return { email: relayEmail(identity.sub), email_verified: 'true', is_private_email: 'true' };
    }
    if (!identity.email) {
      return {};
    }
    return asText
      ? { email: identity.email, email_verified: String(verified), is_private_email: 'false' }
      : { email: identity.email, email_verified: verified };
  };

  const redeem = (provider: AuthProvider, form: URLSearchParams): CodeEntry | Response => {
    const code = form.get('code') ?? '';
    const entry = codes.get(code);
    codes.delete(code);
    if (
      entry === undefined ||
      entry.provider !== provider ||
      entry.clientId !== form.get('client_id') ||
      entry.redirectUri !== form.get('redirect_uri')
    ) {
      return json(400, { error: 'invalid_grant' });
    }
    const verifier = form.get('code_verifier') ?? '';
    if (createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
      return json(400, { error: 'invalid_grant', error_description: 'Invalid code verifier.' });
    }
    if (entry.failure === 'exchange') {
      return json(provider === 'apple' ? 503 : 500, { error: 'server_error' });
    }
    return entry;
  };

  const appleSecretValid = (value: string | null): boolean => {
    try {
      const header = decodeProtectedHeader(value ?? '');
      const claims = decodeJwt(value ?? '');
      return (
        header.alg === 'ES256' &&
        header.kid === OAUTH_MOCK_CLIENTS.apple.keyId &&
        claims.iss === OAUTH_MOCK_CLIENTS.apple.teamId &&
        claims.sub === OAUTH_MOCK_CLIENTS.apple.clientId &&
        claims.aud === `${base}/apple` &&
        typeof claims.exp === 'number' &&
        claims.exp > Date.now() / 1000
      );
    } catch {
      return false;
    }
  };

  const handle = async (request: Request): Promise<Response> => {
    const target = new URL(request.url);
    requests.push(`${request.method} ${target.pathname}`);
    if (target.origin !== new URL(base).origin) {
      throw new TypeError(`fetch failed: ${target.origin} fora do provedor falso`);
    }
    const provider = providerOf(target.pathname);
    const tail = target.pathname.slice(`/${provider}`.length);
    if (provider === 'google' || provider === 'apple') {
      const jwksPath = provider === 'google' ? '/oauth2/v3/certs' : '/auth/keys';
      if (request.method === 'GET' && tail === jwksPath) {
        return json(200, { keys: [publicJwk] });
      }
      const tokenPath = provider === 'google' ? '/token' : '/auth/token';
      if (request.method === 'POST' && tail === tokenPath) {
        const form = new URLSearchParams(await request.text());
        const secretOk =
          provider === 'google'
            ? form.get('client_secret') === OAUTH_MOCK_CLIENTS.google.clientSecret
            : appleSecretValid(form.get('client_secret'));
        if (!secretOk || form.get('grant_type') !== 'authorization_code') {
          return json(provider === 'google' ? 401 : 400, { error: 'invalid_client' });
        }
        const entry = redeem(provider, form);
        if (entry instanceof Response) {
          return entry;
        }
        const accessToken = token();
        const extra =
          provider === 'google'
            ? {
                ...emailClaims(entry, false),
                ...(entry.identity.name ? { name: entry.identity.name } : {}),
              }
            : emailClaims(entry, true);
        return json(200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: await signIdToken(entry, extra),
        });
      }
    }
    if (provider === 'facebook') {
      const version = `/${FACEBOOK_GRAPH_VERSION}`;
      if (request.method === 'GET' && tail === `${version}/oauth/access_token`) {
        const form = target.searchParams;
        if (form.get('client_secret') !== OAUTH_MOCK_CLIENTS.facebook.clientSecret) {
          return json(400, { error: { message: 'Error validating client secret.', code: 1 } });
        }
        const entry = redeem('facebook', form);
        if (entry instanceof Response) {
          return entry;
        }
        const accessToken = token();
        accessTokens.set(accessToken, entry);
        return json(200, {
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: 5_183_944,
        });
      }
      if (request.method === 'GET' && tail === `${version}/me`) {
        const auth = request.headers.get('authorization') ?? '';
        const entry = accessTokens.get(auth.replace(/^Bearer /, ''));
        if (entry === undefined) {
          return json(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
        }
        const { identity } = entry;
        return json(200, {
          id: identity.sub,
          ...(identity.name ? { name: identity.name } : {}),
          ...(identity.email && (identity.emailVerified ?? true) ? { email: identity.email } : {}),
        });
      }
    }
    return json(404, { error: 'not_found' });
  };

  const fetch: FetchLike = (input, init) => handle(new Request(input, init));

  const authorize = (
    authorizationUrl: string,
    identity: FakeOAuthIdentity,
    failure?: FakeOAuthFailure,
  ): FakeOAuthCallback => {
    const target = new URL(authorizationUrl);
    const provider = providerOf(target.pathname);
    if (provider === null || target.origin !== new URL(base).origin) {
      throw new TypeError(`Endereço fora do provedor falso: ${target.origin}${target.pathname}`);
    }
    const params = target.searchParams;
    const clientId = params.get('client_id') ?? '';
    const redirectUri = params.get('redirect_uri') ?? '';
    const challenge = params.get('code_challenge') ?? '';
    if (clientId !== CLIENT_IDS[provider]) {
      throw new TypeError(`client_id desconhecido para ${provider}.`);
    }
    if (!/^https?:\/\//.test(redirectUri)) {
      throw new TypeError('redirect_uri ausente ou inválido.');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get('code_challenge_method') !== 'S256') {
      throw new TypeError('code_challenge (S256) é obrigatório.');
    }
    if (provider === 'apple' && params.get('response_mode') !== 'form_post') {
      throw new TypeError('A Apple exige response_mode=form_post com name e email.');
    }
    const method = provider === 'apple' ? 'POST' : 'GET';
    const state = params.get('state') ?? '';
    const returnedState = failure === 'state' ? `${state}x` : state;
    if (failure === 'deny') {
      return {
        method,
        url: redirectUri,
        params: {
          error: provider === 'apple' ? 'user_cancelled_authorize' : 'access_denied',
          state: returnedState,
        },
      };
    }
    const code = token();
    codes.set(code, {
      provider,
      clientId,
      redirectUri,
      challenge,
      nonce: params.get('nonce'),
      identity,
      failure: failure ?? null,
    });
    const result: Record<string, string> = { code, state: returnedState };
    if (provider === 'apple' && (identity.firstAuthorization ?? true)) {
      const [firstName = '', ...rest] = (identity.name ?? '').split(' ');
      result.user = JSON.stringify({
        name: { firstName, lastName: rest.join(' ') },
        ...(identity.email ? { email: identity.email } : {}),
      });
    }
    return { method, url: redirectUri, params: result };
  };

  return { url: base, fetch, authorize, requests };
}
