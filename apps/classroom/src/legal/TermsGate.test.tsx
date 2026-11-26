import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  noContent,
  problemResponse,
  renderApp,
} from '../test/renderApp';

const PENDING = [
  {
    id: '0193a5b2-0000-7000-8000-000000000011',
    document: 'terms' as const,
    version: 4,
    effectiveAt: '2026-11-20T12:00:00Z',
  },
  {
    id: '0193a5b2-0000-7000-8000-000000000012',
    document: 'privacy' as const,
    version: 2,
    effectiveAt: '2026-11-20T12:00:00Z',
  },
];

function sessionApi(accept: () => Response) {
  let accepted = false;
  return apiRoutes({
    'GET /api/v1/session': () =>
      jsonResponse(makeSession({ termsPending: accepted ? [] : PENDING })),
    'POST /api/v1/me/terms-acceptance': () => {
      const response = accept();
      if (response.status === 204) accepted = true;
      return response;
    },
  });
}

describe('aceite de termos pendentes', () => {
  it('bloqueia as páginas até aceitar; aceito, a página volta', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp('/planos', sessionApi(noContent), { session: 'fetch' });

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.termsGate.title }),
    ).toBeTruthy();
    expect(screen.queryByText(ptBR.construction.title)).toBeNull();
    expect(screen.getByRole('link', { name: /Termos de uso \(versão 4\)/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Política de privacidade \(versão 2\)/ })).toBeTruthy();
    await expectNoAxeViolations();

    // sem marcar a caixa, não envia
    const main = within(screen.getByRole('main'));
    await user.click(main.getByRole('button', { name: ptBR.termsGate.submit }));
    expect(screen.getByText(ptBR.termsGate.required)).toBeTruthy();
    expect(calls.some((call) => call.path === '/api/v1/me/terms-acceptance')).toBe(false);

    await user.click(main.getByRole('checkbox', { name: ptBR.terms.accept }));
    await user.click(main.getByRole('button', { name: ptBR.termsGate.submit }));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: ptBR.subscriptions.plans.title,
      }),
    ).toBeTruthy();
    const accept = calls.find((call) => call.path === '/api/v1/me/terms-acceptance');
    expect(accept?.body).toEqual({ termsVersionIds: PENDING.map((version) => version.id) });
    expect(accept?.csrf).toBe('csrf-teste-1');
  });

  it('as páginas dos próprios termos continuam abertas', async () => {
    renderApp('/termos', sessionApi(noContent), { session: 'fetch' });
    expect(await screen.findByRole('heading', { level: 1, name: ptBR.pages.terms })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(ptBR.termsGate.title)).toBeNull());
  });

  it('terms_version_outdated (422) pede o aceite de novo com as versões atuais', async () => {
    const user = userEvent.setup();
    renderApp(
      '/',
      sessionApi(() => problemResponse(422, 'terms_version_outdated')),
      { session: 'fetch' },
    );
    const main = within(screen.getByRole('main'));
    await user.click(await main.findByRole('checkbox', { name: ptBR.terms.accept }));
    await user.click(main.getByRole('button', { name: ptBR.termsGate.submit }));
    expect(await screen.findByText(ptBR.termsGate.outdated)).toBeTruthy();
    expect(
      (main.getByRole('checkbox', { name: ptBR.terms.accept }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('com a rota ainda inexistente (404) mostra um erro tratado e continua na tela', async () => {
    const user = userEvent.setup();
    renderApp(
      '/',
      sessionApi(() => new Response('{}', { status: 404 })),
      { session: 'fetch' },
    );
    const main = within(screen.getByRole('main'));
    await user.click(await main.findByRole('checkbox', { name: ptBR.terms.accept }));
    await user.click(main.getByRole('button', { name: ptBR.termsGate.submit }));
    expect((await findAlert()).textContent).toContain(ptBR.errors.notAvailable);
    expect(screen.getByRole('heading', { level: 1, name: ptBR.termsGate.title })).toBeTruthy();
  });

  it('"Sair" na tela de aceite encerra a sessão', async () => {
    const user = userEvent.setup();
    renderApp(
      '/',
      apiRoutes({
        'GET /api/v1/session': () => jsonResponse(makeSession({ termsPending: PENDING })),
        'POST /api/v1/auth/logout': () => noContent(),
      }),
      { session: 'fetch' },
    );
    const main = within(screen.getByRole('main'));
    await user.click(await main.findByRole('button', { name: ptBR.shell.signOut }));
    expect(await screen.findByRole('link', { name: ptBR.shell.signIn })).toBeTruthy();
    expect(screen.queryByText(ptBR.termsGate.title)).toBeNull();
  });
});
