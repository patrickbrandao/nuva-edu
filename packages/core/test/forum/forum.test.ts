import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import {
  applyForumModerationAction,
  type CatalogRequest,
  closeDatabase,
  createCourse,
  createDatabase,
  createForumCategory,
  createForumPost,
  createForumReport,
  createForumTopic,
  createLesson,
  createModule,
  type Database,
  deleteForumPost,
  deleteForumTopic,
  grantEntitlement,
  listForumCategories,
  listForumModerationQueue,
  listForumPosts,
  listForumTopics,
  listMyForumReports,
  lookupLessonForumTopic,
  publishCourse,
  type Role,
  readForumModerationTarget,
  readForumTopic,
  searchForumMentions,
  setForumReaction,
  setForumSolution,
  updateLesson,
} from '../../src/index.ts';

let db: Database;
let admin: CatalogRequest;

async function user(role: Role = 'student', verified = true, name = 'Aluna') {
  return db
    .insertInto('users')
    .values({
      name,
      email: `forum-${randomUUID()}@example.test`,
      role,
      emailVerifiedAt: verified ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

beforeAll(async () => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 4 });
  const { id } = await user('admin', true, 'Admin');
  admin = { actor: { id, role: 'admin' }, context: { ip: '127.0.0.1' } };
});

afterAll(async () => {
  await closeDatabase(db);
});

it('cria categoria e tópico da aula uma vez, preserva as respostas e confere direitos', async () => {
  const student = await user();
  const course = await createCourse(db, admin, {
    title: `Curso pago ${randomUUID()}`,
    accessMode: 'paid',
    priceCents: 500,
  });
  const module = await createModule(db, admin, course.id, { title: 'Módulo' });
  let lesson = await createLesson(db, admin, module.id, {
    title: 'Amostra',
    videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    status: 'published',
    isSample: true,
  });
  await publishCourse(db, admin, course.id);
  await publishCourse(db, admin, course.id);
  const categories = await db
    .selectFrom('forumCategories')
    .select('id')
    .where('courseId', '=', course.id)
    .execute();
  expect(categories).toHaveLength(1);
  const [category] = categories;
  if (!category) throw new Error('Fixture de fórum ausente.');
  const topics = await db
    .selectFrom('forumTopics')
    .select('id')
    .where('lessonId', '=', lesson.id)
    .execute();
  expect(topics).toHaveLength(1);
  const [topic] = topics;
  if (!topic) throw new Error('Fixture de fórum ausente.');
  expect(await lookupLessonForumTopic(db, student.id, lesson.id)).toEqual({
    topicId: null,
    postsCount: 0,
    canRead: false,
  });
  await expect(readForumTopic(db, student.id, topic.id)).rejects.toMatchObject({ status: 404 });
  await expect(listForumTopics(db, student.id, { categoryId: category.id })).rejects.toMatchObject({
    status: 404,
  });

  const { entitlement } = await db.transaction().execute((trx) =>
    grantEntitlement(trx, {
      userId: student.id,
      productType: 'course',
      productId: course.id,
      source: 'grant',
      sourceId: admin.actor.id,
      grantedReason: 'Teste do fórum',
      notify: false,
    }),
  );
  expect((await readForumTopic(db, student.id, topic.id)).lessonUrl).toBe(
    `/meus-cursos/${course.slug}/aulas/${lesson.id}`,
  );
  await createForumPost(db, student.id, topic.id, { bodyMd: 'Comentário preservado.' });
  expect(await lookupLessonForumTopic(db, student.id, lesson.id)).toEqual({
    topicId: topic.id,
    postsCount: 1,
    canRead: true,
  });
  lesson = await updateLesson(db, admin, lesson.id, {
    title: 'Aula com comentários',
    version: lesson.version,
  });
  expect((await readForumTopic(db, student.id, topic.id)).topic.title).toBe('Aula com comentários');

  lesson = await updateLesson(db, admin, lesson.id, { status: 'draft', version: lesson.version });
  await expect(readForumTopic(db, student.id, topic.id)).rejects.toMatchObject({ status: 404 });
  await updateLesson(db, admin, lesson.id, { status: 'published', version: lesson.version });
  expect((await listForumPosts(db, student.id, topic.id)).items).toHaveLength(1);
  await db
    .updateTable('entitlements')
    .set({ revokedAt: new Date(), revokeReason: 'manual' })
    .where('id', '=', entitlement.id)
    .execute();
  await expect(listForumPosts(db, student.id, topic.id)).rejects.toMatchObject({ status: 404 });
  expect((await listForumTopics(db, student.id, { q: 'comentários' })).items).toEqual([]);
});

