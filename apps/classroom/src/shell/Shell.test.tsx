import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SOURCE_CODE_URL } from '../config';
import ptBR from '../locales/pt-BR.json';
import { renderApp } from '../test/renderApp';
import { NAV_GROUPS } from './navigation';

describe('casca do classroom', () => {
  it('mostra a barra superior, o menu da spec 006, o conteúdo e o rodapé', async () => {
    renderApp('/');

    const menu = screen.getByRole('navigation', { name: ptBR.shell.menu });
    for (const group of Object.values(ptBR.menu.groups)) {
      expect(within(menu).getByRole('list', { name: group })).toBeTruthy();
    }
    const links = within(menu).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      NAV_GROUPS.flatMap((group) => group.items.map((item) => item.path)),
    );
    expect(links.map((link) => link.textContent)).toEqual(Object.values(ptBR.menu.items));
    expect(within(menu).getByRole('link', { current: 'page' }).textContent).toBe(
      ptBR.menu.items.showcase,
    );

    expect(screen.getByRole('link', { name: ptBR.shell.skipToContent }).getAttribute('href')).toBe(
      '#conteudo',
    );
    expect(screen.getByRole('main').id).toBe('conteudo');
    expect(screen.getByRole('group', { name: ptBR.theme.group })).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.shell.signIn }).getAttribute('href')).toBe(
      '/entrar',
    );

    // o nome da escola vem de /api/v1/meta
    expect(await screen.findByRole('link', { name: 'Escola Aurora' })).toBeTruthy();
  });

  it('tem o link "Código-fonte" no rodapé (AGPL-3.0)', () => {
    renderApp('/');
    const footer = screen.getByRole('contentinfo');
    const source = within(footer).getByRole('link', { name: new RegExp(ptBR.footer.source) });
    expect(source.getAttribute('href')).toBe(SOURCE_CODE_URL);
    expect(source.getAttribute('rel')).toBe('noreferrer');
  });

  it('troca o tema e guarda a escolha em nuva-theme', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: ptBR.theme.dark.hint }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('nuva-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: ptBR.theme.light.hint }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: ptBR.theme.system.hint }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('nuva-theme')).toBeNull();
  });

  it('abre a gaveta do menu, fecha com Esc e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const toggle = screen.getByRole('button', { name: ptBR.shell.openMenu });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(toggle);
    const drawer = screen.getByRole('dialog', { name: ptBR.shell.menu });
    expect(drawer.id).toBe(toggle.getAttribute('aria-controls'));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      within(drawer).getByRole('button', { name: ptBR.shell.closeMenu }),
    );
    expect(screen.getByRole('main').parentElement?.hasAttribute('inert')).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('leva um item ainda sem tela à página "em construção", com trilha e título', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: ptBR.shell.openMenu }));
    await user.click(screen.getByRole('link', { name: ptBR.menu.items.forum }));

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.menu.items.forum }),
    ).toBeTruthy();
    expect(screen.getByText(ptBR.construction.title)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));

    const trail = screen.getByRole('navigation', { name: ptBR.shell.breadcrumb });
    expect(within(trail).getByRole('link', { name: ptBR.home.title })).toBeTruthy();
    expect(within(trail).getByText(ptBR.menu.items.forum).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await screen.findByText(`Página: ${ptBR.menu.items.forum}`)).toBeTruthy();
    await waitFor(() => expect(document.title).toBe(`${ptBR.menu.items.forum} · Escola Aurora`));
  });

  it('abre todas as rotas do menu por endereço direto', async () => {
    for (const item of NAV_GROUPS.flatMap((group) => group.items).slice(1)) {
      const view = renderApp(item.path);
      expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
      expect(screen.getByText(ptBR.construction.title)).toBeTruthy();
      view.unmount();
    }
  });

  it('mostra "não encontrado" em endereço desconhecido', async () => {
    renderApp('/nao-existe');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.notFound.title }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.common.backHome }).getAttribute('href')).toBe('/');
  });
});
