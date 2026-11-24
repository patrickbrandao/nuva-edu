import {
  DomainError,
  type FieldError,
  notFound,
  type Problem,
  toProblem,
  unavailable,
  validationFailed,
} from '@nuva-edu/core';

/** A resposta montada pela rota não confere com o contrato: vira `internal_error` (500). */
export class ResponseContractError extends Error {
  readonly reason: string;

  constructor(reason: string, detail: string) {
    super(detail);
    this.name = 'ResponseContractError';
    this.reason = reason;
  }
}

export interface ResolvedError {
  problem: Problem;
  /**
   * `expected`: recusa prevista (validação, permissão, regra); registra-se sem pilha.
   * `unexpected`: falha do serviço ou de dependência; o erro original vai para o log.
   */
  kind: 'expected' | 'unexpected';
}

/** 413: o corpo passa do limite do serviço ou da operação (spec 003). */
export function payloadTooLarge(detail?: string): DomainError {
  return new DomainError({
    code: 'payload_too_large',
    status: 413,
    title: 'Corpo grande demais',
    detail: detail ?? 'O corpo da requisição passa do tamanho permitido.',
  });
}

/** 415: o `Content-Type` da requisição não é aceito pela operação (spec 003). */
export function unsupportedMediaType(detail?: string): DomainError {
  return new DomainError({
    code: 'unsupported_media_type',
    status: 415,
    title: 'Tipo de conteúdo não suportado',
    detail: detail ?? 'Tipo de conteúdo não aceito.',
  });
}

/** Erros de requisição do próprio Fastify, com a mensagem que vai ao cliente. */
const CLIENT_ERRORS: Record<string, string> = {
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'O Content-Length não confere com o corpo enviado.',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'O corpo está vazio, mas o Content-Type é application/json.',
  FST_ERR_CTP_INVALID_JSON_BODY: 'O corpo não é um JSON válido.',
};

/** Códigos de erro de rede do Node que indicam servidor de banco inalcançável. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/** SQLSTATE do PostgreSQL para "não dá para atender agora" (além da classe 08, de conexão). */
const UNAVAILABLE_SQLSTATES = new Set(['57P01', '57P02', '57P03', '53300']);

const POOL_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated',
  'connection terminated',
  'Client has encountered a connection error',
];

/**
 * Verdadeiro para falha de conexão com o PostgreSQL (servidor fora do ar, em recuperação, pool
 * sem conexão), olhando o erro e a cadeia de `cause` e de `AggregateError`.
 */
export function isDatabaseUnavailable(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 5) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (NETWORK_CODES.has(code) || UNAVAILABLE_SQLSTATES.has(code)) {
      return true;
    }
    // Classe 08 do SQLSTATE: exceção de conexão.
    if (/^08[0-9A-Z]{3}$/.test(code)) {
      return true;
    }
  }
  if (POOL_MESSAGES.some((message) => error.message.includes(message))) {
    return true;
  }
  if (error instanceof AggregateError) {
    return error.errors.some((inner) => isDatabaseUnavailable(inner, depth + 1));
  }
  return error.cause !== undefined && isDatabaseUnavailable(error.cause, depth + 1);
}

/**
 * Converte qualquer erro de uma requisição no problem+json da spec 003:
 * `DomainError` sai como está; erro de requisição do Fastify vira `validation_failed` (400),
 * salvo corpo acima do limite (`payload_too_large`, 413) e `Content-Type` sem suporte
 * (`unsupported_media_type`, 415); rota inexistente, `not_found` (404); banco fora do ar, `database_unavailable` (503); o resto,
 * `internal_error` (500) sem detalhe.
 */
export function resolveError(error: unknown, instance: string | undefined): ResolvedError {
  const options = { instance };
  if (error instanceof DomainError) {
    return {
      problem: toProblem(error, options),
      kind: error.status >= 500 ? 'unexpected' : 'expected',
    };
  }
  if (error instanceof ResponseContractError) {
    return { problem: toProblem(error, options), kind: 'unexpected' };
  }
  if (isDatabaseUnavailable(error)) {
    return {
      problem: toProblem(
        unavailable('database_unavailable', 'O banco de dados está indisponível.', error),
        options,
      ),
      kind: 'unexpected',
    };
  }
  const client = clientError(error);
  if (client) {
    return { problem: toProblem(client, options), kind: 'expected' };
  }
  return { problem: toProblem(error, options), kind: 'unexpected' };
}

/** Erro 4xx gerado pelo Fastify antes de a rota rodar (corpo malformado, grande demais...). */
function clientError(error: unknown): DomainError | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  // Só os erros do próprio Fastify: quem escreve rota ou plugin lança `DomainError`.
  if (
    typeof code !== 'string' ||
    !code.startsWith('FST_ERR_') ||
    typeof statusCode !== 'number' ||
    statusCode < 400 ||
    statusCode > 499
  ) {
    return null;
  }
  if (statusCode === 404) {
    return notFound();
  }
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return payloadTooLarge();
  }
  if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return unsupportedMediaType();
  }
  const known = CLIENT_ERRORS[code];
  const isBody = code.startsWith('FST_ERR_CTP_');
  const errors: FieldError[] = isBody
    ? [{ path: 'body', message: known ?? 'Corpo da requisição inválido.' }]
    : [];
  return validationFailed(errors, known ?? 'Requisição inválida.');
}
