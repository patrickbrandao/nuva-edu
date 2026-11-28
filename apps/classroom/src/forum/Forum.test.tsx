import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';

const categoryId = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f71';
const topicId = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f72';
const postId = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f73';
const date = '2026-11-27T22:00:00.000Z';
const author = { id: categoryId, displayName: 'Autora' };

const detail: ClassroomSchemas['ForumTopicDetail'] = {
  topic: {
    id: topicId,
    categoryId,
    lessonId: null,
    author,
    title: 'Dúvidas sobre aulas',
    status: 'open',
    pinned: false,
    solutionPostId: null,
    postsCount: 0,
    lastActivityAt: date,
    following: false,
  },
  bodyHtml: '<p>Texto <strong>seguro</strong>.</p><a href="javascript:void(0)">Link inativo</a>',
  createdAt: date,
  editedAt: null,
  deletedAt: null,
  hiddenAt: null,
  moderatedAt: null,
  reactions: [],
  canWrite: true,
};

const path = `/api/v1/forum/topics/${topicId}`;

it('renderiza HTML seguro e publica uma resposta com o cliente gerado', async () => {
  const user = userEvent.setup();
  let replied = false;
  const { calls } = renderApp(
    `/forum/t/${topicId}`,
    apiRoutes({
      [`GET ${path}`]: () => jsonResponse(detail),
      [`GET ${path}/posts`]: () =>
        jsonResponse({
          items: replied
            ? [
                {
                  id: postId,
                  topicId,
                  parentPostId: null,
                  author,
                  bodyHtml: '<p>Minha resposta foi publicada.</p>',
                  createdAt: date,
                  editedAt: null,
                  deletedAt: null,
                  hiddenAt: null,
                  moderatedAt: null,
                  reactions: [],
                },
              ]
            : [],
          nextCursor: null,
        }),
      [`POST ${path}/posts`]: () => {
        replied = true;
        return jsonResponse({ id: postId }, 201);
      },
    }),
    { session: makeSession() },
  );

  expect(await screen.findByRole('heading', { name: detail.topic.title })).toBeTruthy();
  expect(screen.getByText('seguro').tagName).toBe('STRONG');
  expect(screen.queryByRole('link', { name: 'Link inativo' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Responder$/ }));
  await user.type(
    screen.getByRole('textbox', { name: 'Mensagem' }),
    'Minha resposta foi publicada.',
  );
  const composer = within(screen.getByRole('form', { name: 'Responder' }));
  await user.click(composer.getByRole('button', { name: /^Responder$/ }));
  expect(await screen.findByText('Minha resposta foi publicada.')).toBeTruthy();
  expect(
    calls.find(({ method, path: url }) => method === 'POST' && url === `${path}/posts`)?.body,
  ).toEqual({
    bodyMd: 'Minha resposta foi publicada.',
  });
  await expectNoAxeViolations();
});

it('mostra um tópico fechado somente para leitura e esconde conteúdo após perder acesso', async () => {
  let allowed = true;
  const { queryClient } = renderApp(
    `/forum/t/${topicId}`,
    apiRoutes({
      [`GET ${path}`]: () =>
        allowed
          ? jsonResponse({
              ...detail,
              canWrite: false,
              topic: { ...detail.topic, status: 'closed' },
            })
          : problemResponse(404, 'not_found'),
      [`GET ${path}/posts`]: () => jsonResponse({ items: [], nextCursor: null }),
    }),
    { session: makeSession() },
  );
  expect(await screen.findByText('Fechado')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Responder' })).toBeNull();
  allowed = false;
  await queryClient.invalidateQueries({ queryKey: ['forum'] });
  await waitFor(() => expect(screen.queryByText('seguro')).toBeNull());
  expect(await screen.findByText('Não foi possível carregar o fórum')).toBeTruthy();
});
