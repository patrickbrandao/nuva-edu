import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../lib/browser';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';
import { MY_EBOOKS } from '../test/shelf';

const EBOOKS = 'GET /api/v1/me/ebooks';
const GIT = MY_EBOOKS.items[0] as (typeof MY_EBOOKS.items)[number];
const DOWNLOAD = `GET /api/v1/ebooks/${GIT.id}/download`;
const t = ptBR.study.ebooks;
const session = makeSession();
const card = async (title: string) =>
  (await screen.findByRole('heading', { level: 2, name: title })).closest('article') as HTMLElement;

/** Troca a aba nova por um registro do que foi pedido a ela. */
function fakeTab() {
  const tab = { go: vi.fn(), cancel: vi.fn() };
  const open = vi.spyOn(browser, 'openTab').mockReturnValue(tab);
  return { tab, open };
}

afterEach(() => vi.restoreAllMocks());

describe('/meus-ebooks', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/meus-ebooks');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fmeus-ebooks');
  });

  it('lista os ebooks com autor, páginas e validade', async () => {
    renderApp('/meus-ebooks', apiRoutes({ [EBOOKS]: () => jsonResponse(MY_EBOOKS) }), { session });

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.menu.items.myEbooks }),
    ).toBeTruthy();
    expect((await screen.findByRole('list', { name: t.list })).children).toHaveLength(2);

    const git = within(await card('Guia de Git'));
    expect(git.getByRole('link', { name: 'Guia de Git' }).getAttribute('href')).toBe(
      '/ebooks/guia-de-git',
    );
    expect(git.getByText('Por Carla Dias')).toBeTruthy();
    expect(git.getByText('48 páginas')).toBeTruthy();
    expect(git.getByText(t.lifetime)).toBeTruthy();
    expect(git.getByRole('button', { name: 'Baixar: Guia de Git' }).textContent).toBe(t.download);

    const sql = within(await card('SQL de bolso'));
    expect(sql.getByText('Acesso até 12 de março de 2027')).toBeTruthy();
    expect(sql.queryByText(/^Por /)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await expectNoAxeViolations();
  });

  it('"Baixar" pede o endereço à API e o abre em outra aba', async () => {
    const user = userEvent.setup();
    const { tab, open } = fakeTab();
    const { calls } = renderApp(
      '/meus-ebooks',
      apiRoutes({
        [EBOOKS]: () => jsonResponse(MY_EBOOKS),
        [DOWNLOAD]: () => jsonResponse({ url: 'https://cdn.exemplo.test/guia-de-git.pdf' }),
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: 'Baixar: Guia de Git' }));
    await waitFor(() =>
      expect(tab.go).toHaveBeenCalledWith('https://cdn.exemplo.test/guia-de-git.pdf'),
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(tab.cancel).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path === `/api/v1/ebooks/${GIT.id}/download`)).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sem acesso (403) fecha a aba e avisa; outra falha traz o código da requisição', async () => {
    const user = userEvent.setup();
    const { tab } = fakeTab();
    let denied = true;
    renderApp(
      '/meus-ebooks',
      apiRoutes({
        [EBOOKS]: () => jsonResponse(MY_EBOOKS),
        [DOWNLOAD]: () =>
          denied
            ? problemResponse(403, 'access_denied', { reason: 'expired' })
            : unavailableResponse(),
      }),
      { session },
    );

    const button = await screen.findByRole('button', { name: 'Baixar: Guia de Git' });
    await user.click(button);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Não foi possível baixar “Guia de Git”')).toBeTruthy();
    expect(within(alert).getByText(t.accessDenied)).toBeTruthy();
    expect(tab.cancel).toHaveBeenCalledTimes(1);
    expect(tab.go).not.toHaveBeenCalled();

    denied = false;
    await user.click(button);
    expect(await screen.findByText(ptBR.errors.unavailable)).toBeTruthy();
    expect(screen.getByText('Código da requisição: req-teste-1')).toBeTruthy();
    expect(tab.cancel).toHaveBeenCalledTimes(2);
  });

  it('endereço que não é http(s) não é aberto', async () => {
    const user = userEvent.setup();
    const { tab } = fakeTab();
    renderApp(
      '/meus-ebooks',
      apiRoutes({
        [EBOOKS]: () => jsonResponse(MY_EBOOKS),
        [DOWNLOAD]: () => jsonResponse({ url: 'javascript:alert(1)' }),
      }),
      { session },
    );
    await user.click(await screen.findByRole('button', { name: 'Baixar: Guia de Git' }));
    expect(await screen.findByText(t.badLink)).toBeTruthy();
    expect(tab.go).not.toHaveBeenCalled();
    expect(tab.cancel).toHaveBeenCalledTimes(1);
  });

  it('sem ebooks mostra o vazio; falha da lista tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      '/meus-ebooks',
      apiRoutes({ [EBOOKS]: () => (fail ? unavailableResponse() : jsonResponse({ items: [] })) }),
      { session },
    );
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(t.errorTitle)).toBeTruthy();
    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await screen.findByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.study.start.showcase }).getAttribute('href')).toBe(
      '/',
    );
  });
});
