import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../../locales/pt-BR.json';
import { defaultRoutes, problem, type Routes, sessionFor } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { findAlert, findMenu, renderApp } from '../../test/render';

const PUBLISHED = {
  id: '0193a5b2-0000-7000-8000-0000000000a1',
  document: 'terms',
  version: 1,
  status: 'published',
  requiresReacceptance: false,
  effectiveAt: '2026-11-01T12:00:00Z',
  publishedAt: '2026-11-01T12:00:00Z',
  createdAt: '2026-11-01T11:00:00Z',
};
const DRAFT = {
  ...PUBLISHED,
  id: '0193a5b2-0000-7000-8000-0000000000a2',
  version: null,
  status: 'draft',
  requiresReacceptance: true,
  effectiveAt: null,
  publishedAt: null,
  createdAt: '2026-11-20T11:00:00Z',
};

/** Termos com rascunho e versão publicada; privacidade vazia. Guarda corpos e consultas. */
function termsRoutes(
  extra: Routes = {},
  lists = { terms: [DRAFT, PUBLISHED], privacy: [] as unknown[] },
) {
  const bodies: Record<string, unknown> = {};
  const documents: string[] = [];
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/terms': (request: Request) => {
      const document = new URL(request.url).searchParams.get('document') ?? '';
      documents.push(document);
      return { items: lists[document as 'terms' | 'privacy'] ?? [] };
    },
  };
  for (const [key, handler] of Object.entries(extra)) {
    routes[key] = async (request: Request) => {
      const text = await request.clone().text();
      if (text) bodies[key] = JSON.parse(text);
      return typeof handler === 'function'
        ? (handler as (r: Request) => unknown)(request)
        : handler;
    };
  }
  return { routes, bodies, documents };
}

const PUBLISH_KEY = `POST /api/v1/terms/${DRAFT.id}/publish`;

