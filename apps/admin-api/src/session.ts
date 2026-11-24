import {
  type ContractOperation,
  clearApiCookie,
  createRequestState,
  type FastifyInstance,
  type FastifyRequest,
  type PermissionDeniedHandler,
  type RateLimitRule,
  rateLimitByIp,
  readApiCookie,
  type SecurityHandlers,
  setApiCookie,
} from '@nuva-edu/api-kit';
import {
  type AuthenticatedSession,
  assertCsrfToken,
  auditContextFor,
  authenticateSession,
  CSRF_HEADER,
  can,
  type Database,
  isPermissionAction,
  type ManagementRequest,
  permissionDenied,
  type RequestContext,
  recordDenied,
} from '@nuva-edu/core';

// Sessão do site admin (spec 007, "Sessões" e "Cookies"; spec 003, "Autenticação e
// autorização"): os tratadores de `sessionCookie` e `csrfToken`, a renovação e a remoção do
// cookie, o limite de taxa da 003 RNF-03 e a auditoria da negação por permissão (spec 028).

/** Site desta API: a sessão, o cookie e a auditoria são do admin. */
export const SITE = 'admin';

/** A sessão autenticada da requisição e o valor do cookie que a abriu. */
export interface AdminSession {
  session: AuthenticatedSession;
  /** Valor do cookie: só para regravá-lo na renovação. Nunca vai para log. */
  token: string;
  /** A rota encerrou a sessão (logout): o cookie não é regravado. */
  ended: boolean;
}

export const adminSession = createRequestState<AdminSession>('adminSession');

/** Permissão que faltou, para a auditoria da negação. */
const deniedPermission = createRequestState<string>('deniedPermission');

/** Ação gravada quando a recusa não vem de uma permissão do contrato (papel `student`). */
const ADMIN_ACCESS = 'admin.access';

/** A sessão da requisição; lança se a operação não tem `sessionCookie` (erro de programação). */
export function requireSession(request: FastifyRequest): AuthenticatedSession {
  return adminSession.require(request).session;
}

/** Marca a sessão como encerrada nesta requisição: o cookie não é renovado na resposta. */
export function markSessionEnded(request: FastifyRequest): void {
  const current = adminSession.get(request);
  if (current) {
    current.ended = true;
  }
}

/** O que as regras de conta recebem sobre a requisição: IP real, navegador e id. */
export function requestContext(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.client.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    requestId: request.id,
  };
}

/**
 * Quem pede, para as regras de gestão do núcleo (`listUsers`, `suspendUser`...): o usuário da
 * sessão, com o papel lido nesta requisição, e o contexto da requisição.
 */
export function managementRequest(request: FastifyRequest): ManagementRequest {
  const { user } = requireSession(request);
  return { actor: { id: user.id, role: user.role }, context: requestContext(request) };
}

/** Rotas de autenticação (`/api/v1/auth/*`): fora da recusa ao `student` (003, critérios). */
function isAuthOperation(operation: ContractOperation): boolean {
  return operation.path.startsWith('/api/v1/auth/');
}

export interface SessionOptions {
  db: Database;
  /** `config.retention.sessionDays`. */
  ttlDays: number;
}

/**
 * Tratadores dos esquemas de segurança do contrato.
 *
 * - `sessionCookie`: sessão válida do site admin (`authenticateSession`); senão `401`. Papel
 *   `student` recebe `403 permission_denied` em toda operação fora de `/auth/*` (003 RF-03). Cada
 *   ação de `x-permission` da operação precisa ser permitida ao papel (`can`, spec 008); com
 *   mais de uma, todas. A rota refina o que depende do recurso (aluno x equipe, alcance).
 * - `csrfToken`: `X-CSRF-Token` igual ao token da sessão (`assertCsrfToken`); senão `403`.
 */
