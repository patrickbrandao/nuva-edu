import { fireEvent, render, screen, within } from '@testing-library/react';
import { act, createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ClassroomShell,
  type ClassroomShellLabels,
  type ClassroomShellProps,
  type LinkComponent,
  ShellFooter,
} from '../../index';
import { fakeViewport } from '../../test/viewport';

const LABELS: ClassroomShellLabels = {
  skipToContent: 'Ir para o conteúdo',
  menu: 'Menu principal',
  openMenu: 'Abrir o menu',
  closeMenu: 'Fechar o menu',
  collapseMenu: 'Recolher o menu',
  expandMenu: 'Expandir o menu',
  breadcrumb: 'Você está em',
};

const GROUPS = [
  {
    id: 'explorar',
    label: 'Explorar',
    items: [
      { id: 'vitrine', label: 'Vitrine', href: '/' },
      { id: 'planos', label: 'Planos', href: '/planos' },
    ],
  },
  { id: 'conta', label: 'Conta', items: [{ id: 'compras', label: 'Compras', href: '/compras' }] },
];

const RouterLink: LinkComponent = ({ href, onClick, ...rest }) => (
  <a
    {...rest}
    href={href}
    data-router="sim"
    onClick={(event) => {
      onClick?.(event);
      event.preventDefault();
    }}
  />
);

function renderShell(props: Partial<ClassroomShellProps> = {}) {
  return render(
    <ClassroomShell
      brand={{ name: 'Escola Aurora', href: '/' }}
      groups={GROUPS}
      active="planos"
      labels={LABELS}
      crumbs={[{ label: 'Vitrine', href: '/' }, { label: 'Planos' }]}
      actions={<button type="button">Entrar</button>}
      footer={<ShellFooter>Escola Aurora · versão 1.2.3</ShellFooter>}
      {...props}
    >
      <p>Conteúdo da página</p>
    </ClassroomShell>,
  );
}

