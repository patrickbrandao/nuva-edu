import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { jsonResponse, META, renderApp, unavailableResponse } from '../test/renderApp';

const about = () =>
  screen.getByRole('heading', { level: 2, name: ptBR.home.about.title }).closest('section');

describe('vitrine', () => {
  it('mostra o estado de carregando enquanto /api/v1/meta não responde', async () => {
    const { requests } = renderApp('/', () => new Promise<Response>(() => {}));

    expect(screen.getByRole('status').textContent).toBe(ptBR.home.about.loading);
    expect(screen.getByRole('heading', { level: 1, name: ptBR.home.welcome })).toBeTruthy();
    await waitFor(() => expect(requests).toEqual(['/api/v1/meta']));
    expect(document.title).toBe(`${ptBR.home.title} · ${ptBR.app.name}`);
  });

  it('mostra os dados da escola, a vitrine vazia e o título da página', async () => {
    renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: META.schoolName })).toBeTruthy();
    const section = about();
    expect(section).not.toBeNull();
    const details = within(section as HTMLElement);
    expect(details.getByText(META.version)).toBeTruthy();
    expect(details.getByText('Real brasileiro (BRL)')).toBeTruthy();
    expect(details.getByText('português (Brasil)')).toBeTruthy();
    expect(details.getByText(`${ptBR.home.about.emailAndPassword}, Google`)).toBeTruthy();

    // vitrine vazia: estado vazio com uma ação sugerida (spec 006, RF-09)
    expect(screen.getByText(ptBR.home.catalog.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.home.catalog.action }).getAttribute('href')).toBe(
      '/cadastro',
    );

    // título, descrição e Open Graph por página (ADR 0018)
    const description = `Cursos, pacotes, ebooks e planos de ${META.schoolName}.`;
    await waitFor(() => expect(document.title).toBe(`${ptBR.home.title} · ${META.schoolName}`));
    const content = (selector: string) =>
      document.head.querySelector(selector)?.getAttribute('content');
    expect(content('meta[name="description"]')).toBe(description);
    expect(content('meta[property="og:title"]')).toBe(document.title);
    expect(content('meta[property="og:description"]')).toBe(description);
  });

  it('mostra o erro com o código da requisição e tenta de novo', async () => {
    const user = userEvent.setup();
    let calls = 0;
    renderApp('/', async () => {
      calls += 1;
      return calls === 1 ? unavailableResponse() : jsonResponse(META);
    });

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(ptBR.home.about.errorTitle)).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-teste-1')).toBeTruthy();
    // o restante da página continua de pé
    expect(screen.getByText(ptBR.home.catalog.emptyTitle)).toBeTruthy();

    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await screen.findByRole('heading', { level: 1, name: META.schoolName })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
