import { type AdminSchemas, createAdminClient } from '@nuva-edu/api-client/admin';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';
import { AppProviders } from '../AppProviders';
import { routes } from '../routes';
import { loadRuntimeConfig } from '../runtime/runtimeConfig';

/** Resposta de `GET /api/v1/meta` no formato do esquema `Meta` do contrato da admin-api. */
export const META: AdminSchemas['Meta'] = {
  schoolName: 'Escola Aurora',
  version: '0.1.0',
  currency: 'BRL',
  locale: 'pt-BR',
  authProviders: ['google'],
  logoUrl: null,
  accentColor: null,
  sourceCodeUrl: 'https://github.com/patrickbrandao/nuva-edu',
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': status < 400 ? 'application/json' : 'application/problem+json',
      ...headers,
    },
  });
}

/** Conteúdo do `/config.json` do site admin, no formato da spec 031. */
export const CONFIG = {
  app: 'admin',
  adminUrl: 'http://edu-admin.test:8080',
  classroomUrl: 'http://classroom.test:8080',
};

type Responder = (request: Request) => Response | Promise<Response>;

interface RenderOptions {
  /** Resposta de `GET /config.json`; por padrão, o arquivo válido de `CONFIG`. */
  config?: (() => Response | Promise<Response>) | undefined;
  /** Rotas no lugar das do site, para abrir uma tela que ainda não tem rota. */
  routes?: RouteObject[] | undefined;
}

/** Abre o site num endereço, com a API simulada por `respond` e o `/config.json` por `config`. */
export function renderApp(
  path: string,
  respond: Responder = () => jsonResponse(META),
  options: RenderOptions = {},
) {
  const config = options.config ?? (() => jsonResponse(CONFIG));
  const configFetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => config());
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    respond(new Request(input, init)),
  );
  const api = createAdminClient({ baseUrl: 'http://admin.test', fetch: fetchMock });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(options.routes ?? routes, { initialEntries: [path] });
  const view = render(
    <AppProviders
      api={api}
      queryClient={queryClient}
      runtimeConfigLoader={() => loadRuntimeConfig(configFetchMock)}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, fetchMock, configFetchMock };
}
