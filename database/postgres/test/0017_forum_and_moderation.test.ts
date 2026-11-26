import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

type Row = Record<string, unknown>;

const EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'];

describe('0017: fórum e moderação', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 17 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  async function insertRow(table: string, row: Row): Promise<Row> {
    const columns = Object.keys(row);
    const names = columns.map((name) => `"${name}"`).join(', ');
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO ${table} (${names}) VALUES (${placeholders}) RETURNING *`,
      Object.values(row),
    );
    return rows[0] as Row;
  }

  async function rejects(table: string, row: Row, constraint: string) {
    await assert.rejects(insertRow(table, row), (error: { constraint?: string }) => {
      assert.equal(error.constraint, constraint);
      return true;
    });
  }

  async function insertUser(): Promise<string> {
    const user = await insertRow('users', {
      email: `forum-${unique()}@example.com`,
      name: 'Pessoa',
    });
    return user.id as string;
  }

  async function insertCourse(): Promise<string> {
    const course = await insertRow('courses', {
      slug: `curso-${unique()}`,
      title: 'Curso de teste',
    });
    return course.id as string;
  }

  async function insertLesson(title = 'Aula de teste'): Promise<string> {
    const courseId = await insertCourse();
    const module = await insertRow('modules', {
      course_id: courseId,
      title: 'Módulo',
      position: 0,
    });
    const lesson = await insertRow('lessons', {
      module_id: module.id,
      title,
      position: 0,
      status: 'published',
    });
    return lesson.id as string;
  }

  async function insertCategory(overrides: Row = {}): Promise<Row> {
    return insertRow('forum_categories', {
      kind: 'free',
      name: 'Categoria de teste',
      ...overrides,
    });
  }

  async function insertTopic(overrides: Row = {}): Promise<Row> {
    return insertRow('forum_topics', {
      category_id: (await insertCategory()).id,
      author_id: await insertUser(),
      title: 'Tópico de teste',
      body_md: 'Corpo do tópico',
      body_html: '<p>Corpo do tópico</p>',
      ...overrides,
    });
  }

  async function insertPost(overrides: Row = {}): Promise<Row> {
    return insertRow('forum_posts', {
      topic_id: (await insertTopic()).id,
      author_id: await insertUser(),
      body_md: 'Resposta',
      body_html: '<p>Resposta</p>',
      ...overrides,
    });
  }

  async function insertReport(overrides: Row = {}): Promise<Row> {
    return insertRow('reports', {
      reporter_id: await insertUser(),
      target_type: 'forum_post',
      target_id: randomUUID(),
      reason: 'spam',
      ...overrides,
    });
  }

  async function foreignKeyDeleteAction(table: string, constraint: string): Promise<string> {
    const { rows } = await query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = $1 AND conrelid = $2::regclass`,
      [constraint, table],
    );
    return rows[0]?.confdeltype as string;
  }

  test('down e up da 0017 removem e recriam tabelas, gatilhos e o vínculo com lessons', async () => {
    const tables = [
      'forum_categories',
      'forum_topics',
      'forum_posts',
      'reactions',
      'forum_topic_follows',
      'reports',
      'moderation_actions',
    ];
    const functions = () =>
      query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' ORDER BY 1`,
      );
    const names = async () => (await functions()).rows.map((row) => row.proname as string);
    const fk = async () =>
      (
        await query(
          `SELECT 1 FROM pg_constraint
            WHERE conname = 'lessons_forum_topic_id_fkey' AND conrelid = 'lessons'::regclass`,
        )
      ).rowCount;

    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    for (const name of [
      'forum_posts_single_level',
      'forum_topics_guard_solution',
      'forum_reactions_cleanup',
    ]) {
      assert.ok((await names()).includes(name), name);
    }
    assert.equal(await fk(), 1);

    await migrateDown(db.client, { dir });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), false, table);
    }
    for (const name of [
      'forum_posts_single_level',
      'forum_topics_guard_solution',
      'forum_reactions_cleanup',
    ]) {
      assert.equal((await names()).includes(name), false, name);
    }
    assert.equal(await fk(), 0);
    // O catálogo e as contas continuam: a 0017 só acrescenta.
    for (const table of ['users', 'courses', 'lessons', 'user_suspensions']) {
      assert.equal(await tableExists(db.client, table), true, table);
    }

    await migrateUp(db.client, { dir, to: 17 });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.equal(await fk(), 1);
  });

  test('categorias: uma por curso, público e arquivamento', async () => {
    const free = await insertCategory({ audience: 'active', description: 'Dúvidas gerais' });
    assert.equal(free.kind, 'free');
    assert.equal(free.course_id, null);
    assert.equal(free.position, 0);
    assert.equal(free.archived_at, null);
    assert.ok(free.created_at instanceof Date);
    assert.deepEqual(free.updated_at, free.created_at);
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [free.id]);
    assert.equal(version[0].v, 7);

    const course = await insertCourse();
    const category = await insertCategory({ kind: 'course', course_id: course, name: 'Curso' });
    assert.equal(category.audience, 'all');

    // RF-01: exatamente uma categoria por curso.
    await assert.rejects(insertCategory({ kind: 'course', course_id: course }), {
      code: '23505',
      constraint: 'forum_categories_course_unique',
    });
    // Livre nunca tem curso; de curso pode perder o vínculo quando o curso é excluído.
    await rejects(
      'forum_categories',
      { kind: 'free', course_id: await insertCourse(), name: 'Livre com curso' },
      'forum_categories_course_matches_kind',
    );
    await rejects(
      'forum_categories',
      { kind: 'course', audience: 'active', course_id: course, name: 'Público errado' },
      'forum_categories_course_audience',
    );
    await rejects(
      'forum_categories',
      { kind: 'student', name: 'Tipo errado' },
      'forum_categories_kind_valid',
    );
    await rejects(
      'forum_categories',
      { kind: 'free', audience: 'public', name: 'Público errado' },
      'forum_categories_audience_valid',
    );
    await rejects('forum_categories', { kind: 'free', name: '  ' }, 'forum_categories_name_length');
    await rejects(
      'forum_categories',
      { kind: 'free', name: 'C'.repeat(161) },
      'forum_categories_name_length',
    );
    await rejects(
      'forum_categories',
      { kind: 'free', name: 'Longa', description: 'd'.repeat(2001) },
      'forum_categories_description_length',
    );
    await rejects(
      'forum_categories',
      { kind: 'free', name: 'Ordem', position: -1 },
      'forum_categories_position_range',
    );
    await assert.rejects(insertCategory({ kind: 'course', course_id: randomUUID() }), {
      code: '23503',
      constraint: 'forum_categories_course_id_fkey',
    });
    await insertCategory({ kind: 'course', course_id: null, archived_at: new Date() });

    // Excluir o curso arquiva a categoria: o vínculo some e a linha fica.
    await query('DELETE FROM courses WHERE id = $1', [course]);
    const { rows: kept } = await query(
      'SELECT course_id, kind FROM forum_categories WHERE id = $1',
      [category.id],
    );
    assert.deepEqual(kept, [{ course_id: null, kind: 'course' }]);
    assert.equal(
      await foreignKeyDeleteAction('forum_categories', 'forum_categories_course_id_fkey'),
      'n',
    );
  });

  test('tópicos: título e corpo, automático de aula, unicidade e ocultação', async () => {
    const category = await insertCategory();
    const author = await insertUser();
    const topic = await insertTopic({ category_id: category.id, author_id: author });
    assert.equal(topic.status, 'open');
    assert.equal(topic.pinned, false);
    assert.equal(topic.posts_count, 0);
    assert.equal(topic.solution_post_id, null);
    assert.equal(topic.hidden_at, null);
    assert.equal(topic.hidden_by, null);
    assert.equal(topic.edited_at, null);
    assert.equal(topic.deleted_at, null);
    assert.ok(topic.last_activity_at instanceof Date);

    const base = { category_id: category.id, author_id: author };
    for (const title of ['', '   ', 'T'.repeat(161)]) {
      await rejects(
        'forum_topics',
        { ...base, title, body_md: 'Corpo', body_html: '<p>Corpo</p>' },
        'forum_topics_title_length',
      );
    }
    // A faixa de 5 a 150 da RNF-02 é do código: o banco guarda até 160 para espelhar lessons e
    // não recusar o tópico quando a aula for excluída.
    await insertTopic({ category_id: category.id, author_id: author, title: 'T'.repeat(150) });
    for (const body of ['', '   ', 'b'.repeat(20001)]) {
      await rejects(
        'forum_topics',
        { ...base, title: 'Título válido', body_md: body, body_html: '<p>x</p>' },
        'forum_topics_body_md_length',
      );
    }
    await rejects(
      'forum_topics',
      { ...base, title: 'Título válido', body_md: 'Corpo', body_html: '' },
      'forum_topics_body_html_not_empty',
    );
    // Sem autor: só o tópico automático de aula (o código exige autor nos demais); depois de
    // excluída a aula, o tópico mantém esse estado.
    const authorless = await insertTopic({
      category_id: category.id,
      author_id: null,
      title: 'Sem autor',
    });
    assert.equal(authorless.author_id, null);

    const lesson = await insertLesson('A');
    const automatic = await insertTopic({
      category_id: category.id,
      author_id: null,
      lesson_id: lesson,
      title: 'A',
      body_md: 'Descrição da aula',
    });
    assert.equal(automatic.author_id, null);
    // O título do automático espelha o da aula (limite de lessons, até 160).
    await insertTopic({
      category_id: category.id,
      author_id: null,
      lesson_id: await insertLesson('T'.repeat(160)),
      title: 'T'.repeat(160),
    });
    await assert.rejects(
      insertTopic({
        category_id: category.id,
        author_id: null,
        lesson_id: await insertLesson(),
        title: 'T'.repeat(161),
      }),
      { constraint: 'forum_topics_title_length' },
    );
    // RF-02: um tópico por aula.
    await assert.rejects(
      insertTopic({ category_id: category.id, lesson_id: lesson, author_id: await insertUser() }),
      { code: '23505', constraint: 'forum_topics_lesson_unique' },
    );

    // A ocultação é ortogonal ao estado: fechar e ocultar não se perdem.
    const closeAndHide = await insertTopic({
      category_id: category.id,
      author_id: author,
      status: 'closed',
      hidden_at: new Date(),
      hidden_by: author,
    });
    assert.equal(closeAndHide.status, 'closed');
    assert.ok(closeAndHide.hidden_at instanceof Date);
    await rejects(
      'forum_topics',
      {
        ...base,
        title: 'Título válido',
        body_html: '<p>x</p>',
        body_md: 'Corpo',
        status: 'hidden',
      },
      'forum_topics_status_valid',
    );
    await rejects(
      'forum_topics',
      {
        ...base,
        title: 'Título válido',
        body_md: 'Corpo',
        body_html: '<p>x</p>',
        hidden_by: author,
      },
      'forum_topics_hidden_matches_by',
    );
    await rejects(
      'forum_topics',
      {
        ...base,
        title: 'Título válido',
        body_md: 'Corpo',
        body_html: '<p>x</p>',
        edited_by: author,
      },
      'forum_topics_edited_matches_by',
    );
    await rejects(
      'forum_topics',
      { ...base, title: 'Título válido', body_md: 'Corpo', body_html: '<p>x</p>', posts_count: -1 },
      'forum_topics_posts_count_range',
    );
    await assert.rejects(insertTopic({ category_id: category.id, author_id: randomUUID() }), {
      code: '23503',
      constraint: 'forum_topics_author_id_fkey',
    });
    await assert.rejects(insertTopic({ category_id: randomUUID() }), {
      code: '23503',
      constraint: 'forum_topics_category_id_fkey',
    });

    // Tópico automático de aula não tem estado de resolvido (017).
    const post = await insertPost({
      topic_id: automatic.id,
      author_id: await insertUser(),
    });
    await assert.rejects(
      query('UPDATE forum_topics SET solution_post_id = $1 WHERE id = $2', [post.id, automatic.id]),
      { constraint: 'forum_topics_lesson_has_no_solution' },
    );
    assert.equal(await foreignKeyDeleteAction('forum_topics', 'forum_topics_lesson_id_fkey'), 'n');
    // Excluir a aula mantém o tópico, agora livre.
    await query('DELETE FROM lessons WHERE id = $1', [lesson]);
    const { rows: orphan } = await query('SELECT lesson_id FROM forum_topics WHERE id = $1', [
      automatic.id,
    ]);
    assert.deepEqual(orphan, [{ lesson_id: null }]);
  });

  test('a solução é resposta do próprio tópico e cai com a resposta', async () => {
    const topicA = await insertTopic();
    const topicB = await insertTopic();
    const postA = await insertPost({ topic_id: topicA.id });
    const postB = await insertPost({ topic_id: topicB.id });

    await assert.rejects(
      query('UPDATE forum_topics SET solution_post_id = $1 WHERE id = $2', [postA.id, topicB.id]),
      { constraint: 'forum_topics_solution_in_topic' },
    );
    const { rows } = await query(
      'UPDATE forum_topics SET solution_post_id = $1 WHERE id = $2 RETURNING solution_post_id',
      [postA.id, topicA.id],
    );
    assert.deepEqual(rows, [{ solution_post_id: postA.id }]);

    await query('DELETE FROM forum_posts WHERE id = $1', [postA.id]);
    const { rows: solved } = await query(
      'SELECT solution_post_id FROM forum_topics WHERE id = $1',
      [topicA.id],
    );
    assert.deepEqual(solved, [{ solution_post_id: null }]);
    assert.ok(postB.id);
  });

  test('respostas: um nível, mesmo tópico e exclusão do pai', async () => {
    const topic = await insertTopic();
    const other = await insertTopic();
    const root = await insertPost({ topic_id: topic.id });
    const reply = await insertPost({ topic_id: topic.id, parent_post_id: root.id });
    assert.equal(reply.parent_post_id, root.id);

    // Um nível: resposta de resposta é recusada, como resposta em outro tópico.
    await assert.rejects(insertPost({ topic_id: topic.id, parent_post_id: reply.id }), {
      constraint: 'forum_posts_parent_single_level',
    });
    await assert.rejects(insertPost({ topic_id: other.id, parent_post_id: root.id }), {
      constraint: 'forum_posts_parent_same_topic',
    });
    await assert.rejects(insertPost({ topic_id: topic.id, parent_post_id: randomUUID() }), {
      code: '23503',
      constraint: 'forum_posts_parent_post_id_fkey',
    });

    // Pai com dependentes não é apagado: a exclusão do autor troca o corpo (017).
    await assert.rejects(query('DELETE FROM forum_posts WHERE id = $1', [root.id]), {
      code: '23503',
      constraint: 'forum_posts_parent_post_id_fkey',
    });

    const author = await insertUser();
    const base = { topic_id: topic.id, author_id: author };
    for (const body of ['', '   ', 'b'.repeat(20001)]) {
      await rejects(
        'forum_posts',
        { ...base, body_md: body, body_html: '<p>x</p>' },
        'forum_posts_body_md_length',
      );
    }
    await rejects(
      'forum_posts',
      { ...base, body_md: 'Corpo', body_html: '' },
      'forum_posts_body_html_not_empty',
    );
    await rejects(
      'forum_posts',
      { ...base, body_md: 'Corpo', body_html: '<p>x</p>', hidden_by: author },
      'forum_posts_hidden_matches_by',
    );
    await rejects(
      'forum_posts',
      { ...base, body_md: 'Corpo', body_html: '<p>x</p>', edited_by: author },
      'forum_posts_edited_matches_by',
    );
    const id = randomUUID();
    await rejects(
      'forum_posts',
      { id, ...base, body_md: 'Corpo', body_html: '<p>x</p>', parent_post_id: id },
      'forum_posts_self_parent',
    );
    await assert.rejects(
      query(
        `INSERT INTO forum_posts (topic_id, body_md, body_html) VALUES ($1, 'Corpo', '<p>x</p>')`,
        [topic.id],
      ),
      { code: '23502', column: 'author_id' },
    );
    await assert.rejects(insertPost({ topic_id: randomUUID(), author_id: author }), {
      code: '23503',
      constraint: 'forum_posts_topic_id_fkey',
    });
    assert.equal(await foreignKeyDeleteAction('forum_posts', 'forum_posts_topic_id_fkey'), 'c');
    assert.equal(
      await foreignKeyDeleteAction('forum_posts', 'forum_posts_parent_post_id_fkey'),
      'a',
    );
  });

  test('reações: seis emojis, uma de cada por usuário e alvo, e limpeza com o alvo', async () => {
    const topic = await insertTopic();
    const user = await insertUser();
    const reaction = await insertRow('reactions', {
      target_type: 'forum_topic',
      target_id: topic.id,
      user_id: user,
      emoji: '👍',
    });
    assert.ok(reaction.created_at instanceof Date);
    await assert.rejects(
      insertRow('reactions', {
        target_type: 'forum_topic',
        target_id: topic.id,
        user_id: user,
        emoji: '👍',
      }),
      { code: '23505', constraint: 'reactions_pkey' },
    );

    for (const emoji of EMOJIS.slice(1)) {
      await insertRow('reactions', {
        target_type: 'forum_topic',
        target_id: topic.id,
        user_id: user,
        emoji,
      });
    }
    for (const emoji of ['😀', 'like']) {
      await rejects(
        'reactions',
        { target_type: 'forum_topic', target_id: topic.id, user_id: user, emoji },
        'reactions_emoji_valid',
      );
    }
    await rejects(
      'reactions',
      { target_type: 'case', target_id: topic.id, user_id: user, emoji: '👍' },
      'reactions_target_type_valid',
    );
    await assert.rejects(
      insertRow('reactions', {
        target_type: 'forum_topic',
        target_id: topic.id,
        user_id: randomUUID(),
        emoji: '🎉',
      }),
      { code: '23503', constraint: 'reactions_user_id_fkey' },
    );

    // Até a resposta do tópico tem reação e as duas somem com o conteúdo removido.
    const post = await insertPost({ topic_id: topic.id });
    await insertRow('reactions', {
      target_type: 'forum_post',
      target_id: post.id,
      user_id: await insertUser(),
      emoji: '👀',
    });
    await query('DELETE FROM forum_topics WHERE id = $1', [topic.id]);
    const { rows } = await query('SELECT count(*)::int AS n FROM reactions');
    assert.equal(rows[0].n, 0);
  });

  test('seguidores: um por usuário e tópico; somem com o tópico', async () => {
    const topic = await insertTopic();
    const user = await insertUser();
    await insertRow('forum_topic_follows', { topic_id: topic.id, user_id: user });
    await assert.rejects(insertRow('forum_topic_follows', { topic_id: topic.id, user_id: user }), {
      code: '23505',
      constraint: 'forum_topic_follows_pkey',
    });
    await assert.rejects(
      insertRow('forum_topic_follows', { topic_id: topic.id, user_id: randomUUID() }),
      { code: '23503', constraint: 'forum_topic_follows_user_id_fkey' },
    );
    await query('DELETE FROM forum_topics WHERE id = $1', [topic.id]);
    const { rows } = await query('SELECT count(*)::int AS n FROM forum_topic_follows');
    assert.equal(rows[0].n, 0);
  });

  test('denúncias: motivos, contexto, uma por denunciante e resolução', async () => {
    const reasons = ['spam', 'harassment', 'inappropriate', 'piracy', 'personal_data', 'other'];
    for (const reason of reasons) {
      await insertReport({ reason, details: reason === 'other' ? 'Sem categoria' : null });
    }
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'forum_topic',
        target_id: randomUUID(),
        reason: 'other',
      },
      'reports_other_requires_details',
    );
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'forum_topic',
        target_id: randomUUID(),
        reason: 'spam',
        details: 'd'.repeat(2001),
      },
      'reports_details_length',
    );
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'forum_post',
        target_id: randomUUID(),
        reason: 'spam',
        context: { messages: [] },
      },
      'reports_context_only_messages',
    );
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'message',
        target_id: randomUUID(),
        reason: 'harassment',
        context: '[1]',
      },
      'reports_context_object',
    );

    // A fila guarda só o necessário; 'message' leva o contexto das mensagens.
    const message = await insertReport({
      target_type: 'message',
      reason: 'harassment',
      context: { target: { body: 'oi' }, before: [], after: [] },
    });
    assert.equal(message.status, 'open');
    assert.equal(message.resolved_at, null);

    const reporter = await insertUser();
    const target = randomUUID();
    await insertReport({ reporter_id: reporter, target_type: 'forum_post', target_id: target });
    await assert.rejects(
      insertReport({ reporter_id: reporter, target_type: 'forum_post', target_id: target }),
      { code: '23505', constraint: 'reports_reporter_content_unique' },
    );
    // Denúncia anonimizada não disputa unicidade nem exige denunciante.
    await insertReport({ reporter_id: null, target_id: target });
    await insertReport({ reporter_id: null, target_id: target });
    await assert.rejects(insertReport({ reporter_id: randomUUID() }), {
      code: '23503',
      constraint: 'reports_reporter_id_fkey',
    });

    const moderator = await insertUser();
    const resolved = await insertReport({
      reporter_id: await insertUser(),
      target_id: randomUUID(),
      status: 'resolved',
      resolved_by: moderator,
      resolved_at: new Date(),
      resolution: 'Conteúdo ocultado',
    });
    assert.equal(resolved.status, 'resolved');
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'forum_post',
        target_id: randomUUID(),
        reason: 'spam',
        status: 'resolved',
      },
      'reports_resolution_matches_status',
    );
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'forum_post',
        target_id: randomUUID(),
        reason: 'spam',
        resolved_at: new Date(),
      },
      'reports_resolution_matches_status',
    );
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'forum_post',
        target_id: randomUUID(),
        reason: 'spam',
        status: 'dismissed',
        resolved_by: moderator,
        resolved_at: new Date(),
        resolution: '  ',
      },
      'reports_resolution_not_empty',
    );
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'user',
        target_id: randomUUID(),
        reason: 'spam',
      },
      'reports_target_type_valid',
    );
    await rejects(
      'reports',
      {
        reporter_id: await insertUser(),
        target_type: 'forum_post',
        target_id: randomUUID(),
        reason: 'offense',
      },
      'reports_reason_valid',
    );
  });

  test('ações de moderação: alcance do alvo, motivo obrigatório e histórico', async () => {
    const moderator = await insertUser();
    const author = await insertUser();
    const topic = await insertTopic();
    const post = await insertPost({ topic_id: topic.id, author_id: author });

    const hide = await insertRow('moderation_actions', {
      moderator_id: moderator,
      action: 'hide',
      target_type: 'forum_post',
      target_id: post.id,
      target_user_id: author,
    });
    assert.equal(hide.reason, null);
    await insertRow('moderation_actions', {
      moderator_id: moderator,
      action: 'dismiss',
      target_type: 'forum_topic',
      target_id: topic.id,
      target_user_id: author,
      reason: 'Dentro das regras',
    });
    await insertRow('moderation_actions', {
      moderator_id: moderator,
      action: 'clear_profile',
      target_type: 'profile',
      target_id: author,
      target_user_id: author,
    });

    // Ações sobre conta apontam para o usuário e exigem motivo.
    await insertRow('moderation_actions', {
      moderator_id: moderator,
      action: 'warn',
      target_type: 'user',
      target_id: author,
      target_user_id: author,
      reason: 'Assédio',
    });
    await insertRow('moderation_actions', {
      moderator_id: moderator,
      action: 'suspend',
      target_type: 'user',
      target_id: author,
      target_user_id: author,
      reason: 'Assédio reincidente',
    });
    await insertRow('moderation_actions', {
      moderator_id: moderator,
      action: 'unsuspend',
      target_type: 'user',
      target_id: author,
      target_user_id: author,
      reason: 'Prazo encerrado',
    });
    await assert.rejects(
      insertRow('moderation_actions', {
        moderator_id: moderator,
        action: 'warn',
        target_type: 'forum_post',
        target_id: post.id,
        target_user_id: author,
        reason: 'Assédio',
      }),
      { constraint: 'moderation_actions_user_target_matches' },
    );
    await rejects(
      'moderation_actions',
      {
        moderator_id: moderator,
        action: 'suspend',
        target_type: 'user',
        target_id: author,
        target_user_id: author,
      },
      'moderation_actions_reason_required',
    );
    await rejects(
      'moderation_actions',
      {
        moderator_id: moderator,
        action: 'ban',
        target_type: 'user',
        target_id: author,
        target_user_id: author,
        reason: 'Banimento',
      },
      'moderation_actions_action_valid',
    );
    await rejects(
      'moderation_actions',
      {
        moderator_id: moderator,
        action: 'hide',
        target_type: 'lesson',
        target_id: post.id,
        target_user_id: author,
      },
      'moderation_actions_target_type_valid',
    );
    await assert.rejects(
      insertRow('moderation_actions', {
        moderator_id: randomUUID(),
        action: 'hide',
        target_type: 'forum_post',
        target_id: post.id,
        target_user_id: author,
      }),
      { code: '23503', constraint: 'moderation_actions_moderator_id_fkey' },
    );
    await assert.rejects(
      insertRow('moderation_actions', {
        moderator_id: moderator,
        action: 'hide',
        target_type: 'forum_post',
        target_id: post.id,
        target_user_id: randomUUID(),
      }),
      { code: '23503', constraint: 'moderation_actions_target_user_id_fkey' },
    );
  });

  test('índices e planos: lista da categoria, filtros e busca', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN (
          'forum_categories', 'forum_topics', 'forum_posts', 'reactions',
          'forum_topic_follows', 'reports', 'moderation_actions'
        ) OR (tablename = 'lessons' AND indexname = 'lessons_forum_topic_unique')
        ORDER BY indexname`,
    );
    const defs = new Map<string, string>(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(
      [...defs.keys()],
      [
        'forum_categories_course_unique',
        'forum_categories_pkey',
        'forum_posts_author_created_idx',
        'forum_posts_body_trgm_idx',
        'forum_posts_hidden_idx',
        'forum_posts_parent_idx',
        'forum_posts_pkey',
        'forum_posts_topic_created_idx',
        'forum_topic_follows_pkey',
        'forum_topic_follows_user_idx',
        'forum_topics_author_created_idx',
        'forum_topics_body_trgm_idx',
        'forum_topics_category_activity_idx',
        'forum_topics_hidden_idx',
        'forum_topics_lesson_unique',
        'forum_topics_pkey',
        'forum_topics_solution_idx',
        'forum_topics_solved_idx',
        'forum_topics_title_trgm_idx',
        'forum_topics_unanswered_idx',
        'lessons_forum_topic_unique',
        'moderation_actions_created_at_idx',
        'moderation_actions_pkey',
        'moderation_actions_target_idx',
        'moderation_actions_target_user_idx',
        'reactions_pkey',
        'reports_open_target_idx',
        'reports_pkey',
        'reports_reporter_content_unique',
        'reports_reporter_created_idx',
        'reports_resolved_retention_idx',
      ],
    );
    const def = (name: string) => defs.get(name) ?? '';
    assert.match(
      def('forum_topics_category_activity_idx'),
      /\(category_id, pinned DESC, last_activity_at DESC, id DESC\)$/,
    );
    assert.match(def('forum_topics_unanswered_idx'), /WHERE \(\(deleted_at IS NULL\) AND/);
    assert.match(def('forum_topics_title_trgm_idx'), /USING gin \(title gin_trgm_ops\)$/);
    assert.match(def('forum_posts_body_trgm_idx'), /USING gin \(body_md gin_trgm_ops\)$/);
    assert.match(
      def('reports_reporter_content_unique'),
      /\(reporter_id, target_type, target_id\)$/,
    );
    assert.match(
      def('reports_open_target_idx'),
      /\(target_type, target_id, created_at\) WHERE \(status = 'open'::text\)$/,
    );

    const category = await insertCategory();
    const author = await insertUser();
    await query(
      `INSERT INTO forum_topics (category_id, author_id, title, body_md, body_html,
                                 last_activity_at, posts_count)
       SELECT $1, $2, 'Tópico ' || g, 'Corpo ' || g, '<p>Corpo</p>',
              now() - (g || ' minutes')::interval, CASE WHEN g % 2 = 0 THEN 0 ELSE 2 END
         FROM generate_series(1, 3000) AS g`,
      [category.id, author],
    );
    await query('ANALYZE forum_topics');
    const plan = async (sql: string) =>
      (await query(`EXPLAIN ${sql}`, [category.id])).rows
        .map((row) => row['QUERY PLAN'])
        .join('\n');

    const list = await plan(
      `SELECT id FROM forum_topics WHERE category_id = $1
        ORDER BY pinned DESC, last_activity_at DESC, id DESC LIMIT 25`,
    );
    assert.match(list, /forum_topics_category_activity_idx/, list);
    assert.doesNotMatch(list, /Sort/, list);

    const unanswered = await plan(
      `SELECT id FROM forum_topics
        WHERE category_id = $1 AND deleted_at IS NULL AND posts_count = 0
        ORDER BY last_activity_at DESC LIMIT 25`,
    );
    assert.match(unanswered, /forum_topics_unanswered_idx/, unanswered);
    assert.doesNotMatch(unanswered, /Sort/, unanswered);
  });
});
