import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { apiRoutes, makeSession, noContent, problemResponse, renderApp } from '../test/renderApp';

const UNVERIFIED = makeSession({ user: { emailVerified: false } });

describe('faixa "confirme seu e-mail"', () => {
  it('aparece só para quem não confirmou', async () => {
    const view = renderApp('/', undefined, { session: makeSession() });
    await screen.findByRole('button', { name: 'Menu da conta de Ana Souza' });
    expect(screen.queryByText(ptBR.verifyEmail.title)).toBeNull();
    view.unmount();

    renderApp('/', undefined, { session: UNVERIFIED });
    expect(await screen.findByText(ptBR.verifyEmail.title)).toBeTruthy();
    expect(screen.getByText(/Enviamos um link de confirmação para ana@exemplo.test/)).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('reenvia o link e anuncia o resultado', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/',
      apiRoutes({ 'POST /api/v1/auth/email/resend': () => noContent() }),
      { session: UNVERIFIED },
    );
    await user.click(await screen.findByRole('button', { name: ptBR.verifyEmail.resend }));
    const status = await screen.findByText('Enviamos um novo link para ana@exemplo.test.');
    expect(status.getAttribute('role')).toBe('status');
    expect(calls.find((call) => call.path === '/api/v1/auth/email/resend')?.csrf).toBe(
      'csrf-teste-1',
    );
  });

  it('rate_limited (429) diz quanto esperar', async () => {
    const user = userEvent.setup();
    renderApp(
      '/',
      apiRoutes({
        'POST /api/v1/auth/email/resend': () =>
          problemResponse(429, 'rate_limited', { headers: { 'Retry-After': '1800' } }),
      }),
      { session: UNVERIFIED },
    );
    await user.click(await screen.findByRole('button', { name: ptBR.verifyEmail.resend }));
    expect(
      await screen.findByText(
        'Você já pediu vários links na última hora. Tente de novo em 30 minutos.',
      ),
    ).toBeTruthy();
  });

  it('com a rota ainda inexistente (404) mostra um erro tratado', async () => {
    const user = userEvent.setup();
    renderApp('/', apiRoutes({}), { session: UNVERIFIED });
    const banner = (await screen.findByText(ptBR.verifyEmail.title)).closest('div') as HTMLElement;
    await user.click(await screen.findByRole('button', { name: ptBR.verifyEmail.resend }));
    expect(await within(document.body).findByText(ptBR.errors.notAvailable)).toBeTruthy();
    expect(banner).toBeTruthy();
  });

  it('sessão vencida (401 unauthenticated numa escrita) volta o site a visitante', async () => {
    const user = userEvent.setup();
    renderApp(
      '/',
      apiRoutes({
        'POST /api/v1/auth/email/resend': () => problemResponse(401, 'unauthenticated'),
      }),
      { session: UNVERIFIED },
    );
    await user.click(await screen.findByRole('button', { name: ptBR.verifyEmail.resend }));
    expect(await screen.findByRole('link', { name: ptBR.shell.signIn })).toBeTruthy();
    expect(screen.queryByText(ptBR.verifyEmail.title)).toBeNull();
  });
});
