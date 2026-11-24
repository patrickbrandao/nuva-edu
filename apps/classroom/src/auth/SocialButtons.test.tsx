import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../lib/browser';
import ptBR from '../locales/pt-BR.json';
import { jsonResponse, META, renderApp } from '../test/renderApp';

afterEach(() => vi.restoreAllMocks());

const withProviders = (authProviders: string[]) => async () =>
  jsonResponse({ ...META, authProviders });

describe('login e cadastro social', () => {
  it.each(['/entrar', '/cadastro'])(
    'em %s mostra só os provedores de authProviders',
    async (path) => {
      renderApp(path, withProviders(['facebook', 'apple']));
      const main = within(await screen.findByRole('main'));
      expect(await main.findByRole('button', { name: 'Continuar com Facebook' })).toBeTruthy();
      expect(main.getByRole('button', { name: 'Continuar com Apple' })).toBeTruthy();
      expect(main.queryByRole('button', { name: 'Continuar com Google' })).toBeNull();
    },
  );

  it('sem provedores configurados, não há seção de login social', async () => {
    renderApp('/entrar', withProviders([]));
    await screen.findByRole('link', { name: 'Escola Aurora' });
    expect(screen.queryByRole('heading', { name: ptBR.login.social })).toBeNull();
    expect(screen.queryByRole('button', { name: /Continuar com/ })).toBeNull();
  });

  it('o botão navega (página inteira, sem fetch) para startOAuth com o destino', async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {});
    const { calls } = renderApp('/entrar?destino=%2Fplanos', withProviders(['google']));
    await user.click(await screen.findByRole('button', { name: 'Continuar com Google' }));
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/google/start?returnTo=%2Fplanos');
    expect(calls.some((call) => call.path.includes('/auth/google'))).toBe(false);
  });

  it('sem destino, volta para /inicio; no cadastro também', async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {});
    renderApp('/cadastro', withProviders(['apple']));
    await user.click(await screen.findByRole('button', { name: 'Continuar com Apple' }));
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/apple/start?returnTo=%2Finicio');
  });
});
