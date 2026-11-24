import type { FastifyReply, FastifyRequest } from 'fastify';

/** Site dono do cookie: cada API grava só os do próprio site. */
export type ApiSite = 'admin' | 'classroom';

/**
 * Os dois tipos de cookie do sistema (spec 007, "Cookies"); são os únicos, ambos estritamente
 * necessários (spec 030, RF-09).
 *
 * - `session`: identificador aleatório da sessão, conferido no banco. Não é assinado.
 * - `oauth`: estado do retorno do provedor (`state`, `nonce`, PKCE...), assinado com
 *   HMAC-SHA256 por `SESSION_SECRET` (`cookieSecret` em `createApiApp`).
 */
export type ApiCookieKind = 'session' | 'oauth';

export interface ApiCookieAttributes {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'lax' | 'none';
  readonly path: string;
}

/**
 * Atributos de cada tipo, como na spec 007. Nenhum leva `Domain`: o cookie vale só no host do
 * site. O de retorno é `SameSite=None` porque o retorno da Apple é um `POST` vindo de outro
 * site, e fica restrito a `/api/v1/auth`.
 */
export const COOKIE_ATTRIBUTES: Readonly<Record<ApiCookieKind, ApiCookieAttributes>> = {
  session: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
  oauth: { httpOnly: true, secure: true, sameSite: 'none', path: '/api/v1/auth' },
};

/** Nomes dos cookies de um site: `nuva_admin_session`, `nuva_classroom_oauth`... */
export function cookieName(site: ApiSite, kind: ApiCookieKind): string {
  return `nuva_${site}_${kind}`;
}

export interface SetApiCookieOptions {
  /** Validade em segundos (`Max-Age`). */
  maxAgeSeconds: number;
}

/**
 * Grava um cookie com os atributos do tipo. O de retorno (`oauth`) é assinado e exige
 * `cookieSecret` em `createApiApp`.
 */
export function setApiCookie(
  reply: FastifyReply,
  site: ApiSite,
  kind: ApiCookieKind,
  value: string,
  options: SetApiCookieOptions,
): FastifyReply {
  if (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw new TypeError('maxAgeSeconds deve ser um inteiro positivo.');
  }
  const signed = kind === 'oauth';
  if (signed && typeof reply.signCookie !== 'function') {
    throw new TypeError('O cookie de retorno é assinado: passe "cookieSecret" a createApiApp.');
  }
  return reply.setCookie(cookieName(site, kind), value, {
    ...COOKIE_ATTRIBUTES[kind],
    maxAge: options.maxAgeSeconds,
    signed,
  });
}

/** Apaga o cookie: mesmo nome e mesmo `Path` da gravação, validade zero. */
export function clearApiCookie(
  reply: FastifyReply,
  site: ApiSite,
  kind: ApiCookieKind,
): FastifyReply {
  return reply.clearCookie(cookieName(site, kind), { ...COOKIE_ATTRIBUTES[kind] });
}

/**
 * Valor do cookie na requisição, ou `null` quando não veio. O de retorno só volta se a
 * assinatura conferir (comparação em tempo constante); assinatura inválida vale como ausente.
 */
export function readApiCookie(
  request: FastifyRequest,
  site: ApiSite,
  kind: ApiCookieKind,
): string | null {
  const raw = request.cookies?.[cookieName(site, kind)];
  if (raw === undefined || raw === '') {
    return null;
  }
  if (kind === 'session') {
    return raw;
  }
  if (typeof request.unsignCookie !== 'function') {
    throw new TypeError('O cookie de retorno é assinado: passe "cookieSecret" a createApiApp.');
  }
  const result = request.unsignCookie(raw);
  return result.valid ? result.value : null;
}
