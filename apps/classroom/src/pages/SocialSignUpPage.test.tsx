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

const TERMS = [
  {
    id: '0193a5b2-0000-7000-8000-000000000001',
    document: 'terms',
    version: 3,
    effectiveAt: '2026-11-01T12:00:00Z',
  },
];
const PENDING = {
  provider: 'google',
  email: 'ana@gmail.test',
  emailVerified: true,
  name: 'Ana Souza',
  terms: TERMS,
};

const main = async () => within(await screen.findByRole('main'));

describe('cadastro social', () => {
  it('mostra os dados do provedor, pede o aceite e cria a conta', async () => {
    const user = userEvent.setup();
    const { router, calls } = renderApp(
      '/cadastro/social',
      apiRoutes({
        'GET /api/v1/auth/social/pending': () => jsonResponse(PENDING),
        'POST /api/v1/auth/social/complete': () => jsonResponse(makeSession()),
      }),
    );
    const page = await main();
    expect(await page.findByText('ana@gmail.test')).toBeTruthy();
    expect(page.getByText('Google')).toBeTruthy();
    expect(page.getByText('Ana Souza')).toBeTruthy();
    expect(page.queryByLabelText(ptBR.socialSignUp.email)).toBeNull();
    await expectNoAxeViolations();

    await user.click(page.getByRole('button', { name: ptBR.socialSignUp.submit }));
    expect(page.getByText(ptBR.signUp.errors.termsRequired)).toBeTruthy();
    expect(calls.some((call) => call.path === '/api/v1/auth/social/complete')).toBe(false);

    await user.click(page.getByRole('checkbox', { name: ptBR.terms.accept }));
    await user.click(page.getByRole('button', { name: ptBR.socialSignUp.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inicio'));
    expect(calls.find((call) => call.path === '/api/v1/auth/social/complete')?.body).toEqual({
      acceptedTerms: [TERMS[0]?.id],
    });
    expect(await screen.findByRole('button', { name: 'Menu da conta de Ana Souza' })).toBeTruthy();
  });

  it('pede o e-mail quando o provedor não enviou, e trata email_taken com orientação', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/cadastro/social',
      apiRoutes({
        'GET /api/v1/auth/social/pending': () =>
          jsonResponse({
            ...PENDING,
            provider: 'facebook',
            email: null,
            emailVerified: false,
            terms: [],
          }),
        'POST /api/v1/auth/social/complete': () => problemResponse(409, 'email_taken'),
      }),
    );
    const page = await main();
    const email = await page.findByLabelText(ptBR.socialSignUp.email);
    expect(page.queryByRole('checkbox')).toBeNull();

    await user.click(page.getByRole('button', { name: ptBR.socialSignUp.submit }));
    expect(page.getByText(ptBR.signUp.errors.emailInvalid)).toBeTruthy();
    expect(document.activeElement).toBe(email);

    await user.type(email, 'ana@exemplo.test');
    await user.click(page.getByRole('button', { name: ptBR.socialSignUp.submit }));
    const alert = await page.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.socialSignUp.emailTakenTitle);
    expect(alert.textContent).toContain('vincule o Facebook em Configurações');
    expect(
      within(alert)
        .getByRole('link', { name: ptBR.socialSignUp.emailTakenAction })
        .getAttribute('href'),
    ).toBe('/entrar?destino=%2Fconta%2Facesso');
    expect(calls.find((call) => call.path === '/api/v1/auth/social/complete')?.body).toEqual({
      acceptedTerms: [],
      email: 'ana@exemplo.test',
    });
  });

  it('sem cadastro pendente (404 not_found) orienta a começar de novo', async () => {
    renderApp(
      '/cadastro/social',
      apiRoutes({ 'GET /api/v1/auth/social/pending': () => problemResponse(404, 'not_found') }),
    );
    const page = await main();
    expect(await page.findByText(ptBR.socialSignUp.expiredTitle)).toBeTruthy();
    expect(
      page.getByRole('link', { name: ptBR.socialSignUp.backToLogin }).getAttribute('href'),
    ).toBe('/entrar');
  });

  it('cadastro que venceu no meio (404 no envio) também leva ao aviso', async () => {
    const user = userEvent.setup();
    let alive = true;
    renderApp(
      '/cadastro/social',
      apiRoutes({
        'GET /api/v1/auth/social/pending': () =>
          alive ? jsonResponse({ ...PENDING, terms: [] }) : problemResponse(404, 'not_found'),
        'POST /api/v1/auth/social/complete': () => {
          alive = false;
          return problemResponse(404, 'not_found');
        },
      }),
    );
    const page = await main();
    await user.click(await page.findByRole('button', { name: ptBR.socialSignUp.submit }));
    expect(await page.findByText(ptBR.socialSignUp.expiredTitle)).toBeTruthy();
  });

  it('terms_acceptance_required (422) busca os termos de novo', async () => {
    const user = userEvent.setup();
    let version = 3;
    renderApp(
      '/cadastro/social',
      apiRoutes({
        'GET /api/v1/auth/social/pending': () =>
          jsonResponse({ ...PENDING, terms: [{ ...TERMS[0], version }] }),
        'POST /api/v1/auth/social/complete': () => {
          version = 4;
          return problemResponse(422, 'terms_acceptance_required');
        },
      }),
    );
    const page = await main();
    await user.click(await page.findByRole('checkbox', { name: ptBR.terms.accept }));
    await user.click(page.getByRole('button', { name: ptBR.socialSignUp.submit }));
    expect(await page.findByRole('link', { name: /Termos de uso \(versão 4\)/ })).toBeTruthy();
  });

  it('com a rota ainda inexistente (404 sem código) mostra um erro tratado', async () => {
    renderApp('/cadastro/social', apiRoutes({}));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.socialSignUp.errorTitle);
    expect(alert.textContent).toContain(ptBR.errors.notAvailable);
  });
});
