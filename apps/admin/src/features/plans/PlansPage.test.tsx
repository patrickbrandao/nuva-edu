import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { PLAN_ID, plan, planPage } from '../../test/plans';
import { renderApp } from '../../test/render';

/** `GET /api/v1/plans` guardando a consulta de cada página, para conferir os filtros. */
function plansRoutes(extra: Routes = {}) {
  const queries: URLSearchParams[] = [];
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/plans': (request: Request) => {
      queries.push(new URL(request.url).searchParams);
      return planPage();
    },
    ...extra,
  };
  return { routes, queries };
}

describe('planos (/planos)', () => {
  it('lista os planos com periodicidade, preço, o que libera e a ordem da vitrine, sem violações do axe', async () => {
    const { routes, queries } = plansRoutes();
    renderApp('/planos', routes);

    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getByText('Curso de Ouro')).toBeTruthy();
    expect(within(table).getByText('curso-de-ouro-mensal')).toBeTruthy();
    expect(within(table).getByText('Mensal')).toBeTruthy();
    expect(within(table).getByText('R$ 97,00 por mês')).toBeTruthy();
    expect(within(table).getByText('2 itens')).toBeTruthy();
    expect(within(table).getByText('1 curso · 1 ebook')).toBeTruthy();
    expect(within(table).getByText('Nenhuma assinatura')).toBeTruthy();
    expect(within(table).getByText('Ativo')).toBeTruthy();
    expect(within(table).getByRole('link', { name: 'Editar' }).getAttribute('href')).toBe(
      `/planos/${PLAN_ID}`,
    );
    expect(screen.getByRole('link', { name: 'Novo plano' }).getAttribute('href')).toBe(
      '/planos/novo',
    );
    expect(queries[0]?.get('limit')).toBe('25');
    await expectNoAxeViolations();
  });

  it('leva busca, situação e periodicidade ao endereço e à consulta, e limpa tudo', async () => {
    const user = userEvent.setup();
    const { routes, queries } = plansRoutes();
    const { router } = renderApp('/planos', routes);
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar plano' }), 'ouro');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('ouro'));

    await user.click(screen.getByRole('button', { name: 'Situação: Todas as situações' }));
    await user.click(screen.getByRole('option', { name: 'Inativo' }));
    await waitFor(() => expect(queries.at(-1)?.get('active')).toBe('false'));

    await user.click(
      screen.getByRole('button', { name: 'Periodicidade: Todas as periodicidades' }),
    );
    await user.click(screen.getByRole('option', { name: 'Anual' }));
    await waitFor(() => expect(queries.at(-1)?.get('interval')).toBe('year'));

    expect(router.state.location.search).toBe('?q=ouro&active=inactive&interval=year');

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    const last = queries.at(-1);
    expect(last?.get('q')).toBeNull();
    expect(last?.get('active')).toBeNull();
    expect(last?.get('interval')).toBeNull();
  });

  it('carrega a página seguinte por cursor', async () => {
    const user = userEvent.setup();
    const second = plan({
      id: '0193a5b2-0000-7000-8000-0000000000e9',
      slug: 'curso-de-prata-mensal',
      groupKey: 'curso-de-prata',
      title: 'Curso de Prata',
    });
    const { routes, queries } = plansRoutes({
      'GET /api/v1/plans': (request: Request) => {
        const params = new URL(request.url).searchParams;
        queries.push(params);
        return params.get('cursor') === 'next'
          ? planPage([second], null)
          : planPage([plan()], 'next');
      },
    });
    renderApp('/planos', routes);
    await screen.findByRole('link', { name: 'Editar' });

    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Curso de Prata')).toBeTruthy();
    expect(queries.at(-1)?.get('cursor')).toBe('next');
  });

  it('desativa o plano depois da confirmação, avisando das assinaturas existentes', async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    const { routes } = plansRoutes({
      [`PATCH /api/v1/plans/${PLAN_ID}`]: async (request: Request) => {
        sent.push(await request.json());
        return plan({ subscriptionCount: 3, active: false });
      },
    });
    renderApp('/planos', routes);
    await screen.findByRole('link', { name: 'Editar' });

    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Desativar plano' });
    expect(within(dialog).getByText(/O plano sai da vitrine/)).toBeTruthy();
    await expectNoAxeViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }));

    await waitFor(() => expect(sent).toEqual([{ active: false }]));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('reativa o plano sem confirmação', async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    const active = plan({ subscriptionCount: 2 });
    const inactive = plan({ active: false, subscriptionCount: 2 });
    const { routes } = plansRoutes({
      'GET /api/v1/plans': () => planPage([inactive]),
      [`PATCH /api/v1/plans/${PLAN_ID}`]: async (request: Request) => {
        sent.push(await request.json());
        return active;
      },
    });
    renderApp('/planos', routes);
    await screen.findByRole('link', { name: 'Editar' });

    await user.click(screen.getByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(sent).toEqual([{ active: true }]));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('avisa quantas assinaturas o plano tem antes de desativar', async () => {
    const user = userEvent.setup();
    const { routes } = plansRoutes({
      'GET /api/v1/plans': () => planPage([plan({ subscriptionCount: 3 })]),
    });
    renderApp('/planos', routes);
    await screen.findByRole('link', { name: 'Editar' });

    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Desativar plano' });
    expect(within(dialog).getByText(/3 assinaturas existentes continuam ativas/)).toBeTruthy();
  });

  it('mostra o estado vazio com o convite a criar', async () => {
    const { routes } = plansRoutes({ 'GET /api/v1/plans': () => planPage([], null) });
    renderApp('/planos', routes);
    expect(await screen.findByText('Nenhum plano ainda')).toBeTruthy();
    expect(screen.getByText('Crie o primeiro plano para vender assinaturas.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Novo plano' })).toHaveLength(2);
  });

  it('mostra o vazio do filtro com limpar', async () => {
    const { routes } = plansRoutes({ 'GET /api/v1/plans': () => planPage([], null) });
    renderApp('/planos?q=nada', routes);
    expect(await screen.findByText('Nenhum plano com estes filtros')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Limpar filtros' }).length).toBeGreaterThan(0);
  });

  it('mostra o erro da lista com a opção de tentar de novo', async () => {
    const { routes } = plansRoutes({
      'GET /api/v1/plans': () => problem(503, 'service_unavailable'),
    });
    renderApp('/planos', routes);
    expect(await screen.findByText('Não foi possível carregar os planos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('recusa a tela ao gerente e ao instrutor, que não têm plan.manage', async () => {
    renderApp('/planos', defaultRoutes('manager'));
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    renderApp('/planos', defaultRoutes('instructor'));
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });

  it('resume o plano que libera tudo', async () => {
    const { routes } = plansRoutes({
      'GET /api/v1/plans': () => planPage([plan({ includesAll: true, items: [] })]),
    });
    renderApp('/planos', routes);
    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getAllByText('Tudo, inclusive futuros').length).toBeGreaterThan(0);
  });

  it('resume o plano que ainda não tem item', async () => {
    const { routes } = plansRoutes({
      'GET /api/v1/plans': () => planPage([plan({ items: [] })]),
    });
    renderApp('/planos', routes);
    expect((await screen.findAllByText('Nenhum item marcado')).length).toBeGreaterThan(0);
  });
});
