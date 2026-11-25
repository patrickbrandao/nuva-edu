import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { COURSE_ID, courseDetail, fakeCatalog } from '../../test/courses';
import { findAlert, renderApp } from '../../test/render';

const PYTHON = courseDetail({ moduleCount: 2, lessonCount: 3, durationSeconds: 3930 });
const DESIGN = courseDetail({
  id: '0193a5b2-0000-7000-8000-0000000000c2',
  slug: 'design',
  title: 'Design para iniciantes',
  accessMode: 'paid',
  priceCents: 4990,
  status: 'published',
  owner: null,
  reviewRequestedAt: '2026-11-21T12:00:00Z',
});

describe('lista de cursos (/cursos)', () => {
  it('mostra os cursos com situação, acesso, dono e conteúdo, sem violações do axe', async () => {
    const catalog = fakeCatalog({ courses: [PYTHON, DESIGN] });
    renderApp('/cursos', catalog.respond);
    expect(await screen.findByText('Carregando os cursos…')).toBeTruthy();

    const table = (await screen.findByRole('table')) as HTMLElement;
    const link = within(table).getByRole('link', { name: 'Curso de Python' });
    expect(link.getAttribute('href')).toBe(`/cursos/${COURSE_ID}`);
    const python = link.closest('tr') as HTMLElement;
    expect(within(python).getByText('Rascunho')).toBeTruthy();
    expect(within(python).getByText('Privado')).toBeTruthy();
    expect(within(python).getByText('Ivo Instrutor')).toBeTruthy();
    expect(within(python).getByText('2 módulos · 3 aulas publicadas · 1:05:30')).toBeTruthy();

    const design = within(table)
      .getByRole('link', { name: 'Design para iniciantes' })
      .closest('tr') as HTMLElement;
    expect(within(design).getByText('Publicado')).toBeTruthy();
    expect(within(design).getByText('Aguardando publicação')).toBeTruthy();
    expect(within(design).getByText(/^Pago · R\$\s49,90$/)).toBeTruthy();
    expect(within(design).getByText('Sem dono')).toBeTruthy();

    const first = catalog.requests.find((item) => item.path === '/api/v1/courses');
    expect(first?.query.get('sort')).toBe('-updatedAt');
    expect(first?.query.get('limit')).toBe('25');
    await expectNoAxeViolations();
  });

  it('busca, filtra por situação, acesso e "aguardando publicação", pelo endereço', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [PYTHON] });
    const { router } = renderApp('/cursos', catalog.respond);
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar por título ou resumo' }), 'py');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await user.click(screen.getByRole('button', { name: 'Situação: Todas as situações' }));
    await user.click(screen.getByRole('option', { name: 'Arquivado' }));
    await user.click(screen.getByRole('button', { name: 'Acesso: Todos os modos de acesso' }));
    await user.click(screen.getByRole('option', { name: 'Pago' }));
    await user.click(screen.getByRole('checkbox', { name: 'Aguardando publicação' }));
    await user.click(screen.getByRole('button', { name: 'Ordem: Alteração mais recente' }));
    await user.click(screen.getByRole('option', { name: 'Título' }));

    await waitFor(() => {
      const last = catalog.requests.filter((item) => item.path === '/api/v1/courses').at(-1);
      expect(Object.fromEntries(last?.query ?? [])).toMatchObject({
        q: 'py',
        status: 'archived',
        accessMode: 'paid',
        awaitingReview: 'true',
        sort: 'title',
      });
    });
    expect(router.state.location.search).toBe(
      '?q=py&status=archived&access=paid&awaiting=1&sort=title',
    );
  });

  it('vazio sem filtro oferece criar o curso; com filtro, limpar', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/cursos?awaiting=1', fakeCatalog().respond);
    expect(await screen.findByText('Nenhum curso encontrado')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Limpar a busca e os filtros' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByText('Nenhum curso ainda')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Novo curso' })).toHaveLength(2);
  });

  it('cria o curso só com o teclado e abre o editor', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ role: 'instructor' });
    const { router } = renderApp('/cursos', catalog.respond);
    await screen.findByText('Nenhum curso ainda');

    (screen.getAllByRole('button', { name: 'Novo curso' })[0] as HTMLElement).focus();
    await user.keyboard('{Enter}');
    const box = await screen.findByRole('dialog', { name: 'Novo curso' });
    expect(document.activeElement).toBe(within(box).getByLabelText('Título'));
    await expectNoAxeViolations();

    // sem título, o campo acusa e nada é enviado
    await user.keyboard('{Enter}');
    expect(await within(box).findByText('Preencha este campo.')).toBeTruthy();
    expect(catalog.writes()).toEqual([]);

    await user.keyboard('Lógica de programação{Tab}Primeiros passos.{Tab}{Tab}{Enter}');
    await waitFor(() => expect(catalog.writes()).toEqual(['POST /api/v1/courses']));
    expect(catalog.bodies('POST /api/v1/courses')[0]).toEqual({
      title: 'Lógica de programação',
      summary: 'Primeiros passos.',
    });
    const created = catalog.first();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/cursos/${created?.id}`));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lógica de programação' }),
    ).toBeTruthy();
  });

  it('erro da lista mostra erro tratado; 403 vira "sem permissão"', async () => {
    const user = userEvent.setup();
    let ready = false;
    const catalog = fakeCatalog({ courses: [PYTHON] });
    renderApp('/cursos', {
      ...defaultRoutes(),
      'GET /api/v1/courses': (request: Request) =>
        ready ? catalog.respond(request) : problem(404, 'not_found'),
    });
    const alert = await findAlert();
    expect(within(alert).getByText('Não foi possível carregar os cursos')).toBeTruthy();
    ready = true;
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('link', { name: 'Curso de Python' })).toBeTruthy();
  });

  it('403 da API vira "sem permissão", mesmo com o item no menu', async () => {
    renderApp('/cursos', {
      ...defaultRoutes(),
      'GET /api/v1/courses': () => problem(403, 'permission_denied'),
    });
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });
});
