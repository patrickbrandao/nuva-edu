import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { BILLING_URL, billing, SAVE_BILLING_URL, uuid } from '../test/sales';
import {
  allPlan,
  PLANS_URL,
  planCatalog,
  SUBSCRIBE_URL,
  SUBSCRIPTIONS_URL,
  subscriptionCheckout,
  subscriptionPage,
  subscriptionSummary,
} from '../test/subscriptions';

const session = makeSession();
const t = ptBR.subscriptions.plans;
const checkout = ptBR.subscriptions.checkout;

/** O cartão de um plano na vitrine, pelo título do cartão. */
function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: title });
  return heading.closest('article') as HTMLElement;
}

/** O `browser.assign` sai da página; no teste, só registramos para onde ele iria. */
function spyNavigation() {
  return vi.spyOn(browser, 'assign').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.scrollTo = () => {};
});

/** O checkout com os dados de comprador completos, pronto para assinar. */
const checkoutRoutes = (extra: Parameters<typeof apiRoutes>[0] = {}) =>
  apiRoutes({
    [PLANS_URL]: () => jsonResponse(planCatalog()),
    [BILLING_URL]: () => jsonResponse(billing()),
    [SUBSCRIPTIONS_URL]: () => jsonResponse(subscriptionPage([])),
    ...extra,
  });

/** Abre o checkout de um plano na vitrine, já com sessão. */
async function openCheckout(extra: Parameters<typeof apiRoutes>[0] = {}) {
  const user = userEvent.setup();
  const view = renderApp('/planos', checkoutRoutes(extra), { session });
  const pro = await screen.findByRole('heading', { level: 3, name: 'Plano Pro' });
  await user.click(
    within(pro.closest('article') as HTMLElement).getByRole('button', { name: t.subscribe }),
  );
  await screen.findByRole('heading', {
    level: 2,
    name: checkout.title.replace('{{plan}}', 'Plano Pro'),
  });
  return { user, ...view };
}

describe('vitrine de planos', () => {
  it('mostra os planos por conteúdo, alterna mensal e anual e leva o visitante ao login', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(
      '/planos',
      apiRoutes({ [PLANS_URL]: () => jsonResponse(planCatalog()) }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeTruthy();
    // o plano "tudo" diz que inclui os lançamentos futuros
    expect(await screen.findByText(t.features.all)).toBeTruthy();
    expect(screen.getByText('React do zero')).toBeTruthy();
    expect(screen.getByText(t.allBadge)).toBeTruthy();
    // mensal é o padrão; o anual tem o dobro de meses no preço
    expect(screen.getByText(/^R\$\s99,00$/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: new RegExp(t.billing.year) }));
    expect(await screen.findByText(/^R\$\s990,00$/)).toBeTruthy();
    expect(screen.queryByText(/^R\$\s99,00$/)).toBeNull();

    // visitante: assinar pede login e volta ao plano escolhido
    await user.click(within(card('Plano Pro')).getByRole('button', { name: t.subscribe }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(new URLSearchParams(router.state.location.search).get('destino')).toBe(
      '/planos?plano=pro',
    );

    await expectNoAxeViolations();
  });

  it('sem plano ativo mostra o vazio com o caminho para a vitrine', async () => {
    renderApp('/planos', apiRoutes({ [PLANS_URL]: () => jsonResponse(planCatalog([])) }));

    expect(await screen.findByText(t.emptyTitle)).toBeTruthy();
    const empty = screen.getByText(t.emptyText).closest('div') as HTMLElement;
    expect(within(empty).getByRole('link', { name: t.emptyAction }).getAttribute('href')).toBe('/');
  });

  it('catálogo fora do ar mostra o erro com nova tentativa', async () => {
    renderApp(
      '/planos',
      apiRoutes({ [PLANS_URL]: () => problemResponse(503, 'database_unavailable') }),
    );

    expect(await screen.findByText(t.errorTitle)).toBeTruthy();
    expect(screen.queryByText(t.emptyTitle)).toBeNull();
  });

  it('plano que saiu da vitrine avisa e volta para a lista', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(
      '/planos?plano=pro',
      apiRoutes({
        [PLANS_URL]: () =>
          jsonResponse(planCatalog([{ groupKey: 'completo', plans: [allPlan()] }])),
      }),
    );

    expect(await screen.findByText(t.unavailableTitle)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: t.unavailableAction }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('plano')).toBeNull(),
    );
    expect(screen.queryByText(t.unavailableTitle)).toBeNull();
  });
});

