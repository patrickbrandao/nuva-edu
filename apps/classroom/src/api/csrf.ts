/*
 * Token CSRF da sessão atual (spec 007, "Sessões"). Vem de `GET /api/v1/session` e das respostas
 * que abrem sessão; o cliente da API o lê a cada escrita. Fica fora do React porque o cliente é
 * criado uma vez, antes da árvore.
 */
let current: string | null = null;

export function setCsrfToken(token: string | null): void {
  current = token;
}

export function getCsrfToken(): string | null {
  return current;
}
