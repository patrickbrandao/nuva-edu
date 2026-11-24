import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { apiRoutes, jsonResponse, problemResponse, renderApp } from '../test/renderApp';

const DOC = {
  id: '0193a5b2-0000-7000-8000-000000000001',
  document: 'terms',
  version: 3,
  bodyMd: '# Uso da plataforma\n\nTexto **importante** com <script>alert(1)</script>.',
  effectiveAt: '2026-11-01T12:00:00Z',
};

describe('termos e privacidade', () => {
  it('/termos mostra a versão vigente em Markdown higienizado', async () => {
    const { calls } = renderApp(
      '/termos',
      apiRoutes({ 'GET /api/v1/legal/terms': () => jsonResponse(DOC) }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: ptBR.pages.terms })).toBeTruthy();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Uso da plataforma' }),
    ).toBeTruthy();
    expect(screen.getByText('Versão 3, em vigor desde 1 de novembro de 2026.')).toBeTruthy();
    expect(screen.getByText('importante').tagName).toBe('STRONG');
    expect(document.querySelector('main script')).toBeNull();
    expect(calls.some((call) => call.path === '/api/v1/legal/terms')).toBe(true);
    await waitFor(() => expect(document.title).toBe(`${ptBR.pages.terms} · Escola Aurora`));
    await expectNoAxeViolations();
  });

  it('/privacidade sem versão publicada (404) mostra o aviso', async () => {
    renderApp('/privacidade', apiRoutes({}));
    expect(await screen.findByText(ptBR.legal.missingTitle)).toBeTruthy();
    expect(screen.getByText(ptBR.legal.missingText)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha do servidor mostra o erro e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      '/termos',
      apiRoutes({
        'GET /api/v1/legal/terms': () =>
          fail ? problemResponse(503, 'database_unavailable') : jsonResponse(DOC),
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.legal.errorTitle);
    expect(alert.textContent).toContain('Código da requisição: req-teste-1');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Uso da plataforma' }),
    ).toBeTruthy();
  });
});
