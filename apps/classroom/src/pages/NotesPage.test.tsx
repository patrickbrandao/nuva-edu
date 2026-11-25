import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { COURSE } from '../test/catalog';
import { LESSON_1, lessonUrl } from '../test/learning';
import { fakeNotes, makeNote, NOTE_1, NOTE_2, NOTE_3, NOTE_LESSON } from '../test/notes';
import {
  apiRoutes,
  inMain,
  makeSession,
  type RecordedRequest,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';
import { fakeShelf } from '../test/shelf';

const session = makeSession();
const t = ptBR.notes;
const NOTES = '/api/v1/notes';

/** Nota de aula com instante, nota avulsa com título e nota de aula que saiu do ar. */
const THREE = [
  makeNote({ body: 'Componentes são funções.', updatedAt: '2026-11-22T12:00:00.000Z' }),
  makeNote({
    id: NOTE_2,
    lesson: null,
    videoSeconds: null,
    title: 'Ideias de projeto',
    body: 'Um caderno de receitas.',
    updatedAt: '2026-11-23T12:00:00.000Z',
  }),
  makeNote({
    id: NOTE_3,
    lesson: {
      ...NOTE_LESSON,
      id: null,
      title: 'Aula antiga',
      courseId: null,
      courseSlug: null,
      courseTitle: 'Curso antigo',
      available: false,
    },
    videoSeconds: null,
    body: 'Sobre hooks.',
    updatedAt: '2026-11-21T12:00:00.000Z',
  }),
];

async function open(
  notes = THREE,
  options: Parameters<typeof fakeNotes>[2] = {},
  path = '/anotacoes',
) {
  const user = userEvent.setup();
  const api = fakeNotes(notes, apiRoutes(fakeShelf()), options);
  const view = renderApp(path, api.fetch, { session });
  await screen.findByRole('main');
  return { user, api, ...view };
}

const list = async () => within(await inMain().findByRole('list', { name: t.page.list }));
const names = async () =>
  (await list()).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
const queries = (calls: RecordedRequest[]) =>
  calls
    .filter((call) => call.path === NOTES && call.method === 'GET')
    .map((call) => new URLSearchParams(call.search));
const writes = (calls: RecordedRequest[]) =>
  calls.filter((call) => call.path.startsWith(NOTES) && call.method !== 'GET');

describe('página "Anotações"', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/anotacoes');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fanotacoes');
  });

  it('lista da alteração mais recente à mais antiga, com o link de volta para a aula e o instante', async () => {
    const { calls } = await open();
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.menu.items.notes }),
    ).toBeTruthy();
    expect(await names()).toEqual([
      'Ideias de projeto',
      'Componentes são funções.',
      'Sobre hooks.',
    ]);
    const items = await list();

    // nota de aula: curso, aula, instante e o link para a aula naquele ponto
    const back = items.getByRole('link', { name: 'React do zero · Boas-vindas ao curso' });
    expect(back.getAttribute('href')).toBe(`${lessonUrl(LESSON_1)}?t=83`);
    expect(items.getByText('Instante do vídeo: 1:23')).toBeTruthy();
    // avulsa: título e trecho
    expect(items.getByText('Um caderno de receitas.')).toBeTruthy();
    expect(items.getByText(t.page.standalone)).toBeTruthy();
    // aula fora do ar: títulos guardados, sem link
    expect(items.getByText(/Curso antigo · Aula antiga/)).toBeTruthy();
    expect(items.queryByRole('link', { name: /Aula antiga/ })).toBeNull();

    expect(queries(calls)[0]?.toString()).toBe('limit=30');
    await waitFor(() => expect(document.title).toBe('Anotações · Escola Aurora'));
    await expectNoAxeViolations();
  });

  it('filtra por tipo, por curso e por busca, e carrega a página seguinte', async () => {
    const { user, calls, router } = await open(THREE, { pageSize: 2 });
    expect(await names()).toHaveLength(2);
    await user.click(inMain().getByRole('button', { name: t.page.more }));
    await waitFor(async () => expect(await names()).toHaveLength(3));
    expect(queries(calls).at(-1)?.get('cursor')).toBe('2');

    await user.click(inMain().getByRole('tab', { name: t.page.filters.standalone }));
    await waitFor(async () => expect(await names()).toEqual(['Ideias de projeto']));
    expect(queries(calls).at(-1)?.get('kind')).toBe('standalone');
    expect(router.state.location.search).toBe('?tipo=avulsas');

    await user.click(inMain().getByRole('tab', { name: t.page.filters.all }));
    await user.click(inMain().getByRole('button', { name: /^Curso: Todos os cursos/ }));
    await user.click(await screen.findByRole('option', { name: 'React do zero' }));
    await waitFor(async () => expect(await names()).toEqual(['Componentes são funções.']));
    expect(queries(calls).at(-1)?.get('courseId')).toBe(COURSE.id);

    await user.type(inMain().getByRole('searchbox', { name: t.page.filters.search }), 'hooks');
    expect(await inMain().findByText(t.page.noResultsTitle)).toBeTruthy();
    expect(queries(calls).at(-1)?.get('q')).toBe('hooks');
    await user.click(inMain().getByRole('button', { name: t.page.filters.clear }));
    // sem filtro, a lista volta com as páginas que já tinham sido carregadas
    await waitFor(async () => expect(await names()).toHaveLength(3));
    expect(router.state.location.search).toBe('');
  });

  it('vazia: mostra os três passos e os dois botões, e a ideia avulsa nasce sem aula nem instante', async () => {
    const { user, calls, api } = await open([]);
    expect(await inMain().findByText(t.page.emptyTitle)).toBeTruthy();
    const steps = within(inMain().getByRole('list')).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      t.page.steps.open,
      t.page.steps.tab,
      t.page.steps.write,
    ]);
    expect(inMain().getByRole('link', { name: t.page.goToCourses }).getAttribute('href')).toBe(
      '/meus-cursos',
    );

    await user.click(inMain().getByRole('button', { name: t.page.writeIdea }));
    const dialog = within(await screen.findByRole('dialog', { name: t.page.new }));
    await user.type(dialog.getByRole('textbox', { name: t.editor.title }), '  Ideia  ');
    await user.type(dialog.getByRole('textbox', { name: t.editor.body }), 'Um app de notas');
    await user.tab();
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: 'POST', path: NOTES });
    expect(writes(calls)[0]?.body).toEqual({ title: 'Ideia', body: 'Um app de notas' });
    await waitFor(() => expect(dialog.getByRole('status').textContent).toBe(t.editor.saved));

    await user.click(dialog.getByRole('button', { name: t.editor.done }));
    expect(await names()).toEqual(['Ideia']);
    expect(api.state.notes[0]).toMatchObject({ lesson: null, videoSeconds: null });
    await user.click(inMain().getByRole('tab', { name: t.page.filters.standalone }));
    await waitFor(async () => expect(await names()).toEqual(['Ideia']));
  });

  it('edita a nota inteira a partir da lista e grava o que falta ao fechar', async () => {
    const { user, calls, api } = await open();
    await user.click((await list()).getByRole('button', { name: /^Editar anotação: Componentes/ }));
    const dialog = within(await screen.findByRole('dialog', { name: t.page.editTitle }));
    const body = (await dialog.findByRole('textbox', {
      name: t.editor.body,
    })) as HTMLTextAreaElement;
    expect(body.value).toBe('Componentes são funções.');
    expect(calls.some((call) => call.path === `${NOTES}/${NOTE_1}` && call.method === 'GET')).toBe(
      true,
    );

    await user.type(body, ' E recebem props.');
    // fechar sem esperar os 2 s: o texto é gravado mesmo assim
    await user.click(dialog.getByRole('button', { name: t.editor.done }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      method: 'PATCH',
      path: `${NOTES}/${NOTE_1}`,
      body: { body: 'Componentes são funções. E recebem props.', updatedAt: THREE[0]?.updatedAt },
    });
    // a nota alterada sobe para o topo da lista
    await waitFor(async () =>
      expect((await names())[0]).toBe('Componentes são funções. E recebem props.'),
    );
    expect(api.state.notes[0]?.body).toBe('Componentes são funções. E recebem props.');
  });

  it('exclui com confirmação que cita a nota', async () => {
    const { user, calls } = await open();
    await user.click(
      (await list()).getByRole('button', { name: 'Excluir anotação: Sobre hooks.' }),
    );
    const confirm = within(await screen.findByRole('alertdialog', { name: t.delete.title }));
    expect(confirm.getByText('Sobre hooks.')).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: ptBR.common.cancel }));
    expect(writes(calls)).toEqual([]);

    await user.click(
      (await list()).getByRole('button', { name: 'Excluir anotação: Sobre hooks.' }),
    );
    const again = within(await screen.findByRole('alertdialog', { name: t.delete.title }));
    await user.click(again.getByRole('button', { name: t.delete.confirm }));
    await waitFor(async () => expect(await names()).toHaveLength(2));
    expect(writes(calls)).toMatchObject([{ method: 'DELETE', path: `${NOTES}/${NOTE_3}` }]);
    const notices = within(screen.getByRole('region', { name: ptBR.common.notices }));
    expect(await notices.findByText(t.delete.done)).toBeTruthy();
  });

  it('falha ao carregar mostra o erro com "Tentar de novo"', async () => {
    renderApp(
      '/anotacoes',
      apiRoutes({ ...fakeShelf(), [`GET ${NOTES}`]: () => unavailableResponse() }),
      { session },
    );
    await screen.findByRole('main');
    expect(await inMain().findByText(t.page.errorTitle)).toBeTruthy();
    expect(inMain().getByRole('button', { name: ptBR.common.retry })).toBeTruthy();
  });
});
