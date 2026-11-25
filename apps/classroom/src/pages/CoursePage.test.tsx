import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  COURSE_PATH,
  fakeLearning,
  LESSON_1,
  LESSON_2,
  LESSON_3,
  lessonUrl,
  makeCourseView,
} from '../test/learning';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';

const COURSE_URL = 'GET /api/v1/courses/react-do-zero';
const title = (name: string) => screen.findByRole('heading', { level: 1, name });
const session = makeSession();
const courseProgress = () =>
  within(screen.getByRole('region', { name: ptBR.learning.progress.course }));

describe('página do curso do aluno', () => {
  it('mostra o programa em acordeão, o progresso e "Começar" na primeira aula', async () => {
    const user = userEvent.setup();
    renderApp(COURSE_PATH, apiRoutes(fakeLearning().handlers), { session });

    expect(await title('React do zero')).toBeTruthy();

    // módulos na ordem de `position`, o primeiro aberto, com o progresso de cada um
    const modules = screen.getAllByRole('button', { name: /aula/ });
    expect(modules.map((button) => button.textContent)).toEqual([
      'Primeiros passos0 de 2 aulas · 0%',
      'Estado e efeitos0 de 1 aula · 0%',
    ]);
    expect(modules.map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'true',
      'false',
    ]);
    const first = within(screen.getByRole('region', { name: /Primeiros passos/ }));
    expect(first.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      lessonUrl(LESSON_1),
      lessonUrl(LESSON_2),
    ]);
    expect(first.getAllByText(ptBR.learning.status.pending)).toHaveLength(2);
    await user.click(modules[1] as HTMLElement);
    expect(screen.getByRole('link', { name: 'useState na prática' }).getAttribute('href')).toBe(
      lessonUrl(LESSON_3),
    );

    // progresso do curso e o botão
    const panel = courseProgress();
    const bar = panel.getByRole('progressbar', { name: ptBR.learning.progress.course });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuetext')).toBe('0 de 3 aulas concluídas');
    expect(panel.getByText('Acesso até 12 de março de 2027.')).toBeTruthy();
    expect(panel.getByRole('link', { name: ptBR.learning.course.start }).getAttribute('href')).toBe(
      lessonUrl(LESSON_1),
    );

    // o certificado é de outra tarefa (454): a página não o menciona
    expect(screen.queryByText(/certificado/i)).toBeNull();
    await waitFor(() => expect(document.title).toBe('React do zero · Escola Aurora'));
    await expectNoAxeViolations();
  });

  it('"Continuar" leva à aula que a API indica e marca as concluídas', async () => {
    const course = makeCourseView({ continueLessonId: LESSON_2 });
    course.progress = { completedLessons: 1, totalLessons: 3, percent: 33, state: 'in_progress' };
    const module = course.modules.find((item) => item.title === 'Primeiros passos');
    if (!module) throw new Error('módulo ausente');
    module.progress = { completedLessons: 1, totalLessons: 2, percent: 50, state: 'in_progress' };
    for (const lesson of module.lessons) lesson.completed = lesson.id === LESSON_1;

    renderApp(COURSE_PATH, apiRoutes({ [COURSE_URL]: () => jsonResponse(course) }), { session });
    await title('React do zero');

    expect(screen.getByRole('button', { name: /Primeiros passos/ }).textContent).toContain(
      '1 de 2 aulas · 50%',
    );
    const first = within(screen.getByRole('region', { name: /Primeiros passos/ }));
    expect(first.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `${ptBR.learning.status.completed}Boas-vindas ao curso${ptBR.product.sample}10 min`,
      `${ptBR.learning.status.pending}Seu primeiro componente1 h 30 min`,
    ]);
    const panel = courseProgress();
    expect(panel.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33');
    expect(
      panel.getByRole('link', { name: ptBR.learning.course.continue }).getAttribute('href'),
    ).toBe(lessonUrl(LESSON_2));
  });

  it('curso concluído oferece "Rever"', async () => {
    const course = makeCourseView();
    course.progress = { completedLessons: 3, totalLessons: 3, percent: 100, state: 'completed' };
    renderApp(COURSE_PATH, apiRoutes({ [COURSE_URL]: () => jsonResponse(course) }), { session });
    await title('React do zero');
    expect(
      courseProgress()
        .getByRole('link', { name: ptBR.learning.course.review })
        .getAttribute('href'),
    ).toBe(lessonUrl(LESSON_1));
  });

  it('sem acesso: mostra o motivo, mantém o programa e só a amostra abre', async () => {
    const course = makeCourseView({
      access: { allowed: false, reason: 'expired', expiresAt: null },
      continueLessonId: null,
    });
    for (const module of course.modules) {
      for (const lesson of module.lessons) lesson.accessible = lesson.isSample;
    }
    renderApp(COURSE_PATH, apiRoutes({ [COURSE_URL]: () => jsonResponse(course) }), { session });
    await title('React do zero');

    const notice = within(screen.getByRole('status'));
    expect(notice.getByText(ptBR.learning.course.lockedTitle)).toBeTruthy();
    expect(notice.getByText(new RegExp(ptBR.learning.reasons.expired))).toBeTruthy();
    expect(
      notice.getByRole('link', { name: ptBR.learning.course.publicPage }).getAttribute('href'),
    ).toBe('/cursos/react-do-zero');

    const first = within(screen.getByRole('region', { name: /Primeiros passos/ }));
    expect(first.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Boas-vindas ao curso',
    ]);
    expect(first.getByText('Seu primeiro componente')).toBeTruthy();
    expect(first.getByText(ptBR.learning.status.locked)).toBeTruthy();
    expect(courseProgress().queryByRole('link')).toBeNull();
    await expectNoAxeViolations();
  });

  it('curso inexistente ou privado sem direito (404) mostra "não encontrado"', async () => {
    renderApp(
      '/meus-cursos/secreto',
      apiRoutes({ 'GET /api/v1/courses/secreto': () => problemResponse(404, 'not_found') }),
      { session },
    );
    expect(await title(ptBR.learning.course.notFoundTitle)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha do servidor mostra o erro e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      COURSE_PATH,
      apiRoutes({
        [COURSE_URL]: () => (fail ? unavailableResponse() : jsonResponse(makeCourseView())),
      }),
      { session },
    );
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(ptBR.learning.course.errorTitle)).toBeTruthy();
    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await title('React do zero')).toBeTruthy();
  });

  it('visitante vai para o login, com o caminho de volta', async () => {
    const { router, calls } = renderApp(COURSE_PATH);
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fmeus-cursos%2Freact-do-zero');
    expect(calls.some((call) => call.path.startsWith('/api/v1/courses/'))).toBe(false);
  });
});
