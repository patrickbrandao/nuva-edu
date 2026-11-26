import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { ADMIN_ID, apiRoutes, defaultRoutes, problem, type Routes, type StaffRole } from './api';
import type { Recorded } from './courses';
import { jsonResponse } from './render';

type EntitlementNode = AdminSchemas['EntitlementNode'];
type ProductRef = AdminSchemas['ProductRef'];
type UserCourseProgress = AdminSchemas['UserCourseProgress'];
type CourseStudent = AdminSchemas['CourseStudent'];
type CourseProgressSummary = AdminSchemas['CourseProgressSummary'];
type ProgressCounts = AdminSchemas['ProgressCounts'];
type ProductEntitlement = AdminSchemas['ProductEntitlement'];

const NOW = '2026-11-20T12:00:00Z';
export const GRANT_ID = '0193a5b2-0000-7000-8000-0000000000a1';
export const ORDER_ID = '0193a5b2-0000-7000-8000-0000000000a2';

/** Direito `EntitlementNode`: por padrão, uma concessão manual ativa e vitalícia de um curso. */
export function entitlement(overrides: Partial<EntitlementNode> = {}): EntitlementNode {
  return {
    id: GRANT_ID,
    product: {
      type: 'course',
      id: '0193a5b2-0000-7000-8000-0000000000c1',
      title: 'Curso de Python',
    },
    source: 'grant',
    sourceId: ADMIN_ID,
    parentEntitlementId: null,
    state: 'active',
    startsAt: NOW,
    expiresAt: null,
    revokedAt: null,
    revokeReason: null,
    grantedReason: 'Bolsa de estudos',
    grantedBy: { id: ADMIN_ID, name: 'Ana Admin' },
    createdAt: NOW,
    children: [],
    ...overrides,
  };
}

/** Direito derivado (cascata) de um pai. */
export function cascade(parent: EntitlementNode, product: ProductRef, id: string): EntitlementNode {
  return entitlement({
    id,
    product,
    source: 'cascade',
    sourceId: parent.sourceId,
    parentEntitlementId: parent.id,
    grantedReason: null,
    grantedBy: null,
  });
}

export function progressCounts(completed: number, total: number): ProgressCounts {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return {
    completedLessons: completed,
    totalLessons: total,
    percent,
    state: completed === 0 ? 'not_started' : completed >= total ? 'completed' : 'in_progress',
  };
}

export function courseStudent(
  id: string,
  name: string,
  completed: number,
  total = 10,
  overrides: Partial<CourseStudent> = {},
): CourseStudent {
  return {
    user: { id, name, avatarUrl: null },
    progress: progressCounts(completed, total),
    lastActivityAt: completed === 0 ? null : '2026-11-19T15:00:00Z',
    accessExpiresAt: null,
    ...overrides,
  };
}

