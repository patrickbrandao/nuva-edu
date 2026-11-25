import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { LESSON_2, lessonUrl } from '../test/learning';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  queryAlert,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';
import { CONTINUE_LIST, SAMPLE_LESSONS } from '../test/shelf';

const CONTINUE = 'GET /api/v1/me/continue';
const SAMPLES = 'GET /api/v1/samples';
const t = ptBR.study;
const session = makeSession();
const noSamples = () => jsonResponse({ items: [], nextCursor: null });
const card = async (title: string) =>
  (await screen.findByRole('heading', { level: 3, name: title })).closest('article') as HTMLElement;

describe('/inicio', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/inicio');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Finicio');
  });

  it('mostra "Continue assistindo" com a aula atual e as aulas liberadas', async () => {
    const { calls } = renderApp(
      '/inicio',
      apiRoutes({
        [CONTINUE]: () => jsonResponse(CONTINUE_LIST),
        [SAMPLES]: () => jsonResponse({ items: SAMPLE_LESSONS, nextCursor: null }),
      }),
      { session },
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Olá, Ana' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: t.start.continueTitle })).toBeTruthy();

    // do mais recente ao mais antigo, como a API devolve
    const list = await screen.findByRole('list', { name: t.start.continueList });
    expect(
      within(list)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['React do zero', 'SQL do zero']);

    const react = within(await card('React do zero'));
    expect(react.getByText('Aula atual: Seu primeiro componente')).toBeTruthy();
    expect(react.getByText('1 de 3 aulas')).toBeTruthy();
    expect(
      react
        .getByRole('progressbar', { name: 'Progresso em React do zero' })
        .getAttribute('aria-valuenow'),
    ).toBe('33');
    const go = react.getByRole('link', { name: 'Continuar: React do zero' });
    expect(go.getAttribute('href')).toBe(lessonUrl(LESSON_2));
    expect(react.getByRole('link', { name: 'React do zero' }).getAttribute('href')).toBe(
      '/meus-cursos/react-do-zero',
    );
    expect(screen.getByRole('link', { name: t.start.allCourses }).getAttribute('href')).toBe(
      '/meus-cursos',
    );

    // aulas liberadas: a aula, o curso e a duração, com link direto para a aula
    const free = within(await screen.findByRole('list', { name: t.samples.list }));
    const items = free.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = within(items[0] as HTMLElement);
    expect(first.getByRole('link', { name: 'O que é TypeScript' }).getAttribute('href')).toBe(
      `/meus-cursos/typescript-na-pratica/aulas/${SAMPLE_LESSONS[0]?.id}`,
    );
    expect(first.getByText('Curso: TypeScript na prática')).toBeTruthy();
    expect(first.getByText(ptBR.learning.lesson.sample)).toBeTruthy();
    expect(first.getByText('15 min')).toBeTruthy();

    const samples = calls.find((call) => call.path === '/api/v1/samples');
    expect(samples?.search).toBe('?limit=12');
    await waitFor(() => expect(document.title).toBe(`${ptBR.menu.items.start} · Escola Aurora`));
    await expectNoAxeViolations();
  });

  it('sem curso em andamento nem amostras, mostra os avisos de vazio', async () => {
    renderApp(
      '/inicio',
      apiRoutes({ [CONTINUE]: () => jsonResponse({ items: [] }), [SAMPLES]: noSamples }),
      { session },
    );
    expect(await screen.findByText(t.start.continueEmptyTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.start.showcase }).getAttribute('href')).toBe('/');
    expect(await screen.findByText(t.samples.empty)).toBeTruthy();
    expect(screen.queryByRole('list', { name: t.start.continueList })).toBeNull();
  });

  it('"Carregar mais" pede a página seguinte das aulas liberadas', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/inicio',
      apiRoutes({
        [CONTINUE]: () => jsonResponse({ items: [] }),
        [SAMPLES]: (request) =>
          new URL(request.url).searchParams.get('cursor') === 'cursor-2'
            ? jsonResponse({ items: SAMPLE_LESSONS.slice(1), nextCursor: null })
            : jsonResponse({ items: SAMPLE_LESSONS.slice(0, 1), nextCursor: 'cursor-2' }),
      }),
      { session },
    );
    const free = within(await screen.findByRole('list', { name: t.samples.list }));
    expect(free.getAllByRole('listitem')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: t.samples.more }));
    expect(await free.findByRole('link', { name: 'Instalando o Docker' })).toBeTruthy();
    expect(free.getAllByRole('listitem')).toHaveLength(2);
    expect(calls.filter((call) => call.path === '/api/v1/samples').at(-1)?.search).toBe(
      '?limit=12&cursor=cursor-2',
    );
    expect(screen.queryByRole('button', { name: t.samples.more })).toBeNull();
  });

  it('a falha de uma seção não derruba a outra, e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      '/inicio',
      apiRoutes({
        [CONTINUE]: () => (fail ? unavailableResponse() : jsonResponse(CONTINUE_LIST)),
        [SAMPLES]: () => jsonResponse({ items: SAMPLE_LESSONS, nextCursor: null }),
      }),
      { session },
    );

    const alert = await findAlert();
    expect(within(alert).getByText(t.start.continueErrorTitle)).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-teste-1')).toBeTruthy();
    expect(await screen.findByRole('list', { name: t.samples.list })).toBeTruthy();

    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await card('React do zero')).toBeTruthy();
    expect(queryAlert()).toBeNull();
  });
});
