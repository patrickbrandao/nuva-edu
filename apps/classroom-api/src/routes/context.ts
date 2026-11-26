import type { FastifyRequest, StreamHub } from '@nuva-edu/api-kit';
import {
  type AuthenticatedSession,
  type Config,
  type Database,
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