it('usa Markdown saneado, paginador, reações, solução e remoção com dependentes', async () => {
  const alice = await user('student', true, 'Alice');
  const bob = await user('student', true, 'Bob');
  const pending = await user('student', false, 'Bob Pendente');
  const category = await createForumCategory(db, admin.actor.id, {
    name: 'Comunidade',
    audience: 'all',
  });
  const active = await createForumCategory(db, admin.actor.id, {
    name: 'Clientes',
    audience: 'active',
  });
  const visible = await listForumCategories(db, alice.id);
  expect(visible.items.map(({ id }) => id)).toContain(category.id);
  expect(visible.items.map(({ id }) => id)).not.toContain(active.id);
  expect((await searchForumMentions(db, alice.id, category.id, { q: 'Bob' })).items).toEqual([
    { id: bob.id, displayName: 'Bob' },
  ]);
  const topic = await createForumTopic(db, alice.id, category.id, {
    title: 'Como publicar aulas?',
    bodyMd: `Oi [@Bob](#${bob.id}) [@Pendente](#${pending.id}) e **bem-vindo**. <script>document.write('x')</script>`,
  });
  expect(topic.bodyHtml).toContain('<strong>bem-vindo</strong>');
  expect(topic.bodyHtml).not.toContain('<script>');
  const notifications = await db
    .selectFrom('jobs')
    .select('payload')
    .where('type', '=', 'notify')
    .execute();
  expect(notifications.some(({ payload }) => JSON.stringify(payload).includes(bob.id))).toBe(true);
  expect(notifications.some(({ payload }) => JSON.stringify(payload).includes(pending.id))).toBe(
    false,
  );
  const first = await createForumPost(db, bob.id, topic.topic.id, {
    bodyMd: '1. Publique o vídeo.',
  });
  const child = await createForumPost(db, alice.id, topic.topic.id, {
    bodyMd: 'Obrigado!',
    parentPostId: first.id,
  });
  await expect(
    createForumPost(db, bob.id, topic.topic.id, {
      bodyMd: 'Mais um nível',
      parentPostId: child.id,
    }),
  ).rejects.toMatchObject({ status: 422, code: 'forum_invalid_parent' });
  expect(await setForumReaction(db, alice.id, 'forum_post', first.id, '👍', true)).toEqual([
    { emoji: '👍', count: 1, reacted: true },
  ]);
  await setForumReaction(db, alice.id, 'forum_post', first.id, '👍', true);
  expect(await setForumReaction(db, alice.id, 'forum_post', first.id, '👍', false)).toEqual([]);
  await expect(setForumSolution(db, bob.id, topic.topic.id, first.id)).rejects.toMatchObject({
    status: 403,
  });
  expect(
    (await setForumSolution(db, alice.id, topic.topic.id, first.id)).topic.solutionPostId,
  ).toBe(first.id);
  const page = await listForumPosts(db, alice.id, topic.topic.id, { limit: 1 });
  expect(page.items.map(({ id }) => id)).toEqual([first.id]);
  const next = await listForumPosts(db, alice.id, topic.topic.id, {
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.items.map(({ id }) => id)).toEqual([child.id]);
  await deleteForumPost(db, bob.id, first.id);
  expect((await listForumPosts(db, alice.id, topic.topic.id)).items[0]?.bodyHtml).toContain(
    'Mensagem removida',
  );
  expect((await readForumTopic(db, alice.id, topic.topic.id)).topic.solutionPostId).toBeNull();
});

it('oculta com cinco denunciantes distintos e informa só se a análise terminou', async () => {
  const { id: authorId } = await user();
  const { id: outsiderId } = await user();
  const category = await createForumCategory(db, admin.actor.id, {
    name: 'Denúncias',
    audience: 'all',
  });
  const { topic } = await createForumTopic(db, authorId, category.id, {
    title: 'Tópico para moderação',
    bodyMd: 'Conteúdo para análise.',
  });
  const input = { targetType: 'forum_topic', targetId: topic.id, reason: 'spam' } as const;
  await expect(createForumReport(db, authorId, input)).rejects.toMatchObject({ status: 422 });
  const reporters = await Promise.all(Array.from({ length: 5 }, () => user()));
  const runs = await Promise.all(reporters.map(({ id }) => createForumReport(db, id, input)));
  expect(runs.every(({ created }) => created)).toBe(true);
  const [reporter] = reporters;
  if (!reporter) throw new Error('Fixture de fórum ausente.');
  expect(await createForumReport(db, reporter.id, input)).toMatchObject({ created: false });
  await expect(readForumTopic(db, outsiderId, topic.id)).rejects.toMatchObject({ status: 404 });
  expect((await readForumTopic(db, authorId, topic.id)).topic.status).toBe('hidden');
  const queue = await listForumModerationQueue(db, admin.actor.id, { reason: 'spam' });
  expect(queue.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ targetId: topic.id, reporterCount: 5 })]),
  );
  expect(
    (await readForumModerationTarget(db, admin.actor.id, 'forum_topic', topic.id)).reports,
  ).toHaveLength(5);
  await applyForumModerationAction(db, admin.actor.id, {
    action: 'unhide',
    targetType: 'forum_topic',
    targetId: topic.id,
    reason: 'Revisão concluída',
  });
  const reviewed = (await listMyForumReports(db, reporter.id)).items[0];
  expect(reviewed).toMatchObject({ status: 'reviewed' });
  expect(reviewed).not.toHaveProperty('resolution');
  expect((await readForumTopic(db, outsiderId, topic.id)).topic.status).toBe('open');
});

it('limita tópicos simultâneos e mantém o limite depois de apagar uma publicação', async () => {
  const { id } = await user();
  const category = await createForumCategory(db, admin.actor.id, {
    name: 'Limite',
    audience: 'all',
  });
  await db.insertInto('settings').values({ key: 'forum.topics_per_hour', value: '1' }).execute();
  const publish = (title: string) =>
    createForumTopic(db, id, category.id, { title, bodyMd: 'Texto original.' });
  const runs = await Promise.allSettled([publish('Primeiro tópico'), publish('Segundo tópico')]);
  try {
    const saved = runs.find((row) => row.status === 'fulfilled');
    const failed = runs.find((row) => row.status === 'rejected');
    expect(saved?.status).toBe('fulfilled');
    expect(failed).toMatchObject({ reason: { status: 429 } });
    if (saved?.status === 'fulfilled') await deleteForumTopic(db, id, saved.value.topic.id);
    await expect(publish('Terceiro tópico')).rejects.toMatchObject({ status: 429 });
  } finally {
    await db.deleteFrom('settings').where('key', '=', 'forum.topics_per_hour').execute();
  }
});
