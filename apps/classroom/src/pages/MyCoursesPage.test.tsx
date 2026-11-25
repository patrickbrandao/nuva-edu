import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SHELF_VIEW_STORAGE_KEY } from '../learning/shelfFilters';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { LESSON_2, lessonUrl } from '../test/learning';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';
import {
  fakeShelf,
  makeShelfCourse,
  NODE_LESSON,
  SAMPLE_LESSONS,
  SHELF_COURSES,
} from '../test/shelf';

const SHELF = '/api/v1/me/courses';
const t = ptBR.study.shelf;
const session = makeSession();
const samples = { 'GET /api/v1/samples': () => jsonResponse({ items: [], nextCursor: null }) };
const withShelf = (...args: Parameters<typeof fakeShelf>) =>
  apiRoutes({ ...fakeShelf(...args), ...samples });

const list = () => screen.findByRole('list', { name: t.list });
const titles = async () =>
  within(await list())
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
const card = async (title: string) =>
  (await screen.findByRole('heading', { level: 3, name: title })).closest('article') as HTMLElement;
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
/** Consultas feitas à estante, como `URLSearchParams`. */
const shelfQueries = (calls: { path: string; search: string }[]) =>
  calls.filter((call) => call.path === SHELF).map((call) => new URLSearchParams(call.search));

