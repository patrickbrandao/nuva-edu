import {
  type ClassroomSchemas,
  type ClassroomSession,
  createClassroomClient,
} from '@nuva-edu/api-client/classroom';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../AppProviders';
import { getCsrfToken, setCsrfToken } from '../api/csrf';
import { createQueryClient } from '../api/query';
import type { RuntimeConfig } from '../config/runtime-config';
import { routes } from '../routes';
import type { UserRole } from '../session/session';

type Meta = ClassroomSchemas['Meta'];

/** Resposta de `/api/v1/meta` no formato do contrato (esquema `Meta`). */
export const META: Meta = {
  schoolName: 'Escola Aurora',
  version: '0.1.0',
  currency: 'BRL',
  locale: 'pt-BR',
  authProviders: ['google'],
  logoUrl: null,
  accentColor: null,
  sourceCodeUrl: 'https://github.com/patrickbrandao/nuva-edu',
};

/** Sessão de uma aluna com e-mail confirmado e sem termos pendentes (esquema `Session`). */
export function makeSession(
  overrides: { user?: Partial<ClassroomSession['user']> } & Partial<
    Omit<ClassroomSession, 'user'>
  > = {},
): ClassroomSession {
  const { user, ...rest } = overrides;
  return {
    user: {
      id: '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70',
      name: 'Ana Souza',
      email: 'ana@exemplo.test',
      emailVerified: true,
      role: 'student',
      avatarUrl: null,
      hasPassword: true,
      ...user,
    },
    csrfToken: 'csrf-teste-1',
    permissions: ['account.self_service'],
    expiresAt: '2026-12-24T12:00:00Z',
    termsPending: [],
    ...rest,
  };
}

export function jsonResponse(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType, 'X-Request-Id': 'req-teste-1' },
  });
}

/** Resposta sem corpo (`204`). */
export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'X-Request-Id': 'req-teste-1' } });
}

/** Erro em problem+json, como as APIs respondem (spec 003). */
export function problemResponse(
  status: number,
  code: string,
  { headers = {}, ...extra }: { headers?: Record<string, string> } & Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, code, ...extra }),
    {
      status,
      headers: {
        'Content-Type': 'application/problem+json',
        'X-Request-Id': 'req-teste-1',
        ...headers,
      },
    },
  );
}

/** Rota que ainda não existe na API (o Fastify responde 404 sem o problem+json do contrato). */
export function missingRouteResponse(): Response {
  return new Response(JSON.stringify({ message: 'Route not found', statusCode: 404 }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Erro 503 em problem+json, como a classroom-api responde sem banco. */
export function unavailableResponse(): Response {
  return jsonResponse(
    {
      type: 'about:blank',
      title: 'Serviço indisponível',
      status: 503,
      code: 'database_unavailable',
      requestId: 'req-teste-1',
    },
    503,
    'application/problem+json',
  );
}

type FetchMock = (request: Request) => Promise<Response>;

/** `/config.json` no formato da spec 031. */
export const RUNTIME_CONFIG: Required<RuntimeConfig> = {
  app: 'classroom',
  adminUrl: 'https://edu-admin.escola.test',
  classroomUrl: 'https://classroom.escola.test',
};

/** Uma requisição feita à API simulada. */
export interface RecordedRequest {
  method: string;
  path: string;
  search: string;
  body: unknown;
  csrf: string | null;
}

interface RenderOptions {
  /** Resultado da leitura do `/config.json`; `null` é arquivo ausente (nenhum campo). */
  config?: RuntimeConfig | null;
  /**
   * `GET /api/v1/session`: a sessão, `null` para visitante (`401`), ou `'fetch'` para deixar a
   * resposta com a função `fetch` do teste.
   */
  session?: ClassroomSession | null | 'fetch';
  /** Atalho: sessão de alguém com este papel. */
  role?: UserRole | null;
}

/**
 * Monta o site inteiro em memória, com a API simulada por `fetch` (por padrão, `apiRoutes({})`).
 * `GET /api/v1/session` é respondido aqui (visitante por padrão), a menos que `session: 'fetch'`.
 */
export function renderApp(
  path = '/',
  fetch: FetchMock = apiRoutes({}),
  { config = RUNTIME_CONFIG, session, role = null }: RenderOptions = {},
) {
  setCsrfToken(null);
  const requests: string[] = [];
  const calls: RecordedRequest[] = [];
  const shownSession = session ?? (role ? makeSession({ user: { role } }) : null);
  const api = createClassroomClient({
    baseUrl: 'http://classroom.test',
    csrfToken: getCsrfToken,
    fetch: async (request) => {
      const url = new URL(request.url);
      requests.push(url.pathname);
      const text = request.method === 'GET' ? '' : await request.clone().text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        /* corpo que não é JSON (multipart): fica o texto */
      }
      calls.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        body,
        csrf: request.headers.get('X-CSRF-Token'),
      });
      if (url.pathname === '/api/v1/session' && request.method === 'GET' && session !== 'fetch') {
        return shownSession ? jsonResponse(shownSession) : problemResponse(401, 'unauthenticated');
      }
      return fetch(request);
    },
  });
  const queryClient = createQueryClient({ retry: false });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders api={api} queryClient={queryClient} loadConfig={async () => config ?? {}}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, requests, calls, queryClient };
}

/** Vitrine sem produtos (`GET /api/v1/catalog`, esquema `CatalogItemPage`). */
export const EMPTY_CATALOG: ClassroomSchemas['CatalogItemPage'] = { items: [], nextCursor: null };

/**
 * Roteia as respostas simuladas por "MÉTODO /caminho". O que faltar responde `/api/v1/meta`, a
 * vitrine vazia em `/api/v1/catalog` e, no resto, a rota inexistente.
 */
export function apiRoutes(
  handlers: Record<string, (request: Request) => Response | Promise<Response>>,
): FetchMock {
  return async (request) => {
    const { pathname } = new URL(request.url);
    const handler = handlers[`${request.method} ${pathname}`];
    if (handler) return handler(request);
    if (pathname === '/api/v1/meta') return jsonResponse(META);
    if (pathname === '/api/v1/catalog') return jsonResponse(EMPTY_CATALOG);
    return missingRouteResponse();
  };
}
