import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { renderApp } from '../test/render';
import { MENU, MENU_ITEMS } from './menu';

describe('casca do admin', () => {
  it('mostra o menu da spec 006 em grupos, com os rótulos das traduções', async () => {
    renderApp('/');
    const menu = await screen.findByRole('navigation', { name: /Escola Aurora/ });

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
    await screen.findByRole('navigation', { name: /Escola Aurora/ });
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

  it('começa com o menu recolhido em tela estreita', () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({ ...original(query), matches: query.includes('max-width') }) as MediaQueryList;
    try {
      renderApp('/');
      expect(screen.getByRole('button', { name: 'Expandir o menu' })).toBeTruthy();
    } finally {
      window.matchMedia = original;
    }
  });

  it('tem no rodapé o link "Código-fonte" para o repositório e a versão instalada', async () => {
    renderApp('/');
    const link = screen.getByRole('link', { name: 'Código-fonte' });
    expect(link.getAttribute('href')).toBe('https://github.com/patrickbrandao/nuva-edu');
    expect(await screen.findByText('Versão 0.1.0')).toBeTruthy();
  });

  it('mostra "página não encontrada" em endereço desconhecido, com volta ao painel', () => {
    renderApp('/nao-existe');
    expect(screen.getAllByText('Página não encontrada').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Voltar ao painel' }).getAttribute('href')).toBe('/');
  });
});
