import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCsrfToken } from '../api/csrf';
import { browser } from '../session/browser';
import { calls, defaultRoutes, problem, type Routes, sessionFor, withMeta } from '../test/api';
import { CONFIG, findAlert, findMenu, META, queryAlerts, renderApp } from '../test/render';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Rotas de quem ainda não entrou: a sessão responde `401`. */
function signedOut(extra: Routes = {}): Routes {
  return {
    ...defaultRoutes(),
    'GET /api/v1/session': () => problem(401, 'unauthenticated'),
    ...extra,
  };
}

async function fillAndSubmit(email = 'ana@escola.test', password = 'senha-certa') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('E-mail'), email);
  await user.type(screen.getByLabelText('Senha'), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  return user;
}

describe('tela de entrada', () => {
  it('tem os campos rotulados, sem menu, com tema, rodapé e "esqueci a senha"', async () => {
    const { fetchMock } = renderApp('/entrar', signedOut());

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeTruthy();
    expect(screen.getByLabelText('E-mail').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Mostrar senha' })).toBeTruthy();
    expect(await screen.findByText('Escola Aurora')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('group', { name: 'Tema da página' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Código-fonte/ })).toBeTruthy();

    const forgot = await screen.findByRole('link', { name: 'Esqueci a senha' });
    expect(forgot.getAttribute('href')).toBe(`${CONFIG.classroomUrl}/redefinir`);

    // Só os dados públicos: a tela de entrada não pede a sessão.
    expect(new Set(calls(fetchMock))).toEqual(new Set(['GET /api/v1/meta']));
  });

  it('sem /config.json, esconde o "esqueci a senha"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderApp('/entrar', signedOut(), { config: () => new Response('', { status: 404 }) });
    expect(await screen.findByText('Escola Aurora')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Esqueci a senha' })).toBeNull();
  });

  it('pede e-mail e senha antes de enviar', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderApp('/entrar', signedOut());
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByText('Informe o e-mail.')).toBeTruthy();
    expect(screen.getByText('Informe a senha.')).toBeTruthy();
    expect(calls(fetchMock)).not.toContain('POST /api/v1/auth/login');
  });

  it('entra, guarda o token CSRF e volta ao destino guardado', async () => {
    let body: unknown;
    const { router } = renderApp(
      '/entrar?destino=%2Fequipe',
      signedOut({
        'POST /api/v1/auth/login': async (request: Request) => {
          body = await request.json();
          return new Response(JSON.stringify(sessionFor('admin')), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      }),
    );
    await fillAndSubmit(' ana@escola.test ', 'senha-certa');

    await waitFor(() => expect(router.state.location.pathname).toBe('/equipe'));
    expect(body).toEqual({ email: 'ana@escola.test', password: 'senha-certa' });
    expect(getCsrfToken()).toBe('csrf-admin');
    expect(await findMenu()).toBeTruthy();
  });

  it('ignora destino que sai do site', async () => {
    const { router } = renderApp(
      '/entrar?destino=%2F%2Fmal.test%2Fx',
      signedOut({ 'POST /api/v1/auth/login': sessionFor('admin') }),
    );
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it.each([
    ['invalid_credentials', 401, 'E-mail ou senha incorretos.'],
    ['account_suspended', 403, 'Sua conta está suspensa. Fale com a administração da escola.'],
    ['validation_failed', 400, 'Confira o e-mail e a senha.'],
  ])('mostra a recusa %s', async (code, status, message) => {
    renderApp('/entrar', signedOut({ 'POST /api/v1/auth/login': () => problem(status, code) }));
    await fillAndSubmit();
    const alert = await findAlert();
    expect(alert.textContent).toContain(message);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
  });

  it('staff_only: "sem acesso ao painel" com link para o classroom', async () => {
    renderApp(
      '/entrar',
      signedOut({ 'POST /api/v1/auth/login': () => problem(403, 'staff_only') }),
    );
    await screen.findByRole('link', { name: 'Esqueci a senha' });
    await fillAndSubmit();
    const alert = await findAlert();
    expect(within(alert).getByText('Sem acesso ao painel')).toBeTruthy();
    expect(
      within(alert).getByRole('link', { name: 'Ir para a área do aluno' }).getAttribute('href'),
    ).toBe(CONFIG.classroomUrl);
  });

  it('too_many_attempts: diz em quantos minutos tentar de novo (Retry-After)', async () => {
    renderApp(
      '/entrar',
      signedOut({
        'POST /api/v1/auth/login': () =>
          problem(429, 'too_many_attempts', { retryAfterSeconds: 840 }, { 'Retry-After': '840' }),
      }),
    );
    await fillAndSubmit();
    expect((await findAlert()).textContent).toContain(
      'Muitas tentativas erradas. Tente de novo em 14 minutos.',
    );
  });

  it('erro inesperado mostra o código da requisição', async () => {
    renderApp(
      '/entrar',
      signedOut({ 'POST /api/v1/auth/login': () => problem(500, 'internal_error') }),
    );
    await fillAndSubmit();
    const text = (await findAlert()).textContent ?? '';
    expect(text).toContain('O servidor não respondeu como esperado.');
    expect(text).toContain('Código da requisição: req-internal_error');
  });

  it('com a rota ainda ausente (404), mostra erro tratado', async () => {
    renderApp('/entrar', signedOut());
    await fillAndSubmit();
    expect((await findAlert()).textContent).toContain('O servidor não respondeu como esperado.');
  });

  it.each([
    ['oauth_state_invalid', 'O login com o provedor expirou ou foi interrompido. Tente de novo.'],
    ['oauth_denied', 'O login foi cancelado no provedor.'],
    ['oauth_provider_error', 'O provedor não respondeu como esperado.'],
    ['account_suspended', 'Sua conta está suspensa.'],
    ['staff_only', 'Sem acesso ao painel'],
    ['outro_codigo', 'Não foi possível entrar com o provedor. Tente de novo.'],
  ])('mostra o erro do retorno do provedor ?erro=%s', async (code, message) => {
    renderApp(`/entrar?erro=${code}`, signedOut());
    expect((await findAlert()).textContent).toContain(message);
  });

  it('sem erro na URL, não há aviso', async () => {
    renderApp('/entrar', signedOut());
    await screen.findByText('Escola Aurora');
    expect(queryAlerts()).toEqual([]);
  });

  it('botões dos provedores ligados navegam para o início do login social com o destino', async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {});
    const { fetchMock } = renderApp(
      '/entrar?destino=%2Falunos',
      withMeta({ authProviders: ['google', 'apple'] }),
    );
    await user.click(await screen.findByRole('button', { name: 'Entrar com Google' }));
    expect(screen.getByRole('button', { name: 'Entrar com Apple' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Entrar com Facebook' })).toBeNull();
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/google/start?returnTo=%2Falunos');
    // Navegação de página, nunca `fetch`.
    expect(calls(fetchMock).some((call) => call.includes('/auth/google'))).toBe(false);
  });

  it('sem provedores configurados, não há botões de login social', async () => {
    renderApp('/entrar', withMeta({ authProviders: [] }));
    await screen.findByText('Escola Aurora');
    expect(screen.queryByRole('button', { name: /^Entrar com/ })).toBeNull();
    expect(META.authProviders).toEqual(['google']);
  });
});
