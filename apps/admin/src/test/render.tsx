import { type AdminSchemas, createAdminClient } from '@nuva-edu/api-client/admin';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';
import { AppProviders } from '../AppProviders';
import { routes } from '../routes';

/** Resposta de `GET /api/v1/meta` no formato do esquema `Meta` do contrato da admin-api. */
export const META: AdminSchemas['Meta'] = {
  schoolName: 'Escola Aurora',
  version: '0.1.0',
  currency: 'BRL',
  locale: 'pt-BR',
  authProviders: ['google'],
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

type Responder = (request: Request) => Response | Promise<Response>;

/** Abre o site num endereço, com a API simulada por `respond`. */
export function renderApp(path: string, respond: Responder = () => jsonResponse(META)) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    respond(new Request(input, init)),
  );
  const api = createAdminClient({ baseUrl: 'http://admin.test', fetch: fetchMock });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders api={api} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, fetchMock };
}
