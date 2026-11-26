import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../lib/browser';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';
import {
  BILLING_URL,
  billing,
  CART_URL,
  CREATE_ORDER_URL,
  cart,
  cartItem,
  orderDetail,
  orderUrl,
  SAVE_BILLING_URL,
} from '../test/sales';

const session = makeSession();
const t = ptBR.sales.checkout;

/** O `browser.assign` sai da página; no teste, só registramos para onde ele iria. */
function spyNavigation() {
  return vi.spyOn(browser, 'assign').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

const routes = (extra: Parameters<typeof apiRoutes>[0] = {}) =>
  apiRoutes({
    [CART_URL]: () => jsonResponse(cart()),
    [BILLING_URL]: () => jsonResponse(billing()),
    [SAVE_BILLING_URL]: () => jsonResponse(billing()),
    ...extra,
  });

describe('página de checkout', () => {
  it('vem preenchida, grava o comprador, cria o pedido com Idempotency-Key e abre o pagamento', async () => {
    const assign = spyNavigation();
    const user = userEvent.setup();
    const order = orderDetail();
    const seen: { key: string | null } = { key: null };
    const { calls } = renderApp(
      '/checkout',
      routes({
        [CREATE_ORDER_URL]: (request) => {
          seen.key = request.headers.get('Idempotency-Key');
          return jsonResponse({ order, checkoutUrl: order.checkoutUrl }, 201);
        },
      }),
      { session },
    );

    const name = (await screen.findByLabelText(t.buyer.fullName)) as HTMLInputElement;
    expect(name.value).toBe('Ana Souza');
    expect((await screen.findByLabelText(t.buyer.taxId)).getAttribute('value')).toBe('39053344705');

    // teclado: Enter no campo envia o formulário
    await user.click(name);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mp.test/checkout/abc'));
    expect(await screen.findByRole('link', { name: t.redirectAction })).toHaveProperty(
      'href',
      'https://mp.test/checkout/abc',
    );

    const saved = calls.find((call) => call.method === 'PUT' && call.path === '/api/v1/me/billing');
    expect(saved?.body).toEqual({
      fullName: 'Ana Souza',
      taxIdType: 'cpf',
      taxId: '39053344705',
    });
    expect(saved?.csrf).toBe(session.csrfToken);
    expect(seen.key).not.toBeNull();
    expect(seen.key?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(seen.key?.length ?? 0).toBeLessThanOrEqual(128);
    expect(assign).toHaveBeenCalledTimes(1);

    await expectNoAxeViolations();
  });

  it('total zero conclui o pedido sem passar pelo provedor e leva ao pedido pago', async () => {
    const assign = spyNavigation();
    const user = userEvent.setup();
    const free = orderDetail({
      status: 'paid',
      provider: 'none',
      checkoutUrl: null,
      paidAt: '2026-11-20T12:01:00Z',
      expiresAt: null,
      payment: null,
      subtotalCents: 0,
      totalCents: 0,
      items: [
        {
          id: orderDetail().items[0]?.id as string,
          productType: 'course',
          productId: orderDetail().items[0]?.productId as string,
          title: 'React do zero',
          accessDays: 365,
          unitPriceCents: 0,
          discountCents: 0,
          paidCents: 0,
          refundedCents: 0,
        },
      ],
    });
    const { router } = renderApp(
      '/checkout',
      routes({
        [CART_URL]: () => jsonResponse(cart({ items: [cartItem({ unitPriceCents: 0 })] })),
        [CREATE_ORDER_URL]: () => jsonResponse({ order: free, checkoutUrl: null }, 201),
        [orderUrl(free.id)]: () => jsonResponse(free),
      }),
      { session },
    );

    expect(await screen.findByText(t.zeroTotal)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: t.submit }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${free.id}`));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: ptBR.sales.order.number.replace('{{number}}', '1042'),
      }),
    ).toBeTruthy();
    expect(screen.getByText(ptBR.sales.order.payment.paid.title)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('provedor fora do ar mantém a pessoa na tela com o aviso de pagamento indisponível', async () => {
    const assign = spyNavigation();
    const user = userEvent.setup();
    renderApp(
      '/checkout',
      routes({
        [CREATE_ORDER_URL]: () => problemResponse(503, 'payment_provider_unavailable'),
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: t.submit }));

    const alert = await findAlert();
    expect(within(alert).getByText(t.errors.providerUnavailable)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t.submit }).hasAttribute('disabled')).toBe(false);
  });

  it.each([
    ['cart_invalid', t.errors.cartInvalid, '/cesta'],
    ['coupon_invalid', t.errors.couponInvalid, '/cesta'],
    ['order_pending_limit', t.errors.pendingLimit, '/conta/compras'],
  ])('o 409 %s explica o motivo e leva ao lugar certo', async (code, message, href) => {
    const user = userEvent.setup();
    renderApp('/checkout', routes({ [CREATE_ORDER_URL]: () => problemResponse(409, code) }), {
      session,
    });

    await user.click(await screen.findByRole('button', { name: t.submit }));

    const alert = await findAlert();
    expect(within(alert).getByText(message)).toBeTruthy();
    expect(within(alert).getByRole('link').getAttribute('href')).toBe(href);
  });

  it('documento recusado volta para o campo, que é anunciado como inválido', async () => {
    const user = userEvent.setup();
    const empty = billing({ fullName: 'Ana Souza', taxIdType: null, taxId: null, complete: false });
    renderApp(
      '/checkout',
      routes({
        [BILLING_URL]: () => jsonResponse(empty),
        [SAVE_BILLING_URL]: () => problemResponse(422, 'tax_id_invalid'),
      }),
      { session },
    );

    const taxId = await screen.findByLabelText(t.buyer.taxId);
    await user.type(taxId, '123');
    await user.click(screen.getByRole('button', { name: t.submit }));

    const alert = await findAlert();
    expect(within(alert).getByText(t.errors.taxIdInvalid)).toBeTruthy();
    await waitFor(() => expect(taxId.getAttribute('aria-invalid')).toBe('true'));
  });

  it('exige nome e documento antes de chamar a API', async () => {
    const user = userEvent.setup();
    const empty = billing({ fullName: null, taxIdType: null, taxId: null, complete: false });
    const { calls } = renderApp('/checkout', routes({ [BILLING_URL]: () => jsonResponse(empty) }), {
      session,
    });

    await user.click(await screen.findByRole('button', { name: t.submit }));

    expect(await screen.findByText(t.errors.requiredName)).toBeTruthy();
    expect(screen.getByText(t.errors.requiredTaxId)).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST' || call.method === 'PUT')).toBe(false);
  });

  it('cesta vazia não deixa finalizar e leva à vitrine', async () => {
    renderApp('/checkout', routes({ [CART_URL]: () => jsonResponse(cart({ items: [] })) }), {
      session,
    });

    expect(await screen.findByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.emptyAction }).getAttribute('href')).toBe('/');
  });
});