describe('estante "Meus cursos"', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/meus-cursos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fmeus-cursos');
  });

  it('mostra contadores, filtros com contagem e os cursos com progresso, validade e ação', async () => {
    renderApp('/meus-cursos', withShelf(), { session });

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.menu.items.myCourses }),
    ).toBeTruthy();
    // ordem padrão: acesso mais recente; nunca aberto por último
    expect(await titles()).toEqual([
      'React do zero',
      'CSS moderno',
      'Git essencial',
      'Node na prática',
    ]);

    // contadores do topo: os dados simulados têm 4 cursos (2 em andamento, 1 e 1)
    const summary = screen.getByRole('region', { name: t.counts.label });
    const stat = (label: string) =>
      within(summary).getByText(label).parentElement?.firstElementChild?.textContent;
    expect(stat(t.counts.all)).toBe('4');
    expect(stat(t.counts.inProgress)).toBe('2');
    expect(stat(t.counts.notStarted)).toBe('1');
    expect(stat(t.counts.completed)).toBe('1');
    expect(stat(t.counts.hours)).toBe('2 h 30 min');

    // filtros com a mesma contagem
    expect(
      screen
        .getAllByRole('tab')
        .map((item) => [item.textContent, item.getAttribute('aria-selected')]),
    ).toEqual([
      ['Todos4', 'true'],
      ['Em andamento2', 'false'],
      ['Não iniciados1', 'false'],
      ['Concluídos1', 'false'],
    ]);

    // em andamento: "X de Y aulas", barra, validade e "Continuar" na aula indicada pela API
    const react = within(await card('React do zero'));
    const bar = react.getByRole('progressbar', { name: 'Progresso em React do zero' });
    expect(bar.getAttribute('aria-valuenow')).toBe('33');
    expect(bar.getAttribute('aria-valuetext')).toBe('1 de 3 aulas concluídas');
    expect(react.getByText('1 de 3 aulas')).toBeTruthy();
    expect(react.getByText(ptBR.product.levels.beginner)).toBeTruthy();
    expect(react.getByText('Acesso até 12 de março de 2027')).toBeTruthy();
    expect(react.getByRole('link', { name: 'React do zero' }).getAttribute('href')).toBe(
      '/meus-cursos/react-do-zero',
    );
    const go = react.getByRole('link', { name: 'Continuar: React do zero' });
    expect(go.textContent).toBe(t.actions.continue);
    expect(go.getAttribute('href')).toBe(lessonUrl(LESSON_2));
    expect(react.queryByText(t.expired)).toBeNull();

    // não iniciado e concluído
    const node = within(await card('Node na prática'));
    expect(node.getByRole('link', { name: 'Começar: Node na prática' }).getAttribute('href')).toBe(
      `/meus-cursos/node-na-pratica/aulas/${NODE_LESSON}`,
    );
    expect(node.queryByText(/Acesso até/)).toBeNull();
    const css = within(await card('CSS moderno'));
    expect(css.getByRole('link', { name: 'Rever: CSS moderno' })).toBeTruthy();
    expect(
      css
        .getByRole('progressbar', { name: 'Progresso em CSS moderno' })
        .getAttribute('aria-valuenow'),
    ).toBe('100');

    // acesso vencido: selo, progresso preservado e "Renovar acesso" na página pública
    const git = within(await card('Git essencial'));
    expect(git.getByText(t.expired)).toBeTruthy();
    expect(git.getByText('Acesso vencido em 1 de outubro de 2026')).toBeTruthy();
    expect(git.getByText('2 de 4 aulas')).toBeTruthy();
    expect(
      git.getByRole('link', { name: 'Renovar acesso: Git essencial' }).getAttribute('href'),
    ).toBe('/cursos/git-essencial');

    // sem curso por começar em destaque e sem menção a certificado (tarefa 454)
    expect(screen.queryByRole('region', { name: t.startHere.title })).toBeNull();
    expect(screen.queryByText(/certificado/i)).toBeNull();
    await waitFor(() =>
      expect(document.title).toBe(`${ptBR.menu.items.myCourses} · Escola Aurora`),
    );
    await expectNoAxeViolations();
  });

  it('cada filtro lista o que o contador promete e vai para o endereço', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp('/meus-cursos', withShelf(), { session });
    await list();

    const expected: [string, string, string, string[]][] = [
      [
        t.filters.inProgress,
        'in_progress',
        '?filtro=em-andamento',
        ['React do zero', 'Git essencial'],
      ],
      [t.filters.notStarted, 'not_started', '?filtro=nao-iniciados', ['Node na prática']],
      [t.filters.completed, 'completed', '?filtro=concluidos', ['CSS moderno']],
    ];
    for (const [name, filter, search, shown] of expected) {
      await user.click(tab(name));
      await waitFor(() => expect(tab(name).getAttribute('aria-selected')).toBe('true'));
      await waitFor(async () => expect(await titles()).toEqual(shown));
      // a contagem do filtro é a quantidade de cursos listada
      expect(tab(name).textContent).toBe(`${name}${shown.length}`);
      expect(router.state.location.search).toBe(search);
      expect(shelfQueries(calls).at(-1)?.get('filter')).toBe(filter);
      expect(
        await screen.findByText(`${shown.length} curso${shown.length > 1 ? 's' : ''} na lista.`),
      ).toBeTruthy();
    }

    // os contadores do topo não mudam com o filtro
    const summary = screen.getByRole('region', { name: t.counts.label });
    expect(within(summary).getByText(t.counts.all).parentElement?.textContent).toContain('4');

    await user.click(tab(t.filters.all));
    await waitFor(async () => expect(await titles()).toHaveLength(SHELF_COURSES.length));
    expect(router.state.location.search).toBe('');
    expect(shelfQueries(calls).at(-1)?.has('filter')).toBe(false);
  });

  it('busca por título com uma consulta só e ordena pelo que o menu escolhe', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp('/meus-cursos', withShelf(), { session });
    await list();

    await user.click(screen.getByRole('button', { name: 'Ordenar: Acesso mais recente' }));
    await user.click(screen.getByRole('option', { name: t.filters.sort.title }));
    await waitFor(async () =>
      expect(await titles()).toEqual([
        'CSS moderno',
        'Git essencial',
        'Node na prática',
        'React do zero',
      ]),
    );
    expect(router.state.location.search).toBe('?ordem=titulo');
    expect(shelfQueries(calls).at(-1)?.get('sort')).toBe('title');

    const field = screen.getByRole('searchbox', { name: t.filters.search });
    await user.type(field, 'git');
    await waitFor(() => expect(router.state.location.search).toBe('?ordem=titulo&q=git'));
    await waitFor(async () => expect(await titles()).toEqual(['Git essencial']));
    expect(shelfQueries(calls).filter((query) => query.has('q'))).toHaveLength(1);

    // busca sem resultado: aviso próprio; limpar mantém a ordenação
    await user.clear(field);
    await user.type(field, 'python');
    expect(await screen.findByText(t.noResultsTitle)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: t.filters.clear }));
    await waitFor(async () => expect(await titles()).toHaveLength(4));
    expect((field as HTMLInputElement).value).toBe('');
    expect(router.state.location.search).toBe('?ordem=titulo');
  });

  it('lê filtro, ordem e busca do endereço e ignora valor desconhecido', async () => {
    const { calls } = renderApp(
      '/meus-cursos?filtro=em-andamento&ordem=progresso&q=e',
      withShelf(),
      { session },
    );
    expect(await titles()).toEqual(['Git essencial', 'React do zero']);
    expect(shelfQueries(calls)[0]?.toString()).toBe('filter=in_progress&q=e&sort=-percent');
    expect(tab(t.filters.inProgress).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ordenar: Maior progresso' })).toBeTruthy();

    const other = renderApp('/meus-cursos?filtro=tudo&ordem=preco', withShelf(), { session });
    await waitFor(() => expect(shelfQueries(other.calls)).toHaveLength(1));
    expect(shelfQueries(other.calls)[0]?.toString()).toBe('');
  });

  it('o modo grade ou lista fica no navegador e vale na visita seguinte', async () => {
    const user = userEvent.setup();
    const first = renderApp('/meus-cursos', withShelf(), { session });
    const mode = () => within(screen.getByRole('group', { name: t.view.label }));
    expect((await list()).getAttribute('data-layout')).toBe('grid');
    expect(mode().getByRole('button', { name: t.view.grid }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(localStorage.getItem(SHELF_VIEW_STORAGE_KEY)).toBeNull();

    await user.click(mode().getByRole('button', { name: t.view.list }));
    expect((await list()).getAttribute('data-layout')).toBe('list');
    expect((await card('React do zero')).getAttribute('data-layout')).toBe('list');
    expect(mode().getByRole('button', { name: t.view.list }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(mode().getByRole('button', { name: t.view.grid }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(localStorage.getItem(SHELF_VIEW_STORAGE_KEY)).toBe('list');
    await expectNoAxeViolations();
    first.unmount();

    // outra visita: a lista continua escolhida
    renderApp('/meus-cursos', withShelf(), { session });
    expect((await list()).getAttribute('data-layout')).toBe('list');

    await user.click(mode().getByRole('button', { name: t.view.grid }));
    expect((await list()).getAttribute('data-layout')).toBe('grid');
    expect(localStorage.getItem(SHELF_VIEW_STORAGE_KEY)).toBeNull();
  });

  it('"Comece por aqui" destaca o curso que a API indica quando nenhum foi iniciado', async () => {
    const node = SHELF_COURSES[1] as (typeof SHELF_COURSES)[number];
    const other = makeShelfCourse({
      id: '0193a5b2-0000-7000-8000-0000000000c9',
      slug: 'html-basico',
      title: 'HTML básico',
      progress: { completedLessons: 0, totalLessons: 5, percent: 0, state: 'not_started' },
      action: 'start',
      continueLessonId: null,
      lastAccessedAt: null,
    });
    renderApp(
      '/meus-cursos',
      withShelf([other, node], { startHereCourseId: node.id, completedLessonSeconds: 0 }),
      { session },
    );

    const block = within(await screen.findByRole('region', { name: t.startHere.title }));
    expect(block.getByRole('heading', { level: 2, name: t.startHere.title })).toBeTruthy();
    expect(block.getByText('Node na prática')).toBeTruthy();
    expect(block.getByRole('link', { name: 'Começar: Node na prática' }).getAttribute('href')).toBe(
      `/meus-cursos/node-na-pratica/aulas/${NODE_LESSON}`,
    );
    // sem aula indicada, "Começar" abre a página do curso
    const html = within(await card('HTML básico'));
    expect(html.getByRole('link', { name: 'Começar: HTML básico' }).getAttribute('href')).toBe(
      '/meus-cursos/html-basico',
    );
    const summary = screen.getByRole('region', { name: t.counts.label });
    expect(within(summary).getByText(t.counts.hours).parentElement?.textContent).toContain('0 min');
    await expectNoAxeViolations();
  });

  it('estante vazia convida à vitrine e mostra as aulas liberadas', async () => {
    renderApp(
      '/meus-cursos',
      apiRoutes({
        ...fakeShelf([]),
        'GET /api/v1/samples': () => jsonResponse({ items: SAMPLE_LESSONS, nextCursor: null }),
      }),
      { session },
    );
    expect(await screen.findByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.study.start.showcase }).getAttribute('href')).toBe(
      '/',
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    const free = within(await screen.findByRole('list', { name: ptBR.study.samples.list }));
    expect(free.getAllByRole('listitem')).toHaveLength(2);
  });

  it('mostra o erro com o código da requisição e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    const shelf = fakeShelf();
    renderApp(
      '/meus-cursos',
      apiRoutes({
        ...samples,
        [`GET ${SHELF}`]: (request) =>
          fail
            ? unavailableResponse()
            : (shelf[`GET ${SHELF}`] as (r: Request) => Response)(request),
      }),
      { session },
    );

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(t.errorTitle)).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-teste-1')).toBeTruthy();

    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await titles()).toHaveLength(4);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
