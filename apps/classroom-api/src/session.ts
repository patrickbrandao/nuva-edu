import {
  clearApiCookie,
  createRequestState,
  type FastifyReply,
  type FastifyRequest,
  readApiCookie,
  setApiCookie,
} from '@nuva-edu/api-kit';
import {
  type AuthenticatedSession,
  authenticateSession,
  type Database,
  isDomainError,
  type RequestContext,
} from '@nuva-edu/core';

/** Site desta API: cookies, sessões e auditoria são sempre os do classroom. */
export const SITE = 'classroom';

/**
 * Tratador do esquema `sessionCookie` do contrato: devolve a sessão do cookie ou lança um
 * `DomainError` (`401 unauthenticated`). Entra por parâmetro em `buildClassroomApp`; o padrão é
 * `createSessionAuthenticator` (spec 007, "Sessões"). Os testes do fluxo SSE injetam um falso.
 */
export type SessionAuthenticator = (
  request: FastifyRequest,
) => AuthenticatedSession | Promise<AuthenticatedSession>;

/**
 * A sessão que o tratador de `sessionCookie` validou, por requisição: `set` no tratador, `get`
 * na rota (`undefined` em operação pública).
 */
export const session = createRequestState<AuthenticatedSession>('session');

/** Validade do cookie e de `expires_at`, em dias (`config.retention.sessionDays`). */
export function cookieMaxAgeSeconds(ttlDays: number): number {
  return ttlDays * 86_400;
}

/** Tratador real: o cookie `nuva_classroom_session` conferido no banco pelo núcleo. */
export function createSessionAuthenticator(db: Database, ttlDays: number): SessionAuthenticator {
  return (request) =>
    authenticateSession(db, {
      token: readApiCookie(request, SITE, 'session'),
      site: SITE,
      ttlDays,
    });
}

/**
 * Grava o cookie da sessão com o `Max-Age` cheio: no login e quando a validação renovou
 * `expires_at` (spec 007, "Cookies").
 */
export function writeSessionCookie(reply: FastifyReply, token: string, ttlDays: number): void {
  setApiCookie(reply, SITE, 'session', token, { maxAgeSeconds: cookieMaxAgeSeconds(ttlDays) });
}

export function clearSessionCookie(reply: FastifyReply): void {
  clearApiCookie(reply, SITE, 'session');
}

/**
 * Confere a sessão de uma requisição e guarda o resultado em `session`. Sessão inválida com
 * cookie presente: o cookie é apagado na resposta de erro. Renovada: o cookie é regravado.
 */
export async function establishSession(
  request: FastifyRequest,
  reply: FastifyReply,
  authenticate: SessionAuthenticator,
  ttlDays: number,
): Promise<AuthenticatedSession> {
  try {
    const current = await authenticate(request);
    session.set(request, current);
    if (current.renewed) {
      const token = readApiCookie(request, SITE, 'session');
      if (token !== null) {
        writeSessionCookie(reply, token, ttlDays);
      }
    }
    return current;
  } catch (error) {
    if (
      isDomainError(error) &&
      error.status === 401 &&
      readApiCookie(request, SITE, 'session') !== null
    ) {
      clearSessionCookie(reply);
    }
    throw error;
  }
}

/** Dados da requisição para as regras de conta: IP real, navegador e `X-Request-Id`. */
export function requestContext(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.client.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    requestId: request.id,
  };
}
