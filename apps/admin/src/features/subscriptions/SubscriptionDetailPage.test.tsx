import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../format';
import { defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { plan } from '../../test/plans';
import { renderApp } from '../../test/render';
import {
  SUBSCRIBER_ID,
  SUBSCRIPTION_ID,
  SUBSCRIPTION_PAYMENT_ID,
  subscriptionDetail,
  subscriptionPage,
  subscriptionPayment,
  subscriptionRefund,
  subscriptionSummary,
} from '../../test/subscriptions';

/** Rota da API do detalhe; o `GET` é o método, como nas chaves de `Routes`. */
const DETAIL_PATH = `/api/v1/subscriptions/${SUBSCRIPTION_ID}`;
const DETAIL_ROUTE = `GET ${DETAIL_PATH}`;

function detailRoutes(
  detail: AdminSchemas['AdminSubscriptionDetail'] | (() => AdminSchemas['AdminSubscriptionDetail']),
  extra: Routes = {},
): Routes {
  return {
    ...defaultRoutes(),
    'GET /api/v1/subscriptions': subscriptionPage([subscriptionSummary()]),
    [DETAIL_ROUTE]: detail,
    ...extra,
  };
}

describe('detalhe da assinatura (/assinaturas/:id)', () => {
  it('mostra assinante, plano, período, cobrança e as ações do admin, sem violações do axe', async () => {
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, detailRoutes(subscriptionDetail()));

    expect(
      await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText('Ativa')).toBeTruthy();
    expect(
      screen.getByText(
        `Acesso liberado; a próxima cobrança é em ${formatDateTime('2026-12-01T12:00:00Z')}.`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('bia@aluna.test')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir a ficha do aluno' }).getAttribute('href')).toBe(
      `/alunos/${SUBSCRIBER_ID}`,
    );

    expect(screen.getAllByText('Curso de Ouro').length).toBeGreaterThan(0);
    expect(screen.getByText('Mensal')).toBeTruthy();
    expect(screen.getAllByText('R$ 97,00').length).toBeGreaterThan(1);
    expect(screen.getByText('1 curso · 1 ebook')).toBeTruthy();
    expect(screen.getByText('Ebook de Ouro')).toBeTruthy();
    expect(
      screen.getByText(
        'As assinaturas existentes mantêm o preço contratado; o preço atual do plano vale para novas.',
      ),
    ).toBeTruthy();

    expect(screen.getAllByText(formatDateTime('2026-11-01T12:00:00Z')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatDateTime('2026-12-01T12:00:00Z')).length).toBeGreaterThan(0);
    expect(screen.getByText('Sem cupom')).toBeTruthy();
    expect(screen.getByText('Mercado Pago')).toBeTruthy();
    expect(screen.getByText('Não cancelada')).toBeTruthy();
    expect(screen.getByText('Não encerrada')).toBeTruthy();
    expect(screen.getAllByText('mp-sub-123').length).toBe(2);

    expect(screen.getByText('Aprovada')).toBeTruthy();
    expect(screen.getByText(/Cartão/)).toBeTruthy();
    expect(screen.getByText('Período em curso')).toBeTruthy();
    expect(screen.getByText('Nada reembolsado')).toBeTruthy();
    expect(screen.getByText('approved')).toBeTruthy();
    expect(screen.getByText('Nenhum reembolso nesta cobrança.')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reembolsar cobrança' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('lista os reembolsos da cobrança com estado, valor e autor', async () => {
    const detail = subscriptionDetail({
      payments: [
        subscriptionPayment({
          refundedCents: 2000,
          refunds: [
            subscriptionRefund({
              amountCents: 2000,
              status: 'done',
              doneAt: '2026-11-22T12:00:00Z',
            }),
          ],
        }),
      ],
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, detailRoutes(detail));
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    expect(screen.getByText('Concluído')).toBeTruthy();
    expect(screen.getAllByText('R$ 20,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Aluno pediu o cancelamento')).toBeTruthy();
    const payments = screen
      .getByRole('heading', { name: 'Cobranças' })
      .closest('section') as HTMLElement;
    expect(within(payments).getByText(/Ana Admin/)).toBeTruthy();
  });

  it('esconde o cancelamento e o reembolso do gerente, que só consulta', async () => {
    const routes: Routes = {
      ...defaultRoutes('manager'),
      'GET /api/v1/subscriptions': subscriptionPage([subscriptionSummary()]),
      [DETAIL_ROUTE]: subscriptionDetail(),
    };
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reembolsar cobrança' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tentar de novo' })).toBeNull();
  });

  it('recusa o detalhe ao instrutor, que não tem sales.view', async () => {
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, defaultRoutes('instructor'));
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });

  it('mostra a assinatura não encontrada com o caminho de volta', async () => {
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/subscriptions': subscriptionPage([subscriptionSummary()]),
      [DETAIL_ROUTE]: problem(404, 'not_found'),
    };
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    expect(await screen.findByText('Assinatura não encontrada')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar às assinaturas' }).getAttribute('href')).toBe(
      '/assinaturas',
    );
  });

  it('cancela a assinatura ativa com motivo, mantendo o acesso até o fim do período', async () => {
    const user = userEvent.setup();
    let current = subscriptionDetail();
    let sent: unknown;
    const routes = detailRoutes(() => current, {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/cancel`]: async (request: Request) => {
        sent = await request.json();
        current = {
          ...current,
          status: 'canceling',
          canceledAt: '2026-11-21T12:00:00Z',
          cancelReason: 'Pedido do aluno',
        };
        return current;
      },
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancelar assinatura' });
    expect(
      within(dialog).getByText(
        `A recorrência é cancelada agora e a assinatura vai para “cancelando”: o acesso segue até ${formatDateTime(
          '2026-12-01T12:00:00Z',
        )}, sem carência adicional.`,
      ),
    ).toBeTruthy();
    await expectNoAxeViolations(dialog);

    await user.type(within(dialog).getByLabelText('Motivo do cancelamento'), 'Pedido do aluno');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar assinatura' }));

    await waitFor(() => expect(sent).toEqual({ reason: 'Pedido do aluno' }));
    expect(
      await screen.findByText('Assinatura cancelada; o acesso segue até o fim do período pago.'),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
    expect(screen.getByText('Cancelando')).toBeTruthy();
  });

  it('encerra na hora a assinatura suspensa ao cancelar', async () => {
    const user = userEvent.setup();
    let current = subscriptionDetail({ status: 'suspended' });
    const routes = detailRoutes(() => current, {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/cancel`]: async () => {
        current = { ...current, status: 'ended', endedAt: '2026-11-21T12:00:00Z' };
        return current;
      },
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancelar assinatura' });
    expect(within(dialog).getByText(/o cancelamento encerra a assinatura na hora/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Motivo do cancelamento'), 'Carência vencida');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar assinatura' }));

    expect(await screen.findByText('Assinatura cancelada e encerrada.')).toBeTruthy();
    expect(
      screen.getByText(`Encerrada em ${formatDateTime('2026-11-21T12:00:00Z')}; sem acesso.`),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
  });

  it('não oferece cancelamento na assinatura pendente e explica quem cancela', async () => {
    const detail = subscriptionDetail({
      status: 'pending',
      currentPeriodPaymentId: null,
      payments: [],
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextChargeAt: null,
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, detailRoutes(detail));
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
    expect(
      screen.getByText(
        'Assinatura aguardando pagamento: quem cancela é o próprio aluno, antes dos 30 minutos.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('O acesso começa com a primeira cobrança aprovada.')).toBeTruthy();
    expect(screen.getByText('Nenhuma cobrança registrada ainda.')).toBeTruthy();
  });

  it('mostra a recusa de cancelamento que a API devolve', async () => {
    const user = userEvent.setup();
    const routes = detailRoutes(subscriptionDetail(), {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/cancel`]: () =>
        problem(409, 'subscription_not_cancelable'),
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancelar assinatura' });
    await user.type(within(dialog).getByLabelText('Motivo do cancelamento'), 'Pedido do aluno');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar assinatura' }));

    expect(
      await within(dialog).findByText('Esta assinatura não pode ser cancelada neste estado.'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Cancelar assinatura' })).toBeTruthy();
  });

  it('reembolsa a cobrança do período em curso por inteiro, avisando que encerra a assinatura', async () => {
    const user = userEvent.setup();
    const posted: { body?: unknown; key?: string | null } = {};
    const routes = detailRoutes(subscriptionDetail(), {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/payments/${SUBSCRIPTION_PAYMENT_ID}/refund`]:
        async (request: Request) => {
          posted.body = await request.json();
          posted.key = request.headers.get('Idempotency-Key');
          return new Response(JSON.stringify(subscriptionRefund()), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        },
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Reembolsar cobrança' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar cobrança' });
    expect(within(dialog).getByText(/Este reembolso fecha o saldo desta cobrança/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Valor a reembolsar') as HTMLInputElement).value).toBe(
      '97,00',
    );
    await expectNoAxeViolations(dialog);

    await user.type(within(dialog).getByLabelText('Motivo'), 'Aluno desistiu');
    await user.click(within(dialog).getByRole('button', { name: 'Reembolsar' }));

    await waitFor(() => expect(posted.body).toBeDefined());
    expect(posted.body).toEqual({ reason: 'Aluno desistiu', amountCents: 9700 });
    expect(posted.key ?? '').toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await screen.findByText(
        'Reembolso pedido: R$ 97,00. O estorno é executado em segundo plano.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('devolve um valor menor sem encerrar a assinatura', async () => {
    const user = userEvent.setup();
    const posted: { body?: unknown } = {};
    const routes = detailRoutes(subscriptionDetail(), {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/payments/${SUBSCRIPTION_PAYMENT_ID}/refund`]:
        async (request: Request) => {
          posted.body = await request.json();
          return new Response(JSON.stringify(subscriptionRefund({ amountCents: 5000 })), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        },
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Reembolsar cobrança' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar cobrança' });
    const amount = within(dialog).getByLabelText('Valor a reembolsar');
    await user.clear(amount);
    await user.type(amount, '50,00');
    expect(within(dialog).getByText(/Reembolso parcial/)).toBeTruthy();

    await user.type(within(dialog).getByLabelText('Motivo'), 'Desconto combinado');
    await user.click(within(dialog).getByRole('button', { name: 'Reembolsar' }));

    await waitFor(() => expect(posted.body).toBeDefined());
    expect(posted.body).toEqual({ reason: 'Desconto combinado', amountCents: 5000 });
  });

  it('trata a cobrança de período passado como sem efeito no estado da assinatura', async () => {
    const user = userEvent.setup();
    const older = subscriptionPayment({
      id: '0193a5b2-0000-7000-8000-0000000000f7',
      providerPaymentId: 'mp-sub-old',
      paidAt: '2026-10-01T12:00:00Z',
      createdAt: '2026-10-01T12:01:00Z',
    });
    const posted: { body?: unknown } = {};
    const routes = detailRoutes(subscriptionDetail({ payments: [subscriptionPayment(), older] }), {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/payments/${older.id}/refund`]: async (
        request: Request,
      ) => {
        posted.body = await request.json();
        return new Response(JSON.stringify(subscriptionRefund({ paymentId: older.id })), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    const buttons = screen.getAllByRole('button', { name: 'Reembolsar cobrança' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar cobrança' });
    expect(within(dialog).getByText(/Cobrança de período passado/)).toBeTruthy();

    await user.type(within(dialog).getByLabelText('Motivo'), 'Ajuste do mês passado');
    await user.click(within(dialog).getByRole('button', { name: 'Reembolsar' }));

    await waitFor(() => expect(posted.body).toBeDefined());
    expect(posted.body).toEqual({ reason: 'Ajuste do mês passado', amountCents: 9700 });
  });

  it('recusa o valor acima do saldo reembolsável antes de chamar a API', async () => {
    const user = userEvent.setup();
    const posted: { body?: unknown } = {};
    const routes = detailRoutes(subscriptionDetail(), {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/payments/${SUBSCRIPTION_PAYMENT_ID}/refund`]:
        async (request: Request) => {
          posted.body = await request.json();
          return new Response(JSON.stringify(subscriptionRefund()), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        },
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Reembolsar cobrança' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar cobrança' });
    const amount = within(dialog).getByLabelText('Valor a reembolsar');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Aluno desistiu');
    await user.clear(amount);
    await user.type(amount, '200,00');
    await user.click(within(dialog).getByRole('button', { name: 'Reembolsar' }));

    expect(
      within(dialog).getByText('Informe um valor maior que zero e até R$ 97,00.'),
    ).toBeTruthy();
    expect(posted.body).toBeUndefined();
  });

  it('oferece reembolso só para cobrança aprovada com saldo', async () => {
    const detail = subscriptionDetail({
      payments: [
        subscriptionPayment({ status: 'refunded', refundedCents: 9700 }),
        subscriptionPayment({
          id: '0193a5b2-0000-7000-8000-0000000000f6',
          status: 'rejected',
          refundedCents: 0,
        }),
      ],
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, detailRoutes(detail));
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    expect(screen.queryByRole('button', { name: 'Reembolsar cobrança' })).toBeNull();
    expect(screen.getByText('Reembolsada')).toBeTruthy();
    expect(screen.getByText('Recusada')).toBeTruthy();
  });

  it('mostra a recusa de reembolso que a API devolve', async () => {
    const user = userEvent.setup();
    const routes = detailRoutes(subscriptionDetail(), {
      [`POST /api/v1/subscriptions/${SUBSCRIPTION_ID}/payments/${SUBSCRIPTION_PAYMENT_ID}/refund`]:
        () => problem(422, 'refund_exceeds_paid'),
    });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, routes);
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Reembolsar cobrança' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar cobrança' });
    await user.type(within(dialog).getByLabelText('Motivo'), 'Aluno desistiu');
    await user.click(within(dialog).getByRole('button', { name: 'Reembolsar' }));

    expect(
      await within(dialog).findByText('O valor passa do saldo não reembolsado da cobrança.'),
    ).toBeTruthy();
  });

  const ACCESS_CASES: [string, Partial<AdminSchemas['AdminSubscriptionDetail']>, string][] = [
    [
      'past_due',
      { status: 'past_due' as const, graceUntil: '2026-12-10T12:00:00Z' },
      `Cobrança recusada: o acesso segue até o fim da carência, em ${formatDateTime(
        '2026-12-10T12:00:00Z',
      )}.`,
    ],
    [
      'canceling',
      { status: 'canceling' as const, canceledAt: '2026-11-21T12:00:00Z' },
      `Cancelada: o acesso segue até o fim do período pago, em ${formatDateTime(
        '2026-12-01T12:00:00Z',
      )}.`,
    ],
    [
      'expired',
      {
        status: 'expired' as const,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        nextChargeAt: null,
        currentPeriodPaymentId: null,
        payments: [],
      },
      'Nunca foi paga; sem acesso.',
    ],
  ];

  it.each(ACCESS_CASES)('explica o acesso no estado %s', async (_status, patch, expected) => {
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, detailRoutes(subscriptionDetail(patch)));
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('mostra o plano atual da assinatura mesmo quando ele mudou de preço', async () => {
    const detail = subscriptionDetail({ plan: plan({ priceCents: 12000 }) });
    renderApp(`/assinaturas/${SUBSCRIPTION_ID}`, detailRoutes(detail));
    await screen.findByRole('heading', { name: 'Assinatura de Bia Aluna', level: 1 });

    expect(screen.getAllByText('R$ 97,00').length).toBeGreaterThan(0);
    expect(screen.getByText('R$ 120,00')).toBeTruthy();
  });
});
