import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { notificationHref } from '../notifications/format';
import { expectNoAxeViolations } from '../test/axe';
import { fakeLearning, LESSON_1, lessonUrl } from '../test/learning';
import { FakeEventSource, notificationItem } from '../test/notifications';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  noContent,
  problemResponse,
  type RecordedRequest,
  renderApp,
} from '../test/renderApp';

type Topic = ClassroomSchemas['ForumTopicSummary'];
type Post = ClassroomSchemas['ForumPost'];
type Detail = ClassroomSchemas['ForumTopicDetail'];

const t = ptBR.forum;
const uuid = (n: number) => `0193a5b2-7c1e-7d3a-9f4b-${String(n).padStart(12, '0')}`;
const session = makeSession();
const me = { id: session.user.id, displayName: 'Ana Souza' };
const other = { id: uuid(90), displayName: 'Bruno Lima' };
const date = '2026-11-27T22:00:00.000Z';
const courseCategory = uuid(1);
const freeCategory = uuid(2);
const topicId = uuid(10);
const postId = uuid(20);

const category = (id: string, name: string): ClassroomSchemas['ForumCategory'] => ({
  id,
  kind: id === courseCategory ? 'course' : 'free',
  courseId: id === courseCategory ? uuid(5) : null,
  audience: 'all',
  name,
  description: null,
  position: 0,
  archivedAt: null,
});

const topic = (overrides: Partial<Topic> = {}): Topic => ({
  id: topicId,
  categoryId: courseCategory,
  lessonId: null,
  author: me,
  title: 'Como organizar os estudos',
  status: 'open',
  pinned: false,
  solutionPostId: null,
  postsCount: 1,
  lastActivityAt: date,
  following: false,
  ...overrides,
});

const post = (overrides: Partial<Post> = {}): Post => ({
  id: postId,
  topicId,
  parentPostId: null,
  author: other,
  bodyHtml: '<p>Use um calendário semanal.</p>',
  createdAt: date,
  editedAt: null,
  deletedAt: null,
  hiddenAt: null,
  moderatedAt: null,
  reactions: [],
  ...overrides,
});

const detail = (overrides: Partial<Detail> = {}, summary: Partial<Topic> = {}): Detail => ({
  topic: topic(summary),
  bodyHtml: '<p>Alguém tem dicas?</p>',
  createdAt: date,
  editedAt: null,
  deletedAt: null,
  hiddenAt: null,
  moderatedAt: null,
  reactions: [],
  canWrite: true,
  ...overrides,
});

