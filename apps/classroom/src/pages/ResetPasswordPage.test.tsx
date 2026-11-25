import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { apiRoutes, findAlert, noContent, problemResponse, renderApp } from '../test/renderApp';

const mainButton = (name: string) => within(screen.getByRole('main')).getByRole('button', { name });

describe('redefinir senha: pedir o link', () => {
  it('envia o e-mail e mostra sempre a mesma resposta', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/redefinir',
      apiRoutes({ 'POST /api/v1/auth/password/forgot': () => noContent() }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: ptBR.reset.title })).toBeTruthy();
    await expectNoAxeViolations();

    await user.type(screen.getByLabelText(ptBR.reset.email), 'ana@exemplo.test');
    await user.click(mainButton(ptBR.reset.submit));
    expect(await screen.findByText(ptBR.reset.sentTitle)).toBeTruthy();
    expect(screen.getByText(/Se houver uma conta com ana@exemplo.test, enviamos/)).toBeTruthy();
    expect(calls.find((call) => call.path === '/api/v1/auth/password/forgot')?.body).toEqual({
      email: 'ana@exemplo.test',
    });
  });

  it('confere o e-mail antes de enviar', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp('/redefinir', apiRoutes({}));
    await user.click(await screen.findByRole('button', { name: ptBR.reset.submit }));
    expect(screen.getByText(ptBR.reset.errors.emailInvalid)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(ptBR.reset.email));
    expect(calls.some((call) => call.path === '/api/v1/auth/password/forgot')).toBe(false);
  });

  it('com a rota ainda inexistente (404) mostra um erro tratado', async () => {
    const user = userEvent.setup();
    renderApp('/redefinir', apiRoutes({}));
    await user.type(await screen.findByLabelText(ptBR.reset.email), 'ana@exemplo.test');
    await user.click(mainButton(ptBR.reset.submit));
    expect((await findAlert()).textContent).toContain(ptBR.errors.notAvailable);
  });

  it('limite de taxa (429) mostra o tempo de espera', async () => {
    const user = userEvent.setup();
    renderApp(
      '/redefinir',
      apiRoutes({
        'POST /api/v1/auth/password/forgot': () =>
          problemResponse(429, 'rate_limited', { retryAfterSeconds: 30 }),
      }),
    );
    await user.type(await screen.findByLabelText(ptBR.reset.email), 'ana@exemplo.test');
    await user.click(mainButton(ptBR.reset.submit));
    expect((await findAlert()).textContent).toContain(
      'Muitas tentativas seguidas. Tente de novo em 30 segundos.',
    );
  });
});

describe('redefinir senha: nova senha pelo link', () => {
  it('define a senha e leva a /entrar com o aviso', async () => {
    const user = userEvent.setup();
    const { router, calls } = renderApp(
      '/redefinir?token=tok_1',
      apiRoutes({ 'POST /api/v1/auth/password/reset': () => noContent() }),
    );
    const field = await screen.findByLabelText(ptBR.reset.newPassword);
    expect(field.getAttribute('autocomplete')).toBe('new-password');
    await expectNoAxeViolations();

    await user.type(field, 'nova-senha-1');
    await user.click(mainButton(ptBR.reset.save));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(calls.find((call) => call.path === '/api/v1/auth/password/reset')?.body).toEqual({
      token: 'tok_1',
      password: 'nova-senha-1',
    });
    expect(await screen.findByText(ptBR.login.notices.passwordReset)).toBeTruthy();
  });

  it('senha curta é recusada no navegador; password_invalid (400) também marca o campo', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/redefinir?token=tok_1',
      apiRoutes({
        'POST /api/v1/auth/password/reset': () => problemResponse(400, 'password_invalid'),
      }),
    );
    const field = await screen.findByLabelText(ptBR.reset.newPassword);
    await user.type(field, 'curta');
    await user.click(mainButton(ptBR.reset.save));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(calls.some((call) => call.path === '/api/v1/auth/password/reset')).toBe(false);

    await user.type(field, '-agora-longa');
    await user.click(mainButton(ptBR.reset.save));
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/v1/auth/password/reset')).toBe(true),
    );
    expect(await screen.findByText(ptBR.password.invalid)).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('token_expired (410) oferece pedir um novo link', async () => {
    const user = userEvent.setup();
    renderApp(
      '/redefinir?token=velho',
      apiRoutes({
        'POST /api/v1/auth/password/reset': () => problemResponse(410, 'token_expired'),
      }),
    );
    await user.type(await screen.findByLabelText(ptBR.reset.newPassword), 'nova-senha-1');
    await user.click(mainButton(ptBR.reset.save));
    expect((await findAlert()).textContent).toContain(ptBR.reset.expiredTitle);
    expect(
      within(screen.getByRole('main'))
        .getByRole('link', { name: ptBR.reset.requestAgain })
        .getAttribute('href'),
    ).toBe('/redefinir');
  });

  it('com a rota ainda inexistente (404) mostra um erro tratado', async () => {
    const user = userEvent.setup();
    renderApp('/redefinir?token=tok', apiRoutes({}));
    await user.type(await screen.findByLabelText(ptBR.reset.newPassword), 'nova-senha-1');
    await user.click(mainButton(ptBR.reset.save));
    expect((await findAlert()).textContent).toContain(ptBR.errors.notAvailable);
  });
});
