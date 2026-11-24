import { type AdminSchemas, createAdminClient } from '@nuva-edu/api-client/admin';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';
import { AppProviders } from '../AppProviders';
import { getCsrfToken } from '../api/csrf';
import { routes } from '../routes';
import { loadRuntimeConfig } from '../runtime/runtimeConfig';
import { apiRoutes, defaultRoutes, type Routes } from './api';

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

/**
 * Abre o site num endereço, com a API simulada por `respond` (função ou rotas de `apiRoutes`;
 * padrão: meta, sessão de admin e termos publicados) e o `/config.json` por `config`.
 */
export function renderApp(
  path: string,
  respond: Responder | Routes = defaultRoutes(),
  options: RenderOptions = {},
) {
  const responder = typeof respond === 'function' ? (respond as Responder) : apiRoutes(respond);
  const config = options.config ?? (() => jsonResponse(CONFIG));
  const configFetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => config());
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    responder(new Request(input, init)),
  );
  const api = createAdminClient({
    baseUrl: 'http://admin.test',
    fetch: fetchMock,
    csrfToken: getCsrfToken,
  });
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

/** Avisos da página, sem a região de toasts (sempre montada, vazia). */
export function queryAlerts(): HTMLElement[] {
  return screen.queryAllByRole('alert').filter((node) => !node.closest('.minui-toast-list'));
}

/** Espera um aviso da página aparecer (fora da região de toasts) e o devolve. */
export async function findAlert(): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    found = queryAlerts()[0];
    if (!found) throw new Error('nenhum aviso na página');
  });
  return found as HTMLElement;
}

/** Espera o painel abrir (sessão carregada, menu à vista) e devolve o menu. */
export function findMenu(): Promise<HTMLElement> {
  return screen.findByRole('navigation', { name: 'Menu' });
}