describe('termos (/configuracoes/termos)', () => {
  it('lista as versões dos Termos de Uso, sem violações do axe', async () => {
    const { routes } = termsRoutes();
    renderApp('/configuracoes/termos', routes);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Termos e privacidade' }),
    ).toBeTruthy();
    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getByText('Versão 1')).toBeTruthy();
    expect(within(table).getAllByText('Rascunho').length).toBeGreaterThan(0);
    expect(within(table).getByText('Publicada')).toBeTruthy();
    expect(
      within(table).getAllByRole('button', { name: /^Publicar o rascunho criado em/ }),
    ).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Termos de Uso' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const crumbs = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(crumbs).getByRole('link', { name: 'Configurações' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('troca de documento pela aba e avisa quando não há versão publicada', async () => {
    const user = userEvent.setup();
    const { routes, documents } = termsRoutes();
    const { router } = renderApp('/configuracoes/termos', routes);
    await screen.findByRole('table');
    await user.click(screen.getByRole('tab', { name: 'Política de Privacidade' }));
    await waitFor(() => expect(router.state.location.search).toBe('?documento=privacy'));
    expect(await screen.findByText('Política de Privacidade: nenhuma versão ainda')).toBeTruthy();
    expect(screen.getAllByText('Política de Privacidade sem versão publicada').length).toBe(1);
    expect(documents).toContain('privacy');
  });

  it('a primeira versão começa com o texto modelo e cria o rascunho', async () => {
    const user = userEvent.setup();
    const { routes, bodies } = termsRoutes({
      'POST /api/v1/terms': () =>
        new Response(JSON.stringify({ ...DRAFT, document: 'privacy' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    renderApp('/configuracoes/termos?documento=privacy', routes);
    await screen.findByText('Política de Privacidade: nenhuma versão ainda');
    await user.click(screen.getAllByRole('button', { name: 'Novo rascunho' })[0] as HTMLElement);
    const box = await screen.findByRole('dialog', {
      name: 'Novo rascunho: Política de Privacidade',
    });
    const body = within(box).getByLabelText('Texto (Markdown)') as HTMLTextAreaElement;
    expect(body.value).toBe(ptBR.terms.templates.privacy);
    await user.click(
      within(box).getByRole('checkbox', {
        name: 'Exigir novo aceite de quem aceitou uma versão anterior',
      }),
    );
    await user.click(within(box).getByRole('button', { name: 'Criar rascunho' }));
    expect(await screen.findByText('Rascunho criado.')).toBeTruthy();
    expect(bodies['POST /api/v1/terms']).toEqual({
      document: 'privacy',
      bodyMd: ptBR.terms.templates.privacy,
      requiresReacceptance: true,
    });
  });

  it('com versões, o rascunho novo começa vazio e exige texto', async () => {
    const user = userEvent.setup();
    const { routes, bodies } = termsRoutes({ 'POST /api/v1/terms': DRAFT });
    renderApp('/configuracoes/termos', routes);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Novo rascunho' }));
    const box = await screen.findByRole('dialog');
    expect((within(box).getByLabelText('Texto (Markdown)') as HTMLTextAreaElement).value).toBe('');
    await user.click(within(box).getByRole('button', { name: 'Criar rascunho' }));
    expect(within(box).getByText('Preencha este campo.')).toBeTruthy();
    expect(bodies['POST /api/v1/terms']).toBeUndefined();
  });

  it('erro ao criar fica no diálogo', async () => {
    const user = userEvent.setup();
    const { routes } = termsRoutes({
      'POST /api/v1/terms': () => problem(400, 'validation_failed'),
    });
    renderApp('/configuracoes/termos', routes);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Novo rascunho' }));
    const box = await screen.findByRole('dialog');
    await user.type(within(box).getByLabelText('Texto (Markdown)'), 'Texto');
    await user.click(within(box).getByRole('button', { name: 'Criar rascunho' }));
    expect(
      await within(box).findByText('Confira o texto: entre 1 e 100.000 caracteres.'),
    ).toBeTruthy();
  });

  it('publica com confirmação e atualiza a lista', async () => {
    const user = userEvent.setup();
    let published = false;
    const lists = { terms: [DRAFT, PUBLISHED], privacy: [] as unknown[] };
    const { routes } = termsRoutes(
      {
        [PUBLISH_KEY]: () => {
          published = true;
          lists.terms = [
            {
              ...DRAFT,
              status: 'published',
              version: 2,
              publishedAt: '2026-11-24T12:00:00Z',
              effectiveAt: '2026-11-24T12:00:00Z',
            },
            PUBLISHED,
          ];
          return lists.terms[0] as object;
        },
      },
      lists,
    );
    renderApp('/configuracoes/termos', routes);
    await user.click(await screen.findByRole('button', { name: /^Publicar o rascunho criado em/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Publicar esta versão?' });
    expect(
      within(confirm).getByText(/terão de aceitar de novo|terá de aceitar de novo/),
    ).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Termos de Uso: versão 2 publicada.')).toBeTruthy();
    expect(published).toBe(true);
    expect(await screen.findByText('Versão 2')).toBeTruthy();
  });

  it('terms_already_published avisa e atualiza a lista', async () => {
    const user = userEvent.setup();
    const { routes } = termsRoutes({
      [PUBLISH_KEY]: () => problem(409, 'terms_already_published'),
    });
    renderApp('/configuracoes/termos', routes);
    await user.click(await screen.findByRole('button', { name: /^Publicar o rascunho criado em/ }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar' }),
    );
    expect(
      await screen.findByText('Esta versão já tinha sido publicada. A lista foi atualizada.'),
    ).toBeTruthy();
  });

  it('outra recusa ao publicar vira aviso de erro', async () => {
    const user = userEvent.setup();
    const { routes } = termsRoutes({ [PUBLISH_KEY]: () => problem(403, 'permission_denied') });
    renderApp('/configuracoes/termos', routes);
    await user.click(await screen.findByRole('button', { name: /^Publicar o rascunho criado em/ }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar' }),
    );
    expect(await screen.findByText('Não foi possível publicar')).toBeTruthy();
  });

  it('lista com rota ausente mostra erro tratado', async () => {
    renderApp('/configuracoes/termos', {
      ...defaultRoutes(),
      'GET /api/v1/terms': () => problem(404, 'not_found'),
    });
    expect(
      within(await findAlert()).getByText('Não foi possível carregar as versões'),
    ).toBeTruthy();
  });

  it('manager não abre os termos (settings.manage)', async () => {
    const { routes, documents } = termsRoutes();
    renderApp('/configuracoes/termos', { ...routes, 'GET /api/v1/session': sessionFor('manager') });
    await findMenu();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(documents).toHaveLength(0);
  });

  it('a página de configurações leva aos termos', async () => {
    const user = userEvent.setup();
    const { routes } = termsRoutes();
    const { router } = renderApp('/configuracoes', routes);
    await user.click(await screen.findByRole('link', { name: 'Termos e privacidade' }));
    expect(router.state.location.pathname).toBe('/configuracoes/termos');
  });
});
