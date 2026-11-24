import { HOME_PATH, LOGIN_PATH } from '../shell/menu';

/** Parâmetro de `/entrar` com o endereço a abrir depois do login. */
export const DESTINATION_PARAM = 'destino';
/** Parâmetro de `/entrar` com o código de erro da volta do login social (spec 007). */
export const ERROR_PARAM = 'erro';

/**
 * Destino seguro: caminho do próprio site (começa com `/`, não com `//` nem `/\`) e que não é a
 * própria tela de entrada. Qualquer outro valor vira o painel.
 */
export function safeDestination(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return HOME_PATH;
  }
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return HOME_PATH;
  return value;
}

/** Endereço de `/entrar` guardando o destino (o painel não precisa ser guardado). */
export function loginPath(destination: string): string {
  const safe = safeDestination(destination);
  if (safe === HOME_PATH) return LOGIN_PATH;
  return `${LOGIN_PATH}?${new URLSearchParams({ [DESTINATION_PARAM]: safe })}`;
}
