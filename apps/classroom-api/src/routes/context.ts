import type { FastifyRequest, StreamHub } from '@nuva-edu/api-kit';
import {
  type AuthenticatedSession,
  type Config,
  type Database,
  type PaymentProvider,
  type UserEventKind,
  unauthenticated,
} from '@nuva-edu/core';
import { session } from '../session.ts';

/** O que as rotas de negócio recebem de `buildClassroomApp`. */
export interface RouteContext {
  config: Config;
  db: Database;
  /** Fluxo SSE: as rotas que encerram sessões fecham as conexões delas. */
  hub: StreamHub<UserEventKind>;
  /** Validade da sessão, em dias (`config.retention.sessionDays`). */
  ttlDays: number;
}

/** Rotas que conversam com a porta de pagamento (resolvida sob demanda, spec 013 RF-09). */
export interface PaymentRouteContext extends RouteContext {
  paymentProvider(): PaymentProvider;
}

/** A sessão validada pelo tratador de `sessionCookie` (só em operação com sessão). */
export function requireSession(request: FastifyRequest): AuthenticatedSession {
  const current = session.get(request);
  if (!current) {
    throw unauthenticated();
  }
  return current;
}

/** Corpo JSON já validado pelo contrato. */
export function bodyOf<T>(request: FastifyRequest): T {
  return request.body as T;
}

/** Parâmetros de caminho já validados pelo contrato. */
export function paramsOf<T>(request: FastifyRequest): T {
  return request.params as T;
}

/** Cabeçalho opcional de texto único já validado pelo contrato. */
export function headerOf(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}
