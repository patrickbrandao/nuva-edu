import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, defaultRoutes, problem, type Routes, sessionFor } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { findAlert, findMenu, renderApp } from '../../test/render';

const ENTRY_ID = '0193a5b2-0000-7000-8000-0000000000e1';
const ENTRY = {
  id: ENTRY_ID,
  createdAt: '2026-11-24T10:00:00Z',
  actor: { id: ADMIN_ID, name: 'Ana Admin' },
  actorRole: 'admin',
  origin: 'admin_panel',
  mcpKeyId: null,
  action: 'user.suspend',
  targetType: 'user',
  targetId: '0193a5b2-0000-7000-8000-0000000000b1',
  targetName: 'Bia Aluna',
  outcome: 'ok',
  ip: '203.0.113.10',
  userAgent: 'Mozilla/5.0',
  requestId: 'req-1',
};
const WORKER_ENTRY = {
  ...ENTRY,
  id: '0193a5b2-0000-7000-8000-0000000000e2',
  actor: null,
  actorRole: null,
  origin: 'worker',
  action: 'user.unsuspend',
  outcome: 'denied',
  targetName: null,
  targetType: 'course',
  targetId: 'c-1',
};

function auditRoutes(pages: Record<string, unknown> = {}, extra: Routes = {}) {
  const queries: URLSearchParams[] = [];
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/audit': (request: Request) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      return (
        pages[params.get('cursor') ?? 'first'] ?? { items: [ENTRY, WORKER_ENTRY], nextCursor: null }
      );
    },
    ...extra,
  };
  return { routes, queries };
}

