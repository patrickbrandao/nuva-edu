import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { AUTOSAVE_MS } from '../notes/notes';
import { expectNoAxeViolations } from '../test/axe';
import { fakeLearning, LESSON_1, lessonUrl, makeCourseView, makeLesson } from '../test/learning';
import { fakeNotes, makeNote, NOTE_1, NOTE_2 } from '../test/notes';
import {
  apiRoutes,
  findAlert,
  inMain,
  makeSession,
  problemResponse,
  queryAlert,
  type RecordedRequest,
  renderApp,
} from '../test/renderApp';

const session = makeSession();
const t = ptBR.notes;
const NOTES = '/api/v1/notes';

type Notes = Parameters<typeof fakeNotes>[0];

/** A página da aula com a API de notas simulada, já na aba "Minhas notas". */
async function openNotes(
  notes: Notes = [],
  options: Parameters<typeof fakeNotes>[2] = {},
  path = lessonUrl(LESSON_1),
  learning = fakeLearning().handlers,
) {
  const user = userEvent.setup();
  const api = fakeNotes(notes, apiRoutes(learning), options);
  const view = renderApp(path, api.fetch, { session });
  await screen.findByRole('heading', { level: 1, name: 'Boas-vindas ao curso' });
  await user.click(screen.getByRole('tab', { name: ptBR.learning.lesson.tabs.notes }));
  return { user, api, ...view };
}

const writes = (calls: RecordedRequest[]) =>
  calls.filter((call) => call.path.startsWith(NOTES) && call.method !== 'GET');
const newField = () => inMain().findByRole('textbox', { name: t.lesson.newLabel });
const status = () => inMain().getByRole('status').textContent;

function video(): HTMLVideoElement {
  const element = document.querySelector('video');
  if (!element) throw new Error('a página não tem <video>');
  Object.defineProperty(element, 'currentTime', { value: 0, writable: true, configurable: true });
  return element;
}

