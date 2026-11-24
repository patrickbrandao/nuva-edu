import type { components } from './generated/admin';

/**
 * Corpo de erro `application/problem+json` (RFC 9457). O esquema `Problem` é comum aos dois
 * contratos; o tipo vem do gerado da admin-api.
 */
export type Problem = components['schemas']['Problem'];
export type ProblemFieldError = components['schemas']['ProblemFieldError'];

/** `code` usado quando a resposta de erro não traz um problem+json válido. */
export const UNKNOWN_ERROR_CODE = 'unknown_error';

/** Resposta de erro da API (status fora de 2xx), já com o problem+json lido. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** Status HTTP da resposta. */
  readonly status: number;
  /** Identificador estável do erro (`Problem.code`), para decidir o que fazer. */
  readonly code: string;
  /** Corpo do erro; sintetizado a partir do status quando a resposta não é problem+json. */
  readonly problem: Problem;
  /** `X-Request-Id` da resposta, para o usuário informar ao suporte. */
  readonly requestId: string | undefined;
  /** Segundos do cabeçalho `Retry-After` (presente em `429`). */
  readonly retryAfter: number | undefined;
  readonly response: Response;

  constructor(problem: Problem, response: Response) {
    super(problem.detail ?? problem.title);
    this.status = response.status;
    this.code = problem.code;
    this.problem = problem;
    this.requestId = response.headers.get('X-Request-Id') ?? undefined;
    const retryAfter = response.headers.get('Retry-After');
    this.retryAfter =
      retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    this.response = response;
  }

  /** Campos recusados na validação (`400`); vazio nos demais erros. */
  get fieldErrors(): ProblemFieldError[] {
    return this.problem.errors ?? [];
  }
}

/** A requisição não chegou a ter resposta (rede fora, servidor inacessível, cancelamento). */
export class ApiNetworkError extends Error {
  override readonly name = 'ApiNetworkError';

  constructor(request: Request, cause: unknown) {
    super(`sem resposta de ${request.method} ${request.url}`, { cause });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.status === 'number' &&
    typeof candidate.code === 'string'
  );
}

/** Lê o corpo de uma resposta de erro e devolve o `ApiError` correspondente. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    body = undefined;
  }
  const problem: Problem = isProblem(body)
    ? body
    : {
        type: 'about:blank',
        title: response.statusText || `HTTP ${response.status}`,
        status: response.status,
        code: UNKNOWN_ERROR_CODE,
      };
  return new ApiError(problem, response);
}
