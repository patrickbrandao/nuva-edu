import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../format';
import { calls, defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { PLAN_ID, plan, planPage } from '../../test/plans';
import { renderApp } from '../../test/render';
import { SUBSCRIPTION_ID, subscriptionPage, subscriptionSummary } from '../../test/subscriptions';

function subscriptionsRoutes(extra: Routes = {}) {
  const queries: URLSearchParams[] = [];
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/subscriptions': (request: Request) => {
      queries.push(new URL(request.url).searchParams);
      return subscriptionPage();
    },
    'GET /api/v1/plans': planPage([plan()]),
    ...extra,
  };
  return { routes, queries };
}

const PERIOD = `${formatDateTime('2026-11-01T12:00:00Z')} a ${formatDateTime(
  '2026-12-01T12:00:00Z',
)}`;

describe('assinaturas (/assinaturas)', () => {
  it('lista as assinaturas com assinante, plano, estado, preço e período, sem violações do axe', async () => {
    const { routes, queries } = subscriptionsRoutes();
    renderApp('/assinaturas', routes);

    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getByText('Bia Aluna')).toBeTruthy();
    expect(within(table).getByText('bia@aluna.test')).toBeTruthy();
    expect(
      within(table)
        .getByRole('link', { name: /Bia Aluna/ })
        .getAttribute('href'),
    ).toBe(`/assinaturas/${SUBSCRIPTION_ID}`);
    expect(within(table).getByText('Curso de Ouro · Mensal')).toBeTruthy();
    expect(within(table).getByText('Ativa')).toBeTruthy();
    expect(within(table).getByText('R$ 97,00')).toBeTruthy();
    expect(within(table).getByText(PERIOD)).toBeTruthy();
    expect(within(table).getByText(formatDateTime('2026-12-01T12:00:00Z'))).toBeTruthy();
    expect(queries[0]?.get('limit')).toBe('25');
    await expectNoAxeViolations();
  });

  it('mostra a carência no lugar da próxima cobrança e o travessão sem data', async () => {
    const { routes } = subscriptionsRoutes({
      'GET /api/v1/subscriptions': () =>
        subscriptionPage([
          subscriptionSummary({
            id: '0193a5b2-0000-7000-8000-0000000000f9',
            status: 'past_due',
            nextChargeAt: null,
            graceUntil: '2026-12-10T12:00:00Z',
          }),
          subscriptionSummary({
            id: '0193a5b2-0000-7000-8000-0000000000fa',
            status: 'pending',
            currentPeriodStart: null,
            currentPeriodEnd: null,
            nextChargeAt: null,
          }),
        ]),
    });
    renderApp('/assinaturas', routes);
    await screen.findByRole('table');

    expect(screen.getByText('Em carência')).toBeTruthy();
    expect(screen.getByText(`Carência até ${formatDateTime('2026-12-10T12:00:00Z')}`)).toBeTruthy();
    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
    // Sem período e sem próxima cobrança: o travessão nas duas células.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('leva estado, plano e busca ao endereço e à consulta, e limpa os filtros', async () => {
    const user = userEvent.setup();
    const { routes, queries } = subscriptionsRoutes();
    const { router } = renderApp('/assinaturas', routes);
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar assinante' }), 'bia');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('bia'));

    await user.click(screen.getByRole('button', { name: 'Estado: Todos os estados' }));
    await user.click(screen.getByRole('option', { name: 'Suspensa' }));
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('suspended'));

    await user.click(screen.getByRole('button', { name: 'Plano: Todos os planos' }));
    await user.click(screen.getByRole('option', { name: 'Curso de Ouro' }));
    await waitFor(() => expect(queries.at(-1)?.get('planId')).toBe(PLAN_ID));

    expect(router.state.location.search).toBe(`?q=bia&status=suspended&planId=${PLAN_ID}`);

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(queries.at(-1)?.get('status')).toBeNull();
    expect(queries.at(-1)?.get('planId')).toBeNull();
  });

  it('lê o período do endereço e manda o começo e o fim do dia à API', async () => {
    const { routes, queries } = subscriptionsRoutes();
    renderApp('/assinaturas?from=2026-11-01&to=2026-11-30', routes);
    await screen.findByRole('table');

    const query = queries[0];
    expect(query?.get('from')).toBe(new Date('2026-11-01T00:00:00').toISOString());
    expect(query?.get('to')).toBe(new Date('2026-12-01T00:00:00').toISOString());
    expect((screen.getByLabelText('De') as HTMLInputElement).value).toBe('2026-11-01');
    expect((screen.getByLabelText('Até') as HTMLInputElement).value).toBe('2026-11-30');
  });

  it('carrega a página seguinte por cursor', async () => {
    const user = userEvent.setup();
    const second = subscriptionSummary({
      id: '0193a5b2-0000-7000-8000-0000000000f8',
      subscriber: {
        id: '0193a5b2-0000-7000-8000-0000000000b2',
        name: 'Caio Aluno',
        email: 'caio@aluno.test',
      },
    });
    const { routes, queries } = subscriptionsRoutes({
      'GET /api/v1/subscriptions': (request: Request) => {
        const params = new URL(request.url).searchParams;
        queries.push(params);
        return params.get('cursor') === 'next'
          ? subscriptionPage([second], null)
          : subscriptionPage([subscriptionSummary()], 'next');
      },
    });
    renderApp('/assinaturas', routes);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Caio Aluno')).toBeTruthy();
    expect(queries.at(-1)?.get('cursor')).toBe('next');
  });

  it('esconde o filtro de plano do gerente, que não lista planos', async () => {
    const { fetchMock } = renderApp('/assinaturas', {
      ...defaultRoutes('manager'),
      'GET /api/v1/subscriptions': subscriptionPage(),
    });
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: /^Plano:/ })).toBeNull();
    expect(calls(fetchMock)).not.toContain('GET /api/v1/plans');
  });

  it('recusa a lista ao instrutor, que não tem sales.view', async () => {
    renderApp('/assinaturas', defaultRoutes('instructor'));
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('mostra o estado vazio, o vazio de filtro e o erro da lista', async () => {
    const empty = subscriptionsRoutes({
      'GET /api/v1/subscriptions': () => subscriptionPage([], null),
    });
    renderApp('/assinaturas', empty.routes);
    expect(await screen.findByText('Nenhuma assinatura ainda')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver planos' }).getAttribute('href')).toBe('/planos');
  });

  it('mostra o vazio do filtro com limpar', async () => {
    const empty = subscriptionsRoutes({
      'GET /api/v1/subscriptions': () => subscriptionPage([], null),
    });
    renderApp('/assinaturas?status=ended', empty.routes);
    expect(await screen.findByText('Nenhuma assinatura com estes filtros')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Limpar filtros' }).length).toBeGreaterThan(0);
  });

  it('mostra o erro da lista com a opção de tentar de novo', async () => {
    const failed = subscriptionsRoutes({
      'GET /api/v1/subscriptions': () => problem(503, 'service_unavailable'),
    });
    renderApp('/assinaturas', failed.routes);
    expect(await screen.findByText('Não foi possível carregar as assinaturas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
