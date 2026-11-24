import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { renderApp } from '../test/render';
import { MENU, MENU_ITEMS } from './menu';

describe('casca do admin', () => {
  it('mostra o menu da spec 006 em grupos, com os rótulos das traduções', () => {
    renderApp('/');
    const menu = screen.getByRole('navigation', { name: 'Menu' });

    for (const group of MENU) {
      expect(within(menu).getByText(ptBR.menu.groups[group.id])).toBeTruthy();
    }
    for (const item of MENU_ITEMS) {
      const link = within(menu).getByRole('link', { name: ptBR.menu.items[item.id] });
      expect(link.getAttribute('href')).toBe(item.path);
    }
    expect(MENU_ITEMS).toHaveLength(21);
    expect(within(menu).getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('usa o nome da escola vindo da API como marca e no título da aba', async () => {
    renderApp('/');
    const menu = screen.getByRole('navigation', { name: 'Menu' });
    expect(
      await within(menu.parentElement as HTMLElement).findByText('Escola Aurora'),
    ).toBeTruthy();
    expect(document.title).toBe('Painel · Escola Aurora');
  });

  it('navega pelo menu sem recarregar e leva item sem tela à página em construção', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/');

    await user.click(screen.getByRole('link', { name: 'Alunos' }));

    expect(router.state.location.pathname).toBe('/alunos');
    expect(screen.getByRole('heading', { level: 1, name: 'Alunos' })).toBeTruthy();
    expect(screen.getByText('Em construção')).toBeTruthy();
    expect(
      screen.getByText('A tela “Alunos” ainda não está disponível nesta versão.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alunos' }).getAttribute('aria-current')).toBe('page');

    const crumbs = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(crumbs).getByText('Alunos').getAttribute('aria-current')).toBe('page');
    await user.click(within(crumbs).getByRole('link', { name: 'Painel' }));
    expect(router.state.location.pathname).toBe('/');
  });

  it('abre cada rota do menu por endereço direto', () => {
    for (const item of MENU_ITEMS.filter((entry) => entry.path !== '/')) {
      const { unmount } = renderApp(item.path);
      expect(
        screen.getByRole('heading', { level: 1, name: ptBR.menu.items[item.id] }),
      ).toBeTruthy();
      unmount();
    }
  });

  it('troca o tema nos três modos e guarda a escolha em nuva-theme', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const theme = screen.getByRole('group', { name: 'Tema da página' });

    await user.click(within(theme).getByRole('button', { name: 'Tema escuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('nuva-theme')).toBe('dark');

    await user.click(within(theme).getByRole('button', { name: 'Tema claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.click(within(theme).getByRole('button', { name: 'Usar o tema do sistema' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('nuva-theme')).toBeNull();
  });

  it('recolhe e expande o menu pelo botão da marca', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Recolher o menu' }));
    await user.click(screen.getByRole('button', { name: 'Expandir o menu' }));
    expect(screen.getByRole('button', { name: 'Recolher o menu' })).toBeTruthy();
  });

  it('em tela estreita o menu é uma gaveta: abre pelo botão da barra, fecha com Esc e pelo fundo', async () => {
    const user = userEvent.setup();
    const original = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({ ...original(query), matches: query.includes('max-width') }) as MediaQueryList;
    try {
      const { router } = renderApp('/');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Recolher o menu' })).toBeNull();
      const open = screen.getByRole('button', { name: 'Abrir o menu' });
      expect(open.getAttribute('aria-expanded')).toBe('false');

      await user.click(open);
      const drawer = screen.getByRole('dialog', { name: 'Menu' });
      expect(drawer.getAttribute('aria-modal')).toBe('true');
      expect(document.activeElement).toBe(
        within(drawer).getByRole('button', { name: 'Fechar o menu' }),
      );
      expect(screen.getByTestId('menu-backdrop')).toBeTruthy();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByTestId('menu-backdrop')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir o menu' }));

      await user.click(screen.getByRole('button', { name: 'Abrir o menu' }));
      await user.click(screen.getByTestId('menu-backdrop'));
      expect(screen.queryByRole('dialog')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Abrir o menu' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Alunos' }));
      expect(router.state.location.pathname).toBe('/alunos');
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('tem no rodapé o link "Código-fonte" para o repositório e a versão instalada', async () => {
    renderApp('/');
    const link = screen.getByRole('link', { name: /^Código-fonte\s*\(abre em nova aba\)$/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('href')).toBe('https://github.com/patrickbrandao/nuva-edu');
    expect(await screen.findByText('Versão 0.1.0')).toBeTruthy();
  });

  it('o botão "Voltar ao painel" navega pelo roteador, sem recarregar a página', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/alunos');
    let reloads = 0;
    const onClick = (event: MouseEvent) => {
      if (!event.defaultPrevented) reloads += 1;
    };
    window.addEventListener('click', onClick);
    try {
      await user.click(screen.getByRole('link', { name: 'Voltar ao painel' }));
      expect(router.state.location.pathname).toBe('/');
      expect(reloads).toBe(0);
    } finally {
      window.removeEventListener('click', onClick);
    }
  });

  it('mostra "página não encontrada" em endereço desconhecido, com volta ao painel', () => {
    renderApp('/nao-existe');
    expect(screen.getAllByText('Página não encontrada').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Voltar ao painel' }).getAttribute('href')).toBe('/');
  });
});