describe('checkout da assinatura', () => {
  it('assina com cupom, envia o plano e abre o pagamento do provedor', async () => {
    const assign = spyNavigation();
    const seen: { body: unknown } = { body: null };
    const { user, calls } = await openCheckout({
      [SUBSCRIBE_URL]: (request) => {
        return request
          .clone()
          .json()
          .then((body) => {
            seen.body = body;
            return jsonResponse(subscriptionCheckout(), 201);
          });
      },
    });

    await expectNoAxeViolations();

    await user.type(screen.getByLabelText(checkout.coupon.label), 'PRIMEIRA10');
    await user.click(screen.getByRole('button', { name: checkout.submit }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mp.test/assinatura/abc'));
    expect(seen.body).toEqual({ planId: uuid(11), couponCode: 'PRIMEIRA10' });
    const subscribe = calls.find(
      (call) => call.method === 'POST' && call.path === '/api/v1/subscriptions',
    );
    expect(subscribe?.csrf).toBe(session.csrfToken);
    expect(
      (await screen.findByRole('link', { name: checkout.redirectAction })).getAttribute('href'),
    ).toBe('https://mp.test/assinatura/abc');
    expect(screen.getByText(checkout.redirecting)).toBeTruthy();
  });

  it('duplo clique e nova tentativa após falha transitória usam a mesma chave', async () => {
    const assign = spyNavigation();
    const keys: Array<string | null> = [];
    let unavailable = true;
    const { user } = await openCheckout({
      [SUBSCRIBE_URL]: (request) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return unavailable
          ? problemResponse(503, 'payment_provider_unavailable')
          : jsonResponse(subscriptionCheckout(), 201);
      },
    });

    await user.dblClick(screen.getByRole('button', { name: checkout.submit }));
    expect(await screen.findByText(checkout.errors.providerUnavailable)).toBeTruthy();
    expect(keys[0]).toMatch(/^.{8,128}$/);
    unavailable = false;
    await user.click(screen.getByRole('button', { name: checkout.submit }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mp.test/assinatura/abc'));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('recomeçar após cupom recusado gera outra chave', async () => {
    const assign = spyNavigation();
    const keys: Array<string | null> = [];
    const { user } = await openCheckout({
      [SUBSCRIBE_URL]: (request) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return keys.length === 1
          ? problemResponse(422, 'coupon_invalid')
          : jsonResponse(subscriptionCheckout(), 201);
      },
    });

    await user.type(screen.getByLabelText(checkout.coupon.label), 'PRIMEIRA10');
    await user.click(screen.getByRole('button', { name: checkout.submit }));
    await findAlert();
    await user.click(screen.getByRole('button', { name: checkout.submit }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mp.test/assinatura/abc'));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toMatch(/^.{8,128}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('sem dados de comprador pede nome e documento, salva e segue para o pagamento', async () => {
    const assign = spyNavigation();
    const user = userEvent.setup();
    const seen: { bodies: unknown[] } = { bodies: [] };
    const { calls } = renderApp(
      '/planos?plano=pro',
      checkoutRoutes({
        [BILLING_URL]: () =>
          jsonResponse(
            billing({ fullName: 'Ana Souza', taxIdType: null, taxId: null, complete: false }),
          ),
        [SAVE_BILLING_URL]: () =>
          jsonResponse(
            billing({
              fullName: 'Ana Souza',
              taxIdType: 'cpf',
              taxId: '39053344705',
              complete: true,
            }),
          ),
        [SUBSCRIBE_URL]: (request) =>
          request
            .clone()
            .json()
            .then((body) => {
              seen.bodies.push(body);
              return jsonResponse(subscriptionCheckout(), 201);
            }),
      }),
      { session },
    );

    // o nome já salvo preenche o formulário; falta o documento
    const taxId = await screen.findByLabelText(checkout.buyer.taxId);
    expect((screen.getByLabelText(checkout.buyer.fullName) as HTMLInputElement).value).toBe(
      'Ana Souza',
    );
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: checkout.submit }));
    expect(await screen.findByText(checkout.errors.requiredTaxId)).toBeTruthy();
    expect((taxId as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
    expect(seen.bodies).toEqual([]);

    await user.type(taxId, '39053344705');
    await user.click(screen.getByRole('button', { name: checkout.submit }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mp.test/assinatura/abc'));
    expect(seen.bodies).toEqual([{ planId: uuid(11) }]);
    const saved = calls.find((call) => call.method === 'PUT' && call.path === '/api/v1/me/billing');
    expect(saved?.body).toEqual({
      fullName: 'Ana Souza',
      taxIdType: 'cpf',
      taxId: '39053344705',
    });
    // os dados de comprador são salvos antes da assinatura
    const writes = calls.filter(
      (call) =>
        call.method === 'PUT' || (call.method === 'POST' && call.path === '/api/v1/subscriptions'),
    );
    expect(writes.map((call) => call.method)).toEqual(['PUT', 'POST']);
  });

  it('recusa de comprador incompleto abre o formulário e repete a assinatura depois de salvar', async () => {
    const assign = spyNavigation();
    const user = userEvent.setup();
    const seen: { bodies: unknown[] } = { bodies: [] };
    const { calls } = renderApp(
      '/planos?plano=pro',
      checkoutRoutes({
        [BILLING_URL]: () => jsonResponse(billing({ complete: true })),
        [SAVE_BILLING_URL]: () => jsonResponse(billing()),
        [SUBSCRIBE_URL]: (request) =>
          request
            .clone()
            .json()
            .then((body) => {
              seen.bodies.push(body);
              // a primeira tentativa esbarra no comprador incompleto; a segunda, depois do PUT
              return seen.bodies.length === 1
                ? problemResponse(409, 'billing_required')
                : jsonResponse(subscriptionCheckout(), 201);
            }),
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: checkout.submit }));
    const alert = await findAlert();
    expect(within(alert).getByText(checkout.errors.billingRequired)).toBeTruthy();

    await user.type(screen.getByLabelText(checkout.buyer.taxId), '39053344705');
    await user.click(screen.getByRole('button', { name: checkout.submit }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mp.test/assinatura/abc'));
    expect(seen.bodies).toEqual([{ planId: uuid(11) }, { planId: uuid(11) }]);
    const writes = calls.filter(
      (call) =>
        call.method === 'PUT' || (call.method === 'POST' && call.path === '/api/v1/subscriptions'),
    );
    expect(writes.map((call) => call.method)).toEqual(['POST', 'PUT', 'POST']);
  });

  it('plano que já assina fica desabilitado e a duplicidade explica o motivo', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/planos',
      checkoutRoutes({
        [SUBSCRIPTIONS_URL]: () => jsonResponse(subscriptionPage([subscriptionSummary()])),
        [SUBSCRIBE_URL]: () => problemResponse(409, 'subscription_already_exists'),
      }),
      { session },
    );

    expect(await screen.findByText(t.alreadyText.replace('{{plans}}', 'Plano Pro'))).toBeTruthy();
    expect(
      within(card('Plano Pro'))
        .getByRole('button', { name: t.existing.active })
        .hasAttribute('disabled'),
    ).toBe(true);

    // outro plano ainda pode ser tentado: a API recusa a segunda assinatura do mesmo plano
    await user.click(within(card('Plano Completo')).getByRole('button', { name: t.subscribe }));
    await user.click(await screen.findByRole('button', { name: checkout.submit }));

    const alert = await findAlert();
    expect(within(alert).getByText(checkout.errors.alreadyExists)).toBeTruthy();
    expect(within(alert).getByRole('link', { name: checkout.goToMine }).getAttribute('href')).toBe(
      '/conta/compras',
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(true);
  });

  it.each([
    ['coupon_invalid', 422, checkout.errors.couponInvalid],
    ['payment_provider_unavailable', 503, checkout.errors.providerUnavailable],
    ['email_not_verified', 403, checkout.errors.emailNotVerified],
  ])('a recusa %s mantém a pessoa no checkout com o motivo', async (code, status, message) => {
    const assign = spyNavigation();
    const { user } = await openCheckout({
      [SUBSCRIBE_URL]: () => problemResponse(status, code),
    });

    await user.click(screen.getByRole('button', { name: checkout.submit }));

    const alert = await findAlert();
    expect(within(alert).getByText(message)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: checkout.submit }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('plano desativado entre a vitrine e o clique explica e recarrega a lista', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { router } = renderApp(
      '/planos?plano=pro',
      checkoutRoutes({
        [PLANS_URL]: () => {
          calls += 1;
          return jsonResponse(planCatalog());
        },
        [SUBSCRIBE_URL]: () => problemResponse(404, 'not_found'),
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: checkout.submit }));
    const alert = await findAlert();
    expect(within(alert).getByText(checkout.errors.planUnavailable)).toBeTruthy();

    await user.click(within(alert).getByRole('button', { name: checkout.refreshPlans }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('plano')).toBeNull(),
    );
    expect(calls).toBeGreaterThan(1);
  });

  it('cancelar a escolha fecha o checkout e mantém a vitrine', async () => {
    const user = userEvent.setup();
    const { router } = await openCheckout();

    await user.click(screen.getByRole('button', { name: checkout.close }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('plano')).toBeNull(),
    );
    expect(screen.queryByRole('heading', { level: 2, name: /Plano Pro/ })).toBeNull();
    // o plano volta a estar disponível para assinar
    expect(within(card('Plano Pro')).getByRole('button', { name: t.subscribe })).toBeTruthy();
  });
});
