import { afterAll, beforeAll, expect, it } from 'vitest';
import { Browser, createUser } from '../accounts.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

let test: TestApp;
let alice: Browser;
let bob: Browser;

beforeAll(async () => {
  test = createTestApp();
  const [author, reader] = await Promise.all([createUser(test.db), createUser(test.db)]);
  alice = new Browser(test.app, () => {});
  bob = new Browser(test.app, () => {});
  for (const [browser, user] of [
    [alice, author],
    [bob, reader],
  ] as const) {
    expect((await browser.login(user.email)).statusCode).toBe(200);
  }
}, 30_000);

afterAll(async () => {
  await test?.close();
});

it('serve o tópico, respostas, solução, menção e denúncias pelo contrato', async () => {
  const category = await test.db
    .insertInto('forumCategories')
    .values({
      kind: 'free',
      audience: 'all',
      name: 'Categoria do teste HTTP',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const categories = await alice.request('GET', '/api/v1/forum/categories');
  expect(categories.statusCode, categories.body).toBe(200);
  expect(categories.json().items).toContainEqual(expect.objectContaining({ id: category.id }));

  const create = await alice.request('POST', `/api/v1/forum/categories/${category.id}/topics`, {
    payload: { title: 'Tópico da API', bodyMd: 'Palavra pesquisável em **negrito**.' },
  });
  expect(create.statusCode, create.body).toBe(201);
  const id = create.json().topic.id;
  expect(create.json().bodyHtml).toContain('<strong>negrito</strong>');
  const other = await bob.request('GET', `/api/v1/forum/topics/${id}`);
  expect(other.statusCode, other.body).toBe(200);
  expect(other.json()).not.toHaveProperty('bodyMd');
  const found = await bob.request('GET', '/api/v1/forum/search?q=pesquis');
  expect(found.statusCode, found.body).toBe(200);
  expect(found.json().items).toContainEqual(expect.objectContaining({ id }));

  const post = await bob.request('POST', `/api/v1/forum/topics/${id}/posts`, {
    payload: { bodyMd: 'Resposta da leitora.' },
  });
  expect(post.statusCode, post.body).toBe(201);
  const reaction = await alice.request(
    'PUT',
    `/api/v1/forum/posts/${post.json().id}/reactions/${encodeURIComponent('👍')}`,
  );
  expect(reaction.statusCode, reaction.body).toBe(200);
  expect(reaction.json()).toEqual([{ emoji: '👍', count: 1, reacted: true }]);
  const solution = await alice.request('PUT', `/api/v1/forum/topics/${id}/solution`, {
    payload: { postId: post.json().id },
  });
  expect(solution.statusCode, solution.body).toBe(200);
  expect(solution.json().topic.solutionPostId).toBe(post.json().id);

  const report = { targetType: 'forum_topic', targetId: id, reason: 'spam' };
  const sent = await bob.request('POST', '/api/v1/reports', { payload: report });
  expect(sent.statusCode, sent.body).toBe(201);
  const duplicate = await bob.request('POST', '/api/v1/reports', { payload: report });
  expect(duplicate.statusCode, duplicate.body).toBe(200);
  expect(duplicate.json()).toEqual(sent.json());
  const mine = await bob.request('GET', '/api/v1/me/reports');
  expect(mine.statusCode, mine.body).toBe(200);
  expect(mine.json().items).toContainEqual(sent.json());
});

it('isola categorias do público ativo de quem não tem direito', async () => {
  const category = await test.db
    .insertInto('forumCategories')
    .values({
      kind: 'free',
      audience: 'active',
      name: 'Categoria protegida',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const reply = await bob.request('GET', `/api/v1/forum/categories/${category.id}/topics`);
  expect(reply.statusCode, reply.body).toBe(404);
});
