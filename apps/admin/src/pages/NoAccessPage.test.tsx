import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG, jsonResponse, META, renderApp } from '../test/render';
import { NoAccessPage } from './NoAccessPage';

// A tela ainda não tem rota: quem a mostra é a guarda de sessão, que chega com a spec 007.
const ROUTES = [{ path: '/', element: <NoAccessPage /> }];
const LINK = { name: 'Ir para a área do aluno' };

function open(config?: () => Response | Promise<Response>) {
  return renderApp('/', () => jsonResponse(META), { routes: ROUTES, config });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tela "sem acesso ao painel"', () => {
  it('leva ao classroom pelo endereço do /config.json', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    open();

    expect(screen.getByRole('heading', { level: 1, name: 'Sem acesso ao painel' })).toBeTruthy();
    const link = await screen.findByRole('link', LINK);
    expect(link.getAttribute('href')).toBe(CONFIG.classroomUrl);
    await waitFor(() => expect(document.title).toBe('Sem acesso ao painel · Escola Aurora'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('sem o arquivo (index.html no lugar), a tela abre sem o link e avisa no console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { configFetchMock } = open(
      () =>
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    );

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(configFetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Sem acesso ao painel' })).toBeTruthy();
    expect(screen.queryByRole('link', LINK)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sem o campo classroomUrl, a tela abre sem o link', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    open(() => jsonResponse({ app: 'admin', adminUrl: CONFIG.adminUrl }));

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('link', LINK)).toBeNull();
  });

  it('com o arquivo fora do ar (rede), a tela abre sem o link', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    open(() => Promise.reject(new TypeError('Failed to fetch')));

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('link', LINK)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('carga do site', () => {
  it('busca o /config.json uma vez ao abrir, junto com o /api/v1/meta', async () => {
    const { fetchMock, configFetchMock } = renderApp('/');

    expect(await screen.findByText('0.1.0')).toBeTruthy();
    expect(configFetchMock).toHaveBeenCalledTimes(1);
    expect(configFetchMock.mock.calls[0]?.[0]).toBe('/config.json');
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/v1/meta');
  });

  it('abre o painel mesmo sem o /config.json', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderApp('/', () => jsonResponse(META), { config: () => new Response('', { status: 404 }) });

    expect(await screen.findByText('0.1.0')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  });
});
