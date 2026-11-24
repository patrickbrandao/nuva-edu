import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { calls, defaultRoutes, PUBLISHED_TERMS, problem } from '../test/api';
import { findMenu, renderApp } from '../test/render';
import { MENU_ITEMS, type MenuItemId } from './menu';

/** Itens que o mapa de telas da spec 006 dá a `manager` ou a `admin`. */
const MANAGER_ITEMS: MenuItemId[] = [
  'students',
  'ebooks',
  'bundles',
  'orders',
  'subscriptions',
  'cases',
  'mcpKeys',
];
const ADMIN_ITEMS: MenuItemId[] = ['team', 'plans', 'coupons', 'audit', 'operations', 'settings'];

async function menuLinks(role: 'instructor' | 'manager' | 'admin'): Promise<string[]> {
  renderApp('/', defaultRoutes(role));
  const menu = await findMenu();
  return within(menu)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
}

const labels = (ids: MenuItemId[]) => ids.map((id) => ptBR.menu.items[id]);

describe('menu pelo papel (spec 006, RF-10; spec 008)', () => {
  it('instructor não vê itens de manager nem de admin', async () => {
    const links = await menuLinks('instructor');
    for (const label of [...labels(MANAGER_ITEMS), ...labels(ADMIN_ITEMS)]) {
      expect(links).not.toContain(label);
    }
    // O que é dele (◐, só os próprios cursos) continua à vista.
    expect(links).toEqual(
      expect.arrayContaining(['Painel', 'Cursos', 'Fórum', 'Denúncias', 'Chamados']),
    );
    expect(screen.queryByText(ptBR.menu.groups.sales)).toBeNull();
  });

  it('manager não vê itens de admin', async () => {
    const links = await menuLinks('manager');
    for (const label of labels(ADMIN_ITEMS)) expect(links).not.toContain(label);
    expect(links).toEqual(expect.arrayContaining(labels(MANAGER_ITEMS)));
  });

  it('admin vê todos os itens', async () => {
    const links = await menuLinks('admin');
    expect(links).toEqual(labels(MENU_ITEMS.map((item) => item.id)));
  });

  it('endereço aberto direto sem a ação mostra "sem permissão", sem chamar a tela', async () => {
    renderApp('/auditoria', defaultRoutes('manager'));
    await findMenu();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(screen.getByText('Seu papel não permite abrir esta tela.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar ao painel' })).toBeTruthy();
  });
});

describe('aviso de termos sem versão publicada (spec 030)', () => {
  const NONE = { items: [] };
  const DRAFT = {
    items: [{ ...PUBLISHED_TERMS.items[0], status: 'draft', version: null, publishedAt: null }],
  };

  function termsRoutes(terms: object, privacy: object) {
    return {
      ...defaultRoutes('admin'),
      'GET /api/v1/terms': (request: Request) =>
        new URL(request.url).searchParams.get('document') === 'terms' ? terms : privacy,
    };
  }

  it('aparece para o admin enquanto um documento não tem versão publicada', async () => {
    renderApp('/', termsRoutes(PUBLISHED_TERMS, DRAFT));
    const notice = (await screen.findByText('Documentos legais sem versão publicada')).closest(
      '.minui-alert',
    ) as HTMLElement;
    expect(within(notice).getByText(/Política de Privacidade/)).toBeTruthy();
    expect(within(notice).queryByText(/Termos de Uso/)).toBeNull();
    expect(
      within(notice).getByRole('link', { name: 'Publicar os termos' }).getAttribute('href'),
    ).toBe('/configuracoes/termos');
  });

  it('cita os dois documentos quando nenhum foi publicado', async () => {
    renderApp('/', termsRoutes(NONE, NONE));
    expect(await screen.findByText(/Termos de Uso e Política de Privacidade/)).toBeTruthy();
  });

  it('some com os dois publicados', async () => {
    const { fetchMock } = renderApp('/', termsRoutes(PUBLISHED_TERMS, PUBLISHED_TERMS));
    await findMenu();
    await screen.findByText('0.1.0');
    expect(calls(fetchMock).filter((call) => call === 'GET /api/v1/terms')).toHaveLength(2);
    expect(screen.queryByText('Documentos legais sem versão publicada')).toBeNull();
  });

  it('não aparece nem consulta para quem não tem settings.manage', async () => {
    const { fetchMock } = renderApp('/', {
      ...defaultRoutes('manager'),
      'GET /api/v1/terms': { items: [] },
    });
    await findMenu();
    await screen.findByText('0.1.0');
    expect(calls(fetchMock)).not.toContain('GET /api/v1/terms');
    expect(screen.queryByText('Documentos legais sem versão publicada')).toBeNull();
  });

  it('se a lista falhar (rota ausente), não há aviso nem erro na casca', async () => {
    renderApp('/', {
      ...defaultRoutes('admin'),
      'GET /api/v1/terms': () => problem(404, 'not_found'),
    });
    await findMenu();
    await screen.findByText('0.1.0');
    expect(screen.queryByText('Documentos legais sem versão publicada')).toBeNull();
  });
});
