import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { apiRoutes, jsonResponse, makeSession, renderApp } from '../test/renderApp';
import { ORDERS_URL, orderPage, orderSummary, uuid } from '../test/sales';

const session = makeSession();
const t = ptBR.sales.orders;
const number = (value: number) => ptBR.sales.order.number.replace('{{number}}', String(value));

describe('minhas compras', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/conta/compras');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fconta%2Fcompras');
  });

  it('lista os pedidos, avisa do limite de pendentes e abre sem violações do axe', async () => {
    const orders = [1042, 1043, 1044].map((number, index) =>
      orderSummary({ id: uuid(31 + index), number }),
    );
    renderApp(
      '/conta/compras',
      apiRoutes({ [ORDERS_URL]: () => jsonResponse(orderPage(orders)) }),
      { session },
    );

    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeTruthy();
    for (const order of orders) {
      expect(screen.getByRole('link', { name: number(order.number) })).toBeTruthy();
    }
    expect(screen.getAllByText(t.status.pending)).toHaveLength(3);
    expect(screen.getByText(t.pendingLimit)).toBeTruthy();
    expect(screen.getByRole('link', { name: number(1042) }).getAttribute('href')).toBe(
      `/pedidos/${orders[0]?.id}`,
    );

    await expectNoAxeViolations();
  });

  it('filtra por estado e pede a lista filtrada à API', async () => {
    const user = userEvent.setup();
    const pending = orderSummary();
    const paid = orderSummary({
      id: uuid(32),
      number: 1043,
      status: 'paid',
      paidAt: '2026-11-20T12:05:00Z',
      expiresAt: null,
      paymentMethod: 'pix',
    });
    const { calls } = renderApp(
      '/conta/compras',
      apiRoutes({
        [ORDERS_URL]: (request) => {
          const status = new URL(request.url).searchParams.get('status');
          return jsonResponse(orderPage(status === 'paid' ? [paid] : [pending, paid]));
        },
      }),
      { session },
    );

    expect(await screen.findByRole('link', { name: number(1042) })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: `${t.filters.label}: ${t.filters.all}` }));
    await user.click(await screen.findByRole('option', { name: t.status.paid }));

    await waitFor(() =>
      expect(
        calls.some((call) => call.path === '/api/v1/orders' && call.search.includes('status=paid')),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('link', { name: number(1042) })).toBeNull());
    expect(screen.getByRole('link', { name: number(1043) })).toBeTruthy();
  });

  it('carrega a próxima página pelo cursor', async () => {
    const user = userEvent.setup();
    const first = orderSummary();
    const second = orderSummary({
      id: uuid(33),
      number: 1039,
      status: 'canceled',
      expiresAt: null,
    });
    const { calls } = renderApp(
      '/conta/compras',
      apiRoutes({
        [ORDERS_URL]: (request) => {
          const cursor = new URL(request.url).searchParams.get('cursor');
          return jsonResponse(cursor ? orderPage([second]) : orderPage([first], 'cursor-2'));
        },
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: t.loadMore }));

    expect(await screen.findByRole('link', { name: number(1039) })).toBeTruthy();
    expect(calls.some((call) => call.search.includes('cursor=cursor-2'))).toBe(true);
    expect(screen.queryByRole('button', { name: t.loadMore })).toBeNull();
  });

  it('sem pedidos mostra o vazio e o caminho para a vitrine', async () => {
    renderApp('/conta/compras', apiRoutes({ [ORDERS_URL]: () => jsonResponse(orderPage([])) }), {
      session,
    });

    expect(await screen.findByText(t.emptyTitle)).toBeTruthy();
    const empty = screen.getByText(t.emptyText).closest('div') as HTMLElement;
    expect(within(empty).getByRole('link', { name: t.emptyAction }).getAttribute('href')).toBe('/');
  });
});
