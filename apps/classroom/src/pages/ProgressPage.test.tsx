import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  queryAlert,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';
import { ACTIVITY, MY_PROGRESS } from '../test/shelf';

const PROGRESS = 'GET /api/v1/me/progress';
const ACTIVITY_URL = 'GET /api/v1/me/activity';
const t = ptBR.study;
const session = makeSession();
const api = (progress: unknown = MY_PROGRESS, activity: unknown = ACTIVITY) =>
  apiRoutes({
    [PROGRESS]: () => jsonResponse(progress),
    [ACTIVITY_URL]: () => jsonResponse(activity),
  });

describe('/progresso', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/progresso');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fprogresso');
  });

  it('mostra um quadrado por aula, agrupado por módulo, com o percentual do curso', async () => {
    renderApp('/progresso', api(), { session });

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.menu.items.progress }),
    ).toBeTruthy();
    const course = within(await screen.findByRole('article', { name: 'React do zero' }));
    expect(course.getByRole('link', { name: 'React do zero' }).getAttribute('href')).toBe(
      '/meus-cursos/react-do-zero',
    );
    const bar = course.getByRole('progressbar', { name: 'Progresso em React do zero' });
    expect(bar.getAttribute('aria-valuenow')).toBe('33');
    expect(course.getByText('33%')).toBeTruthy();
    expect(course.getByText('1 de 3 aulas concluídas')).toBeTruthy();

    // um quadrado por aula, na ordem do módulo, com o estado no texto lido
    const first = within(course.getByRole('list', { name: 'Aulas de Primeiros passos' }));
    expect(first.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Boas-vindas ao curso: concluída',
      'Seu primeiro componente: não concluída',
    ]);
    expect(
      first
        .getAllByRole('listitem')
        .map((item) => item.querySelector('[data-done]')?.getAttribute('data-done')),
    ).toEqual(['true', 'false']);
    const second = within(course.getByRole('list', { name: 'Aulas de Estado e efeitos' }));
    expect(second.getAllByRole('listitem')).toHaveLength(1);
    expect(
      course.getByRole('heading', { level: 4, name: /Primeiros passos.*1 de 2 aulas/ }),
    ).toBeTruthy();

    await waitFor(() => expect(document.title).toBe(`${ptBR.menu.items.progress} · Escola Aurora`));
    await expectNoAxeViolations();
  });

  it('mostra o mapa de atividade de 53 semanas, com os dias que a API informa', async () => {
    const { container } = renderApp('/progresso', api(), { session });

    const map = await screen.findByRole('table', { name: t.activity.tableTitle });
    // 7 linhas (dias da semana) e 53 colunas; a última semana vai só até hoje (quarta, 25/11/2026)
    const rows = within(map)
      .getAllByRole('row', { hidden: false })
      .filter((row) => row.querySelector('th'));
    expect(rows).toHaveLength(7);
    expect(rows[0]?.querySelectorAll('td')).toHaveLength(53);
    expect(container.querySelectorAll('td[data-future]')).toHaveLength(3);

    const day = (date: string) => container.querySelector(`td[data-date="${date}"]`);
    expect(day('2026-11-24')?.getAttribute('title')).toBe('2 atividades em 24 de novembro de 2026');
    expect(day('2026-11-24')?.getAttribute('data-level')).toBe('4');
    expect(day('2026-11-20')?.getAttribute('title')).toBe('1 atividade em 20 de novembro de 2026');
    expect(day('2026-11-25')?.getAttribute('title')).toBe(
      'Nenhuma atividade em 25 de novembro de 2026',
    );
    expect(day('2026-11-25')?.getAttribute('data-level')).toBe('0');
    expect(day('2026-11-26')).toBeNull();
    expect(screen.getByText('3 atividades no período, em 2 dias.')).toBeTruthy();
    expect(screen.getByText(t.activity.less)).toBeTruthy();
  });

  it('sem curso iniciado e sem atividade, mostra os vazios', async () => {
    renderApp('/progresso', api({ items: [] }, { ...ACTIVITY, days: [] }), { session });
    expect(await screen.findByText(t.progress.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.start.allCourses }).getAttribute('href')).toBe(
      '/meus-cursos',
    );
    expect(await screen.findByText(t.activity.summaryNone)).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('a falha de uma parte não derruba a outra, e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      '/progresso',
      apiRoutes({
        [PROGRESS]: () => jsonResponse(MY_PROGRESS),
        [ACTIVITY_URL]: () => (fail ? unavailableResponse() : jsonResponse(ACTIVITY)),
      }),
      { session },
    );
    const alert = await findAlert();
    expect(within(alert).getByText(t.activity.errorTitle)).toBeTruthy();
    expect(await screen.findByRole('article', { name: 'React do zero' })).toBeTruthy();

    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await screen.findByRole('table', { name: t.activity.tableTitle })).toBeTruthy();
    expect(queryAlert()).toBeNull();
  });
});
