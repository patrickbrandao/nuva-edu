/** Um campo recusado na validação (`ProblemFieldError` do contrato). */
export interface FieldError {
  /** Caminho do campo na requisição, como `body.email`. */
  path: string;
  message: string;
}

export interface DomainErrorInit {
  /** Identificador estável, em `snake_case`; o cliente decide o que fazer por ele. */
  code: string;
  /** Status HTTP que a API devolve. */
  status: number;
  /** Resumo curto, igual para todas as ocorrências do mesmo `code`. */
  title: string;
  /** Explicação desta ocorrência. Vai ao cliente: não inclua dado interno nem sensível. */
  detail?: string | undefined;
  errors?: readonly FieldError[] | undefined;
  /** Campos extras do problem+json, conforme o `code` (ex.: `retryAfterSeconds`). */
  extras?: Readonly<Record<string, unknown>> | undefined;
  cause?: unknown;
}

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Erro de regra de negócio ou de acesso. É o único tipo de erro que as APIs mostram ao
 * cliente; qualquer outro vira `internal_error` em `toProblem`.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: readonly FieldError[] | undefined;
  readonly extras: Readonly<Record<string, unknown>> | undefined;

  constructor(init: DomainErrorInit) {
    super(init.detail ?? init.title, init.cause === undefined ? undefined : { cause: init.cause });
    if (!CODE_PATTERN.test(init.code)) {
      throw new TypeError(`Código de erro inválido: "${init.code}" (use snake_case).`);
    }
    if (!Number.isInteger(init.status) || init.status < 400 || init.status > 599) {
      throw new TypeError(`Status de erro inválido: ${init.status} (use 400 a 599).`);
    }
    this.name = 'DomainError';
    this.code = init.code;
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.errors = init.errors;
    this.extras = init.extras;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** 400: dados da requisição inválidos; `errors` lista os campos. */
export function validationFailed(errors: readonly FieldError[], detail?: string): DomainError {
  return new DomainError({
    code: 'validation_failed',
    status: 400,
    title: 'Dados inválidos',
    detail,
    errors,
  });
}

/** 401: sem sessão válida. */
export function unauthenticated(detail?: string): DomainError {
  return new DomainError({
    code: 'unauthenticated',
    status: 401,
    title: 'Sessão necessária',
    detail,
  });
}

/** 403: sessão válida, sem permissão para a operação. */
export function permissionDenied(detail?: string): DomainError {
  return new DomainError({
    code: 'permission_denied',
    status: 403,
    title: 'Sem permissão',
    detail,
  });
}

/** 404: inexistente ou fora do alcance de quem pede. */
export function notFound(detail?: string): DomainError {
  return new DomainError({ code: 'not_found', status: 404, title: 'Não encontrado', detail });
}

/** 409: conflito de estado (versão divergente, registro duplicado). */
export function conflict(code: string, detail?: string): DomainError {
  return new DomainError({ code, status: 409, title: 'Conflito de estado', detail });
}

/** 422: requisição bem formada que uma regra de negócio recusa. */
export function businessRule(code: string, detail?: string): DomainError {
  return new DomainError({ code, status: 422, title: 'Regra de negócio não atendida', detail });
}

/** 429: limite de taxa atingido. */
export function rateLimited(retryAfterSeconds?: number, detail?: string): DomainError {
  return new DomainError({
    code: 'rate_limited',
    status: 429,
    title: 'Muitas requisições',
    detail,
    extras: retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
  });
}

/** 503: dependência indisponível (`database_unavailable`, `payment_provider_unavailable`...). */
export function unavailable(code: string, detail?: string, cause?: unknown): DomainError {
  return new DomainError({ code, status: 503, title: 'Serviço indisponível', detail, cause });
}
