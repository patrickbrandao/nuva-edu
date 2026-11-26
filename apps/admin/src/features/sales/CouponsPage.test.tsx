import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { findMenu, renderApp } from '../../test/render';
import { COUPON_ID, coupon } from '../../test/sales';

function couponRoutes(extra: Routes = {}) {
  const queries: URLSearchParams[] = [];
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/coupons': (request: Request) => {
      queries.push(new URL(request.url).searchParams);
      return { items: [coupon()], nextCursor: null };
    },
    ...extra,
  };
  return { routes, queries };
}

describe('cupons (/cupons)', () => {
  it('lista os cupons com desconto, usos, validade e situação, sem violações do axe', async () => {
    const { routes, queries } = couponRoutes();
    renderApp('/cupons', routes);

    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getByText('OUTUBRO20')).toBeTruthy();
    expect(within(table).getByText('20% de desconto')).toBeTruthy();
    expect(within(table).getByText('Pedidos')).toBeTruthy();
    expect(within(table).getByText('12 de 100 usos')).toBeTruthy();
    expect(within(table).getByText('Até 1 por pessoa')).toBeTruthy();
    expect(within(table).getByText('Ativo')).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Desativar' })).toBeTruthy();
    expect(queries[0]?.get('limit')).toBe('25');
    await expectNoAxeViolations();
  });

  it('busca e filtra por situação e destino no endereço', async () => {
    const user = userEvent.setup();
    const { routes, queries } = couponRoutes();
    const { router } = renderApp('/cupons', routes);
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar cupom' }), 'out');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('out'));

    await user.click(screen.getByRole('button', { name: 'Situação: Todas as situações' }));
    await user.click(screen.getByRole('option', { name: 'Inativo' }));
    await user.click(screen.getByRole('button', { name: 'Vale para: Todos os destinos' }));
    await user.click(screen.getByRole('option', { name: 'Assinaturas' }));

    await waitFor(() => expect(queries.at(-1)?.get('active')).toBe('false'));
    expect(queries.at(-1)?.get('appliesTo')).toBe('subscriptions');
    expect(router.state.location.search).toBe('?q=out&active=inactive&appliesTo=subscriptions');
  });

  it('valida e cria o cupom com os padrões do contrato', async () => {
    const user = userEvent.setup();
    let posted: unknown = null;
    const { routes } = couponRoutes({
      'POST /api/v1/coupons': async (request: Request) => {
        posted = await request.json();
        return coupon({ code: 'PROMO10', percentOff: 10 });
      },
    });
    renderApp('/cupons', routes);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Novo cupom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo cupom' });
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(within(dialog).getByText('Use de 3 a 40 caracteres.')).toBeTruthy();
    expect(within(dialog).getByText('Informe um percentual inteiro de 1 a 100.')).toBeTruthy();
    expect(posted).toBeNull();

    await user.type(within(dialog).getByLabelText('Código'), 'promo10');
    expect((within(dialog).getByLabelText('Código') as HTMLInputElement).value).toBe('PROMO10');
    await user.type(within(dialog).getByLabelText('Desconto (%)'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({
      code: 'PROMO10',
      kind: 'percent',
      percentOff: 10,
      amountOffCents: null,
      startsAt: null,
      endsAt: null,
      maxUses: null,
      maxUsesPerUser: 1,
      appliesTo: 'orders',
      products: [],
      active: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('avisa quando o código já existe', async () => {
    const user = userEvent.setup();
    const { routes } = couponRoutes({
      'POST /api/v1/coupons': problem(409, 'coupon_code_taken'),
    });
    renderApp('/cupons', routes);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Novo cupom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo cupom' });
    await user.type(within(dialog).getByLabelText('Código'), 'OUTUBRO20');
    await user.type(within(dialog).getByLabelText('Desconto (%)'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(await within(dialog).findByText('Já existe um cupom com este código.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('edita o cupom e manda a lista inteira de produtos', async () => {
    const user = userEvent.setup();
    let patched: unknown = null;
    const { routes } = couponRoutes({
      [`PATCH /api/v1/coupons/${COUPON_ID}`]: async (request: Request) => {
        patched = await request.json();
        return coupon({ percentOff: 30 });
      },
    });
    renderApp('/cupons', routes);
    const table = (await screen.findByRole('table')) as HTMLElement;

    await user.click(within(table).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar cupom' });
    expect((within(dialog).getByLabelText('Código') as HTMLInputElement).value).toBe('OUTUBRO20');
    const percent = within(dialog).getByLabelText('Desconto (%)') as HTMLInputElement;
    expect(percent.value).toBe('20');
    await user.clear(percent);
    await user.type(percent, '30');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toMatchObject({ code: 'OUTUBRO20', percentOff: 30, products: [] });
  });

  it('desativa com confirmação destrutiva', async () => {
    const user = userEvent.setup();
    let patched: unknown = null;
    const { routes } = couponRoutes({
      [`PATCH /api/v1/coupons/${COUPON_ID}`]: async (request: Request) => {
        patched = await request.json();
        return coupon({ active: false });
      },
    });
    renderApp('/cupons', routes);
    const table = (await screen.findByRole('table')) as HTMLElement;

    await user.click(within(table).getByRole('button', { name: 'Desativar' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Desativar o cupom?' });
    expect(within(dialog).getByText('OUTUBRO20')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }));

    await waitFor(() => expect(patched).toEqual({ active: false }));
    expect(await screen.findByText('Cupom OUTUBRO20 desativado.')).toBeTruthy();
  });

  it('esconde os cupons do gerente e recusa o endereço aberto à força', async () => {
    renderApp('/cupons', defaultRoutes('manager'));
    const menu = await findMenu();
    expect(within(menu).queryByRole('link', { name: 'Cupons' })).toBeNull();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });
});
