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
import { uuid } from '../test/sales';
import {
  cancelSubscriptionUrl,
  charge,
  subscriptionDetail,
  subscriptionUrl,
} from '../test/subscriptions';

const session = makeSession();
const t = ptBR.subscriptions.detail;
const cancel = ptBR.subscriptions.cancel;
const status = ptBR.subscriptions.status;

const ID = uuid(31);

/** Abre o detalhe da assinatura com o que o teste mandar. */
const open = (extra: Parameters<typeof apiRoutes>[0] = {}, detail = subscriptionDetail()) =>
  renderApp(
    `/conta/compras/assinaturas/${ID}`,
    apiRoutes({ [subscriptionUrl(ID)]: () => jsonResponse(detail), ...extra }),
    { session },
  );

describe('detalhe da assinatura', () => {
  it('mostra plano, estado, período, o que libera e o histórico de cobranças', async () => {
    open();

    expect(await screen.findByRole('heading', { level: 1, name: 'Plano Pro' })).toBeTruthy();
    expect(screen.getByText(status.active)).toBeTruthy();
    expect(
      screen.getByText(t.status.activeNext.replace('{{date}}', '1 de dezembro de 2026')),
    ).toBeTruthy();
    expect(screen.getByText('React do zero')).toBeTruthy();
    expect(screen.getByText('1 de novembro de 2026 – 1 de dezembro de 2026')).toBeTruthy();
    expect(screen.getByText(t.contractedPrice)).toBeTruthy();
    expect(screen.getAllByText(/^R\$\s99,00$/).length).toBeGreaterThan(0);
    // a cobrança aprovada, com o meio de pagamento
    const charges = screen.getByRole('heading', { name: t.chargesTitle }).closest('section');
    expect(
      within(charges as HTMLElement).getByText(ptBR.sales.order.payment.status.approved),
    ).toBeTruthy();
    expect(
      within(charges as HTMLElement).getByText(ptBR.sales.orders.payment.method.pix),
    ).toBeTruthy();
    expect(within(charges as HTMLElement).getByText(/Pago em/)).toBeTruthy();

    await expectNoAxeViolations();
  });

  it('mostra a carência e o valor reembolsado da cobrança', async () => {
    open(
      {},
      subscriptionDetail({
        status: 'past_due',
        graceUntil: '2026-12-04T12:00:00Z',
        nextChargeAt: null,
        payments: [charge({ status: 'partially_refunded', refundedCents: 2_000 })],
      }),
    );

    expect(
      await screen.findByText(t.status.pastDueGrace.replace('{{date}}', '4 de dezembro de 2026')),
    ).toBeTruthy();
    expect(screen.getByText(t.graceUntil)).toBeTruthy();
    expect(screen.getByText(t.charges.refunded.replace('{{value}}', 'R$ 20,00'))).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('cancelar a assinatura ativa avisa até quando o acesso continua', async () => {
    const user = userEvent.setup();
    let canceled = false;
    const { calls } = open({
      [cancelSubscriptionUrl(ID)]: () => {
        canceled = true;
        return jsonResponse(
          subscriptionDetail({ status: 'canceling', canceledAt: '2026-11-26T12:00:00Z' }),
        );
      },
    });

    await user.click(await screen.findByRole('button', { name: cancel.action }));
    const dialog = await screen.findByRole('alertdialog', { name: cancel.title });
    expect(
      within(dialog).getByText(cancel.text.active.replace('{{date}}', '1 de dezembro de 2026')),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: cancel.confirm }));

    expect(await screen.findByText(cancel.done)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(status.canceling)).toBeTruthy());
    expect(
      screen.getByText(t.status.cancelingEnd.replace('{{date}}', '1 de dezembro de 2026')),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: cancel.action })).toBeNull();
    expect(canceled).toBe(true);
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      `/api/v1/me/subscriptions/${ID}/cancel`,
    ]);
  });

  it('assinatura pendente pede confirmação própria e deixa de ser cancelável', async () => {
    const user = userEvent.setup();
    open(
      {
        [cancelSubscriptionUrl(ID)]: () =>
          jsonResponse(
            subscriptionDetail({
              status: 'expired',
              currentPeriodStart: null,
              currentPeriodEnd: null,
              nextChargeAt: null,
              payments: [],
            }),
          ),
      },
      subscriptionDetail({
        status: 'pending',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        nextChargeAt: null,
        graceUntil: null,
        payments: [],
      }),
    );

    expect(await screen.findByText(t.status.pending)).toBeTruthy();
    expect(screen.getByText(t.noCharges)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: cancel.action }));
    const dialog = await screen.findByRole('alertdialog', { name: cancel.titlePending });
    expect(within(dialog).getByText(cancel.text.pending)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: cancel.confirm }));

    await waitFor(() => expect(screen.getByText(status.expired)).toBeTruthy());
    expect(screen.getByText(t.status.expired)).toBeTruthy();
    expect(screen.queryByRole('button', { name: cancel.action })).toBeNull();
    await expectNoAxeViolations();
  });

  it('assinatura suspensa não oferece cancelamento ao aluno', async () => {
    open({}, subscriptionDetail({ status: 'suspended', nextChargeAt: null }));

    expect(await screen.findByText(status.suspended)).toBeTruthy();
    expect(screen.getByText(t.status.suspended)).toBeTruthy();
    expect(screen.queryByRole('button', { name: cancel.action })).toBeNull();
  });

  it('recusa do cancelamento mantém a assinatura e explica o motivo', async () => {
    const user = userEvent.setup();
    open({
      [cancelSubscriptionUrl(ID)]: () => problemResponse(409, 'subscription_not_cancelable'),
    });

    await user.click(await screen.findByRole('button', { name: cancel.action }));
    const dialog = await screen.findByRole('alertdialog', { name: cancel.title });
    await user.click(within(dialog).getByRole('button', { name: cancel.confirm }));

    expect(await screen.findByText(cancel.notCancelable)).toBeTruthy();
    expect(screen.getByText(status.active)).toBeTruthy();
  });

  it('assinatura de outra pessoa é 404, com o caminho de volta', async () => {
    renderApp(
      `/conta/compras/assinaturas/${ID}`,
      apiRoutes({ [subscriptionUrl(ID)]: () => problemResponse(404, 'not_found') }),
      { session },
    );

    expect(await screen.findByRole('heading', { name: t.notFoundTitle })).toBeTruthy();
    expect(screen.getByText(t.notFoundText)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.back }).getAttribute('href')).toBe('/conta/compras');
  });

  it('falha de rede mostra o erro com nova tentativa', async () => {
    renderApp(
      `/conta/compras/assinaturas/${ID}`,
      apiRoutes({
        [subscriptionUrl(ID)]: () => problemResponse(500, 'internal_error'),
      }),
      { session },
    );

    expect(await screen.findByText(t.errorTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: ptBR.common.retry })).toBeTruthy();
  });

  it('sem sessão leva a /entrar com o destino da assinatura', async () => {
    const { router } = renderApp(`/conta/compras/assinaturas/${ID}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(new URLSearchParams(router.state.location.search).get('destino')).toBe(
      `/conta/compras/assinaturas/${ID}`,
    );
  });
});
