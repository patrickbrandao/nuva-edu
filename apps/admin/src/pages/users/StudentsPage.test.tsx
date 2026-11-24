import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem, sessionFor } from '../../test/api';
import { findAlert, findMenu, renderApp } from '../../test/render';
import { userSummary } from '../../test/users';

const BIA = userSummary();
const CAIO = userSummary({
  id: '0193a5b2-0000-7000-8000-0000000000b2',
  name: 'Caio Suspenso',
  email: 'caio@aluno.test',
  status: 'suspended',
  emailVerified: false,
  lastLoginAt: null,
});

/** Rotas com a lista respondendo `items` e guardando as consultas recebidas. */
function withList(pages: Record<string, { items: unknown[]; nextCursor: string | null }>) {
  const queries: URLSearchParams[] = [];
  const routes = {
    ...defaultRoutes(),
    'GET /api/v1/users': (request: Request) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      return pages[params.get('cursor') ?? 'first'] ?? { items: [], nextCursor: null };
    },
  };
  return { routes, queries };
}

describe('lista de alunos (/alunos)', () => {
  it('mostra carregando e depois os usuários, com papel, situação e ligação à ficha', async () => {
    const { routes, queries } = withList({ first: { items: [BIA, CAIO], nextCursor: null } });
    renderApp('/alunos', routes);
    expect(await screen.findByText('Carregando os usuários…')).toBeTruthy();

    const table = (await screen.findByRole('table')) as HTMLElement;
    const link = within(table).getByRole('link', { name: 'Bia Aluna' });
    expect(link.getAttribute('href')).toBe(`/alunos/${BIA.id}`);
    expect(within(table).getByText('caio@aluno.test')).toBeTruthy();
    expect(within(table).getByText('Suspenso')).toBeTruthy();
    expect(within(table).getByText('E-mail não confirmado')).toBeTruthy();
    expect(within(table).getByText('Nunca entrou')).toBeTruthy();
    expect(within(table).getAllByText('Aluno')).toHaveLength(2);
    expect(queries[0]?.get('sort')).toBe('-createdAt');
    expect(queries[0]?.get('limit')).toBe('25');
  });

  it('busca, filtra e ordena pelo endereço e pela consulta', async () => {
    const user = userEvent.setup();
    const { routes, queries } = withList({ first: { items: [BIA], nextCursor: null } });
    const { router } = renderApp('/alunos', routes);
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar por nome ou e-mail' }), 'bia');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(router.state.location.search).toBe('?q=bia'));

    await user.click(screen.getByRole('button', { name: 'Papel: Todos os papéis' }));
    await user.click(screen.getByRole('option', { name: 'Aluno' }));
    await user.click(screen.getByRole('button', { name: 'Situação: Todas as situações' }));
    await user.click(screen.getByRole('option', { name: 'Suspenso' }));
    await user.click(screen.getByRole('button', { name: 'Ordem: Cadastro mais recente' }));
    await user.click(screen.getByRole('option', { name: 'Nome' }));

    await waitFor(() => {
      const last = queries.at(-1);
      expect(last?.get('q')).toBe('bia');
      expect(last?.get('role')).toBe('student');
      expect(last?.get('status')).toBe('suspended');
      expect(last?.get('sort')).toBe('name');
    });
    expect(router.state.location.search).toBe('?q=bia&role=student&status=suspended&sort=name');
  });

  it('abre com os filtros do endereço', async () => {
    const { routes, queries } = withList({ first: { items: [BIA], nextCursor: null } });
    renderApp('/alunos?role=manager&status=unverified&sort=-lastLoginAt&q=ana', routes);
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Papel: Gerente' })).toBeTruthy();
    expect(Object.fromEntries(queries[0] ?? [])).toMatchObject({
      role: 'manager',
      status: 'unverified',
      sort: '-lastLoginAt',
      q: 'ana',
    });
  });

  it('carrega a página seguinte pelo cursor', async () => {
    const user = userEvent.setup();
    const { routes, queries } = withList({
      first: { items: [BIA], nextCursor: 'c2' },
      c2: { items: [CAIO], nextCursor: null },
    });
    renderApp('/alunos', routes);
    await screen.findByRole('link', { name: 'Bia Aluna' });
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('link', { name: 'Caio Suspenso' })).toBeTruthy();
    expect(queries.at(-1)?.get('cursor')).toBe('c2');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('vazio com filtro oferece limpar; sem filtro, voltar ao painel', async () => {
    const user = userEvent.setup();
    const { routes } = withList({});
    const { router } = renderApp('/alunos?q=ninguem', routes);
    expect(await screen.findByText('Nenhum usuário encontrado')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Limpar a busca e os filtros' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByText('Nenhum usuário ainda')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Voltar ao painel' }).length).toBeGreaterThan(0);
  });

  it('erro (rota ausente) mostra erro tratado e tenta de novo', async () => {
    const user = userEvent.setup();
    let ready = false;
    renderApp('/alunos', {
      ...defaultRoutes(),
      'GET /api/v1/users': () =>
        ready ? { items: [BIA], nextCursor: null } : problem(404, 'not_found'),
    });
    const alert = await findAlert();
    expect(within(alert).getByText('Não foi possível carregar os usuários')).toBeTruthy();
    ready = true;
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('link', { name: 'Bia Aluna' })).toBeTruthy();
  });

  it('403 da API vira "sem permissão", mesmo com o item no menu', async () => {
    renderApp('/alunos', {
      ...defaultRoutes(),
      'GET /api/v1/users': () => problem(403, 'permission_denied'),
    });
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });

  it('instructor não abre a lista (sem users.view_private) e nada é consultado', async () => {
    const { routes, queries } = withList({ first: { items: [BIA], nextCursor: null } });
    renderApp('/alunos', {
      ...routes,
      'GET /api/v1/session': sessionFor('instructor'),
    });
    await findMenu();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(queries).toHaveLength(0);
  });
});
