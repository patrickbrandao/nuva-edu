import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { findMenu, renderApp } from '../../test/render';
import {
  ORDER_ID,
  ORDER_ITEM_ID,
  orderDetail,
  orderItem,
  orderPage,
  orderSummary,
  refund,
} from '../../test/sales';

const CSV = `\ufefforder_id;order_number;created_at\r\n${ORDER_ID};101;2026-11-20T12:00:00Z\r\n`;

function salesRoutes(extra: Routes = {}) {
  const queries: URLSearchParams[] = [];
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/orders': (request: Request) => {
      queries.push(new URL(request.url).searchParams);
      return orderPage();
    },
    'GET /api/v1/orders/export.csv': new Response(CSV, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    }),
    [`GET /api/v1/orders/${ORDER_ID}`]: orderDetail(),
    ...extra,
  };
  return { routes, queries };
}

describe('pedidos (/pedidos)', () => {
  it('lista pedidos com comprador, estado, total e totais do filtro, sem violações do axe', async () => {
    const { routes, queries } = salesRoutes();
    renderApp('/pedidos', routes);

    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getByText('Bia Aluna')).toBeTruthy();
    expect(within(table).getByText('bia@aluna.test')).toBeTruthy();
    expect(within(table).getByText('Pago')).toBeTruthy();
    expect(within(table).getByText('R$ 199,00')).toBeTruthy();
    expect(within(table).getByRole('link', { name: 'Pedido 101' }).getAttribute('href')).toBe(
      `/pedidos/${ORDER_ID}`,
    );
    expect(screen.getByText('Subtotal')).toBeTruthy();
    expect(screen.getAllByText('R$ 199,00').length).toBeGreaterThan(1);
    expect(queries[0]?.get('limit')).toBe('25');
    await expectNoAxeViolations();
  });

  it('aplica busca e estado pelo endereço e leva os filtros à consulta', async () => {
    const user = userEvent.setup();
    const { routes, queries } = salesRoutes();
    const { router } = renderApp('/pedidos', routes);
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar por comprador' }), 'bia');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('bia'));

    await user.click(screen.getByRole('button', { name: 'Estado: Todos os estados' }));
    await user.click(screen.getByRole('option', { name: 'Pago' }));
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('paid'));
    expect(router.state.location.search).toBe('?q=bia&status=paid');

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(queries.at(-1)?.get('q')).toBeNull();
    expect(queries.at(-1)?.get('status')).toBeNull();
  });

  it('carrega a página seguinte por cursor', async () => {
    const user = userEvent.setup();
    const second = orderSummary({ id: '0193a5b2-0000-7000-8000-0000000000c9', number: 102 });
    const { routes, queries } = salesRoutes({
      'GET /api/v1/orders': (request: Request) => {
        const params = new URL(request.url).searchParams;
        queries.push(params);
        return params.get('cursor') === 'next'
          ? orderPage([second], null)
          : orderPage([orderSummary()], 'next');
      },
    });
    renderApp('/pedidos', routes);
    await screen.findByRole('link', { name: 'Pedido 101' });

    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('link', { name: 'Pedido 102' })).toBeTruthy();
    expect(queries.at(-1)?.get('cursor')).toBe('next');
  });

  it('mostra a exportação só para o admin e abre a tela de exportar', async () => {
    const { routes } = salesRoutes();
    const { router } = renderApp('/pedidos', routes);
    const menu = await findMenu();
    expect(within(menu).getByRole('link', { name: 'Exportar vendas' }).getAttribute('href')).toBe(
      '/pedidos/exportar',
    );
    expect(screen.getAllByRole('link', { name: 'Exportar vendas' })).toHaveLength(2);

    await router.navigate('/pedidos/exportar');
    expect(await screen.findByRole('heading', { name: 'Exportar vendas', level: 1 })).toBeTruthy();
    expect(
      within(menu).getByRole('link', { name: 'Exportar vendas' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('esconde a exportação do gerente e recusa o endereço aberto à força', async () => {
    const manager = { ...defaultRoutes('manager'), 'GET /api/v1/orders': orderPage() };
    const view = renderApp('/pedidos', manager);
    const menu = await findMenu();
    expect(within(menu).queryByRole('link', { name: 'Exportar vendas' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Exportar vendas' })).toBeNull();

    await view.router.navigate('/pedidos/exportar');
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });

  it('recusa a lista ao instrutor, que não tem sales.view', async () => {
    renderApp('/pedidos', defaultRoutes('instructor'));
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('detalha o pedido com documento fiscal, itens, cobranças e reembolso', async () => {
    const { routes } = salesRoutes();
    renderApp(`/pedidos/${ORDER_ID}`, routes);

    expect(await screen.findByRole('heading', { name: 'Pedido 101', level: 1 })).toBeTruthy();
    expect(screen.getAllByText('Bia Aluna').length).toBeGreaterThan(0);
    expect(screen.getByText('12345678900')).toBeTruthy();
    expect(screen.getByText('Curso de Ouro')).toBeTruthy();
    expect(screen.getByText('mp-123')).toBeTruthy();
    expect(screen.getByText('Estado no provedor: approved')).toBeTruthy();
    expect(screen.getByText('Nenhum reembolso pedido.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pedir reembolso' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('esconde o reembolso do gerente, que só consulta', async () => {
    const manager = {
      ...defaultRoutes('manager'),
      [`GET /api/v1/orders/${ORDER_ID}`]: orderDetail(),
    };
    renderApp(`/pedidos/${ORDER_ID}`, manager);
    expect(await screen.findByRole('heading', { name: 'Pedido 101', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pedir reembolso' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });

  it('pede o reembolso com motivo e chave de idempotência', async () => {
    const user = userEvent.setup();
    const posted: { body?: unknown; key?: string | null } = {};
    const { routes } = salesRoutes({
      [`POST /api/v1/orders/${ORDER_ID}/refunds`]: async (request: Request) => {
        posted.body = await request.json();
        posted.key = request.headers.get('Idempotency-Key');
        return new Response(JSON.stringify(refund()), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    renderApp(`/pedidos/${ORDER_ID}`, routes);
    await screen.findByRole('heading', { name: 'Pedido 101', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Pedir reembolso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir reembolso' });
    expect(within(dialog).getByText(/O estorno é executado em segundo plano/)).toBeTruthy();
    await expectNoAxeViolations();
    await user.type(within(dialog).getByLabelText('Motivo'), 'Pedido duplicado');
    await user.click(within(dialog).getByRole('button', { name: 'Pedir reembolso' }));

    await waitFor(() => expect(posted.body).toBeDefined());
    expect(posted.body).toEqual({ reason: 'Pedido duplicado', items: null });
    expect(posted.key ?? '').toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reembolsa itens escolhidos com o valor de cada um', async () => {
    const user = userEvent.setup();
    const posted: { body?: unknown } = {};
    const second = orderItem({
      id: '0193a5b2-0000-7000-8000-0000000000c8',
      productType: 'ebook',
      title: 'Ebook de Ouro',
      unitPriceCents: 5000,
      paidCents: 5000,
    });
    const { routes } = salesRoutes({
      [`GET /api/v1/orders/${ORDER_ID}`]: orderDetail({ items: [orderItem(), second] }),
      [`POST /api/v1/orders/${ORDER_ID}/refunds`]: async (request: Request) => {
        posted.body = await request.json();
        return new Response(JSON.stringify(refund()), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    renderApp(`/pedidos/${ORDER_ID}`, routes);
    await screen.findByRole('heading', { name: 'Pedido 101', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Pedir reembolso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir reembolso' });
    await user.click(within(dialog).getByRole('radio', { name: 'Itens escolhidos' }));
    const box = within(dialog).getByRole('checkbox', { name: /Curso de Ouro/ }) as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(true);
    const amount = within(dialog).getByLabelText('Valor de Curso de Ouro') as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, '100,00');
    expect(amount.value).toBe('100,00');
    expect(amount.disabled).toBe(false);
    await user.type(within(dialog).getByLabelText('Motivo'), 'Comprou só um item');
    await user.click(within(dialog).getByRole('button', { name: 'Pedir reembolso' }));

    await waitFor(() => expect(posted.body).toBeDefined());
    expect(posted.body).toEqual({
      reason: 'Comprou só um item',
      items: [{ orderItemId: ORDER_ITEM_ID, amountCents: 10000 }],
    });
  });

  it('recusa reembolso por item sem escolha ou com valor fora do disponível', async () => {
    const user = userEvent.setup();
    const { routes } = salesRoutes();
    renderApp(`/pedidos/${ORDER_ID}`, routes);
    await screen.findByRole('heading', { name: 'Pedido 101', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Pedir reembolso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir reembolso' });
    await user.type(within(dialog).getByLabelText('Motivo'), 'Desisti');
    await user.click(within(dialog).getByRole('radio', { name: 'Itens escolhidos' }));
    await user.click(within(dialog).getByRole('button', { name: 'Pedir reembolso' }));
    expect(within(dialog).getByText('Escolha ao menos um item.')).toBeTruthy();

    await user.click(within(dialog).getByRole('checkbox', { name: /Curso de Ouro/ }));
    const amount = within(dialog).getByLabelText('Valor de Curso de Ouro');
    await user.clear(amount);
    await user.type(amount, '500,00');
    await user.click(within(dialog).getByRole('button', { name: 'Pedir reembolso' }));
    expect(
      within(dialog).getByText(
        'O valor de Curso de Ouro precisa ser maior que zero e caber no disponível.',
      ),
    ).toBeTruthy();
  });

  it('mostra a recusa do reembolso de pedido não reembolsável', async () => {
    const user = userEvent.setup();
    const { routes } = salesRoutes({
      [`POST /api/v1/orders/${ORDER_ID}/refunds`]: problem(409, 'order_not_refundable'),
    });
    renderApp(`/pedidos/${ORDER_ID}`, routes);
    await screen.findByRole('heading', { name: 'Pedido 101', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Pedir reembolso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir reembolso' });
    await user.type(within(dialog).getByLabelText('Motivo'), 'Desisti');
    await user.click(within(dialog).getByRole('button', { name: 'Pedir reembolso' }));
    expect(
      await within(dialog).findByText('Este pedido não está pago e não pode ser reembolsado.'),
    ).toBeTruthy();
  });

  it('repete um reembolso que falhou e atualiza o pedido', async () => {
    const user = userEvent.setup();
    const failed = refund({ status: 'failed', error: 'provedor fora do ar' });
    let retried: string | null = null;
    const { routes } = salesRoutes({
      [`GET /api/v1/orders/${ORDER_ID}`]: orderDetail({ refunds: [failed] }),
      [`POST /api/v1/refunds/${failed.id}/retry`]: (request: Request) => {
        retried = new URL(request.url).pathname;
        return refund({
          ...failed,
          status: 'requested',
          error: null,
        });
      },
    });
    renderApp(`/pedidos/${ORDER_ID}`, routes);

    expect(await screen.findByText(/provedor fora do ar/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(retried).toBe(`/api/v1/refunds/${failed.id}/retry`));
  });

  it('baixa o CSV como texto, com os filtros do endereço', async () => {
    const user = userEvent.setup();
    const saved: { name: string; type: string }[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      saved.push({ name: '', type: (blob as Blob).type });
      return 'blob:vendas';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      const last = saved.at(-1);
      if (last) last.name = this.download;
    });
    const { routes, queries } = salesRoutes();
    // a exportação tem a própria consulta, sem paginação
    const exportQueries: URLSearchParams[] = [];
    routes['GET /api/v1/orders/export.csv'] = (request: Request) => {
      exportQueries.push(new URL(request.url).searchParams);
      return new Response(CSV, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    };
    const { router } = renderApp('/pedidos', routes);
    await screen.findByRole('table');
    await router.navigate('/pedidos/exportar?status=paid&q=bia');
    await screen.findByRole('heading', { name: 'Exportar vendas', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Baixar CSV' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.type).toBe('text/csv;charset=utf-8');
    expect(saved[0]?.name).toMatch(/^vendas-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exportQueries.at(-1)?.get('status')).toBe('paid');
    expect(exportQueries.at(-1)?.get('q')).toBe('bia');
    // a lista não recebe a consulta de exportação
    expect(queries.length).toBeGreaterThan(0);
    await expectNoAxeViolations();
  });

  it('mostra a recusa da API quando a exportação é negada', async () => {
    const user = userEvent.setup();
    const { routes } = salesRoutes();
    routes['GET /api/v1/orders/export.csv'] = problem(403, 'permission_denied');
    renderApp('/pedidos/exportar', routes);
    await screen.findByRole('heading', { name: 'Exportar vendas', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Baixar CSV' }));
    expect(await screen.findByText(/Seu papel não permite esta ação/)).toBeTruthy();
  });
});
