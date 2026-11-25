import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNDO_MS } from '../learning/progress';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  COURSE_PATH,
  fakeLearning,
  LESSON_1,
  LESSON_2,
  LESSON_2_VIEW,
  LESSON_3,
  LESSON_3_VIEW,
  lessonUrl,
  makeCourseView,
  makeLesson,
} from '../test/learning';
import {
  apiRoutes,
  makeSession,
  problemResponse,
  type RecordedRequest,
  renderApp,
} from '../test/renderApp';

const session = makeSession();
const text = ptBR.learning.lesson;
const title = (name: string) => screen.findByRole('heading', { level: 1, name });
const progressPath = (id: string) => `/api/v1/lessons/${id}/progress`;
const puts = (calls: RecordedRequest[]) => calls.filter((call) => call.method === 'PUT');
const courseBar = () => screen.getByRole('progressbar', { name: ptBR.learning.progress.course });
const moduleButton = (name: RegExp) => screen.getByRole('button', { name });

/** O `<video>` da aula, com `currentTime` gravável (o jsdom não toca mídia). */
function video(): HTMLVideoElement {
  const element = document.querySelector('video');
  if (!element) throw new Error('a página não tem <video>');
  if (!Object.getOwnPropertyDescriptor(element, 'currentTime')) {
    Object.defineProperty(element, 'currentTime', { value: 0, writable: true });
  }
  return element;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('página da aula', () => {
  it('mostra cabeçalho, player, Sobre, Materiais, programa e navegação', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(lessonUrl(LESSON_1), apiRoutes(fakeLearning().handlers), {
      session,
    });

    expect(await title('Boas-vindas ao curso')).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: 'React do zero' }).getAttribute('href')).toBe(
      COURSE_PATH,
    );
    expect(main.getByText(text.sample)).toBeTruthy();
    expect(video().getAttribute('aria-label')).toBe('Boas-vindas ao curso');
    expect(video().src).toBe('https://cdn.exemplo.test/aulas/boas-vindas.mp4');
    expect(main.getByRole('toolbar', { name: ptBR.learning.player.controls })).toBeTruthy();

    // abas: Sobre (Markdown higienizado), Materiais e Minhas notas; sem Comentários nem
    // "Reportar" (Fase 4)
    const tabs = main.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual([text.tabs.about, `${text.tabs.materials}2`, text.tabs.notes]);
    expect(main.getByText('aprender').tagName).toBe('STRONG');
    expect(document.querySelector('main script')).toBeNull();
    await user.click(main.getByRole('tab', { name: new RegExp(text.tabs.materials) }));
    const slides = main.getByRole('link', { name: /Slides da aula/ });
    expect(slides.getAttribute('href')).toBe('https://cdn.exemplo.test/slides.pdf');
    expect(slides.getAttribute('target')).toBe('_blank');
    expect(main.getByRole('link', { name: 'Guia de Git' }).getAttribute('href')).toBe(
      '/ebooks/guia-de-git',
    );
    expect(main.queryByText(/reportar|comentário/i)).toBeNull();

    // lateral: a aula atual marcada no programa, com o módulo dela aberto
    const program = within(await screen.findByRole('region', { name: text.courseProgram }));
    expect(
      program.getByRole('link', { name: 'Boas-vindas ao curso' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(program.getByText(ptBR.learning.status.current)).toBeTruthy();
    expect(moduleButton(/Primeiros passos/).getAttribute('aria-expanded')).toBe('true');

    // rodapé: primeira aula não tem anterior
    const nav = within(screen.getByRole('navigation', { name: text.navigation }));
    expect(nav.queryByRole('link', { name: text.previous })).toBeNull();
    expect(nav.getByRole('link', { name: text.next }).getAttribute('href')).toBe(
      lessonUrl(LESSON_2),
    );
    expect(nav.getByRole('button', { name: text.markDone })).toBeTruthy();

    expect(calls.some((call) => call.path === `/api/v1/lessons/${LESSON_1}`)).toBe(true);
    expect(puts(calls)).toEqual([]);
    await waitFor(() => expect(document.title).toBe('Boas-vindas ao curso · Escola Aurora'));
    await expectNoAxeViolations();
  });

  it('marcar e desmarcar atualiza o progresso do módulo e do curso', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(lessonUrl(LESSON_1), apiRoutes(fakeLearning().handlers), {
      session,
    });
    await title('Boas-vindas ao curso');
    await screen.findByRole('region', { name: text.courseProgram });
    expect(moduleButton(/Primeiros passos/).textContent).toContain('0 de 2 aulas · 0%');
    expect(courseBar().getAttribute('aria-valuenow')).toBe('0');

    await user.click(screen.getByRole('button', { name: text.markDone }));
    expect(await screen.findByRole('button', { name: text.unmarkDone })).toBeTruthy();
    expect(screen.getByText(text.done)).toBeTruthy();
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]).toMatchObject({
      path: progressPath(LESSON_1),
      body: { completed: true, completedVia: 'manual' },
      csrf: 'csrf-teste-1',
    });
    await waitFor(() =>
      expect(moduleButton(/Primeiros passos/).textContent).toContain('1 de 2 aulas · 50%'),
    );
    expect(moduleButton(/Estado e efeitos/).textContent).toContain('0 de 1 aula · 0%');
    expect(courseBar().getAttribute('aria-valuenow')).toBe('33');
    expect(courseBar().getAttribute('aria-valuetext')).toBe('1 de 3 aulas concluídas');

    await user.click(screen.getByRole('button', { name: text.unmarkDone }));
    expect(await screen.findByRole('button', { name: text.markDone })).toBeTruthy();
    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    expect(puts(calls)[1]?.body).toEqual({ completed: false });
    await waitFor(() =>
      expect(moduleButton(/Primeiros passos/).textContent).toContain('0 de 2 aulas · 0%'),
    );
    expect(courseBar().getAttribute('aria-valuenow')).toBe('0');
    expect(screen.queryByText(text.done)).toBeNull();
  });

  it('a conclusão aparece antes de a API responder e é desfeita se a gravação falhar', async () => {
    const user = userEvent.setup();
    const { handlers } = fakeLearning();
    let release: (response: Response) => void = () => {};
    handlers[`PUT ${progressPath(LESSON_1)}`] = () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      });
    renderApp(lessonUrl(LESSON_1), apiRoutes(handlers), { session });
    await title('Boas-vindas ao curso');
    await screen.findByRole('region', { name: text.courseProgram });

    await user.click(screen.getByRole('button', { name: text.markDone }));
    // otimista: a tela já mudou, com a requisição ainda em aberto
    expect(await screen.findByRole('button', { name: text.unmarkDone })).toBeTruthy();
    expect(moduleButton(/Primeiros passos/).textContent).toContain('1 de 2 aulas · 50%');
    expect(courseBar().getAttribute('aria-valuenow')).toBe('33');

    await act(async () => {
      release(problemResponse(403, 'access_denied', { reason: 'expired' }));
    });
    expect(await screen.findByRole('button', { name: text.markDone })).toBeTruthy();
    expect(moduleButton(/Primeiros passos/).textContent).toContain('0 de 2 aulas · 0%');
    expect(courseBar().getAttribute('aria-valuenow')).toBe('0');
    const notices = within(screen.getByRole('region', { name: ptBR.common.notices }));
    expect(
      within(notices.getByRole('alert')).getByText(ptBR.learning.errors.accessDenied),
    ).toBeTruthy();
  });

  it('vídeo nativo no fim marca a aula e oferece "Desfazer"', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(lessonUrl(LESSON_1), apiRoutes(fakeLearning().handlers), {
      session,
    });
    await title('Boas-vindas ao curso');
    await screen.findByRole('region', { name: text.courseProgram });

    fireEvent.ended(video());
    expect(await screen.findByRole('button', { name: text.unmarkDone })).toBeTruthy();
    await waitFor(() =>
      expect(puts(calls).map((call) => call.body)).toContainEqual({
        completed: true,
        completedVia: 'video_end',
      }),
    );
    await waitFor(() => expect(courseBar().getAttribute('aria-valuenow')).toBe('33'));

    const notice = within(screen.getByRole('region', { name: ptBR.common.notices }));
    expect(notice.getByText(text.autoCompleted)).toBeTruthy();
    await user.click(notice.getByRole('button', { name: text.undo }));

    expect(await screen.findByRole('button', { name: text.markDone })).toBeTruthy();
    await waitFor(() => expect(puts(calls).at(-1)?.body).toEqual({ completed: false }));
    await waitFor(() => expect(courseBar().getAttribute('aria-valuenow')).toBe('0'));
    expect(notice.queryByText(text.autoCompleted)).toBeNull();
  });

  it('o "Desfazer" some depois de 8 s, e o fim do vídeo de aula já concluída não avisa', async () => {
    const { calls } = renderApp(lessonUrl(LESSON_1), apiRoutes(fakeLearning().handlers), {
      session,
    });
    await title('Boas-vindas ao curso');
    await screen.findByRole('region', { name: text.courseProgram });
    const notices = () => within(screen.getByRole('region', { name: ptBR.common.notices }));

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    fireEvent.ended(video());
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS - 100));
    expect(notices().getByRole('button', { name: text.undo })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(notices().queryByRole('button', { name: text.undo })).toBeNull();
    expect(screen.getByRole('button', { name: text.unmarkDone })).toBeTruthy();

    // já concluída: outro fim de vídeo não grava nem avisa de novo
    const before = puts(calls).filter((call) => 'completed' in (call.body as object)).length;
    fireEvent.ended(video());
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(puts(calls).filter((call) => 'completed' in (call.body as object))).toHaveLength(before);
    expect(notices().queryByRole('button', { name: text.undo })).toBeNull();
  });

  it('aula `link` vira botão "Abrir vídeo" e só conclui pelo botão', async () => {
    const user = userEvent.setup();
    const lesson = makeLesson({
      videoProvider: 'link',
      videoUrl: 'https://videos.exemplo.test/aula-1',
    });
    const { calls } = renderApp(
      lessonUrl(LESSON_1),
      apiRoutes(fakeLearning(makeCourseView(), [lesson]).handlers),
      { session },
    );
    await title('Boas-vindas ao curso');

    const open = screen.getByRole('link', { name: new RegExp(ptBR.learning.player.openVideo) });
    expect(open.getAttribute('href')).toBe('https://videos.exemplo.test/aula-1');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(document.querySelector('video, iframe')).toBeNull();

    // abrir o vídeo e sair da página não concluem nem gravam posição
    fireEvent.click(open);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(puts(calls)).toEqual([]);
    expect(screen.getByRole('button', { name: text.markDone })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: text.markDone }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]?.body).toEqual({ completed: true, completedVia: 'manual' });
    expect(await screen.findByRole('button', { name: text.unmarkDone })).toBeTruthy();
  });

  it('retoma na posição gravada e envia a posição com keepalive e CSRF, também ao sair', async () => {
    const lesson = makeLesson();
    lesson.userState.positionSeconds = 120;
    const { calls } = renderApp(
      lessonUrl(LESSON_1),
      apiRoutes(fakeLearning(makeCourseView(), [lesson]).handlers),
      { session },
    );
    await title('Boas-vindas ao curso');
    const media = video();

    fireEvent.loadedMetadata(media);
    expect(media.currentTime).toBe(120);

    // reproduzindo, antes de 15 s do último envio: nada vai
    media.currentTime = 131.4;
    fireEvent.timeUpdate(media);
    expect(puts(calls)).toEqual([]);

    // pausa: envia já
    media.currentTime = 140.9;
    fireEvent.pause(media);
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]).toEqual({
      method: 'PUT',
      path: progressPath(LESSON_1),
      search: '',
      body: { positionSeconds: 140 },
      csrf: 'csrf-teste-1',
      keepalive: true,
    });

    // saída da página: a última posição vai por fetch com keepalive
    media.currentTime = 152;
    fireEvent.timeUpdate(media);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    expect(puts(calls)[1]).toMatchObject({
      body: { positionSeconds: 152 },
      csrf: 'csrf-teste-1',
      keepalive: true,
    });
    // gravar a posição não mexe na conclusão
    expect(screen.getByRole('button', { name: text.markDone })).toBeTruthy();
  });

  it('vídeo que não carrega mostra o aviso com "Abrir em nova aba"', async () => {
    renderApp(lessonUrl(LESSON_1), apiRoutes(fakeLearning().handlers), { session });
    await title('Boas-vindas ao curso');
    fireEvent.error(video());
    const alert = within(
      (await screen.findByText(text.videoErrorTitle)).closest('[role="alert"]') as HTMLElement,
    );
    const open = alert.getByRole('link', { name: new RegExp(text.openInNewTab) });
    expect(open.getAttribute('href')).toBe('https://cdn.exemplo.test/aulas/boas-vindas.mp4');
    expect(open.getAttribute('target')).toBe('_blank');
    await expectNoAxeViolations();
  });

  it('a navegação troca de aula, e a última oferece "Concluir curso"', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp(lessonUrl(LESSON_2), apiRoutes(fakeLearning().handlers), {
      session,
    });
    await title('Seu primeiro componente');
    const nav = () => within(screen.getByRole('navigation', { name: text.navigation }));
    expect(nav().getByRole('link', { name: text.previous }).getAttribute('href')).toBe(
      lessonUrl(LESSON_1),
    );

    await user.click(nav().getByRole('link', { name: text.next }));
    expect(await title('useState na prática')).toBeTruthy();
    expect(video().src).toBe('https://cdn.exemplo.test/aulas/estado.mp4');
    await waitFor(() =>
      expect(moduleButton(/Estado e efeitos/).getAttribute('aria-expanded')).toBe('true'),
    );
    expect(nav().queryByRole('link', { name: text.next })).toBeNull();

    await user.click(nav().getByRole('button', { name: text.finishCourse }));
    await waitFor(() => expect(router.state.location.pathname).toBe(COURSE_PATH));
    await waitFor(() =>
      expect(puts(calls).map((call) => [call.path, call.body])).toContainEqual([
        progressPath(LESSON_3),
        { completed: true, completedVia: 'manual' },
      ]),
    );
  });

  it('sem acesso: no lugar do player, o motivo e o caminho até a página do curso', async () => {
    const { handlers } = fakeLearning(
      makeCourseView({ access: { allowed: false, reason: 'expired', expiresAt: null } }),
      [],
    );
    handlers[`GET /api/v1/lessons/${LESSON_2}`] = () =>
      problemResponse(403, 'access_denied', { reason: 'expired' });
    const { calls } = renderApp(lessonUrl(LESSON_2), apiRoutes(handlers), { session });

    expect(await title('Seu primeiro componente')).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.getByText(text.lockedTitle)).toBeTruthy();
    expect(main.getByText(ptBR.learning.reasons.expired)).toBeTruthy();
    expect(
      main.getByRole('link', { name: ptBR.learning.course.publicPage }).getAttribute('href'),
    ).toBe('/cursos/react-do-zero');
    expect(main.getByRole('link', { name: text.backToCourse }).getAttribute('href')).toBe(
      COURSE_PATH,
    );
    expect(document.querySelector('video, iframe')).toBeNull();
    expect(main.queryByRole('button', { name: text.markDone })).toBeNull();
    expect(main.queryByRole('alert')).toBeNull();
    expect(puts(calls)).toEqual([]);
    await expectNoAxeViolations();
  });

  it('aula inexistente ou despublicada (404) mostra "não encontrada"', async () => {
    const { handlers } = fakeLearning(makeCourseView(), []);
    handlers[`GET /api/v1/lessons/${LESSON_1}`] = () => problemResponse(404, 'not_found');
    renderApp(lessonUrl(LESSON_1), apiRoutes(handlers), { session });
    expect(await title(text.notFoundTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: text.backToCourse }).getAttribute('href')).toBe(
      COURSE_PATH,
    );
  });

  it('endereço com o curso errado vai para o curso da aula', async () => {
    const { router } = renderApp(
      `/meus-cursos/outro-curso/aulas/${LESSON_2}`,
      apiRoutes(fakeLearning(makeCourseView(), [LESSON_2_VIEW(), LESSON_3_VIEW()]).handlers),
      { session },
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(lessonUrl(LESSON_2)));
    expect(await title('Seu primeiro componente')).toBeTruthy();
  });

  it('visitante vai para o login, com o caminho de volta', async () => {
    const { router } = renderApp(lessonUrl(LESSON_1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(new URLSearchParams(router.state.location.search).get('destino')).toBe(
      lessonUrl(LESSON_1),
    );
  });
});
