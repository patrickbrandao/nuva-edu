import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  noContent,
  problemResponse,
  renderApp,
} from '../test/renderApp';
import {
  CART_URL,
  CLEAR_COUPON_URL,
  COUPON_URL,
  cart,
  cartItem,
  itemUrl,
  uuid,
} from '../test/sales';

const session = makeSession();
const t = ptBR.sales.cart;
const cartRegion = () => screen.findByRole('region', { name: t.region });

describe('página da cesta', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/cesta');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fcesta');
  });

  it('mostra a cascata, os avisos e os totais, sem violações do axe', async () => {
    const bundle = cartItem({
      id: uuid(1),
      productType: 'bundle',
      title: 'Trilha Front-end',
      unitPriceCents: 29_700,
      warnings: ['bundle_item_owned'],
      unlocks: [
        { productType: 'course', productId: uuid(12), title: 'React do zero', via: null },
        {
          productType: 'ebook',
          productId: uuid(13),
          title: 'Guia de React',
          via: { productType: 'course', title: 'React do zero' },
        },
      ],
    });
    const ebook = cartItem({
      id: uuid(2),
      productType: 'ebook',
      title: 'Guia de CSS',
      unitPriceCents: 4_900,
      accessDays: null,
      warnings: ['subscription_covered'],
    });
    const shown = cart({ items: [bundle, ebook] });
    renderApp('/cesta', apiRoutes({ [CART_URL]: () => jsonResponse(shown) }), { session });

    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeTruthy();
    const region = within(await cartRegion());
    expect(region.getByText('Trilha Front-end')).toBeTruthy();
    expect(region.getByText(t.includes)).toBeTruthy();
    expect(region.getByText('React do zero')).toBeTruthy();
    expect(
      region.getByText(
        t.unlock.via.replace('{{title}}', 'Guia de React').replace('{{via}}', 'React do zero'),
      ),
    ).toBeTruthy();
    expect(region.getByText(t.notice.bundle_item_owned)).toBeTruthy();
    expect(region.getByText(t.notice.subscription_covered)).toBeTruthy();

    // os totais somam os itens vendáveis: 297,00 + 49,00
    const totals = screen.getByText(t.totals.total).closest('dl') as HTMLElement;
    expect(within(totals).getAllByText(/^R\$\s346,00$/)).toHaveLength(2);
    expect(screen.getByText(t.subtitle_other.replace('{{count}}', '2'))).toBeTruthy();

    // o resumo leva ao checkout
    expect(screen.getByRole('link', { name: t.checkout }).getAttribute('href')).toBe('/checkout');

    await expectNoAxeViolations();
  });

  it('item indisponível aparece com o motivo e impede a finalização', async () => {
    const archived = cartItem({
      title: 'Node na prática',
      sellable: false,
      unsellableReason: 'archived',
    });
    renderApp(
      '/cesta',
      apiRoutes({ [CART_URL]: () => jsonResponse(cart({ items: [archived] })) }),
      { session },
    );

    const region = within(await cartRegion());
    expect(await region.findByText(t.unsellable.archived)).toBeTruthy();
    expect(screen.getByText(t.checkoutBlocked)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.checkout }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('link', { name: t.checkout })).toBeNull();
  });

  it('cupom recusado mostra o motivo no campo, mantém a cesta e aceita teclado', async () => {
    const user = userEvent.setup();
    const shown = cart();
    const { calls } = renderApp(
      '/cesta',
      apiRoutes({
        [CART_URL]: () => jsonResponse(shown),
        [COUPON_URL]: () => problemResponse(422, 'coupon_invalid'),
      }),
      { session },
    );

    const field = await screen.findByLabelText(t.coupon.label);
    await user.type(field, 'NAOEXISTE{Enter}');

    expect(await screen.findByText(t.coupon.invalid)).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const applied = calls.find(
      (call) => call.method === 'PUT' && call.path === '/api/v1/cart/coupon',
    );
    expect(applied?.body).toEqual({ code: 'NAOEXISTE' });
    // o cupom recusado não altera a cesta: continua sem cupom
    expect(screen.queryByRole('button', { name: t.coupon.remove })).toBeNull();
  });

  it('cupom vencido na cesta mostra o motivo e pode ser retirado', async () => {
    const user = userEvent.setup();
    const expired = cart({
      coupon: {
        code: 'BEMVINDO10',
        kind: 'percent',
        percentOff: 10,
        amountOffCents: null,
        valid: false,
        invalidReason: 'expired',
      },
    });
    let current = expired;
    renderApp(
      '/cesta',
      apiRoutes({
        [CART_URL]: () => jsonResponse(current),
        [CLEAR_COUPON_URL]: () => {
          current = cart();
          return jsonResponse(current);
        },
      }),
      { session },
    );

    expect(await screen.findByText(t.coupon.invalidReason.expired)).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: t.coupon.removeNamed.replace('{{code}}', 'BEMVINDO10') }),
    );

    await waitFor(() => expect(screen.queryByText('BEMVINDO10')).toBeNull());
    expect(screen.queryByText(t.coupon.invalidReason.expired)).toBeNull();
  });

  it('remove um item e a cesta é relida', async () => {
    const user = userEvent.setup();
    const first = cart();
    let current = first;
    const { calls } = renderApp(
      '/cesta',
      apiRoutes({
        [CART_URL]: () => jsonResponse(current),
        [itemUrl(first.items[0]?.id as string)]: () => {
          current = cart({ items: [] });
          return noContent();
        },
      }),
      { session },
    );

    await user.click(
      await screen.findByRole('button', { name: t.remove.replace('{{title}}', 'React do zero') }),
    );

    expect(await screen.findByText(t.emptyTitle)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      `/api/v1/cart/items/${first.items[0]?.id}`,
    ]);
    expect(screen.getByRole('link', { name: t.emptyAction }).getAttribute('href')).toBe('/');
  });
});
