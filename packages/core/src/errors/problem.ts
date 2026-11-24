import { DomainError, type FieldError } from './domain-error.ts';

/** Tipo de mídia das respostas de erro (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Corpo de erro das APIs: o esquema `Problem` dos dois `openapi.yaml`. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
  [extra: string]: unknown;
}

export interface ToProblemOptions {
  /** Caminho da requisição que falhou. */
  instance?: string | undefined;
}

/**
 * Converte qualquer erro no corpo problem+json. Só `DomainError` expõe `code` e `detail`
 * próprios; o resto vira `internal_error` (500) sem detalhe, para não vazar dado interno:
 * o erro original vai para o log, não para o cliente.
 */
export function toProblem(error: unknown, options: ToProblemOptions = {}): Problem {
  const problem: Problem =
    error instanceof DomainError
      ? {
          // Campos extras primeiro: nunca sobrescrevem os do padrão.
          ...error.extras,
          type: 'about:blank',
          title: error.title,
          status: error.status,
          code: error.code,
        }
      : { type: 'about:blank', title: 'Erro interno', status: 500, code: 'internal_error' };

  if (error instanceof DomainError) {
    if (error.detail !== undefined) {
      problem.detail = error.detail;
    }
    if (error.errors !== undefined) {
      problem.errors = error.errors.map(({ path, message }) => ({ path, message }));
    }
  }
  if (options.instance !== undefined) {
    problem.instance = options.instance;
  }
  return problem;
}
