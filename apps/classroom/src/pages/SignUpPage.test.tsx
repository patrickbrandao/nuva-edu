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

const TERMS = {
  id: '0193a5b2-0000-7000-8000-000000000001',
  document: 'terms',
  version: 3,
  bodyMd: '# Termos',
  effectiveAt: '2026-11-01T12:00:00Z',
};
const PRIVACY = {
  id: '0193a5b2-0000-7000-8000-000000000002',
  document: 'privacy',
  version: 2,
  bodyMd: '# Privacidade',
  effectiveAt: '2026-11-01T12:00:00Z',
};

const withTerms = {
  'GET /api/v1/legal/terms': () => jsonResponse(TERMS),
  'GET /api/v1/legal/privacy': () => jsonResponse(PRIVACY),
};
const withoutTerms = {
  'GET /api/v1/legal/terms': () => problemResponse(404, 'not_found'),
  'GET /api/v1/legal/privacy': () => problemResponse(404, 'not_found'),
};

async function fill({
  name = 'Ana Souza',
  email = 'ana@exemplo.test',
  password = 'senha-de-teste',
  accept = true,
} = {}) {
  const user = userEvent.setup();
  const nameField = await screen.findByLabelText(ptBR.signUp.name);
  if (name) await user.type(nameField, name);
  if (email) await user.type(screen.getByLabelText(ptBR.signUp.email), email);
  if (password) await user.type(screen.getByLabelText(ptBR.signUp.password), password);
  if (accept) {
    const box = screen.queryByRole('checkbox', { name: ptBR.terms.accept });
    if (box) await user.click(box);
  }
  const submit = () =>
    user.click(within(screen.getByRole('main')).getByRole('button', { name: ptBR.signUp.submit }));
  return { user, submit };
}