describe('aba "Minhas notas" da aula', () => {
  it('lista as notas da mais antiga à mais recente, higienizadas, e o instante leva o player ao ponto', async () => {
    const { user, calls } = await openNotes([
      makeNote({
        id: NOTE_2,
        body: 'Segunda nota',
        videoSeconds: null,
        createdAt: '2026-11-21T12:00:00.000Z',
      }),
      makeNote(),
    ]);
    const list = within(await inMain().findByRole('list', { name: t.lesson.list }));
    const items = list.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Componentes são funções.');
    expect(items[1]?.textContent).toContain('Segunda nota');
    expect(list.getByText('funções').tagName).toBe('STRONG');
    expect(document.querySelector('main script')).toBeNull();

    const player = video();
    await user.click(list.getByRole('button', { name: 'Ir para 1:23 no vídeo' }));
    expect(player.currentTime).toBe(83);

    // uma consulta só, sem paginação
    const lists = calls.filter((call) => call.path === `/api/v1/lessons/${LESSON_1}/notes`);
    expect(lists).toHaveLength(1);
    expect(lists[0]?.search).toBe('');
    await expectNoAxeViolations();
  });

  it('salva sozinha em até 2 s, com o instante inteiro, e cada gravação leva o updatedAt da anterior', async () => {
    const { user, calls, api } = await openNotes();
    expect(await inMain().findByText(t.lesson.empty)).toBeTruthy();
    video().currentTime = 83.9;

    const startedAt = Date.now();
    await user.type(await newField(), 'Primeira ideia');
    expect(writes(calls)).toEqual([]);
    expect(status()).toBe(t.editor.unsaved);
    await waitFor(() => expect(writes(calls)).toHaveLength(1), { timeout: AUTOSAVE_MS + 1500 });
    expect(Date.now() - startedAt).toBeLessThan(AUTOSAVE_MS + 1500);
    expect(writes(calls)[0]).toMatchObject({
      method: 'POST',
      path: NOTES,
      body: { lessonId: LESSON_1, body: 'Primeira ideia', videoSeconds: 83 },
      csrf: 'csrf-teste-1',
    });
    await waitFor(() => expect(status()).toBe(t.editor.saved));
    expect(inMain().getByText('Instante do vídeo: 1:23')).toBeTruthy();
    const first = api.state.notes[0]?.updatedAt;

    // sair do campo grava na hora, com o updatedAt da criação
    await user.type(await newField(), ' e mais');
    await user.tab();
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toMatchObject({
      method: 'PATCH',
      body: { body: 'Primeira ideia e mais', updatedAt: first },
    });
    await waitFor(() => expect(status()).toBe(t.editor.saved));
    const second = api.state.notes[0]?.updatedAt;
    expect(second).not.toBe(first);

    // remover o instante manda `null` com o updatedAt da última resposta
    await user.click(inMain().getByRole('button', { name: t.instant.remove }));
    await waitFor(() => expect(writes(calls)).toHaveLength(3));
    expect(writes(calls)[2]?.body).toEqual({ videoSeconds: null, updatedAt: second });

    // sair de novo sem mudar nada não grava
    await user.click(await newField());
    await user.tab();
    expect(writes(calls)).toHaveLength(3);

    // concluir leva a nota à lista e esvazia o campo
    await user.click(inMain().getByRole('button', { name: t.lesson.finish }));
    expect(((await newField()) as HTMLTextAreaElement).value).toBe('');
    const list = within(inMain().getByRole('list', { name: t.lesson.list }));
    expect(list.getByText('Primeira ideia e mais')).toBeTruthy();
  }, 15_000);

  it('no limite de notas da aula mostra o aviso e mantém o texto digitado', async () => {
    const { user, api } = await openNotes([], { createFails: 'note_lesson_limit_reached' });
    await user.type(await newField(), 'Nota 101');
    await user.tab();
    expect((await findAlert()).textContent).toContain(t.errors.lessonLimit);
    expect(((await newField()) as HTMLTextAreaElement).value).toBe('Nota 101');
    expect(status()).toBe(t.editor.notSaved);

    // o limite geral (5.000) tem o seu aviso, e o texto continua lá
    api.state.options.createFails = 'note_limit_reached';
    await user.click(inMain().getByRole('button', { name: t.editor.retry }));
    await waitFor(() => expect(queryAlert()?.textContent).toContain(t.errors.limit));
    expect(((await newField()) as HTMLTextAreaElement).value).toBe('Nota 101');
  });

  it('conflito de edição: mostra a versão do servidor e copia a local para uma nota nova', async () => {
    const { user, api, calls } = await openNotes([makeNote({ body: 'Texto original' })]);
    const list = within(await inMain().findByRole('list', { name: t.lesson.list }));
    await user.click(list.getByRole('button', { name: /^Editar anotação/ }));
    const field = inMain().getByRole('textbox', { name: t.lesson.editLabel });
    api.editElsewhere(NOTE_1, 'Texto do celular');
    await user.type(field, ' com adendo');
    await user.tab();

    const dialog = within(await screen.findByRole('alertdialog', { name: t.conflict.title }));
    expect(dialog.getByText('Texto do celular')).toBeTruthy();
    expect(dialog.getByText('Texto original com adendo')).toBeTruthy();
    for (const choice of [t.conflict.keepLocal, t.conflict.useServer, t.conflict.copy]) {
      expect(dialog.getByRole('button', { name: choice })).toBeTruthy();
    }

    // a cópia também pode bater no limite: o aviso aparece e o texto local continua guardado
    api.state.options.createFails = 'note_limit_reached';
    await user.click(dialog.getByRole('button', { name: t.conflict.copy }));
    expect((await findAlert()).textContent).toContain(t.errors.limit);
    expect(dialog.getByText('Texto original com adendo')).toBeTruthy();

    api.state.options.createFails = null;
    await user.click(dialog.getByRole('button', { name: t.conflict.copy }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const posts = writes(calls).filter((call) => call.method === 'POST');
    expect(posts.at(-1)?.body).toEqual({
      lessonId: LESSON_1,
      body: 'Texto original com adendo',
      videoSeconds: 83,
    });
    // a nota em edição fica com a versão do servidor; a cópia entra na lista
    expect((field as HTMLTextAreaElement).value).toBe('Texto do celular');
    expect(api.state.notes.map((note) => note.body)).toEqual([
      'Texto do celular',
      'Texto original com adendo',
    ]);
    expect(await inMain().findByText('Texto original com adendo')).toBeTruthy();
  });

  it('conflito de edição: manter a local grava por cima com o updatedAt da versão atual', async () => {
    const { user, api, calls } = await openNotes([makeNote({ body: 'Texto original' })]);
    const list = within(await inMain().findByRole('list', { name: t.lesson.list }));
    await user.click(list.getByRole('button', { name: /^Editar anotação/ }));
    const field = inMain().getByRole('textbox', { name: t.lesson.editLabel });
    const current = api.editElsewhere(NOTE_1, 'Texto do celular').updatedAt;
    await user.clear(field);
    await user.type(field, 'Meu texto');
    await user.tab();

    const dialog = within(await screen.findByRole('alertdialog', { name: t.conflict.title }));
    await user.click(dialog.getByRole('button', { name: t.conflict.keepLocal }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(writes(calls).at(-1)).toMatchObject({
      method: 'PATCH',
      path: `${NOTES}/${NOTE_1}`,
      body: { body: 'Meu texto', updatedAt: current },
    });
    expect(api.state.notes[0]?.body).toBe('Meu texto');
    const item = within(field.closest('li') as HTMLElement);
    await waitFor(() => expect(item.getByRole('status').textContent).toBe(t.editor.saved));

    // usar a do servidor num segundo conflito troca o texto do campo
    api.editElsewhere(NOTE_1, 'Outra vez no celular');
    await user.type(field, '!');
    await user.tab();
    const again = within(await screen.findByRole('alertdialog', { name: t.conflict.title }));
    await user.click(again.getByRole('button', { name: t.conflict.useServer }));
    expect((field as HTMLTextAreaElement).value).toBe('Outra vez no celular');
    expect(api.state.notes[0]?.body).toBe('Outra vez no celular');
  });

  it('exclui com confirmação, e esvaziar uma nota pergunta se é para excluir', async () => {
    const { user, api, calls } = await openNotes([
      makeNote({ body: 'Fica' }),
      makeNote({ id: NOTE_2, body: 'Sai', createdAt: '2026-11-21T12:00:00.000Z' }),
    ]);
    const list = () => within(inMain().getByRole('list', { name: t.lesson.list }));
    await inMain().findByRole('list', { name: t.lesson.list });

    await user.click(list().getByRole('button', { name: 'Excluir anotação: Sai' }));
    const confirm = within(await screen.findByRole('alertdialog', { name: t.delete.title }));
    expect(confirm.getByText('Sai')).toBeTruthy();
    expect(writes(calls)).toEqual([]);
    await user.click(confirm.getByRole('button', { name: t.delete.confirm }));
    await waitFor(() => expect(list().getAllByRole('listitem')).toHaveLength(1));
    expect(writes(calls)).toMatchObject([{ method: 'DELETE', path: `${NOTES}/${NOTE_2}` }]);

    // esvaziar: nada é gravado; cancelar devolve o texto salvo
    await user.click(list().getByRole('button', { name: 'Editar anotação: Fica' }));
    const field = inMain().getByRole('textbox', { name: t.lesson.editLabel });
    await user.clear(field);
    await user.tab();
    const emptied = within(await screen.findByRole('alertdialog', { name: t.emptied.title }));
    await user.click(emptied.getByRole('button', { name: t.emptied.keep }));
    expect((field as HTMLTextAreaElement).value).toBe('Fica');
    expect(writes(calls)).toHaveLength(1);

    await user.clear(field);
    await user.tab();
    const second = within(await screen.findByRole('alertdialog', { name: t.emptied.title }));
    await user.click(second.getByRole('button', { name: t.delete.confirm }));
    await waitFor(() => expect(api.state.notes).toEqual([]));
    expect(await inMain().findByText(t.lesson.empty)).toBeTruthy();
  });

  it('em vídeo por iframe (Panda), a nota nova leva o instante atual do player, não o último envio', async () => {
    const origin = 'https://player-vz-ded14ebd-85a.tv.pandavideo.com.br';
    const lesson = makeLesson({ videoProvider: 'panda', videoUrl: `${origin}/embed/?v=3b101f05` });
    lesson.userState.positionSeconds = 12;
    const { user, calls } = await openNotes(
      [],
      {},
      lessonUrl(LESSON_1),
      fakeLearning(makeCourseView(), [lesson]).handlers,
    );
    const frame = document.querySelector('main iframe');
    if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow)
      throw new Error('sem iframe');
    vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
    const fromPanda = (data: unknown) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', { data, origin, source: frame.contentWindow }),
        );
      });
    fromPanda({ message: 'panda_ready' });
    // antes de 15 s do último envio: o `onTime` não sai, mas o player já sabe a posição
    fromPanda({ message: 'panda_timeupdate', currentTime: 47.6 });

    await user.type(await newField(), 'No Panda');
    await user.tab();
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]?.body).toEqual({
      lessonId: LESSON_1,
      body: 'No Panda',
      videoSeconds: 47,
    });
  });

  it('o endereço com ?t= abre o vídeo no instante da nota', async () => {
    await openNotes([], {}, `${lessonUrl(LESSON_1)}?t=83`);
    const element = video();
    fireEvent.loadedMetadata(element);
    expect(element.currentTime).toBe(83);
  });

  it('sem acesso à aula, as notas seguem legíveis e editáveis, sem campo de nota nova', async () => {
    const learning = fakeLearning().handlers;
    learning[`GET /api/v1/lessons/${LESSON_1}`] = () =>
      problemResponse(403, 'access_denied', { reason: 'expired' });
    const api = fakeNotes([makeNote({ body: 'Nota antiga' })], apiRoutes(learning));
    renderApp(lessonUrl(LESSON_1), api.fetch, { session });

    expect(await screen.findByText(ptBR.learning.reasons.expired)).toBeTruthy();
    const list = within(await inMain().findByRole('list', { name: t.lesson.list }));
    expect(list.getByText('Nota antiga')).toBeTruthy();
    expect(list.getByRole('button', { name: /^Editar anotação/ })).toBeTruthy();
    // sem player, o instante é só informativo
    expect(list.getByText('Instante do vídeo: 1:23')).toBeTruthy();
    expect(inMain().queryByRole('textbox', { name: t.lesson.newLabel })).toBeNull();
  });
});
