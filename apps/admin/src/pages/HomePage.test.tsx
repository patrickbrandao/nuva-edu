import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, META, renderApp } from '../test/render';

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
    const { fetchMock } = renderApp('/', () => pending);

    expect(screen.getByRole('status').textContent).toBe('Carregando os dados da instalação…');

    release(jsonResponse(META));
    const section = (await screen.findByRole('heading', { level: 2, name: 'Instalação' })).closest(
      'section',
    ) as HTMLElement;
    expect(await within(section).findByText('0.1.0')).toBeTruthy();
    expect(within(section).getByText('Escola Aurora')).toBeTruthy();
    expect(within(section).getByText('BRL')).toBeTruthy();
    expect(within(section).getByText('pt-BR')).toBeTruthy();
    expect(within(section).getByText('Google')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/v1/meta');
  });

  it('avisa quando não há login social configurado', async () => {
    renderApp('/', () => jsonResponse({ ...META, authProviders: [] }));
    expect(await screen.findByText('Nenhum provedor configurado')).toBeTruthy();
  });

  it('mostra o erro com o código da requisição e tenta de novo pelo botão', async () => {
    const user = userEvent.setup();
    let healthy = false;
    renderApp('/', () =>
      healthy ? jsonResponse(META) : jsonResponse(PROBLEM, 503, { 'X-Request-Id': 'req-123' }),
    );

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Não foi possível carregar os dados da instalação'),
    ).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-123')).toBeTruthy();

    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('0.1.0')).toBeTruthy();
  });
});