describe('cadastro', () => {
  it('tem os campos, o aviso de não reutilizar senha e os termos vigentes com links', async () => {
    renderApp('/cadastro', apiRoutes(withTerms));

    expect(await screen.findByRole('heading', { level: 1, name: ptBR.signUp.title })).toBeTruthy();
    expect(screen.getByLabelText(ptBR.signUp.name).getAttribute('autocomplete')).toBe('name');
    const password = screen.getByLabelText(ptBR.signUp.password);
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText(ptBR.signUp.passwordHint)).toBeTruthy();

    const termsLink = await screen.findByRole('link', { name: /Termos de uso \(versão 3\)/ });
    expect(termsLink.getAttribute('href')).toBe('/termos');
    expect(termsLink.getAttribute('target')).toBe('_blank');
    expect(
      screen
        .getByRole('link', { name: /Política de privacidade \(versão 2\)/ })
        .getAttribute('href'),
    ).toBe('/privacidade');
    expect(screen.getByRole('checkbox', { name: ptBR.terms.accept })).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: ptBR.signUp.signIn }).getAttribute('href')).toBe(
      '/entrar',
    );
    await expectNoAxeViolations();
  });

  it('cria a conta com o aceite e entra com as mesmas credenciais', async () => {
    const { router, calls } = renderApp(
      '/cadastro?destino=/planos',
      apiRoutes({
        ...withTerms,
        'POST /api/v1/auth/register': () => noContent(),
        'POST /api/v1/auth/login': () => jsonResponse(makeSession()),
      }),
    );
    const { submit } = await fill({ email: ' ana@exemplo.test ' });
    await submit();

    await waitFor(() => expect(router.state.location.pathname).toBe('/planos'));
    expect(calls.find((call) => call.path === '/api/v1/auth/register')?.body).toEqual({
      name: 'Ana Souza',
      email: 'ana@exemplo.test',
      password: 'senha-de-teste',
      acceptedTerms: [TERMS.id, PRIVACY.id],
    });
    expect(calls.find((call) => call.path === '/api/v1/auth/login')?.body).toEqual({
      email: 'ana@exemplo.test',
      password: 'senha-de-teste',
    });
    expect(await screen.findByRole('button', { name: 'Menu da conta de Ana Souza' })).toBeTruthy();
  });

  it('sem versão publicada (404) não pede aceite e manda acceptedTerms vazio', async () => {
    const { router, calls } = renderApp(
      '/cadastro',
      apiRoutes({
        ...withoutTerms,
        'POST /api/v1/auth/register': () => noContent(),
        'POST /api/v1/auth/login': () => jsonResponse(makeSession()),
      }),
    );
    const { submit } = await fill();
    expect(screen.queryByRole('checkbox')).toBeNull();
    await submit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/inicio'));
    expect(calls.find((call) => call.path === '/api/v1/auth/register')?.body).toMatchObject({
      acceptedTerms: [],
    });
  });

  it('confere os campos e o aceite no navegador antes de enviar', async () => {
    const { calls } = renderApp('/cadastro', apiRoutes(withTerms));
    await screen.findByRole('checkbox', { name: ptBR.terms.accept });
    const { submit } = await fill({ name: '', email: 'x', password: 'curta', accept: false });
    await submit();

    expect(screen.getByText(ptBR.signUp.errors.nameRequired)).toBeTruthy();
    expect(screen.getByText(ptBR.signUp.errors.emailInvalid)).toBeTruthy();
    expect(screen.getByText(ptBR.password.invalid)).toBeTruthy();
    expect(screen.getByText(ptBR.signUp.errors.termsRequired)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(ptBR.signUp.name));
    expect(calls.some((call) => call.path === '/api/v1/auth/register')).toBe(false);
  });

  it('password_invalid (400) marca o campo de senha', async () => {
    renderApp(
      '/cadastro',
      apiRoutes({
        ...withTerms,
        'POST /api/v1/auth/register': () => problemResponse(400, 'password_invalid'),
      }),
    );
    const { submit } = await fill();
    await submit();
    const password = screen.getByLabelText(ptBR.signUp.password);
    await waitFor(() => expect(password.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText(ptBR.password.invalid)).toBeTruthy();
    expect(document.activeElement).toBe(password);
  });

  it('validation_failed (400) marca os campos citados em errors[]', async () => {
    renderApp(
      '/cadastro',
      apiRoutes({
        ...withTerms,
        'POST /api/v1/auth/register': () =>
          problemResponse(400, 'validation_failed', {
            errors: [{ path: 'body.email', message: 'must match format "email"' }],
          }),
      }),
    );
    const { submit } = await fill();
    await submit();
    expect(await screen.findByText(ptBR.signUp.errors.emailInvalid)).toBeTruthy();
    expect(screen.queryByText('must match format "email"')).toBeNull();
  });

  it('terms_acceptance_required (422) desmarca o aceite e busca os termos de novo', async () => {
    let termsCalls = 0;
    renderApp(
      '/cadastro',
      apiRoutes({
        ...withTerms,
        'GET /api/v1/legal/terms': () => {
          termsCalls += 1;
          return jsonResponse(
            termsCalls === 1 ? TERMS : { ...TERMS, id: `${TERMS.id.slice(0, -1)}9`, version: 4 },
          );
        },
        'POST /api/v1/auth/register': () =>
          problemResponse(422, 'terms_acceptance_required', {
            errors: [{ path: 'body.acceptedTerms', message: 'terms' }],
          }),
      }),
    );
    const { submit } = await fill();
    await submit();
    expect(await screen.findByText(ptBR.signUp.errors.termsChanged)).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Termos de uso \(versão 4\)/ })).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: ptBR.terms.accept }) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('cadastro aceito mas login recusado: orienta sem revelar se o e-mail existia', async () => {
    const { router } = renderApp(
      '/cadastro',
      apiRoutes({
        ...withTerms,
        'POST /api/v1/auth/register': () => noContent(),
        'POST /api/v1/auth/login': () => problemResponse(401, 'invalid_credentials'),
      }),
    );
    const { submit } = await fill();
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.signUp.loginAfterFailed);
    expect(
      within(alert).getByRole('link', { name: ptBR.signUp.goToLogin }).getAttribute('href'),
    ).toBe('/entrar');
    expect(router.state.location.pathname).toBe('/cadastro');
  });

  it('com as rotas ainda inexistentes (404) mostra um erro tratado', async () => {
    renderApp('/cadastro', apiRoutes({}));
    const { submit } = await fill();
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain(ptBR.errors.notAvailable);
  });

  it('termos fora do ar: mostra o erro com "tentar de novo" e não deixa enviar', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      '/cadastro',
      apiRoutes({
        ...withTerms,
        'GET /api/v1/legal/terms': () =>
          fail ? problemResponse(503, 'database_unavailable') : jsonResponse(TERMS),
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.signUp.termsErrorTitle);
    const submit = within(screen.getByRole('main')).getByRole('button', {
      name: ptBR.signUp.submit,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await screen.findByRole('checkbox', { name: ptBR.terms.accept })).toBeTruthy();
    expect(submit.disabled).toBe(false);
  });
});
