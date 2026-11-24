import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, withMeta } from '../test/api';
import { findAlert, jsonResponse, META, queryAlerts, renderApp } from '../test/render';

const PROBLEM = {
  type: 'about:blank',
  title: 'Banco de dados indisponível',
  status: 503,
  code: 'database_unavailable',
  requestId: 'req-123',
};

describe('página inicial', () => {
  it('mostra "carregando" e depois os dados de /api/v1/meta', async () => {
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { fetchMock } = renderApp('/', { ...defaultRoutes(), 'GET /api/v1/meta': () => pending });

    expect(
      (await screen.findByText('Carregando os dados da instalação…')).closest('[role="status"]'),
    ).toBeTruthy();

    release(jsonResponse(META));
    const section = (await screen.findByRole('heading', { level: 2, name: 'Instalação' })).closest(
      'section',
    ) as HTMLElement;
    expect(await within(section).findByText('0.1.0')).toBeTruthy();
    expect(within(section).getByText('Escola Aurora')).toBeTruthy();
    expect(within(section).getByText('BRL')).toBeTruthy();
    expect(within(section).getByText('pt-BR')).toBeTruthy();
    expect(within(section).getByText('Google')).toBeTruthy();
    expect(screen.queryByText('Carregando os dados da instalação…')).toBeNull();

    const paths = fetchMock.mock.calls.map(([input]) => new URL((input as Request).url).pathname);
    expect(paths).toContain('/api/v1/meta');
  });

  it('avisa quando não há login social configurado', async () => {
    renderApp('/', withMeta({ authProviders: [] }));
    expect(await screen.findByText('Nenhum provedor configurado')).toBeTruthy();
  });

  it('mostra o erro com o código da requisição e tenta de novo pelo botão', async () => {
    const user = userEvent.setup();
    let healthy = false;
    renderApp('/', {
      ...defaultRoutes(),
      'GET /api/v1/meta': () =>
        healthy ? jsonResponse(META) : jsonResponse(PROBLEM, 503, { 'X-Request-Id': 'req-123' }),
    });

    const alert = await findAlert();
    expect(
      within(alert).getByText('Não foi possível carregar os dados da instalação'),
    ).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-123')).toBeTruthy();

    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(queryAlerts()).toEqual([]));
    expect(await screen.findByText('0.1.0')).toBeTruthy();
  });
});
