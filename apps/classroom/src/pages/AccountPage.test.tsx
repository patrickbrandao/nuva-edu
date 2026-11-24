import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { makeSession, renderApp } from '../test/renderApp';

describe('/conta', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/conta');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fconta');
  });

  it('lista perfil e acesso, e o menu marca "Configurações"', async () => {
    window.innerWidth = 1440;
    const user = userEvent.setup();
    const { router } = renderApp('/conta', undefined, { session: makeSession() });
    expect(await screen.findByRole('heading', { level: 1, name: ptBR.account.title })).toBeTruthy();
    const menu = screen.getByRole('navigation', { name: ptBR.shell.menu });
    expect(within(menu).getByRole('link', { current: 'page' }).textContent).toBe(
      ptBR.menu.items.settings,
    );
    await expectNoAxeViolations();
    const main = within(screen.getByRole('main'));
    await user.click(main.getByRole('link', { name: ptBR.account.access }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/conta/acesso'));
  });
});