describe('auditoria (/auditoria)', () => {
  it('lista os registros com ator, ação, alvo, origem e resultado, sem violações do axe', async () => {
    const { routes, queries } = auditRoutes();
    renderApp('/auditoria', routes);
    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getByText('user.suspend')).toBeTruthy();
    expect(within(table).getByText('Bia Aluna')).toBeTruthy();
    expect(within(table).getByText('Painel')).toBeTruthy();
    expect(within(table).getByText('Concluída')).toBeTruthy();
    expect(within(table).getByText('Sistema')).toBeTruthy();
    expect(within(table).getByText('Tarefa automática')).toBeTruthy();
    expect(within(table).getByText('Negada')).toBeTruthy();
    expect(within(table).getByText('course c-1')).toBeTruthy();
    // Sem filtros, a API usa os últimos 30 dias.
    expect(queries[0]?.get('from')).toBeNull();
    expect(queries[0]?.get('limit')).toBe('50');
    await expectNoAxeViolations();
  });

  it('aplica período, ação e alvo pelo formulário e guarda no endereço', async () => {
    const user = userEvent.setup();
    const { routes, queries } = auditRoutes();
    const { router } = renderApp('/auditoria', routes);
    await screen.findByRole('table');
    const form = screen.getByRole('form', { name: 'Filtros da auditoria' });
    await user.type(within(form).getByLabelText('De'), '2026-11-01');
    await user.type(within(form).getByLabelText('Até (inclusive)'), '2026-11-24');
    await user.type(within(form).getByLabelText('Ação'), 'user.*');
    await user.type(within(form).getByLabelText('Tipo do alvo'), 'user');
    await user.type(within(form).getByLabelText('Identificador do alvo'), 'abc');
    await user.click(within(form).getByRole('button', { name: 'Aplicar filtros' }));

    await waitFor(() =>
      expect(router.state.location.search).toBe(
        '?from=2026-11-01&to=2026-11-24&action=user.*&targetType=user&targetId=abc',
      ),
    );
    await waitFor(() => expect(queries.at(-1)?.get('action')).toBe('user.*'));
    const last = queries.at(-1) as URLSearchParams;
    expect(new Date(last.get('from') as string).getTime()).toBe(
      new Date('2026-11-01T00:00:00').getTime(),
    );
    // `to` é exclusivo: o dia seguinte ao escolhido.
    expect(new Date(last.get('to') as string).getTime()).toBe(
      new Date('2026-11-25T00:00:00').getTime(),
    );
    expect(last.get('targetType')).toBe('user');
    expect(last.get('targetId')).toBe('abc');
  });

  it('filtra por origem, resultado e ator', async () => {
    const user = userEvent.setup();
    const { routes, queries } = auditRoutes();
    const { router } = renderApp('/auditoria', routes);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Origem: Todas as origens' }));
    await user.click(screen.getByRole('option', { name: 'MCP' }));
    await user.click(screen.getByRole('button', { name: 'Resultado: Todos os resultados' }));
    await user.click(screen.getByRole('option', { name: 'Negada' }));
    await user.click(screen.getByRole('button', { name: 'Filtrar pelos registros de Ana Admin' }));
    await waitFor(() => {
      const last = queries.at(-1);
      expect(last?.get('origin')).toBe('mcp');
      expect(last?.get('outcome')).toBe('denied');
      expect(last?.get('actorId')).toBe(ADMIN_ID);
    });
    await user.click(screen.getByRole('button', { name: 'Remover o filtro do ator Ana Admin' }));
    // Volta à consulta anterior, já em cache: não grava outro `audit.search`.
    await waitFor(() => expect(router.state.location.search).toBe('?origin=mcp&outcome=denied'));
  });

  it('recusa ação fora do formato e período acima de 366 dias, sem consultar', async () => {
    const user = userEvent.setup();
    const { routes, queries } = auditRoutes();
    renderApp('/auditoria', routes);
    await screen.findByRole('table');
    const before = queries.length;
    const form = screen.getByRole('form', { name: 'Filtros da auditoria' });
    await user.type(within(form).getByLabelText('Ação'), 'User Suspend');
    await user.type(within(form).getByLabelText('De'), '2025-01-01');
    await user.type(within(form).getByLabelText('Até (inclusive)'), '2026-11-24');
    await user.click(within(form).getByRole('button', { name: 'Aplicar filtros' }));
    expect(
      within(form).getByText('Use uma ação como user.suspend ou um prefixo como user.*.'),
    ).toBeTruthy();
    expect(within(form).getByText('O período pode ter no máximo 366 dias.')).toBeTruthy();
    expect(queries.length).toBe(before);
  });

  it('carrega mais pelo cursor', async () => {
    const user = userEvent.setup();
    const { routes, queries } = auditRoutes({
      first: { items: [ENTRY], nextCursor: 'c2' },
      c2: { items: [WORKER_ENTRY], nextCursor: null },
    });
    renderApp('/auditoria', routes);
    await screen.findByText('user.suspend');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('user.unsuspend')).toBeTruthy();
    expect(queries.at(-1)?.get('cursor')).toBe('c2');
  });

  it('vazio com filtro oferece limpar', async () => {
    const user = userEvent.setup();
    const { routes } = auditRoutes({ first: { items: [], nextCursor: null } });
    const { router } = renderApp('/auditoria?origin=cli', routes);
    expect(await screen.findByText('Nenhum registro encontrado')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('validation_failed e rota ausente viram erro tratado', async () => {
    renderApp('/auditoria', {
      ...defaultRoutes(),
      'GET /api/v1/audit': () => problem(404, 'not_found'),
    });
    expect(
      within(await findAlert()).getByText('Não foi possível carregar a auditoria'),
    ).toBeTruthy();
  });

  it('403 da API vira "sem permissão"', async () => {
    renderApp('/auditoria', {
      ...defaultRoutes(),
      'GET /api/v1/audit': () => problem(403, 'permission_denied'),
    });
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });

  it('manager não abre a auditoria e não consulta (audit.view)', async () => {
    const { routes, queries } = auditRoutes();
    renderApp('/auditoria', { ...routes, 'GET /api/v1/session': sessionFor('manager') });
    await findMenu();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(queries).toHaveLength(0);
  });
});

describe('registro da auditoria (/auditoria/:id)', () => {
  const DETAIL = {
    ...ENTRY,
    details: {
      before: { status: 'active' },
      after: { status: 'suspended', reason: 'spam' },
      kind: 'full',
      truncated: true,
    },
  };

  it('abre pela lista e mostra antes, depois e o resto, sem violações do axe', async () => {
    const user = userEvent.setup();
    const { routes } = auditRoutes({}, { [`GET /api/v1/audit/${ENTRY_ID}`]: DETAIL });
    const { router } = renderApp('/auditoria', routes);
    await user.click(
      await screen.findByRole('link', { name: /^Abrir o registro user\.suspend de / }),
    );
    expect(router.state.location.pathname).toBe(`/auditoria/${ENTRY_ID}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Registro da auditoria' }),
    ).toBeTruthy();
    const before = screen.getByText('Antes').closest('figure') as HTMLElement;
    expect(within(before).getByText(/"active"/)).toBeTruthy();
    const after = screen.getByText('Depois').closest('figure') as HTMLElement;
    expect(within(after).getByText(/"spam"/)).toBeTruthy();
    expect(screen.getByText('Outros dados')).toBeTruthy();
    expect(screen.getByText('Os detalhes passaram de 8 KB e foram cortados.')).toBeTruthy();
    expect(screen.getByText('203.0.113.10')).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(crumbs).getByText('Registro user.suspend')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('sem details', async () => {
    renderApp(`/auditoria/${ENTRY_ID}`, {
      ...defaultRoutes(),
      [`GET /api/v1/audit/${ENTRY_ID}`]: { ...ENTRY, details: null },
    });
    expect(await screen.findByText('Este registro não tem detalhes.')).toBeTruthy();
  });

  it('registro inexistente', async () => {
    renderApp(`/auditoria/${ENTRY_ID}`, defaultRoutes());
    expect(await screen.findByText('Registro não encontrado')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar à auditoria' })).toBeTruthy();
  });
});
