import type { FastifyRequest } from 'fastify';

/** Um dado da API associado a cada requisição, com tipo (`createRequestState`). */
export interface RequestState<T> {
  /** Valor guardado para a requisição, ou `undefined`. */
  get(request: FastifyRequest): T | undefined;
  /** Valor guardado; lança `TypeError` se ninguém o guardou (erro de programação). */
  require(request: FastifyRequest): T;
  set(request: FastifyRequest, value: T): void;
  delete(request: FastifyRequest): void;
}

/**
 * Cria um lugar tipado para a API guardar um dado por requisição (o usuário da sessão, a chave
 * de API...), sem decorar o `request` nem depender dos tipos do Fastify:
 *
 * ```ts
 * const session = createRequestState<SessionUser>('session');
 * // no tratador de `sessionCookie`: session.set(request, user);
 * // na rota: const user = session.require(request);
 * ```
 *
 * O dado some com a requisição (`WeakMap`). O `name` só aparece na mensagem de erro.
 */
export function createRequestState<T>(name: string): RequestState<T> {
  const values = new WeakMap<FastifyRequest, { value: T }>();
  return {
    get: (request) => values.get(request)?.value,
    require(request) {
      const entry = values.get(request);
      if (!entry) {
        throw new TypeError(`Nenhum valor de "${name}" foi guardado para esta requisição.`);
      }
      return entry.value;
    },
    set(request, value) {
      values.set(request, { value });
    },
    delete(request) {
      values.delete(request);
    },
  };
}
