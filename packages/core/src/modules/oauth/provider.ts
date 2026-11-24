import {
  createRemoteJWKSet,
  customFetch,
  type FetchImplementation,
  type JWTPayload,
  jwtVerify,
} from 'jose';
import type { AuthProvider } from '../accounts/identities.ts';
import { OAuthProviderError } from './errors.ts';

// Interface única dos provedores (spec 007, "Provedor simulado"; ADR 0024): endereço de
// autorização, troca do código e leitura da identidade. Os endereços são configuração; o mesmo
// código fala com o provedor real, com o simulador e com o provedor falso dos testes.

/** O `fetch` usado para falar com o provedor (o global, ou o do provedor falso nos testes). */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Tempo máximo de cada chamada ao provedor. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** O que o provedor atesta sobre a pessoa. */
export interface ProviderIdentity {
  provider: AuthProvider;
  /** `sub` (Google, Apple) ou `id` (Facebook). */
  providerUserId: string;
  /** Normalizado (minúsculas, sem espaços nas pontas); `null` quando o provedor não enviou. */
  email: string | null;
  /** Spec 007: Google e Apple `email_verified`; Facebook, verdadeiro sempre que há e-mail. */
  emailVerified: boolean;
  name: string | null;
  /** E-mail de retransmissão da Apple (`privaterelay.appleid.com`). */
  privateRelay: boolean;
}

export interface AuthorizationRequest {
  state: string;
  /** Ignorado pelo Facebook, que não é OpenID. */
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface CodeExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  nonce: string;
  /** Os demais campos do retorno (o `user` da Apple traz o nome na primeira autorização). */
  callback: Readonly<Record<string, string>>;
}

export interface OAuthProvider {
  readonly name: AuthProvider;
  /** `form_post`: o retorno é um `POST` de formulário (Apple). */
  readonly responseMode: 'query' | 'form_post';
  authorizationUrl(request: AuthorizationRequest): string;
  /** Troca o código, valida o `id_token` quando houver e lê a identidade. */
  exchangeCode(exchange: CodeExchange): Promise<ProviderIdentity>;
}

export function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Chamada ao provedor que devolve JSON; qualquer falha vira `OAuthProviderError`. */
export async function requestJson(
  fetch: FetchLike,
  provider: AuthProvider,
  step: string,
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OAuthProviderError(`${provider}: ${step} sem resposta`, { cause: error });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new OAuthProviderError(`${provider}: ${step} respondeu ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new OAuthProviderError(`${provider}: ${step} sem JSON`, { cause: error });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new OAuthProviderError(`${provider}: ${step} fora do formato`);
  }
  return body as Record<string, unknown>;
}

/** `POST` `application/x-www-form-urlencoded`, como pedem os endpoints de troca do código. */
export function postForm(
  fetch: FetchLike,
  provider: AuthProvider,
  url: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  return requestJson(fetch, provider, 'troca do código', url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

export function requireString(
  provider: AuthProvider,
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value === '') {
    throw new OAuthProviderError(`${provider}: resposta sem ${field}`);
  }
  return value;
}

/** Google manda booleano; a Apple, texto `"true"`/`"false"` (ou booleano). */
export function claimIsTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

export function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeProviderEmail(value: unknown): string | null {
  const text = optionalText(value);
  return text === null ? null : text.toLowerCase();
}

export interface IdTokenExpectation {
  issuer: string | string[];
  audience: string;
  nonce: string;
}

export type IdTokenVerifier = (
  idToken: string,
  expected: IdTokenExpectation,
) => Promise<JWTPayload>;

/**
 * Validação do `id_token` (spec 007, "Fluxo do provedor"): assinatura pela JWKS do provedor
 * (baixada pelo mesmo `fetch` e guardada pelo `jose`), `iss`, `aud`, `exp` e `nonce`.
 */
export function createIdTokenVerifier(
  provider: AuthProvider,
  jwksUrl: string,
  fetch: FetchLike,
): IdTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUrl), {
    timeoutDuration: PROVIDER_TIMEOUT_MS,
    [customFetch]: fetch as FetchImplementation,
  });
  return async (idToken, expected) => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        issuer: expected.issuer,
        audience: expected.audience,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 30,
      }));
    } catch (error) {
      throw new OAuthProviderError(`${provider}: id_token inválido`, { cause: error });
    }
    if (payload.nonce !== expected.nonce) {
      throw new OAuthProviderError(`${provider}: nonce do id_token não confere`);
    }
    return payload;
  };
}
