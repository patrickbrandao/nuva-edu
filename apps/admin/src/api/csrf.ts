/*
 * Token CSRF da sessão atual (spec 007, "CSRF"). Vem de `GET /api/v1/session` ou do login e vale
 * só na memória da página: não vai para `localStorage` nem para cookie legível pelo JavaScript.
 * O cliente da API o lê a cada escrita, pelo `csrfToken` de `createAdminClient`.
 */
let token: string | null = null;

export function setCsrfToken(value: string | null): void {
  token = value;
}

export function getCsrfToken(): string | null {
  return token;
}
