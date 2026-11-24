/** Nome do parâmetro com o caminho de volta depois do login (`/entrar?destino=/conta`). */
export const RETURN_PARAM = 'destino';

/** Para onde vai quem entra sem destino: a tela inicial do aluno (spec 006). */
export const DEFAULT_AFTER_LOGIN = '/inicio';

/** Telas de autenticação: não servem de destino (voltar a elas depois de entrar não faz sentido). */
const AUTH_PATHS = ['/entrar', '/cadastro', '/confirmar', '/redefinir'];

/**
 * Caminho de volta seguro: só caminho do próprio site (começa com `/`, não com `//` nem `/\`),
 * como o `returnTo` da API (spec 007, "Fluxo do provedor"). Outro valor vira `null`.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if ([...value].some((char) => char.charCodeAt(0) < 32)) return null;
  const path = value.split(/[?#]/)[0] ?? '';
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) return null;
  return value;
}

/** Endereço de uma tela de autenticação levando o destino adiante, quando houver. */
export function withReturnTo(path: string, returnTo: string | null): string {
  if (!returnTo || returnTo === '/') return path;
  return `${path}?${new URLSearchParams({ [RETURN_PARAM]: returnTo }).toString()}`;
}
