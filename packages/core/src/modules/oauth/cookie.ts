import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AccountSite } from '../accounts/context.ts';
import { type AuthProvider, isAuthProvider } from '../accounts/identities.ts';

// Cookie de retorno do login social (spec 007, "Cookies"): JSON com `state`, `nonce`, verificador
// PKCE, provedor, `intent`, `returnTo` e, no cadastro pendente, os dados do provedor; assinado com
// HMAC-SHA256 por `SESSION_SECRET`. Não é cifrado: é `HttpOnly` e não guarda segredo do usuário.

export const OAUTH_COOKIE_NAMES: { readonly [S in AccountSite]: string } = {
  classroom: 'nuva_classroom_oauth',
  admin: 'nuva_admin_oauth',
};

export const OAUTH_COOKIE_PATH = '/api/v1/auth';
/** Validade do cookie durante a ida ao provedor. */
export const OAUTH_FLOW_TTL_SECONDS = 10 * 60;
/** Validade do cookie regravado no cadastro pendente. */
export const OAUTH_PENDING_TTL_SECONDS = 30 * 60;

export function oauthCookieName(site: AccountSite): string {
  return OAUTH_COOKIE_NAMES[site];
}

/** `SameSite=None`: o retorno da Apple é um `POST` vindo de outro site. */
export interface OAuthCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: 'none';
  path: typeof OAUTH_COOKIE_PATH;
  /** Segundos; `0` apaga o cookie. */
  maxAge: number;
}

/** O que a API grava na resposta (`value` vazio com `maxAge` 0 apaga). */
export interface OAuthCookie {
  name: string;
  value: string;
  options: OAuthCookieOptions;
}

export function oauthCookieOptions(maxAge: number): OAuthCookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'none', path: OAUTH_COOKIE_PATH, maxAge };
}

/** Cookie que apaga o de retorno do site. */
export function clearOAuthCookie(site: AccountSite): OAuthCookie {
  return { name: oauthCookieName(site), value: '', options: oauthCookieOptions(0) };
}

export type OAuthIntent = 'login' | 'link';

/** Ida ao provedor. */
export interface OAuthFlowState {
  provider: AuthProvider;
  intent: OAuthIntent;
  returnTo: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** `intent=link`: o dono da sessão que pediu o vínculo; o retorno exige a mesma sessão. */
  linkUserId: string | null;
}

/** Dados do provedor guardados para o cadastro pendente. */
export interface SocialPendingData {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  returnTo: string;
}

export type OAuthCookiePayload =
  | { kind: 'flow'; site: AccountSite; exp: number; flow: OAuthFlowState }
  | { kind: 'pending'; site: AccountSite; exp: number; pending: SocialPendingData };

const SIGNATURE_LABEL = 'nuva-edu:oauth-cookie:v1:';

function sign(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(SIGNATURE_LABEL).update(body).digest();
}

function requireSecret(secret: string | null): string {
  if (secret === null || secret === '') {
    throw new TypeError('O login social exige SESSION_SECRET (spec 031, "Segredos exigidos").');
  }
  return secret;
}

/** Valor assinado do cookie: `<JSON em base64url>.<HMAC em base64url>`. */
export function encodeOAuthCookie(secret: string | null, payload: OAuthCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(requireSecret(secret), body).toString('base64url')}`;
}

/**
 * Lê o cookie: assinatura conferida em tempo constante, site e validade conferidos. Qualquer
 * falha (ausente, adulterado, de outro site, vencido, fora do formato) devolve `null`.
 */
export function decodeOAuthCookie(
  secret: string | null,
  value: string | null | undefined,
  site: AccountSite,
  nowSeconds: number,
): OAuthCookiePayload | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const dot = value.indexOf('.');
  if (dot <= 0 || dot !== value.lastIndexOf('.')) {
    return null;
  }
  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), 'base64url');
  const expected = sign(requireSecret(secret), body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.site !== site || payload.exp <= nowSeconds) {
    return null;
  }
  return payload;
}

function isPayload(value: unknown): value is OAuthCookiePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.exp !== 'number' || (record.site !== 'classroom' && record.site !== 'admin')) {
    return false;
  }
  const inner = (record.kind === 'flow' ? record.flow : record.pending) as
    | Record<string, unknown>
    | undefined;
  if (
    (record.kind !== 'flow' && record.kind !== 'pending') ||
    typeof inner !== 'object' ||
    inner === null
  ) {
    return false;
  }
  return isAuthProvider(inner.provider) && typeof inner.returnTo === 'string';
}

/** 32 bytes aleatórios em base64url (43 caracteres): `state`, `nonce` e verificador PKCE. */
export function randomUrlToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `code_challenge` S256 do verificador PKCE (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Compara o `state` do retorno com o do cookie em tempo constante. */
export function stateMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') {
    return false;
  }
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b) && given === expected;
}
