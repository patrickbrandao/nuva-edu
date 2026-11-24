import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminBreadcrumb,
  AdminButton,
  AdminContent,
  AdminDetails,
  AdminEmpty,
  AdminField,
  AdminMenu,
  AdminNav,
  AdminShell,
  AdminSidebar,
  AdminTable,
  AdminTabs,
  AdminTopbar,
  CASES,
  CasesBoard,
  CLIENT,
  ClientOverview,
  type LinkComponent,
  LinkProvider,
} from '../../index';
import { fakeViewport } from '../../test/viewport';

/** Faz o papel do link do roteador de um site: marca o que passou por ele. */
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

describe('controles do painel', () => {
  it('AdminButton é um <button> e vira link com `href`', () => {
    const onClick = vi.fn();
    render(
      <>
        <AdminButton variant="primary" onClick={onClick}>
          Salvar
        </AdminButton>
        <AdminButton href="/cursos">Cursos</AdminButton>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button.className).toContain('minui-adm-btn--primary');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Cursos' }).getAttribute('href')).toBe('/cursos');
  });

  it('AdminButton com `href` interno usa o componente de link do site', () => {
    const onClick = vi.fn();
    render(
      <>
        <AdminButton href="/cursos" linkComponent={RouterLink} onClick={onClick}>
          Pela prop
        </AdminButton>
        <LinkProvider component={RouterLink}>
          <AdminButton href="/alunos" variant="primary">
            Pelo provedor
          </AdminButton>
          <AdminButton href="https://example.com/ajuda">Externo</AdminButton>
          <AdminButton href="/relatorio.csv" download>
            Baixar
          </AdminButton>
          <AdminButton href="/ajuda" target="_blank">
            Outra aba
          </AdminButton>
          <AdminButton>Sem link</AdminButton>
        </LinkProvider>
      </>,
    );
    const byProp = screen.getByRole('link', { name: 'Pela prop' });
    expect(byProp.getAttribute('data-router')).toBe('sim');
    expect(byProp.getAttribute('href')).toBe('/cursos');
    fireEvent.click(byProp);
    expect(onClick).toHaveBeenCalledTimes(1);

    const byProvider = screen.getByRole('link', { name: 'Pelo provedor' });
    expect(byProvider.getAttribute('data-router')).toBe('sim');
    expect(byProvider.className).toContain('minui-adm-btn--primary');
    // externo, download e outra aba seguem o navegador
    for (const name of ['Externo', 'Baixar', 'Outra aba']) {
      expect(screen.getByRole('link', { name }).hasAttribute('data-router')).toBe(false);
    }
    expect(screen.getByRole('button', { name: 'Sem link' })).toBeTruthy();
  });

  it('AdminMenu abre a lista e devolve a opção escolhida', () => {
    const onChange = vi.fn();
    render(
      <AdminMenu
        value="recentes"
        onChange={onChange}
        options={[
          { id: 'recentes', label: 'Mais recentes' },
          { id: 'nome', label: 'Por nome' },
        ]}
      />,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Mais recentes/ }));
    const list = screen.getByRole('listbox');
    fireEvent.click(within(list).getByRole('option', { name: 'Por nome' }));
    expect(onChange.mock.calls[0]?.[0]).toBe('nome');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('AdminField liga o rótulo e o erro ao campo', () => {
    const onChange = vi.fn();
    render(<AdminField label="Cupom" error="Cupom inválido" value="X" onChange={onChange} />);
    const input = screen.getByLabelText('Cupom');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const noteId = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(noteId)?.textContent).toBe('Cupom inválido');
    fireEvent.change(input, { target: { value: 'NUVA10' } });
    expect(onChange).toHaveBeenCalledWith('NUVA10');
  });

  it('AdminTabs marca a aba atual e avisa a troca', () => {
    const onChange = vi.fn();
    render(
      <AdminTabs
        value="a"
        onChange={onChange}
        tabs={[
          { id: 'a', label: 'Todos', count: 3 },
          { id: 'b', label: 'Ativos' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: /Todos/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Ativos' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('dados do painel', () => {
  const columns = [
    { id: 'name', label: 'Nome' },
    { id: 'status', label: 'Situação', render: (row: { status: string }) => `[${row.status}]` },
  ];

  it('AdminTable desenha cabeçalho, linhas e células com `render`', () => {
    render(<AdminTable columns={columns} rows={[{ id: '1', name: 'Ana', status: 'ativa' }]} />);
    expect(screen.getByRole('columnheader', { name: 'Situação' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ana' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '[ativa]' })).toBeTruthy();
  });

  it('AdminTable sem linhas mostra o estado vazio', () => {
    render(
      <AdminTable
        columns={columns}
        rows={[]}
        empty={<AdminEmpty title="Nenhum aluno" text="Convide o primeiro." />}
      />,
    );
    expect(screen.getByText('Nenhum aluno')).toBeTruthy();
    expect(screen.getByText('Convide o primeiro.')).toBeTruthy();
  });
});

describe('detalhes e estado vazio', () => {
  it('AdminDetails corta o valor por padrão e quebra linha com `wrap`', () => {
    const items = [{ label: 'Entrada', value: 'E-mail e senha, Google, GitHub' }];
    const { container, rerender } = render(<AdminDetails items={items} />);
    expect(container.querySelector('dl')?.className).toBe('minui-adm-details');
    rerender(<AdminDetails items={items} wrap />);
    expect(container.querySelector('dl')?.className).toBe(
      'minui-adm-details minui-adm-details--wrap',
    );
    expect(screen.getByText('E-mail e senha, Google, GitHub').tagName).toBe('DD');
  });

  it('AdminEmpty sem `title` não deixa um <strong> vazio', () => {
    const { container, rerender } = render(<AdminEmpty text="Nada por aqui." />);
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.getByText('Nada por aqui.')).toBeTruthy();
    rerender(<AdminEmpty title="Vazio" text="Nada por aqui." />);
    expect(container.querySelector('strong')?.textContent).toBe('Vazio');
  });
});

describe('links da casca do painel', () => {
  const sections = [
    {
      id: 'geral',
      items: [
        { id: 'painel', label: 'Painel', href: '/' },
        { id: 'alunos', label: 'Alunos', href: '/alunos' },
        { id: 'docs', label: 'Documentação', href: 'https://example.com/docs' },
      ],
    },
  ];

  it('AdminNav desenha os itens com o componente de link e passa o evento a onNavigate', () => {
    const onNavigate = vi.fn();
    render(
      <AdminNav
        sections={sections}
        active="alunos"
        onNavigate={onNavigate}
        linkComponent={RouterLink}
      />,
    );
    const students = screen.getByRole('link', { name: 'Alunos' });
    expect(students.getAttribute('data-router')).toBe('sim');
    expect(students.getAttribute('href')).toBe('/alunos');
    expect(students.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Documentação' }).hasAttribute('data-router')).toBe(
      false,
    );
    fireEvent.click(students);
    const [id, item, event] = onNavigate.mock.calls[0] ?? [];
    expect(id).toBe('alunos');
    expect(item).toBe(sections[0]?.items[1]);
    expect(typeof event?.preventDefault).toBe('function');
  });

  it('AdminSidebar e AdminBreadcrumb pegam o link do LinkProvider; `navLabel` nomeia o <nav>', () => {
    render(
      <LinkProvider component={RouterLink}>
        <AdminSidebar brand={{ name: 'Escola' }} sections={sections} navLabel="Menu principal" />
        <AdminBreadcrumb
          items={[
            { label: 'Início', href: '/' },
            { label: 'Fora', href: 'https://example.com' },
            { label: 'Aqui' },
          ]}
        />
      </LinkProvider>,
    );
    const menu = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(menu).getByRole('link', { name: 'Painel' }).getAttribute('data-router')).toBe(
      'sim',
    );
    const trail = screen.getByRole('navigation', { name: 'Trilha' });
    expect(within(trail).getByRole('link', { name: 'Início' }).getAttribute('data-router')).toBe(
      'sim',
    );
    expect(within(trail).getByRole('link', { name: 'Fora' }).hasAttribute('data-router')).toBe(
      false,
    );
  });

  it('sem componente de link, tudo continua <a href> comum', () => {
    render(<AdminNav sections={sections} />);
    const link = screen.getByRole('link', { name: 'Painel' });
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('data-router')).toBe(false);
  });
});

describe('janela do painel: página inteira e gaveta', () => {
  const sections = [
    { id: 'geral', items: [{ id: 'painel', label: 'Painel', href: '/' }] },
    { id: 'pessoas', label: 'Pessoas', items: [{ id: 'alunos', label: 'Alunos' }] },
  ];
  const shell = () => document.querySelector('.minui-adm-shell') as HTMLElement;
  const side = () => document.querySelector('.minui-adm-side') as HTMLElement;

  it('por padrão é a janela com moldura e 780 px; `fullPage` tira a moldura e usa a tela', () => {
    const { rerender } = render(<AdminShell>conteúdo</AdminShell>);
    expect(shell().className).not.toContain('minui-adm-shell--page');
    expect(shell().style.getPropertyValue('--adm-height')).toBe('780px');
    rerender(<AdminShell fullPage>conteúdo</AdminShell>);
    expect(shell().className).toContain('minui-adm-shell--page');
    expect(shell().style.getPropertyValue('--adm-height')).toBe('100dvh');
    rerender(
      <AdminShell fullPage height={500}>
        conteúdo
      </AdminShell>,
    );
    expect(shell().style.getPropertyValue('--adm-height')).toBe('500px');
  });

  it('em tela estreita o menu já nasce recolhido, antes de qualquer efeito', () => {
    const width = window.innerWidth;
    const ui = (
      <AdminShell sidebar={<AdminSidebar brand={{ name: 'Escola' }} sections={sections} />} />
    );
    try {
      // renderToString não roda efeitos: é o que a primeira pintura mostra
      window.innerWidth = 600;
      expect(renderToString(ui)).toContain('data-collapsed');
      window.innerWidth = 1280;
      expect(renderToString(ui)).not.toContain('data-collapsed');
    } finally {
      window.innerWidth = width;
    }
  });

  it('a largura do menu só anima depois da primeira pintura (`data-booting`)', () => {
    const ui = <AdminShell sidebar={<AdminSidebar sections={sections} />} />;
    expect(renderToString(ui)).toContain('data-booting');
    render(ui);
    expect(shell().hasAttribute('data-booting')).toBe(false);
  });

  it('sem `drawerBelow` não há gaveta nem botão de menu na barra', () => {
    fakeViewport(360);
    render(
      <AdminShell defaultCollapsed={false} sidebar={<AdminSidebar sections={sections} />}>
        <AdminTopbar title="Painel" />
      </AdminShell>,
    );
    expect(shell().hasAttribute('data-drawer')).toBe(false);
    expect(side().hasAttribute('data-drawer')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Abrir o menu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Recolher o menu' })).toBeTruthy();
  });

  it('com `drawerBelow`, em tela larga o menu é a coluna de sempre', () => {
    fakeViewport(1280);
    render(
      <AdminShell
        drawerBelow={1024}
        defaultCollapsed={false}
        sidebar={<AdminSidebar sections={sections} />}
      >
        <AdminTopbar title="Painel" />
      </AdminShell>,
    );
    expect(side().hasAttribute('data-drawer')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Abrir o menu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Recolher o menu' })).toBeTruthy();
  });

  it('abaixo de `drawerBelow` o menu vira gaveta: abre como diálogo e fecha de três jeitos', () => {
    fakeViewport(360);
    const onNavigate = vi.fn();
    render(
      <AdminShell
        fullPage
        drawerBelow={1024}
        collapsed
        drawerLabels={{ open: 'Abrir menu', close: 'Fechar menu', title: 'Menu do painel' }}
        sidebar={
          <AdminSidebar brand={{ name: 'Escola' }} sections={sections} onNavigate={onNavigate} />
        }
      >
        <AdminTopbar title="Painel" />
        <AdminContent>Conteúdo</AdminContent>
      </AdminShell>,
    );
    const main = document.querySelector('.minui-adm-main') as HTMLElement;
    // fechada desde a primeira pintura; na gaveta o menu nunca fica só com ícones
    expect(shell().getAttribute('data-drawer')).toBe('closed');
    expect(side().getAttribute('data-drawer')).toBe('closed');
    expect(side().hasAttribute('data-collapsed')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recolher o menu' })).toBeNull();

    const open = screen.getByRole('button', { name: 'Abrir menu' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.getAttribute('aria-controls')).toBe(side().id);
    fireEvent.click(open);

    const dialog = screen.getByRole('dialog', { name: 'Menu do painel' });
    expect(dialog).toBe(side());
    expect(side().getAttribute('data-drawer')).toBe('open');
    expect(main.hasAttribute('inert')).toBe(true);
    const close = within(dialog).getByRole('button', { name: 'Fechar menu' });
    expect(document.activeElement).toBe(close);

    // botão de fechar: fecha e devolve o foco ao botão da barra
    fireEvent.click(close);
    expect(side().getAttribute('data-drawer')).toBe('closed');
    expect(main.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(open);

    // Esc
    fireEvent.click(open);
    fireEvent.keyDown(side(), { key: 'Escape' });
    expect(side().getAttribute('data-drawer')).toBe('closed');

    // fundo escuro
    fireEvent.click(open);
    fireEvent.click(screen.getByTestId('menu-backdrop'));
    expect(side().getAttribute('data-drawer')).toBe('closed');

    // escolher um item fecha e ainda avisa onNavigate
    fireEvent.click(open);
    fireEvent.click(within(side()).getByRole('button', { name: 'Alunos' }));
    expect(side().getAttribute('data-drawer')).toBe('closed');
    expect(onNavigate.mock.calls[0]?.[0]).toBe('alunos');
  });
});

describe('casca do painel', () => {
  const sections = [
    {
      id: 'geral',
      label: 'Visão geral',
      items: [
        { id: 'painel', label: 'Painel' },
        { id: 'alunos', label: 'Alunos', badge: 4 },
      ],
    },
  ];

  it('AdminShell monta menu, trilha e conteúdo, e o menu navega e recolhe', () => {
    const onNavigate = vi.fn();
    render(
      <AdminShell
        defaultCollapsed={false}
        sidebar={
          <AdminSidebar
            brand={{ name: 'Escola' }}
            sections={sections}
            active="alunos"
            onNavigate={onNavigate}
            user={{ name: 'Rita Alves', role: 'Admin' }}
          />
        }
      >
        <AdminTopbar>
          <AdminBreadcrumb items={[{ label: 'Pessoas', href: '/' }, { label: 'Alunos' }]} />
        </AdminTopbar>
        <AdminContent>Lista de alunos</AdminContent>
      </AdminShell>,
    );

    const menu = screen.getByRole('navigation', { name: 'Menu de Escola' });
    const current = within(menu).getByRole('button', { name: /Alunos/ });
    expect(current.getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(menu).getByRole('button', { name: 'Painel' }));
    expect(onNavigate.mock.calls[0]?.[0]).toBe('painel');

    const trail = screen.getByRole('navigation', { name: 'Trilha' });
    expect(within(trail).getByText('Alunos').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Lista de alunos')).toBeTruthy();
    expect(screen.getByText('Rita Alves')).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'Recolher o menu' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expandir o menu' })).toBeTruthy();
    expect(document.querySelector('.minui-adm-side')?.hasAttribute('data-collapsed')).toBe(true);
  });

  it('CasesBoard desenha as colunas e os cartões dos dados de exemplo', () => {
    render(<CasesBoard />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cases' })).toBeTruthy();
    const first = CASES[0];
    expect(first).toBeDefined();
    expect(screen.getAllByText(String(first?.name)).length).toBeGreaterThan(0);
  });

  it('ClientOverview desenha a ficha com os dados de exemplo', () => {
    render(<ClientOverview />);
    expect(screen.getAllByText(CLIENT.name).length).toBeGreaterThan(0);
  });
});
