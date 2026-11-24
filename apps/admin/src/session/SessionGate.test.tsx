import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getCsrfToken } from '../api/csrf';
import { calls, defaultRoutes, problem, sessionFor } from '../test/api';
import { findAlert, findMenu, renderApp } from '../test/render';
import { loginPath, safeDestination } from './destination';

describe('sessão ao carregar (spec 006, "Sessão")', () => {
  it('mostra "conferindo a sessão" e abre o painel com a sessão e o token CSRF', async () => {
    renderApp('/');
    expect(screen.getByText('Conferindo a sessão…')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Abrindo o painel' })).toBeTruthy();
    await findMenu();
    expect(getCsrfToken()).toBe('csrf-admin');
    expect(screen.getByText('Ana Admin')).toBeTruthy();
    expect(screen.getByText('Administrador')).toBeTruthy();
  });

  it('sem sessão (401), leva a /entrar guardando o destino', async () => {
    const { router } = renderApp('/equipe?pagina=2', {
      ...defaultRoutes(),
      'GET /api/v1/session': () => problem(401, 'unauthenticated'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });
    expect(router.state.location.pathname).toBe('/entrar');
    expect(router.state.location.search).toBe('?destino=%2Fequipe%3Fpagina%3D2');
  });

  it('sem sessão no painel, vai a /entrar sem destino', async () => {
    const { router } = renderApp('/', {
      ...defaultRoutes(),
      'GET /api/v1/session': () => problem(401, 'unauthenticated'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });
    expect(router.state.location.search).toBe('');
  });

  it('403 por papel mostra "sem acesso ao painel"', async () => {
    renderApp('/', {
      ...defaultRoutes(),
      'GET /api/v1/session': () => problem(403, 'permission_denied'),
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sem acesso ao painel' }),
    ).toBeTruthy();
  });

  it('com a rota ausente (404) ou fora do ar, mostra erro tratado e tenta de novo', async () => {
    const user = userEvent.setup();
    let ready = false;
    renderApp('/', {
      ...defaultRoutes(),
      'GET /api/v1/session': () => (ready ? sessionFor() : problem(404, 'not_found')),
    });
    const alert = await findAlert();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Não foi possível abrir o painel' }),
    ).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-not_found')).toBeTruthy();
    // Rodapé com o código-fonte continua à vista.
    expect(screen.getByRole('link', { name: /^Código-fonte/ })).toBeTruthy();

    ready = true;
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    await findMenu();
  });

  it('um 401 em outra chamada confere a sessão de novo e volta à entrada', async () => {
    let sessionCalls = 0;
    const { router } = renderApp('/auditoria', {
      ...defaultRoutes(),
      'GET /api/v1/session': () => {
        sessionCalls += 1;
        return sessionCalls === 1 ? sessionFor() : problem(401, 'unauthenticated');
      },
      // A sessão venceu entre uma chamada e outra: a leitura dos termos já recebe 401.
      'GET /api/v1/terms': () => problem(401, 'unauthenticated'),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fauditoria');
  });
});

describe('destino guardado', () => {
  it('aceita só caminho do próprio site', () => {
    expect(safeDestination('/alunos?q=ana')).toBe('/alunos?q=ana');
    for (const value of ['//mal.test', '/\\mal.test', 'https://mal.test', '', null, '/entrar']) {
      expect(safeDestination(value)).toBe('/');
    }
    expect(loginPath('/')).toBe('/entrar');
    expect(loginPath('/auditoria')).toBe('/entrar?destino=%2Fauditoria');
  });
});

describe('sair', () => {
  it('encerra a sessão, esquece o token e volta à entrada', async () => {
    const user = userEvent.setup();
    let csrf: string | null = null;
    const { router, fetchMock } = renderApp('/', {
      ...defaultRoutes(),
      'POST /api/v1/auth/logout': (request: Request) => {
        csrf = request.headers.get('X-CSRF-Token');
        return new Response(null, { status: 204 });
      },
    });
    await findMenu();
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });
    expect(router.state.location.pathname).toBe('/entrar');
    expect(csrf).toBe('csrf-admin');
    expect(getCsrfToken()).toBeNull();
    expect(calls(fetchMock)).toContain('POST /api/v1/auth/logout');
  });

  it('sessão já vencida (401) também sai', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/', {
      ...defaultRoutes(),
      'POST /api/v1/auth/logout': () => problem(401, 'unauthenticated'),
    });
    await findMenu();
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
  });

  it('falha do servidor avisa e mantém o painel', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/', {
      ...defaultRoutes(),
      'POST /api/v1/auth/logout': () => problem(503, 'database_unavailable'),
    });
    await findMenu();
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('Não foi possível sair')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
  });
});
