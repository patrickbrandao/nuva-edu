import { randomUUID } from 'node:crypto';
import { createForumReport, createForumTopic } from '@nuva-edu/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Actor, auditOf, type CallOptions, callAs, createActor } from '../actors.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

let test: TestApp;
let admin: Actor;
let manager: Actor;
let instructor: Actor;
let student: Actor;
let reporter: Actor;

beforeAll(async () => {
  test = createTestApp();
  [admin, manager, instructor, student, reporter] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
    createActor(test, 'student'),
    createActor(test, 'student'),
  ]);
  await test.app.ready();
}, 30_000);
afterAll(async () => {
  await test?.close();
});

const call = (options: CallOptions) => callAs(test, options);

it('restringe as operações administrativas e registra ação e advertência', async () => {
  const route = '/api/v1/forum/categories';
  const payload = { name: 'Ajuda e dúvidas', audience: 'all' };
  expect((await call({ method: 'POST', url: route, as: instructor, payload })).statusCode).toBe(
    403,
  );
  const category = await call({ method: 'POST', url: route, as: manager, payload });
  expect(category.statusCode, category.body).toBe(201);
  const { topic } = await createForumTopic(test.db, student.id, category.json().id, {
    title: 'Discussão para moderação',
    bodyMd: 'Corpo da discussão',
  });
  await createForumReport(test.db, reporter.id, {
    targetType: 'forum_topic',
    targetId: topic.id,
    reason: 'spam',
  });
  const queue = await call({ method: 'GET', url: '/api/v1/moderation/queue', as: manager });
  expect(queue.statusCode, queue.body).toBe(200);
  expect(queue.json().items).toContainEqual(
    expect.objectContaining({ targetId: topic.id, reporterCount: 1 }),
  );
  const result = await call({
    method: 'POST',
    url: '/api/v1/moderation/actions',
    as: manager,
    payload: {
      action: 'hide',
      targetType: 'forum_topic',
      targetId: topic.id,
      reason: 'Ocultação moderada',
    },
  });
  expect(result.statusCode, result.body).toBe(201);
  expect(result.json()).toMatchObject({ targetId: topic.id, userId: student.id, action: 'hide' });
  expect(await auditOf(test, topic.id, 'forum.topic_hide')).toHaveLength(1);
  const detail = await call({
    method: 'GET',
    url: `/api/v1/moderation/queue/forum_topic/${topic.id}`,
    as: manager,
  });
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().reports[0].status).toBe('resolved');
  expect(detail.json().history).toContainEqual(expect.objectContaining({ action: 'hide' }));
  const warn = await call({
    method: 'POST',
    url: `/api/v1/users/${student.id}/warn`,
    as: manager,
    payload: { reason: 'Revisar regras do fórum' },
  });
  expect(warn.statusCode, warn.body).toBe(201);
  const history = await call({
    method: 'GET',
    url: `/api/v1/users/${student.id}/moderation-history`,
    as: admin,
  });
  expect(history.statusCode, history.body).toBe(200);
  expect(history.json().items).toContainEqual(expect.objectContaining({ action: 'warn' }));
});

it('limita instrutor ao próprio curso e restringe relatório sobre equipe ao administrador', async () => {
  const course = await test.db
    .insertInto('courses')
    .values({
      title: 'Curso de moderação',
      slug: `moderacao-${randomUUID()}`,
      ownerId: instructor.id,
      accessMode: 'open',
      status: 'published',
      publishedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const category = await test.db
    .insertInto('forumCategories')
    .values({
      kind: 'course',
      courseId: course.id,
      name: 'Tópicos do curso',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const own = await createForumTopic(test.db, student.id, category.id, {
    title: 'Discussão de aluno',
    bodyMd: 'Conteúdo do aluno',
  });
  const done = await call({
    method: 'PATCH',
    url: `/api/v1/forum/topics/${own.topic.id}`,
    as: instructor,
    payload: { pinned: true },
  });
  expect(done.statusCode, done.body).toBe(200);
  expect(done.json().topic.pinned).toBe(true);
  const outsider = await createActor(test, 'instructor');
  expect(
    (
      await call({
        method: 'PATCH',
        url: `/api/v1/forum/topics/${own.topic.id}`,
        as: outsider,
        payload: { pinned: true },
      })
    ).statusCode,
  ).toBe(403);
  const staff = await createForumTopic(test.db, instructor.id, category.id, {
    title: 'Discussão de instrutor',
    bodyMd: 'Conteúdo da equipe',
  });
  await createForumReport(test.db, reporter.id, {
    targetType: 'forum_topic',
    targetId: staff.topic.id,
    reason: 'spam',
  });
  const queue = await call({ method: 'GET', url: '/api/v1/moderation/queue', as: manager });
  expect(queue.statusCode, queue.body).toBe(200);
  expect(queue.json().items).not.toContainEqual(
    expect.objectContaining({ targetId: staff.topic.id }),
  );
  const visible = await call({ method: 'GET', url: '/api/v1/moderation/queue', as: admin });
  expect(visible.statusCode, visible.body).toBe(200);
  expect(visible.json().items).toContainEqual(
    expect.objectContaining({ targetId: staff.topic.id }),
  );
});
