import { type ClassroomSchemas, createClassroomClient } from '@nuva-edu/api-client/classroom';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../AppProviders';
import type { RuntimeConfig } from '../config/runtime-config';
import { routes } from '../routes';
import type { UserRole } from '../session/role';

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

export function jsonResponse(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType, 'X-Request-Id': 'req-teste-1' },
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
export const RUNTIME_CONFIG: RuntimeConfig = {
  app: 'classroom',
  adminUrl: 'https://edu-admin.escola.test',
  classroomUrl: 'https://classroom.escola.test',
};

interface RenderOptions {
  /** Resultado da leitura do `/config.json`; `null` é arquivo ausente ou inválido. */
  config?: RuntimeConfig | null;
  /** Papel do usuário da sessão; sem ele, é um visitante. */
  role?: UserRole | null;
}

/** Monta o site inteiro em memória, com a API simulada por `fetch`. */
export function renderApp(
  path = '/',
  fetch: FetchMock = async () => jsonResponse(META),
  { config = RUNTIME_CONFIG, role = null }: RenderOptions = {},
) {
  const requests: string[] = [];
  const api = createClassroomClient({
    baseUrl: 'http://classroom.test',
    fetch: (request) => {
      requests.push(new URL(request.url).pathname);
      return fetch(request);
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders
      api={api}
      queryClient={queryClient}
      loadConfig={async () => config}
      sessionRole={role}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, requests };
}
