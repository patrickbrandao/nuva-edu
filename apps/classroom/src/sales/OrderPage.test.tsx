import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';
import { cancelUrl, orderDetail, orderUrl, uuid } from '../test/sales';

const session = makeSession();
const t = ptBR.sales.order;
const tOrders = ptBR.sales.orders;
const number = (value: number) => t.number.replace('{{number}}', String(value));

describe('página do pedido', () => {
  it('pedido pendente mostra o prazo, o retorno ao pagamento e o cancelamento', async () => {
    const user = userEvent.setup();
    const pending = orderDetail();
    const canceled = orderDetail({
      status: 'canceled',
      checkoutUrl: null,
      expiresAt: null,
    });
    const { calls } = renderApp(
      `/pedidos/${pending.id}`,
      apiRoutes({
        [orderUrl(pending.id)]: () => jsonResponse(pending),
        [cancelUrl(pending.id)]: () => jsonResponse(canceled),
      }),
      { session },
    );

    expect(await screen.findByRole('heading', { level: 1, name: number(1042) })).toBeTruthy();
    const result = within(await screen.findByRole('region', { name: t.payment.region }));
    expect(result.getByText(t.payment.pending.title)).toBeTruthy();
    expect(result.getByText(/^Pague até/)).toBeTruthy();
    expect(screen.getByText(tOrders.status.pending)).toBeTruthy();
    expect((await screen.findByRole('link', { name: t.goToPayment })).getAttribute('href')).toBe(
      'https://mp.test/checkout/abc',
    );

    await user.click(screen.getByRole('button', { name: t.cancel.action }));
    const dialog = await screen.findByRole('alertdialog', { name: t.cancel.title });
    await user.click(within(dialog).getByRole('button', { name: t.cancel.confirm }));

    expect(await screen.findByText(t.cancel.done)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(tOrders.status.canceled)).toBeTruthy());
    expect(screen.getByText(t.payment.canceled.title)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.cancel.action })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      `/api/v1/orders/${pending.id}/cancel`,
    ]);

    await expectNoAxeViolations();
  });

  it('pedido pago mostra a confirmação, os valores e o caminho para os cursos', async () => {
    const paid = orderDetail({
      status: 'paid',
      checkoutUrl: null,
      expiresAt: null,
      paidAt: '2026-11-20T12:05:00Z',
      discountCents: 1_970,
      totalCents: 17_730,
      couponCode: 'BEMVINDO10',
      provider: 'fake',
      items: [
        {
          ...(orderDetail().items[0] as NonNullable<ReturnType<typeof orderDetail>['items'][0]>),
          discountCents: 1_970,
          paidCents: 17_730,
        },
      ],
      payment: {
        method: 'pix',
        status: 'approved',
        amountCents: 17_730,
        refundedCents: 0,
        currency: 'BRL',
        provider: 'fake',
        providerPaymentId: 'pay_123',
        paidAt: '2026-11-20T12:05:00Z',
      },
    });
    renderApp(`/pedidos/${paid.id}`, apiRoutes({ [orderUrl(paid.id)]: () => jsonResponse(paid) }), {
      session,
    });

    expect(await screen.findByText(t.payment.paid.title)).toBeTruthy();
    expect(screen.getByText(tOrders.status.paid)).toBeTruthy();
    expect(screen.getByText('Pix')).toBeTruthy();
    expect(screen.getByText(t.payment.status.approved)).toBeTruthy();
    expect(screen.getByText('BEMVINDO10')).toBeTruthy();
    expect(screen.getByRole('link', { name: t.goToCourses }).getAttribute('href')).toBe(
      '/meus-cursos',
    );
    expect(screen.queryByRole('link', { name: t.goToPayment })).toBeNull();
    expect(screen.queryByRole('button', { name: t.cancel.action })).toBeNull();

    // valores congelados no pedido: subtotal, desconto e total
    const totals = screen.getByText(t.totals.total).closest('dl') as HTMLElement;
    expect(within(totals).getByText(/^R\$\s177,30$/)).toBeTruthy();
    expect(within(totals).getByText(/^-R\$\s19,70$/)).toBeTruthy();

    await expectNoAxeViolations();
  });

  it('pedido de outra pessoa aparece como não encontrado', async () => {
    const id = uuid(77);
    renderApp(
      `/pedidos/${id}`,
      apiRoutes({ [orderUrl(id)]: () => problemResponse(404, 'not_found') }),
      {
        session,
      },
    );

    expect(await screen.findByRole('heading', { level: 1, name: t.notFoundTitle })).toBeTruthy();
    expect(screen.getByText(t.notFoundText)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.backToOrders }).getAttribute('href')).toBe(
      '/conta/compras',
    );
  });
});