describe('casca do site do aluno', () => {
  it('monta barra superior, menu por grupos, trilha, conteúdo e rodapé', () => {
    fakeViewport(1280);
    renderShell();

    expect(screen.getByRole('link', { name: 'Ir para o conteúdo' }).getAttribute('href')).toBe(
      '#conteudo',
    );
    expect(screen.getByRole('link', { name: 'Escola Aurora' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();

    const menu = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(menu).getByRole('list', { name: 'Explorar' })).toBeTruthy();
    expect(within(menu).getByRole('list', { name: 'Conta' })).toBeTruthy();
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/', '/planos', '/compras']);
    expect(within(menu).getByRole('link', { current: 'page' }).textContent).toBe('Planos');

    const trail = screen.getByRole('navigation', { name: 'Você está em' });
    expect(within(trail).getByRole('link', { name: 'Vitrine' })).toBeTruthy();
    expect(within(trail).getByText('Planos').getAttribute('aria-current')).toBe('page');

    const main = screen.getByRole('main');
    expect(main.id).toBe('conteudo');
    expect(within(main).getByText('Conteúdo da página')).toBeTruthy();
    expect(screen.getByRole('contentinfo').textContent).toContain('versão 1.2.3');
  });

  it('os links internos passam pelo componente de link do site', () => {
    fakeViewport(1280);
    renderShell({ linkComponent: RouterLink });
    const routed = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('data-router') === 'sim')
      .map((link) => link.getAttribute('href'));
    // marca, três itens do menu e o primeiro item da trilha
    expect(routed).toEqual(['/', '/', '/planos', '/compras', '/']);
    expect(
      screen.getByRole('link', { name: 'Ir para o conteúdo' }).hasAttribute('data-router'),
    ).toBe(false);
  });

  it('em tela larga o botão recolhe a coluna e avisa a escolha', () => {
    fakeViewport(1280);
    const onCollapsedChange = vi.fn();
    renderShell({ onCollapsedChange });
    const aside = document.querySelector('.minui-room__side');
    expect(aside?.hasAttribute('data-drawer')).toBe(false);
    expect(aside?.hasAttribute('data-collapsed')).toBe(false);

    const toggle = screen.getByRole('button', { name: 'Recolher o menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(aside?.id);
    fireEvent.click(toggle);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(aside?.hasAttribute('data-collapsed')).toBe(true);
    expect(screen.getByRole('button', { name: 'Expandir o menu' })).toBeTruthy();
    // recolhido, o item mantém o nome (para leitor de tela) e ganha a dica
    expect(screen.getByRole('link', { name: 'Compras' }).getAttribute('title')).toBe('Compras');
  });

  it('`collapsed` controla a coluna de fora', () => {
    fakeViewport(1280);
    renderShell({ collapsed: true });
    expect(document.querySelector('.minui-room__side')?.hasAttribute('data-collapsed')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Expandir o menu' }));
    expect(document.querySelector('.minui-room__side')?.hasAttribute('data-collapsed')).toBe(true);
  });

  it('abaixo de 1024 px o menu é uma gaveta: abre como diálogo, prende o foco e fecha', () => {
    fakeViewport(360);
    renderShell({ collapsed: true, linkComponent: RouterLink });
    const aside = document.querySelector('.minui-room__side') as HTMLElement;
    const page = document.querySelector('.minui-room__page') as HTMLElement;
    // fechada desde a primeira pintura, e nunca recolhida em ícones
    expect(aside.getAttribute('data-drawer')).toBe('closed');
    expect(aside.hasAttribute('data-collapsed')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    const open = screen.getByRole('button', { name: 'Abrir o menu' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);

    const dialog = screen.getByRole('dialog', { name: 'Menu principal' });
    expect(dialog).toBe(aside);
    expect(aside.getAttribute('data-drawer')).toBe('open');
    expect(aside.getAttribute('aria-modal')).toBe('true');
    expect(page.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    const close = within(dialog).getByRole('button', { name: 'Fechar o menu' });
    expect(document.activeElement).toBe(close);

    // Esc fecha e devolve o foco ao botão do menu
    fireEvent.keyDown(aside, { key: 'Escape' });
    expect(aside.getAttribute('data-drawer')).toBe('closed');
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(open);

    // o fundo escuro fecha
    fireEvent.click(open);
    fireEvent.click(screen.getByTestId('menu-backdrop'));
    expect(aside.getAttribute('data-drawer')).toBe('closed');

    // escolher um item fecha
    fireEvent.click(open);
    fireEvent.click(within(aside).getByRole('link', { name: 'Compras' }));
    expect(aside.getAttribute('data-drawer')).toBe('closed');
  });

  it('a gaveta aberta some quando a tela alarga, e não reabre ao estreitar', () => {
    const resize = fakeViewport(800);
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o menu' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => resize(1280));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.minui-room__side')?.hasAttribute('data-drawer')).toBe(false);
    act(() => resize(800));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('entrega o <main> por `mainRef` e anuncia o texto de `announcement`', () => {
    fakeViewport(1280);
    const mainRef = createRef<HTMLElement>();
    renderShell({ mainRef, announcement: 'Página Planos', contentId: 'principal' });
    expect(mainRef.current).toBe(screen.getByRole('main'));
    expect(mainRef.current?.id).toBe('principal');
    expect(mainRef.current?.getAttribute('tabindex')).toBe('-1');
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('Página Planos');
  });
});

describe('rodapé das cascas', () => {
  it('mostra o texto e os links; o externo abre em outra aba', () => {
    render(
      <ShellFooter
        linkComponent={RouterLink}
        newTabLabel="(abre em nova aba)"
        links={[
          { id: 'termos', label: 'Termos', href: '/termos' },
          { id: 'codigo', label: 'Código-fonte', href: 'https://example.com/repo', external: true },
        ]}
      >
        Versão 1.2.3
      </ShellFooter>,
    );
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain('Versão 1.2.3');
    expect(within(footer).getByRole('link', { name: 'Termos' }).getAttribute('data-router')).toBe(
      'sim',
    );
    const source = within(footer).getByRole('link', { name: /Código-fonte/ });
    expect(source.getAttribute('href')).toBe('https://example.com/repo');
    expect(source.getAttribute('target')).toBe('_blank');
    expect(source.getAttribute('rel')).toBe('noreferrer');
  });
});
