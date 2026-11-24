import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch';
import { ApiNetworkError, apiErrorFromResponse } from './problem';

/** Nome do cabeçalho CSRF definido nos contratos (esquema de segurança `csrfToken`). */
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
   * que altera dados; o cabeçalho só é preenchido quando a chamada não o informou. Como o
   * contrato declara o CSRF como esquema de segurança, e não como parâmetro, o tipo gerado das
   * operações não o pede: é este preenchimento que o envia.
   */
  csrfToken?: () => string | null | undefined;
  /** Substitui o `fetch` global (testes). */
  fetch?: ClientOptions['fetch'];
}

/**
 * Comportamento comum dos dois clientes:
 * - envia o cabeçalho CSRF nas requisições que alteram dados;
 * - transforma resposta `4xx`/`5xx` em `ApiError` (problem+json) lançado;
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
      // Só 4xx e 5xx são erro. O `304` de `getImageVariant` (com `If-None-Match`) volta como
      // resposta comum, sem corpo: quem chama confere `response.status`.
      if (response.status >= 400) throw await apiErrorFromResponse(response);
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
