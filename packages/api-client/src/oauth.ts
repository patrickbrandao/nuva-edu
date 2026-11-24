/**
 * Login social: `GET /api/v1/auth/{provider}/start` (`startOAuth`) e as voltas do provedor
 * (`oauthCallback`, `oauthCallbackForm`) só respondem `302`. O navegador navega até elas; não
 * se chamam por `fetch` (o `fetch` seguiria o redirecionamento até o provedor e falharia por
 * CORS). Por isso o cliente oferece só a montagem da URL de início.
 */

/** Caminho de `startOAuth`, com `{provider}` no lugar do provedor. */
export const OAUTH_START_PATH = '/api/v1/auth/{provider}/start';

export interface OAuthStartQuery {
  /** Caminho do próprio site para onde o navegador volta (começa com `/`). */
  returnTo?: string;
  /** Só no classroom: `login` (padrão) entra ou cadastra; `link` vincula à conta da sessão. */
  intent?: 'login' | 'link';
}

/**
 * Monta a URL de `startOAuth`. Sem `baseUrl`, devolve um caminho relativo à própria origem
 * (o uso normal nos sites: `window.location.assign(url)`).
 */
export function buildOAuthStartUrl(
  provider: string,
  query: OAuthStartQuery = {},
  baseUrl = '',
): string {
  const path = OAUTH_START_PATH.replace('{provider}', encodeURIComponent(provider));
  const params = new URLSearchParams();
  if (query.intent !== undefined) params.set('intent', query.intent);
  if (query.returnTo !== undefined) params.set('returnTo', query.returnTo);
  const search = params.toString();
  return `${baseUrl.replace(/\/+$/, '')}${path}${search ? `?${search}` : ''}`;
}