const page = <T,>(items: T[]) => ({ items, nextCursor: null });
const topicUrl = (id = topicId) => `/api/v1/forum/topics/${id}`;
const sent = (calls: RecordedRequest[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path);

/** Tópico aberto com uma resposta; `handlers` acrescenta ou troca rotas. */
function topicRoutes(
  shown: () => Detail,
  posts: () => Post[],
  handlers: Parameters<typeof apiRoutes>[0] = {},
) {
  return apiRoutes({
    [`GET ${topicUrl()}`]: () => jsonResponse(shown()),
    [`GET ${topicUrl()}/posts`]: () => jsonResponse(page(posts())),
    ...handlers,
  });
}

describe('lista do fórum', () => {
  const routes = (handlers: Parameters<typeof apiRoutes>[0] = {}) =>
    apiRoutes({
      'GET /api/v1/forum/categories': () =>
        jsonResponse(
          page([category(courseCategory, 'React do zero'), category(freeCategory, 'Geral')]),
        ),
      [`GET /api/v1/forum/categories/${courseCategory}/topics`]: () =>
        jsonResponse(page([topic({ pinned: true }), topic({ id: uuid(11), title: 'Aula 1' })])),
      [`GET /api/v1/forum/categories/${freeCategory}/topics`]: () => jsonResponse(page([])),
      'GET /api/v1/forum/search': () =>
        jsonResponse(page([topic({ id: uuid(12), title: 'Resultado da busca' })])),
      ...handlers,
    });

  it('mostra as categorias que a API devolve, filtra, separa aulas de discussões e busca', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp('/forum', routes(), { session });

    const pinned = await screen.findByRole('link', { name: 'Como organizar os estudos' });
    expect(pinned.getAttribute('href')).toBe(`/forum/t/${topicId}`);
    expect(screen.getByText(t.pinned)).toBeTruthy();
    const categories = screen.getByRole('combobox', { name: t.category });
    expect(within(categories).getAllByRole('option')).toHaveLength(2);
    await expectNoAxeViolations();

    const topicsPath = `/api/v1/forum/categories/${courseCategory}/topics`;
    await user.selectOptions(screen.getByRole('combobox', { name: t.kind }), 'discussions');
    await user.selectOptions(screen.getByRole('combobox', { name: t.filter }), 'following');
    await waitFor(() =>
      expect(
        sent(calls, 'GET', topicsPath).some(
          ({ search }) =>
            search.includes('kind=discussions') && search.includes('filter=following'),
        ),
      ).toBe(true),
    );

    await user.selectOptions(categories, freeCategory);
    expect(await screen.findByText(t.empty)).toBeTruthy();

    await user.type(screen.getByRole('searchbox', { name: t.search }), 'calendário');
    await user.click(screen.getByRole('button', { name: t.searchButton }));
    expect(await screen.findByRole('link', { name: 'Resultado da busca' })).toBeTruthy();
    const search = new URLSearchParams(sent(calls, 'GET', '/api/v1/forum/search').at(-1)?.search);
    expect(search.get('q')).toBe('calendário');
    expect(search.get('categoryId')).toBe(freeCategory);
  });

  it('cria um tópico na categoria escolhida e abre o tópico criado', async () => {
    const user = userEvent.setup();
    const created = detail({}, { id: uuid(13), title: 'Grupo de estudos', postsCount: 0 });
    const { calls, router } = renderApp(
      '/forum',
      routes({
        [`POST /api/v1/forum/categories/${courseCategory}/topics`]: () =>
          jsonResponse(created, 201),
        [`GET ${topicUrl(uuid(13))}`]: () => jsonResponse(created),
        [`GET ${topicUrl(uuid(13))}/posts`]: () => jsonResponse(page([])),
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: t.newTopic }));
    const form = within(screen.getByRole('form', { name: t.newTopic }));
    await user.type(form.getByRole('textbox', { name: t.topicTitle }), 'Oi');
    await user.type(form.getByRole('textbox', { name: t.message }), 'Vamos estudar juntos?');
    await user.click(form.getByRole('button', { name: t.newTopic }));
    expect((await form.findByRole('alert')).textContent).toBe(t.invalidMessage);

    await user.type(form.getByRole('textbox', { name: t.topicTitle }), ' Grupo de estudos');
    await user.click(form.getByRole('button', { name: t.newTopic }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/forum/t/${uuid(13)}`));
    expect(
      sent(calls, 'POST', `/api/v1/forum/categories/${courseCategory}/topics`)[0]?.body,
    ).toEqual({ title: 'Oi Grupo de estudos', bodyMd: 'Vamos estudar juntos?' });
    expect(await screen.findByRole('heading', { name: 'Grupo de estudos' })).toBeTruthy();
  });

  it('quem não confirmou o e-mail só lê: não há "Criar tópico"', async () => {
    renderApp('/forum', routes(), {
      session: makeSession({ user: { emailVerified: false } }),
    });
    await screen.findByRole('link', { name: 'Como organizar os estudos' });
    expect(screen.queryByRole('button', { name: t.newTopic })).toBeNull();
  });

  it('lista as denúncias feitas pelo aluno com o estado de cada uma', async () => {
    renderApp(
      '/forum/denuncias',
      apiRoutes({
        'GET /api/v1/me/reports': () =>
          jsonResponse(
            page([
              {
                id: uuid(30),
                targetType: 'forum_post',
                targetId: postId,
                reason: 'spam',
                status: 'open',
                createdAt: date,
              },
            ]),
          ),
      }),
      { session },
    );
    expect(await screen.findByText(`${t.reportReasons.spam} · ${t.reportOpen}`)).toBeTruthy();
  });

  it('visitante vai para o login', async () => {
    const { router } = renderApp('/forum');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
  });
});

describe('tópico', () => {
  it('o autor marca e desfaz a solução, e a solução sobe para logo abaixo do tópico', async () => {
    const user = userEvent.setup();
    let solution: string | null = null;
    const first = post({ id: uuid(21), bodyHtml: '<p>Primeira resposta.</p>' });
    const { calls } = renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail({}, { solutionPostId: solution, postsCount: 2 }),
        () => [first, post()],
        {
          [`PUT ${topicUrl()}/solution`]: async (request) => {
            solution = ((await request.json()) as { postId: string | null }).postId;
            return jsonResponse(detail({}, { solutionPostId: solution }));
          },
        },
      ),
      { session },
    );

    await screen.findByText('Use um calendário semanal.');
    const articles = () => screen.getAllByRole('article').map((item) => item.id);
    expect(articles()).toEqual([`post-${uuid(21)}`, `post-${postId}`]);
    const card = () => within(document.getElementById(`post-${postId}`) as HTMLElement);
    await user.click(card().getByRole('button', { name: t.solution }));
    await waitFor(() => expect(articles()).toEqual([`post-${postId}`, `post-${uuid(21)}`]));
    expect(card().getByText(t.solved)).toBeTruthy();

    await user.click(card().getByRole('button', { name: t.undoSolution }));
    await waitFor(() => expect(articles()).toEqual([`post-${uuid(21)}`, `post-${postId}`]));
    expect(sent(calls, 'PUT', `${topicUrl()}/solution`).map((call) => call.body)).toEqual([
      { postId },
      { postId: null },
    ]);
  });

  it('terceiros não marcam solução, e tópico de aula não tem solução', async () => {
    const view = renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail({}, { author: other }),
        () => [post()],
      ),
      { session },
    );
    await screen.findByText('Use um calendário semanal.');
    expect(screen.queryByRole('button', { name: t.solution })).toBeNull();
    view.unmount();

    renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail({ lessonUrl: '/meus-cursos/react-do-zero/aulas/1' }, { lessonId: uuid(6) }),
        () => [post()],
      ),
      { session, role: 'manager' },
    );
    await screen.findByText('Use um calendário semanal.');
    expect(screen.queryByRole('button', { name: t.solution })).toBeNull();
    expect(screen.getByRole('link', { name: t.playLesson }).getAttribute('href')).toBe(
      '/meus-cursos/react-do-zero/aulas/1',
    );
  });

  it('reage, desfaz a reação e segue o tópico', async () => {
    const user = userEvent.setup();
    let reacted = false;
    let following = false;
    const { calls } = renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail({}, { following }),
        () => [post({ reactions: reacted ? [{ emoji: '🎉', count: 1, reacted: true }] : [] })],
        {
          [`PUT /api/v1/forum/posts/${postId}/reactions/${encodeURIComponent('🎉')}`]: () => {
            reacted = true;
            return noContent();
          },
          [`DELETE /api/v1/forum/posts/${postId}/reactions/${encodeURIComponent('🎉')}`]: () => {
            reacted = false;
            return noContent();
          },
          [`PUT ${topicUrl()}/follow`]: () => {
            following = true;
            return noContent();
          },
          [`DELETE ${topicUrl()}/follow`]: () => {
            following = false;
            return noContent();
          },
        },
      ),
      { session },
    );
    await screen.findByText('Use um calendário semanal.');
    const card = () => within(document.getElementById(`post-${postId}`) as HTMLElement);
    const celebrate = (count: number) =>
      card().findByRole('button', { name: `${t.reactionNames.celebrate}, ${count}` });

    await user.click(await celebrate(0));
    expect((await celebrate(1)).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() =>
      expect((card().getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(false),
    );
    await user.click(await celebrate(1));
    expect((await celebrate(0)).getAttribute('aria-pressed')).toBe('false');

    await user.click(screen.getByRole('button', { name: t.follow }));
    await user.click(await screen.findByRole('button', { name: t.unfollow }));
    expect(await screen.findByRole('button', { name: t.follow })).toBeTruthy();
    expect(
      calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path}`),
    ).toEqual([
      `PUT /api/v1/forum/posts/${postId}/reactions/${encodeURIComponent('🎉')}`,
      `DELETE /api/v1/forum/posts/${postId}/reactions/${encodeURIComponent('🎉')}`,
      `PUT ${topicUrl()}/follow`,
      `DELETE ${topicUrl()}/follow`,
    ]);
  });

  it('sugere menções de quem lê a categoria e grava o ID por trás do nome', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail(),
        () => [post()],
        {
          [`GET /api/v1/forum/categories/${courseCategory}/mentions`]: () =>
            jsonResponse(page([other])),
          [`POST ${topicUrl()}/posts`]: () => jsonResponse(post({ id: uuid(22) }), 201),
        },
      ),
      { session },
    );
    await screen.findByText('Use um calendário semanal.');
    const card = within(document.getElementById(`post-${postId}`) as HTMLElement);
    await user.click(card.getByRole('button', { name: t.reply }));
    const form = within(screen.getByRole('form', { name: 'Responder a Bruno Lima' }));
    await user.type(form.getByRole('textbox', { name: t.message }), 'Valeu, @Bru');
    const suggestions = within(await form.findByRole('list', { name: t.mentions }));
    await user.click(suggestions.getByRole('button', { name: '@Bruno Lima' }));
    await user.click(form.getByRole('button', { name: 'Responder a Bruno Lima' }));
    await waitFor(() =>
      expect(sent(calls, 'POST', `${topicUrl()}/posts`)[0]?.body).toEqual({
        bodyMd: `Valeu, [@Bruno Lima](#${other.id})`,
        parentPostId: postId,
      }),
    );
  });

  it('edita e remove a própria resposta, com confirmação', async () => {
    const user = userEvent.setup();
    const own = post({ author: me, bodyMd: 'Texto antigo', bodyHtml: '<p>Texto antigo</p>' });
    const { calls } = renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail({}, { author: other }),
        () => [own],
        {
          [`PATCH /api/v1/forum/posts/${postId}`]: () => jsonResponse(own),
          [`DELETE /api/v1/forum/posts/${postId}`]: () => noContent(),
        },
      ),
      { session },
    );
    await screen.findByText('Texto antigo');
    const card = within(document.getElementById(`post-${postId}`) as HTMLElement);
    // a própria publicação não se denuncia
    expect(card.queryByRole('button', { name: t.report })).toBeNull();
    await user.click(card.getByRole('button', { name: t.edit }));
    const form = within(screen.getByRole('form', { name: t.save }));
    const field = form.getByRole('textbox', { name: t.message });
    expect((field as HTMLTextAreaElement).value).toBe('Texto antigo');
    await user.clear(field);
    await user.type(field, 'Texto novo');
    await user.click(form.getByRole('button', { name: t.save }));
    await waitFor(() =>
      expect(sent(calls, 'PATCH', `/api/v1/forum/posts/${postId}`)[0]?.body).toEqual({
        bodyMd: 'Texto novo',
      }),
    );

    await user.click(card.getByRole('button', { name: t.remove }));
    const dialog = within(await screen.findByRole('alertdialog'));
    await user.click(dialog.getByRole('button', { name: t.remove }));
    await waitFor(() =>
      expect(sent(calls, 'DELETE', `/api/v1/forum/posts/${postId}`)).toHaveLength(1),
    );
  });

  it('denuncia uma resposta alheia e avisa do envio', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail(),
        () => [post()],
        { 'POST /api/v1/reports': () => jsonResponse({ id: uuid(30) }, 201) },
      ),
      { session },
    );
    await screen.findByText('Use um calendário semanal.');
    const card = within(document.getElementById(`post-${postId}`) as HTMLElement);
    await user.click(card.getByRole('button', { name: t.report }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('radio', { name: t.reportReasons.spam }));
    await user.click(dialog.getByRole('button', { name: t.reportSend }));
    expect(await screen.findByText(t.reportSent)).toBeTruthy();
    expect(sent(calls, 'POST', '/api/v1/reports')[0]?.body).toEqual({
      targetType: 'forum_post',
      targetId: postId,
      reason: 'spam',
    });
  });

  it('resposta recusada por tópico fechado mostra o motivo; publicações ocultas e removidas ficam sem ações', async () => {
    const user = userEvent.setup();
    renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail(),
        () => [
          post({ id: uuid(23), hiddenAt: date, bodyHtml: '' }),
          post({ id: uuid(24), deletedAt: date, bodyHtml: '' }),
        ],
        { [`POST ${topicUrl()}/posts`]: () => problemResponse(409, 'topic_closed') },
      ),
      { session },
    );
    expect(await screen.findByText(t.hidden)).toBeTruthy();
    expect(screen.getByText(t.deleted)).toBeTruthy();
    for (const id of [uuid(23), uuid(24)]) {
      const card = within(document.getElementById(`post-${id}`) as HTMLElement);
      expect(card.queryAllByRole('button')).toEqual([]);
    }
    await user.click(screen.getByRole('button', { name: t.reply }));
    const form = within(screen.getByRole('form', { name: t.reply }));
    await user.type(form.getByRole('textbox', { name: t.message }), 'Ainda dá tempo?');
    await user.click(form.getByRole('button', { name: t.reply }));
    expect((await form.findByRole('alert')).textContent).toBe(t.errors.closed);
  });
});

