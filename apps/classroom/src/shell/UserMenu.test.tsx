import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../lib/browser';
import ptBR from '../locales/pt-BR.json';
import type { UserRole } from '../session/session';
import {
  apiRoutes,
  makeSession,
  noContent,
  problemResponse,
  RUNTIME_CONFIG,
  renderApp,
} from '../test/renderApp';

const menuName = 'Menu da conta de Ana Souza';

async function openMenu() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: menuName }));
  return { user, menu: screen.getByRole('menu') };
}

afterEach(() => vi.restoreAllMocks());

describe('menu do usuário', () => {
  it('visitante vê "Entrar"; com sessão, o menu com as iniciais e sem "Entrar"', async () => {
    const visitor = renderApp('/');
    expect(await screen.findByRole('link', { name: ptBR.shell.signIn })).toBeTruthy();
    expect(screen.queryByRole('button', { name: menuName })).toBeNull();
    visitor.unmount();

    renderApp('/', undefined, { session: makeSession() });
    const button = await screen.findByRole('button', { name: menuName });
    expect(within(button).getByRole('img', { name: 'Ana Souza' }).textContent).toBe('AS');
    expect(screen.queryByRole('link', { name: ptBR.shell.signIn })).toBeNull();
  });

  it('mostra a foto quando a sessão tem avatarUrl', async () => {
    const avatarUrl = '/api/v1/images/0193a5b2-avatar/256.webp';
    renderApp('/', undefined, { session: makeSession({ user: { avatarUrl } }) });
    const button = await screen.findByRole('button', { name: menuName });
    const photos = within(button).getAllByRole('img', { name: 'Ana Souza' });
    expect(photos.some((photo) => photo.style.backgroundImage.includes(avatarUrl))).toBe(true);
  });

  it.each<UserRole>(['instructor', 'manager', 'admin'])(
    'a equipe (%s) tem "Administração", que leva ao endereço do /config.json',
    async (role) => {
      const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {});
      renderApp('/', undefined, { role });
      const { user, menu } = await openMenu();
      await user.click(within(menu).getByRole('menuitem', { name: ptBR.shell.administration }));
      expect(assign).toHaveBeenCalledWith(RUNTIME_CONFIG.adminUrl);
    },
  );

  it('aluno não vê "Administração"', async () => {
    renderApp('/', undefined, { role: 'student' });
    const { menu } = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: ptBR.shell.account })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: ptBR.shell.administration })).toBeNull();
  });

  it('sem o /config.json (ou com adminUrl descartado) a equipe não vê "Administração"', async () => {
    const view = renderApp('/', undefined, { role: 'admin', config: null });
    let { menu } = await openMenu();
    expect(within(menu).queryByRole('menuitem', { name: ptBR.shell.administration })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();

    const { adminUrl: _dropped, ...config } = RUNTIME_CONFIG;
    renderApp('/', undefined, { role: 'admin', config });
    ({ menu } = await openMenu());
    expect(within(menu).queryByRole('menuitem', { name: ptBR.shell.administration })).toBeNull();
  });

  it('"Minha conta" leva a /conta', async () => {
    const { router } = renderApp('/', undefined, { session: makeSession() });
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: ptBR.shell.account }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/conta'));
  });

  it('"Sair" encerra a sessão com o token CSRF e volta à vitrine como visitante', async () => {
    const { router, calls } = renderApp(
      '/planos',
      apiRoutes({ 'POST /api/v1/auth/logout': () => noContent() }),
      { session: makeSession() },
    );
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: ptBR.shell.signOut }));

    expect(await screen.findByRole('link', { name: ptBR.shell.signIn })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
    const logout = calls.find((call) => call.path === '/api/v1/auth/logout');
    expect(logout?.csrf).toBe('csrf-teste-1');
  });

  it('com GET /session ainda inexistente (404) o site abre como visitante, sem erro', async () => {
    renderApp('/', apiRoutes({}), { session: 'fetch' });
    expect(await screen.findByRole('link', { name: ptBR.shell.signIn })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Sair" com a rota ainda inexistente (404) não quebra o site', async () => {
    renderApp('/', apiRoutes({}), { session: makeSession() });
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: ptBR.shell.signOut }));
    // a sessão continua aberta no servidor: o menu fica
    expect(await screen.findByRole('button', { name: menuName })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('"Sair" que falha no servidor consulta a sessão de novo', async () => {
    let sessionCalls = 0;
    renderApp(
      '/',
      apiRoutes({
        'GET /api/v1/session': () => {
          sessionCalls += 1;
          return sessionCalls === 1
            ? new Response(JSON.stringify(makeSession()), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            : problemResponse(401, 'unauthenticated');
        },
        'POST /api/v1/auth/logout': () => problemResponse(503, 'database_unavailable'),
      }),
      { session: 'fetch' },
    );
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: ptBR.shell.signOut }));
    await waitFor(() => expect(sessionCalls).toBe(2));
    expect(await screen.findByRole('link', { name: ptBR.shell.signIn })).toBeTruthy();
  });
});
