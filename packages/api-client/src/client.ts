import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch';
import { ApiNetworkError, apiErrorFromResponse } from './problem';

/** Nome do cabeçalho CSRF definido nos contratos (parâmetro `CsrfToken`). */
export const CSRF_HEADER = 'X-CSRF-Token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

export interface ApiClientOptions {
  /**
   * Origem da API. Padrão: a origem da própria página (os sites só chamam a API do próprio
   * endereço). Informe um endereço absoluto fora do navegador (testes, scripts).
   */
  baseUrl?: string;
  /**
   * Devolve o token CSRF da sessão (vem de `GET /api/v1/session`). Chamado a cada requisição
   * que altera dados; o cabeçalho só é preenchido quando a chamada não o informou.
   */
  csrfToken?: () => string | null | undefined;
  /** Substitui o `fetch` global (testes). */
  fetch?: ClientOptions['fetch'];
}

/**
 * Comportamento comum dos dois clientes:
 * - envia o cabeçalho CSRF nas requisições que alteram dados;
 * - transforma resposta fora de 2xx em `ApiError` (problem+json) lançado;
 * - transforma falha de rede em `ApiNetworkError`.
 */
function defaultMiddleware(options: ApiClientOptions): Middleware {
  return {
    onRequest({ request }) {
      if (SAFE_METHODS.has(request.method) || request.headers.has(CSRF_HEADER)) return;
      const token = options.csrfToken?.();
      if (token) request.headers.set(CSRF_HEADER, token);
      return request;
    },
    async onResponse({ response }) {
      if (!response.ok) throw await apiErrorFromResponse(response);
    },
    onError({ request, error }) {
      return new ApiNetworkError(request, error);
    },
  };
}

/**
 * Cria um cliente tipado pelo `paths` de um contrato. Use `createAdminClient` ou
 * `createClassroomClient`; esta função existe para os dois compartilharem o comportamento.
 */
export function createApiClient<Paths extends {}>(options: ApiClientOptions = {}): Client<Paths> {
  const client = createClient<Paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'include',
    headers: { Accept: 'application/json, application/problem+json' },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.use(defaultMiddleware(options));
  return client;
}
