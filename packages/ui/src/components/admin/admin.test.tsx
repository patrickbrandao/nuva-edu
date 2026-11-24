import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminBreadcrumb,
  AdminButton,
  AdminContent,
  AdminEmpty,
  AdminField,
  AdminMenu,
  AdminShell,
  AdminSidebar,
  AdminTable,
  AdminTabs,
  AdminTopbar,
  CASES,
  CasesBoard,
  CLIENT,
  ClientOverview,
} from '../../index';

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
