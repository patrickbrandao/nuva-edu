import type { AdminSession } from '@nuva-edu/api-client/admin';
import { jsonResponse, META } from './render';

/*
 * API simulada por rota: `{ 'GET /api/v1/session': () => resposta }`. Rota sem resposta devolve
 * `404` `not_found`, como a admin-api faz hoje com as operações ainda pendentes.
 */
/** Resposta de uma rota: `Response` ou o corpo JSON de um `200`. */
export type Handler = (request: Request) => Response | object | Promise<Response | object>;
export type Routes = Record<string, Handler | Response | object>;

/** Ações de cada papel, nas linhas da matriz de administração da spec 008. */
export const PERMISSIONS = {
  instructor: [
    'admin.access',
    'dashboard.view',
    'users.list',
    'course.create',
    'course.edit',
    'course.publish',
    'course.delete',
    'ebook.link',
    'product.set_access',
    'event.manage',
    'announcement.publish',
    'forum.moderate',
    'report.handle',
    'badge.award',
    'ticket.handle',
    'progress.view',
    'certificate.template.edit',
  ],
  manager: [
    'admin.access',
    'dashboard.view',
    'users.list',
    'users.view_private',
    'users.edit',
    'users.suspend',
    'users.sessions.revoke',
    'course.create',
    'course.edit',
    'course.publish',
    'course.delete',
    'course.set_owner',
    'ebook_bundle.manage',
    'ebook.link',
    'product.set_access',
    'event.manage',
    'announcement.publish',
    'entitlement.manage',
    'sales.view',
    'forum.category.manage',
    'forum.moderate',
    'report.handle',
    'case.moderate',
    'badge.award',
    'ticket.handle',
    'progress.view',
    'certificate.issue',
    'certificate.template.edit',
    'mcp_key.own',
  ],
  admin: [
    'admin.access',
    'dashboard.view',
    'users.list',
    'users.view_private',
    'users.edit',
    'users.suspend',
    'users.sessions.revoke',
    'users.password.view',
    'users.password.set',
    'staff.manage',
    'users.delete',
    'course.create',
    'course.edit',
    'course.publish',
    'course.delete',
    'product.archive',
    'course.set_owner',
    'ebook_bundle.manage',
    'ebook.link',
    'product.set_access',
    'product.set_price',
    'event.manage',
    'announcement.publish',
    'entitlement.manage',
    'sales.view',
    'order.refund',
    'subscription.cancel',
    'plan.manage',
    'coupon.manage',
    'forum.category.manage',
    'forum.moderate',
    'report.handle',
    'case.moderate',
    'badge.award',
    'gamification.configure',
    'ticket.handle',
    'progress.view',
    'certificate.issue',
    'certificate.revoke',
    'certificate.template.edit',
    'mcp_key.own',
    'mcp_key.manage_all',
    'audit.view',
    'ops.manage',
    'settings.manage',
  ],
} as const;

export type StaffRole = keyof typeof PERMISSIONS;

export const ADMIN_ID = '0193a5b2-0000-7000-8000-000000000001';

/** Sessão de `GET /api/v1/session` no formato do esquema `Session`. */
export function sessionFor(role: StaffRole = 'admin'): AdminSession {
  return {
    user: {
      id: ADMIN_ID,
      name: role === 'admin' ? 'Ana Admin' : role === 'manager' ? 'Gil Gerente' : 'Ivo Instrutor',
      email: `${role}@escola.test`,
      emailVerified: true,
      role,
      avatarUrl: null,
      hasPassword: true,
    },
    csrfToken: `csrf-${role}`,
    permissions: [...PERMISSIONS[role]],
    expiresAt: '2026-12-24T12:00:00Z',
  };
}

/** Corpo `application/problem+json` com o `code`, como a API responde. */
export function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return jsonResponse({ type: 'about:blank', title: code, status, code, ...extra }, status, {
    'X-Request-Id': `req-${code}`,
    ...headers,
  });
}

/** Lista de termos com uma versão publicada de cada documento: o aviso de termos não aparece. */
export const PUBLISHED_TERMS = {
  items: [
    {
      id: '0193a5b2-0000-7000-8000-0000000000a1',
      document: 'terms',
      version: 1,
      status: 'published',
      requiresReacceptance: false,
      effectiveAt: '2026-11-01T12:00:00Z',
      publishedAt: '2026-11-01T12:00:00Z',
      createdAt: '2026-11-01T11:00:00Z',
    },
  ],
};

/** Respostas padrão: meta, sessão de admin e termos publicados. */
export function defaultRoutes(role: StaffRole = 'admin'): Routes {
  return {
    'GET /api/v1/meta': META,
    'GET /api/v1/session': sessionFor(role),
    'GET /api/v1/terms': PUBLISHED_TERMS,
  };
}

/** Monta o `respond` de `renderApp` a partir das rotas (chave `MÉTODO /caminho`). */
export function apiRoutes(routes: Routes) {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const handler = routes[`${request.method} ${pathname}`];
    if (handler === undefined) return problem(404, 'not_found');
    if (typeof handler === 'function') {
      const result = await (handler as Handler)(request);
      return result instanceof Response ? result : jsonResponse(result);
    }
    if (handler instanceof Response) return handler.clone();
    return jsonResponse(handler);
  };
}

/** Chamadas feitas à API, como `MÉTODO /caminho`, na ordem. */
export function calls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map(([input]) => {
    const request = input as Request;
    return `${request.method} ${new URL(request.url).pathname}`;
  });
}

/** Rotas padrão com o `/meta` alterado. */
export function withMeta(meta: Partial<typeof META>, role: StaffRole = 'admin'): Routes {
  return { ...defaultRoutes(role), 'GET /api/v1/meta': { ...META, ...meta } };
}
