import type { FastifyRequest } from '@nuva-edu/api-kit';
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

// Guardado fora do `request`: declarar um campo novo nele exigiria estender os tipos do
// Fastify, que é dependência do `@nuva-edu/api-kit`, não deste serviço.
const sessions = new WeakMap<FastifyRequest, SessionUser>();

/** Guarda o usuário identificado pelo tratador de `sessionCookie`. */
export function setSessionUser(request: FastifyRequest, user: SessionUser): void {
  sessions.set(request, user);
}

/** Usuário da sessão; `null` em operação pública. */
export function getSessionUser(request: FastifyRequest): SessionUser | null {
  return sessions.get(request) ?? null;
}
