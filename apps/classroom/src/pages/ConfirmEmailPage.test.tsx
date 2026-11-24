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

const verifyCalls = (calls: { path: string }[]) =>
  calls.filter((call) => call.path === '/api/v1/auth/email/verify');

describe('confirmação de e-mail', () => {
  it('confirma o token do link uma vez só e oferece entrar', async () => {
    const { calls } = renderApp(
      '/confirmar?token=abc_123',
      apiRoutes({ 'POST /api/v1/auth/email/verify': () => noContent() }),
    );
    expect(await screen.findByText(ptBR.confirm.successTitle)).toBeTruthy();
    expect(verifyCalls(calls)).toHaveLength(1);
    expect(verifyCalls(calls)[0]).toMatchObject({ method: 'POST', body: { token: 'abc_123' } });
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: ptBR.confirm.signIn }).getAttribute('href')).toBe(
      '/entrar?destino=%2Finicio',
    );
    await expectNoAxeViolations();
  });

  it('com sessão, atualiza a sessão e leva a /inicio; a faixa de confirmação some', async () => {
    let verified = false;
    renderApp(
      '/confirmar?token=abc',
      apiRoutes({
        'GET /api/v1/session': () =>
          jsonResponse(makeSession({ user: { emailVerified: verified } })),
        'POST /api/v1/auth/email/verify': () => {
          verified = true;
          return noContent();
        },
      }),
      { session: 'fetch' },
    );
    expect(await screen.findByText(ptBR.confirm.successTitle)).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: ptBR.confirm.continue }).getAttribute('href')).toBe(
      '/inicio',
    );
    await waitFor(() => expect(screen.queryByText(ptBR.verifyEmail.title)).toBeNull());
  });

  it('token_expired (410) sem sessão orienta a entrar para pedir outro link', async () => {
    renderApp(
      '/confirmar?token=velho',
      apiRoutes({ 'POST /api/v1/auth/email/verify': () => problemResponse(410, 'token_expired') }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.confirm.expiredTitle);
    expect(alert.textContent).toContain(ptBR.confirm.expiredTextSignedOut);
  });

  it('token_expired com sessão não confirmada oferece um novo link', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/confirmar?token=velho',
      apiRoutes({
        'POST /api/v1/auth/email/verify': () => problemResponse(410, 'token_expired'),
        'POST /api/v1/auth/email/resend': () => noContent(),
      }),
      { session: makeSession({ user: { emailVerified: false } }) },
    );
    expect((await screen.findByRole('alert')).textContent).toContain(ptBR.confirm.expiredText);
    const main = within(screen.getByRole('main'));
    // o botão da faixa e o da tela fazem o mesmo; aqui, o da tela
    const buttons = main.getAllByRole('button', { name: ptBR.verifyEmail.resend });
    await user.click(buttons.at(-1) as HTMLElement);
    expect(await main.findByText('Enviamos um novo link para ana@exemplo.test.')).toBeTruthy();
    expect(calls.find((call) => call.path === '/api/v1/auth/email/resend')?.csrf).toBe(
      'csrf-teste-1',
    );
  });

  it('sem token mostra "link incompleto" e não chama a API', async () => {
    const { calls } = renderApp('/confirmar', apiRoutes({}));
    expect((await screen.findByRole('alert')).textContent).toContain(ptBR.confirm.missingTitle);
    expect(verifyCalls(calls)).toHaveLength(0);
  });

  it('com a rota ainda inexistente (404) mostra um erro tratado com "tentar de novo"', async () => {
    const user = userEvent.setup();
    let ready = false;
    renderApp(
      '/confirmar?token=abc',
      apiRoutes({
        'POST /api/v1/auth/email/verify': () =>
          ready ? noContent() : new Response('{}', { status: 404 }),
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.confirm.errorTitle);
    expect(alert.textContent).toContain(ptBR.errors.notAvailable);
    ready = true;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await screen.findByText(ptBR.confirm.successTitle)).toBeTruthy();
  });
});