describe('tempo real e player', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    FakeEventSource.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.reset();
  });

  it('forum.post.created recarrega só o tópico aberto', async () => {
    let posts: Post[] = [];
    const { calls } = renderApp(
      `/forum/t/${topicId}`,
      topicRoutes(
        () => detail({}, { postsCount: posts.length }),
        () => posts,
      ),
      { session },
    );
    await screen.findByRole('heading', { name: 'Como organizar os estudos' });
    await waitFor(() => expect(sent(calls, 'GET', `${topicUrl()}/posts`)).toHaveLength(1));
    const source = FakeEventSource.latest;
    act(() => source.open());

    act(() => source.emit('forum.post.created', { topicId: uuid(99), postId: uuid(98) }));
    posts = [post()];
    act(() => source.emit('forum.post.created', { topicId, postId }));
    expect(await screen.findByText('Use um calendário semanal.')).toBeTruthy();
    expect(sent(calls, 'GET', `${topicUrl()}/posts`)).toHaveLength(2);
  });

  it('a aba Comentários da aula mostra as respostas do tópico da aula e publica um comentário', async () => {
    const user = userEvent.setup();
    let posts: Post[] = [post()];
    const { calls } = renderApp(
      lessonUrl(LESSON_1),
      apiRoutes({
        ...fakeLearning().handlers,
        [`GET /api/v1/lessons/${LESSON_1}/topic`]: () =>
          jsonResponse({ topicId, postsCount: 1, canRead: true }),
        [`GET ${topicUrl()}`]: () =>
          jsonResponse(
            detail({}, { lessonId: LESSON_1, author: { id: null, displayName: 'Equipe' } }),
          ),
        [`GET ${topicUrl()}/posts`]: () => jsonResponse(page(posts)),
        [`POST ${topicUrl()}/posts`]: () => {
          posts = [...posts, post({ id: uuid(25), author: me, bodyHtml: '<p>Ótima aula!</p>' })];
          return jsonResponse(posts[1], 201);
        },
      }),
      { session },
    );
    await user.click(await screen.findByRole('tab', { name: t.comments }));
    expect(await screen.findByText('Use um calendário semanal.')).toBeTruthy();
    expect(screen.getByRole('link', { name: t.topic }).getAttribute('href')).toBe(
      `/forum/t/${topicId}`,
    );
    await user.click(screen.getAllByRole('button', { name: t.reply })[0] as HTMLElement);
    const form = within(screen.getByRole('form', { name: t.reply }));
    await user.type(form.getByRole('textbox', { name: t.message }), 'Ótima aula!');
    await user.click(form.getByRole('button', { name: t.reply }));
    expect(await screen.findByText('Ótima aula!')).toBeTruthy();
    expect(sent(calls, 'POST', `${topicUrl()}/posts`)[0]?.body).toEqual({ bodyMd: 'Ótima aula!' });
    await expectNoAxeViolations();
  });

  it('aula de amostra sem o curso: só o número de respostas e o convite', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      lessonUrl(LESSON_1),
      apiRoutes({
        ...fakeLearning().handlers,
        [`GET /api/v1/lessons/${LESSON_1}/topic`]: () =>
          jsonResponse({ topicId: null, postsCount: 7, canRead: false }),
      }),
      { session },
    );
    await user.click(await screen.findByRole('tab', { name: t.comments }));
    expect(await screen.findByText(t.posts_other.replace('{{count}}', '7'))).toBeTruthy();
    expect(screen.getByText(t.sample)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.getCourse }).getAttribute('href')).toBe(
      '/cursos/react-do-zero',
    );
    expect(calls.some((call) => call.path.startsWith('/api/v1/forum/'))).toBe(false);
  });
});

describe('notificações do fórum', () => {
  it('levam ao tópico e, na resposta, à âncora da publicação', () => {
    expect(
      notificationHref(notificationItem({ targetType: 'forum_topic', targetId: topicId })),
    ).toBe(`/forum/t/${topicId}`);
    expect(
      notificationHref(
        notificationItem({ targetType: 'forum_post', targetId: postId, data: { topicId } }),
      ),
    ).toBe(`/forum/t/${topicId}#post-${postId}`);
    expect(
      notificationHref(notificationItem({ targetType: 'forum_post', targetId: postId, data: {} })),
    ).toBeUndefined();
  });
});