/** Um direito na lista de quem tem acesso a um produto: por padrão, compra ativa e vitalícia. */
export function productEntitlement(
  id: string,
  user: { id: string; name: string },
  overrides: Partial<ProductEntitlement> = {},
): ProductEntitlement {
  return {
    id,
    user: { ...user, avatarUrl: null },
    source: 'order',
    via: null,
    state: 'active',
    startsAt: NOW,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

interface Options {
  role?: StaffRole;
  /** O usuário da ficha. */
  userId?: string;
  /** Raízes dos direitos do usuário, mais recentes primeiro. */
  entitlements?: EntitlementNode[];
  /** Progresso do usuário; `null` responde `404` (nenhum curso do instrutor). */
  progress?: UserCourseProgress[] | null;
  /** Produtos que existem, para a concessão achar o título (os demais respondem `404`). */
  products?: ProductRef[];
  courseId?: string;
  students?: CourseStudent[];
  /** Alunos por página de `GET /courses/{id}/students`. */
  pageSize?: number;
  /** Direitos por produto (`tipo/id`), mais recentes primeiro, de todos os estados; o resto, nenhum. */
  productAccess?: Record<string, ProductEntitlement[]>;
  /** Respostas fixas por `MÉTODO /caminho`, à frente das simuladas (ex.: uma recusa). */
  overrides?: Routes;
  /** Quem responde o resto (ex.: o `respond` do catálogo simulado). */
  fallback?: (request: Request) => Response | Promise<Response>;
}

/**
 * Direitos e progresso simulados, com estado: árvore de direitos, concessão (`201` na nova,
 * `200` com a existente na repetida), revogação (só raiz `grant` ainda não revogada), progresso
 * do usuário, e alunos e resumo do curso. Guarda cada requisição.
 */
export function fakeAccess({
  role = 'manager',
  userId = '',
  entitlements = [],
  progress = [],
  products = [],
  courseId = '',
  students = [],
  pageSize = 25,
  productAccess = {},
  overrides = {},
  fallback,
}: Options = {}) {
  const roots = structuredClone(entitlements);
  const requests: Recorded[] = [];
  const base = apiRoutes({ ...defaultRoutes(role), ...overrides });
  let sequence = 0;

  const flat = (nodes: EntitlementNode[]): EntitlementNode[] =>
    nodes.flatMap((node) => [node, ...flat(node.children)]);
  const revokeTree = (node: EntitlementNode) => {
    Object.assign(node, { state: 'revoked', revokedAt: NOW, revokeReason: 'manual' });
    node.children.forEach(revokeTree);
  };

  const summaryOf = (): CourseProgressSummary => {
    const bucket = (min: number, max: number) =>
      students.filter(({ progress: p }) => p.percent >= min && p.percent <= max).length;
    const completed = bucket(100, 100);
    return {
      courseId,
      totalLessons: students[0]?.progress.totalLessons ?? 0,
      studentCount: students.length,
      buckets: {
        notStarted: bucket(0, 0),
        upTo25: bucket(1, 25),
        upTo50: bucket(26, 50),
        upTo75: bucket(51, 75),
        upTo99: bucket(76, 99),
        completed,
      },
      completionRate: students.length === 0 ? 0 : completed / students.length,
    };
  };

  const handle = (
    method: string,
    path: string,
    query: URLSearchParams,
    body: unknown,
  ): Response | undefined => {
    const input = (body ?? {}) as Record<string, unknown>;

    if (path === `/api/v1/users/${userId}/entitlements`) {
      if (method === 'GET') return jsonResponse({ items: roots });
      if (method === 'POST') {
        const product = products.find(
          (item) => item.type === input.productType && item.id === input.productId,
        );
        if (!product) return problem(404, 'not_found');
        if (typeof input.reason !== 'string' || input.reason.trim() === '') {
          return problem(400, 'validation_failed', {
            errors: [{ path: 'body.reason', message: 'obrigatório' }],
          });
        }
        const expiresAt = (input.expiresAt as string | null | undefined) ?? null;
        if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
          return problem(422, 'expires_at_in_past');
        }
        const existing = roots.find(
          (node) =>
            node.source === 'grant' &&
            node.sourceId === ADMIN_ID &&
            node.state === 'active' &&
            node.product.type === product.type &&
            node.product.id === product.id,
        );
        if (existing) return jsonResponse(existing, 200);
        sequence += 1;
        const node = entitlement({
          id: `0193a5b2-0000-7000-8000-9${String(sequence).padStart(11, '0')}`,
          product,
          expiresAt,
          grantedReason: input.reason.trim(),
        });
        roots.unshift(node);
        return jsonResponse(node, 201);
      }
    }

    const revoke = path.match(/^\/api\/v1\/entitlements\/([^/]+)\/revoke$/);
    if (revoke && method === 'POST') {
      const node = flat(roots).find((item) => item.id === revoke[1]);
      if (!node) return problem(404, 'not_found');
      if (node.source !== 'grant' || node.parentEntitlementId !== null) {
        return problem(409, 'entitlement_not_revocable');
      }
      if (node.state === 'revoked') return problem(409, 'entitlement_already_revoked');
      revokeTree(node);
      return jsonResponse(node);
    }

    const product = path.match(/^\/api\/v1\/products\/([^/]+)\/([^/]+)\/entitlements$/);
    if (product && method === 'GET') {
      const items = productAccess[`${product[1]}/${product[2]}`] ?? [];
      const state = query.get('state') ?? 'active';
      const found = items.filter((item) => item.state === state);
      const start = Number(query.get('cursor') ?? 0);
      const end = start + pageSize;
      return jsonResponse({
        items: found.slice(start, end),
        nextCursor: end < found.length ? String(end) : null,
      });
    }

    if (path === `/api/v1/users/${userId}/progress` && method === 'GET') {
      return progress === null ? problem(404, 'not_found') : jsonResponse({ items: progress });
    }
    if (path === `/api/v1/courses/${courseId}/progress-summary` && method === 'GET') {
      return jsonResponse(summaryOf());
    }
    if (path === `/api/v1/courses/${courseId}/students` && method === 'GET') {
      const q = query.get('q')?.toLowerCase();
      const state = query.get('state');
      const sort = query.get('sort') ?? '-lastActivityAt';
      const found = students
        .filter((item) => !q || item.user.name.toLowerCase().includes(q))
        .filter((item) => !state || item.progress.state === state)
        .sort((a, b) =>
          sort === 'name'
            ? a.user.name.localeCompare(b.user.name)
            : sort === '-percent'
              ? b.progress.percent - a.progress.percent
              : (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
        );
      const start = Number(query.get('cursor') ?? 0);
      const end = start + pageSize;
      return jsonResponse({
        items: found.slice(start, end),
        nextCursor: end < found.length ? String(end) : null,
      });
    }
    return undefined;
  };

  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const type = request.headers.get('Content-Type') ?? '';
    const body = type.includes('application/json') ? await request.clone().json() : undefined;
    requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body });
    if (overrides[`${request.method} ${url.pathname}`] !== undefined) return base(request);
    return (
      handle(request.method, url.pathname, url.searchParams, body) ??
      (fallback ? fallback(request) : base(request))
    );
  };

  return {
    respond,
    requests,
    /** As raízes como estão gravadas. */
    roots: () => roots,
    /** Corpos enviados a uma rota (`MÉTODO /caminho`), na ordem. */
    bodies: (key: string) =>
      requests.filter((item) => `${item.method} ${item.path}` === key).map((item) => item.body),
    /** Consultas feitas a uma rota (`MÉTODO /caminho`), na ordem. */
    queries: (key: string) =>
      requests
        .filter((item) => `${item.method} ${item.path}` === key)
        .map((item) => Object.fromEntries(item.query)),
    /** Chamadas de escrita, como `MÉTODO /caminho`, na ordem. */
    writes: () =>
      requests.filter((item) => item.method !== 'GET').map((item) => `${item.method} ${item.path}`),
  };
}