export function sessionSecurity(options: SessionOptions): SecurityHandlers {
  const { db, ttlDays } = options;
  return {
    sessionCookie: async (request, { operation }) => {
      const token = readApiCookie(request, SITE, 'session');
      const session = await authenticateSession(db, { token, site: SITE, ttlDays });
      adminSession.set(request, { session, token: token as string, ended: false });
      if (isAuthOperation(operation)) {
        return;
      }
      if (session.user.role === 'student') {
        deniedPermission.set(request, operation.permissions[0] ?? ADMIN_ACCESS);
        throw permissionDenied();
      }
      for (const permission of operation.permissions) {
        if (!isPermissionAction(permission) || !can(session.user, permission)) {
          deniedPermission.set(request, permission);
          throw permissionDenied();
        }
      }
    },
    csrfToken: (request) => {
      assertCsrfToken(requireSession(request), request.headers[CSRF_HEADER]);
    },
  };
}

/**
 * Negação por permissão do tratador de `sessionCookie` (`x-permission` da operação ou papel
 * `student`): grava `outcome = denied` na auditoria, fora de transação, com a ação do contrato
 * em `details.permission` (spec 028, "Gravação").
 *
 * O `403 permission_denied` lançado pela rota vem das regras do núcleo que dependem do alvo
 * (conta de equipe exige `staff.manage`, alcance de `users.list`), e elas já gravam a negação:
 * aqui ele não é gravado de novo.
 */
export function auditPermissionDenied(db: Database): PermissionDeniedHandler {
  return async (request, { operation }) => {
    const permission = deniedPermission.get(request);
    if (permission === undefined) {
      return;
    }
    const user = adminSession.get(request)?.session.user ?? null;
    await recordDenied(db, {
      context: auditContextFor(SITE, requestContext(request), user),
      permission,
      details: { operation: operation.operationId },
    });
  };
}

/**
 * Cookie de sessão na resposta: regravado com o `Max-Age` cheio quando a validação renovou
 * `expires_at`, e apagado quando a requisição trouxe cookie e terminou em `401` (spec 007).
 */
export function registerSessionCookieHooks(app: FastifyInstance, ttlDays: number): void {
  const maxAgeSeconds = ttlDays * 86_400;
  app.addHook('onSend', async (request, reply, payload) => {
    const current = adminSession.get(request);
    if (current?.session.renewed && !current.ended && reply.statusCode < 400) {
      setApiCookie(reply, SITE, 'session', current.token, { maxAgeSeconds });
    } else if (
      request.problemCode === 'unauthenticated' &&
      readApiCookie(request, SITE, 'session') !== null
    ) {
      clearApiCookie(reply, SITE, 'session');
    }
    return payload;
  });
}

/**
 * Operações de autenticação (`/api/v1/auth/*`) com o limite de 20 por minuto por IP
 * (003 RNF-03), inclusive as três do login social.
 */
export const AUTH_OPERATIONS: readonly string[] = [
  'login',
  'logout',
  'startOAuth',
  'oauthCallback',
  'oauthCallbackForm',
];

/** Entrega de imagem: conta própria por IP, fora do limite da sessão (spec 029). */
export const IMAGE_DELIVERY_OPERATION = 'getImageVariant';

/**
 * Limites da 003 RNF-03: 300 por minuto por sessão; 20 por minuto por IP na autenticação. A
 * entrega de imagem (`getImageVariant`) não conta na sessão e tem conta própria de 600 por minuto
 * por IP, com ou sem sessão, `304` incluído (spec 029, "Limite de taxa da entrega").
 */
export function adminRateLimits(): RateLimitRule[] {
  return [
    {
      name: 'session',
      limit: 300,
      windowSeconds: 60,
      key: (request) =>
        request.operation?.operationId === IMAGE_DELIVERY_OPERATION
          ? null
          : (adminSession.get(request)?.session.id ?? null),
    },
    {
      name: 'auth-ip',
      limit: 20,
      windowSeconds: 60,
      key: rateLimitByIp,
      operations: AUTH_OPERATIONS,
    },
    {
      name: 'image-ip',
      limit: 600,
      windowSeconds: 60,
      key: rateLimitByIp,
      operations: [IMAGE_DELIVERY_OPERATION],
    },
  ];
}
