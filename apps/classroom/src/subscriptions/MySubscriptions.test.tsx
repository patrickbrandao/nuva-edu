import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { apiRoutes, jsonResponse, makeSession, renderApp } from '../test/renderApp';
import { ORDERS_URL, orderPage, orderSummary, uuid } from '../test/sales';
import {
  cancelSubscriptionUrl,
  SUBSCRIPTIONS_URL,
  subscriptionDetail,
  subscriptionPage,
  subscriptionSummary,
} from '../test/subscriptions';

const session = makeSession();
const t = ptBR.subscriptions.mine;
const status = ptBR.subscriptions.status;

/** A seção "Minha assinatura" dentro de `/conta/compras`, pelo título dela. */
function section(): HTMLElement {
  return screen.getByRole('heading', { name: t.title }).closest('section') as HTMLElement;
}

/** As rotas da página: assinaturas vazias e pedidos vazios, salvo o que o teste mudar. */
const routes = (extra: Parameters<typeof apiRoutes>[0] = {}) =>
  apiRoutes({
    [SUBSCRIPTIONS_URL]: () => jsonResponse(subscriptionPage([])),
    [ORDERS_URL]: () => jsonResponse(orderPage([])),
    ...extra,
  });

describe('minha assinatura', () => {
  it('lista plano, estado, próxima cobrança e o caminho do detalhe, ao lado dos pedidos', async () => {
    const item = subscriptionSummary();
    renderApp(
      '/conta/compras',
      routes({
        [SUBSCRIPTIONS_URL]: () => jsonResponse(subscriptionPage([item])),
        [ORDERS_URL]: () =>
          jsonResponse(orderPage([orderSummary({ id: uuid(32), number: 1042, status: 'paid' })])),
      }),
      { session },
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.sales.orders.title }),
    ).toBeTruthy();
    expect(await screen.findByRole('link', { name: item.plan.title })).toBeTruthy();
    expect(within(section()).getByText(status.active)).toBeTruthy();
    expect(
      within(section()).getByText(t.nextCharge.replace('{{date}}', '1 de dezembro de 2026')),
    ).toBeTruthy();
    expect(
      within(section()).getByText(t.accessUntil.replace('{{date}}', '1 de dezembro de 2026')),
    ).toBeTruthy();
    expect(within(section()).getByRole('link', { name: t.open }).getAttribute('href')).toBe(
      `/conta/compras/assinaturas/${item.id}`,
    );
    // a compra avulsa continua na própria seção, mesmo com assinatura
    expect(screen.getByRole('link', { name: 'Pedido nº 1042' })).toBeTruthy();

    await expectNoAxeViolations();
  });

  it('filtra por estado e pede a lista filtrada à API', async () => {
    const user = userEvent.setup();
    const active = subscriptionSummary();
    const pastDue = subscriptionSummary({ id: uuid(32), status: 'past_due' });
    const { calls } = renderApp(
      '/conta/compras',
      routes({
        [SUBSCRIPTIONS_URL]: (request) => {
          const chosen = new URL(request.url).searchParams.get('status');
          return jsonResponse(
            subscriptionPage(chosen === 'past_due' ? [pastDue] : [active, pastDue]),
          );
        },
      }),
      { session },
    );

    await screen.findByRole('heading', { name: t.title });
    expect(
      (await within(section()).findAllByRole('link', { name: active.plan.title })).length,
    ).toBeGreaterThan(0);
    await user.click(
      within(section()).getByRole('button', { name: `${t.filters.label}: ${t.filters.all}` }),
    );
    await user.click(await screen.findByRole('option', { name: status.past_due }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path === '/api/v1/me/subscriptions' && call.search.includes('status=past_due'),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(within(section()).queryByText(status.active)).toBeNull());
    expect(within(section()).getAllByText(status.past_due).length).toBeGreaterThan(0);
  });

  it('sem assinatura mostra o vazio e o caminho para os planos', async () => {
    renderApp('/conta/compras', routes(), { session });

    expect(await screen.findByText(t.emptyTitle)).toBeTruthy();
    const empty = screen.getByText(t.emptyText).closest('div') as HTMLElement;
    expect(within(empty).getByRole('link', { name: t.emptyAction }).getAttribute('href')).toBe(
      '/planos',
    );
  });

  it('cancelar uma assinatura pendente na lista encerra a adesão e libera assinar de novo', async () => {
    const user = userEvent.setup();
    const pending = subscriptionSummary({ status: 'pending', nextChargeAt: null });
    const expired = { ...pending, status: 'expired' as const };
    let current = pending;
    const { calls } = renderApp(
      '/conta/compras',
      routes({
        [SUBSCRIPTIONS_URL]: () => jsonResponse(subscriptionPage([current])),
        [cancelSubscriptionUrl(pending.id)]: () => {
          current = expired;
          return jsonResponse(
            subscriptionDetail({
              status: 'expired',
              currentPeriodStart: null,
              currentPeriodEnd: null,
              nextChargeAt: null,
              payments: [],
            }),
          );
        },
      }),
      { session },
    );

    expect(await screen.findByRole('link', { name: pending.plan.title })).toBeTruthy();
    await user.click(
      within(section()).getByRole('button', { name: ptBR.subscriptions.cancel.action }),
    );

    const dialog = await screen.findByRole('alertdialog', {
      name: ptBR.subscriptions.cancel.titlePending,
    });
    expect(within(dialog).getByText(ptBR.subscriptions.cancel.text.pending)).toBeTruthy();
    await user.click(
      within(dialog).getByRole('button', { name: ptBR.subscriptions.cancel.confirm }),
    );

    expect(await screen.findByText(ptBR.subscriptions.cancel.done)).toBeTruthy();
    await waitFor(() => expect(within(section()).getByText(status.expired)).toBeTruthy());
    expect(within(section()).queryByText(status.pending)).toBeNull();
    // `expired` não é mais cancelável
    expect(
      within(section()).queryByRole('button', { name: ptBR.subscriptions.cancel.action }),
    ).toBeNull();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      `/api/v1/me/subscriptions/${pending.id}/cancel`,
    ]);
  });

  it('não oferece cancelar a assinatura suspensa', async () => {
    renderApp(
      '/conta/compras',
      routes({
        [SUBSCRIPTIONS_URL]: () =>
          jsonResponse(subscriptionPage([subscriptionSummary({ status: 'suspended' })])),
      }),
      { session },
    );

    expect(await screen.findByText(status.suspended)).toBeTruthy();
    expect(
      within(section()).queryByRole('button', { name: ptBR.subscriptions.cancel.action }),
    ).toBeNull();
  });

  it('carrega a próxima página de assinaturas', async () => {
    const user = userEvent.setup();
    const first = subscriptionSummary();
    const older = subscriptionSummary({
      id: uuid(32),
      status: 'ended',
      nextChargeAt: null,
      endedAt: '2026-10-30T12:00:00Z',
    });
    renderApp(
      '/conta/compras',
      routes({
        [SUBSCRIPTIONS_URL]: (request) =>
          jsonResponse(
            new URL(request.url).searchParams.get('cursor')
              ? subscriptionPage([older])
              : subscriptionPage([first], 'pagina-2'),
          ),
      }),
      { session },
    );

    expect(await screen.findByRole('link', { name: first.plan.title })).toBeTruthy();
    await user.click(within(section()).getByRole('button', { name: t.loadMore }));
    await waitFor(() => expect(within(section()).getByText(status.ended)).toBeTruthy());
    expect(
      within(section()).getByText(t.endedAt.replace('{{date}}', '30 de outubro de 2026')),
    ).toBeTruthy();
  });
});
