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

const SESSION = makeSession();

async function fillAndSubmit(email = 'ana@exemplo.test', password = 'senha-de-teste') {
  const user = userEvent.setup();
  const emailField = await screen.findByLabelText(ptBR.login.email);
  if (email) await user.type(emailField, email);
  if (password) await user.type(screen.getByLabelText(ptBR.login.password), password);
  const main = screen.getByRole('main');
  await user.click(within(main).getByRole('button', { name: ptBR.login.submit }));
  return { user, main };
}

describe('login', () => {
  it('tem os campos rotulados, os links e o login social da instalação', async () => {
    renderApp('/entrar');

    expect(await screen.findByRole('heading', { level: 1, name: ptBR.login.title })).toBeTruthy();
    const email = screen.getByLabelText(ptBR.login.email);
    const password = screen.getByLabelText(ptBR.login.password);
    expect(email.getAttribute('type')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByRole('button', { name: ptBR.password.show })).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.login.forgot }).getAttribute('href')).toBe(
      '/redefinir',
    );
    expect(screen.getByRole('link', { name: ptBR.login.signUp }).getAttribute('href')).toBe(
      '/cadastro',
    );
    expect(await screen.findByRole('button', { name: 'Continuar com Google' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe(`${ptBR.login.title} · Escola Aurora`));
    await expectNoAxeViolations();
  });

  it('entra, guarda a sessão e vai para /inicio', async () => {
    const { router, calls } = renderApp(
      '/entrar',
      apiRoutes({ 'POST /api/v1/auth/login': () => jsonResponse(SESSION) }),
    );
    await fillAndSubmit(' ana@exemplo.test ');

    await waitFor(() => expect(router.state.location.pathname).toBe('/inicio'));
    const login = calls.find((call) => call.path === '/api/v1/auth/login');
    expect(login?.body).toEqual({ email: 'ana@exemplo.test', password: 'senha-de-teste' });
    expect(
      await screen.findByRole('button', { name: `Menu da conta de ${SESSION.user.name}` }),
    ).toBeTruthy();
  });

  it('volta ao destino guardado em ?destino=, e ignora destino de outro site', async () => {
    const view = renderApp(
      '/entrar?destino=%2Fplanos%3Fx%3D1',
      apiRoutes({ 'POST /api/v1/auth/login': () => jsonResponse(SESSION) }),
    );
    expect(
      (await screen.findByRole('link', { name: ptBR.login.signUp })).getAttribute('href'),
    ).toBe('/cadastro?destino=%2Fplanos%3Fx%3D1');
    await fillAndSubmit();
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/planos'));
    expect(view.router.state.location.search).toBe('?x=1');
    view.unmount();

    const other = renderApp(
      '/entrar?destino=%2F%2Fmal.test%2Fx',
      apiRoutes({ 'POST /api/v1/auth/login': () => jsonResponse(SESSION) }),
    );
    await fillAndSubmit();
    await waitFor(() => expect(other.router.state.location.pathname).toBe('/inicio'));
  });

  it('confere os campos no navegador antes de enviar', async () => {
    const { calls } = renderApp('/entrar', apiRoutes({}));
    const { user } = await fillAndSubmit('', '');

    const email = screen.getByLabelText(ptBR.login.email);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(ptBR.login.errors.emailRequired)).toBeTruthy();
    expect(screen.getByText(ptBR.login.errors.passwordRequired)).toBeTruthy();
    expect(document.activeElement).toBe(email);

    await user.type(email, 'sem-arroba');
    await user.click(screen.getByRole('button', { name: ptBR.login.submit }));
    expect(screen.getByText(ptBR.login.errors.emailInvalid)).toBeTruthy();
    expect(calls.some((call) => call.path === '/api/v1/auth/login')).toBe(false);
  });

  it.each([
    [401, 'invalid_credentials', ptBR.login.errors.invalidCredentials],
    [403, 'account_suspended', ptBR.login.errors.accountSuspended],
  ])('mostra o erro %s %s', async (status, code, message) => {
    const { router } = renderApp(
      '/entrar',
      apiRoutes({ 'POST /api/v1/auth/login': () => problemResponse(status, code) }),
    );
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(alert.textContent).toContain('Código da requisição: req-teste-1');
    expect(router.state.location.pathname).toBe('/entrar');
    // o 401 do login não é "sessão vencida": o site continua como visitante, na mesma tela
    expect(screen.getByRole('link', { name: ptBR.shell.signIn })).toBeTruthy();
  });

  it('too_many_attempts mostra o tempo restante do Retry-After', async () => {
    const view = renderApp(
      '/entrar',
      apiRoutes({
        'POST /api/v1/auth/login': () =>
          problemResponse(429, 'too_many_attempts', { headers: { 'Retry-After': '840' } }),
      }),
    );
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Por segurança, tente de novo em 14 minutos.',
    );
    view.unmount();

    renderApp(
      '/entrar',
      apiRoutes({ 'POST /api/v1/auth/login': () => problemResponse(429, 'too_many_attempts') }),
    );
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toContain(
      ptBR.login.errors.tooManyAttemptsNoTime,
    );
  });

  it('com a rota ainda inexistente na API (404) mostra um erro tratado', async () => {
    renderApp('/entrar', apiRoutes({}));
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toContain(ptBR.errors.notAvailable);
    expect(screen.getByRole('heading', { level: 1, name: ptBR.login.title })).toBeTruthy();
  });

  it('sem resposta do servidor mostra o erro de conexão', async () => {
    renderApp(
      '/entrar',
      apiRoutes({
        'POST /api/v1/auth/login': () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    );
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toContain(ptBR.errors.network);
  });

  it.each(Object.entries(ptBR.login.oauth.codes))(
    'mostra o código ?erro=%s da volta do login social',
    async (code, message) => {
      renderApp(`/entrar?erro=${code === 'unknown' ? 'outro_codigo' : code}`);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(ptBR.login.oauth.title);
      expect(alert.textContent).toContain(message);
    },
  );

  it('mostra o aviso de senha redefinida', async () => {
    renderApp('/entrar?aviso=senha-redefinida');
    const notice = await screen.findByText(ptBR.login.notices.passwordReset);
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it('quem já entrou vai direto para o destino', async () => {
    const { router } = renderApp('/entrar?destino=/planos', undefined, { session: SESSION });
    await waitFor(() => expect(router.state.location.pathname).toBe('/planos'));
  });
});
