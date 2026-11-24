import { createRequestState, type FastifyRequest } from '@nuva-edu/api-kit';
import { unauthenticated } from '@nuva-edu/core';

/** Quem a sessão identifica. Cresce com a sessão real (Fase 1, spec 007). */
export interface SessionUser {
  /** `users.id` do dono da sessão. */
  userId: string;
}

/**
 * Tratador do esquema `sessionCookie` do contrato: devolve o usuário da sessão ou lança um
 * `DomainError` (`unauthenticated()`, ou o de `account_suspended`). Entra por parâmetro em
 * `buildClassroomApp`; os testes injetam um que identifica um usuário de teste.
 */
export type SessionAuthenticator = (request: FastifyRequest) => SessionUser | Promise<SessionUser>;

/**
 * Tratador de produção até a sessão existir (Fase 1, spec 007): recusa sempre. Nenhuma rota
 * protegida fica aberta enquanto não houver login.
 */
export const rejectEverySession: SessionAuthenticator = () => {
  throw unauthenticated();
};

/**
 * O usuário que o tratador de `sessionCookie` identificou, por requisição: `set` no tratador,
 * `get` na rota (`undefined` em operação pública).
 */
export const session = createRequestState<SessionUser>('session');
