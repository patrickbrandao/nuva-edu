import type { FastifyReply, FastifyRequest } from 'fastify';

/** Site dono do cookie: cada API grava só os do próprio site. */
export type ApiSite = 'admin' | 'classroom';

/**
 * Os dois tipos de cookie do sistema (spec 007, "Cookies"); são os únicos, ambos estritamente
 * necessários (spec 030, RF-09).
 *
 * - `session`: identificador aleatório da sessão, conferido no banco. Não é assinado. É o único
 *   que `setApiCookie` e `readApiCookie` gravam e leem.
 * - `oauth`: estado do retorno do provedor (`state`, `nonce`, PKCE...). Quem o assina (HMAC com
 *   `SESSION_SECRET`) e confere é o núcleo (`packages/core`, módulo `oauth`); a API o grava com
 *   `reply.setCookie` usando o nome, o valor e as opções que o núcleo devolve, e entrega o valor
 *   cru de `request.cookies` ao núcleo. O api-kit não assina nem confere esse cookie: o nome e
 *   os atributos daqui servem só para apagá-lo (`clearApiCookie`) e para conferência.
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
 * Recusa o cookie de retorno OAuth nos auxiliares de gravação e leitura: ele já chega assinado
 * pelo núcleo, e assiná-lo aqui de novo (ou exigir uma segunda assinatura na leitura) quebraria
 * o fluxo.
 */
function assertSessionKind(kind: string, helper: string): void {
  if (kind !== 'session') {
    throw new TypeError(
      `${helper} só trata o cookie "session". O de retorno OAuth é assinado e conferido pelo ` +
        'núcleo: grave-o com reply.setCookie e leia o valor cru de request.cookies.',
    );
  }
}

/** Grava o cookie de sessão com os atributos da spec 007. Sem assinatura. */
export function setApiCookie(
  reply: FastifyReply,
  site: ApiSite,
  kind: 'session',
  value: string,
  options: SetApiCookieOptions,
): FastifyReply {
  assertSessionKind(kind, 'setApiCookie');
  if (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw new TypeError('maxAgeSeconds deve ser um inteiro positivo.');
  }
  return reply.setCookie(cookieName(site, kind), value, {
    ...COOKIE_ATTRIBUTES[kind],
    maxAge: options.maxAgeSeconds,
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

/** Valor do cookie de sessão na requisição, ou `null` quando não veio. */
export function readApiCookie(
  request: FastifyRequest,
  site: ApiSite,
  kind: 'session',
): string | null {
  assertSessionKind(kind, 'readApiCookie');
  const raw = request.cookies?.[cookieName(site, kind)];
  return raw === undefined || raw === '' ? null : raw;
}
