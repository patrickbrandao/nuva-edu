import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

type Row = Record<string, unknown>;

describe('0019: eventos e novidades', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 19 });
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
      email: `pessoa-${unique()}@example.com`,
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

  async function insertLesson(): Promise<string> {
    const courseId = await insertCourse();
    const module = await insertRow('modules', {
      course_id: courseId,
      title: 'Módulo',
      position: 0,
    });
    const lesson = await insertRow('lessons', {
      module_id: module.id,
      title: 'Aula de teste',
      position: 0,
      status: 'published',
    });
    return lesson.id as string;
  }

  async function insertImage(purpose: string): Promise<string> {
    const image = await insertRow('images', {
      owner_user_id: await insertUser(),
      purpose,
      original_width: 1280,
      original_height: 720,
    });
    return image.id as string;
  }

  async function insertEvent(overrides: Row = {}): Promise<Row> {
    const startsAt = new Date('2026-12-01T18:00:00Z');
    return insertRow('events', {
      title: 'Live de dezembro',
      description_md: 'Encontro do mês',
      description_html: '<p>Encontro do mês</p>',
      kind: 'live',
      starts_at: startsAt,
      ends_at: new Date(startsAt.getTime() + 60 * 60 * 1000),
      created_by: await insertUser(),
      ...overrides,
    });
  }

  async function insertAnnouncement(overrides: Row = {}): Promise<Row> {
    return insertRow('announcements', {
      title: 'Novidade da escola',
      body_md: 'Temos um curso novo',
      body_html: '<p>Temos um curso novo</p>',
      author_id: await insertUser(),
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

  async function columnExists(table: string, column: string): Promise<boolean> {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows.length === 1;
  }

  test('down e up da 0019 removem e recriam tabelas, gatilho e coluna do perfil', async () => {
    const tables = ['events', 'event_products', 'announcements', 'announcement_products'];

    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.equal(await columnExists('profiles', 'announcements_seen_at'), true);

    await migrateDown(db.client, { dir });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), false, table);
    }
    assert.equal(await columnExists('profiles', 'announcements_seen_at'), false);
    const { rows: functions } = await query(
      `SELECT count(*)::int AS n FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'announcements_guard_pinned'`,
    );
    assert.equal(functions[0].n, 0);

    // A novidade reutiliza contas, catálogo, imagens, notificações e a fila; nada disso sai.
    for (const table of [
      'users',
      'courses',
      'lessons',
      'images',
      'notifications',
      'notification_prefs',
      'jobs',
      'profiles',
    ]) {
      assert.equal(await tableExists(db.client, table), true, table);
    }

    await migrateUp(db.client, { dir, to: 19 });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.equal(await columnExists('profiles', 'announcements_seen_at'), true);
  });

  test('evento: campos, padrões, UUID v7 e limites', async () => {
    const event = await insertEvent();
    assert.equal(event.audience, 'all');
    assert.equal(event.stream_url, null);
    assert.equal(event.course_id, null);
    assert.equal(event.recording_lesson_id, null);
    assert.equal(event.series_id, null);
    assert.equal(event.cover_image_id, null);
    assert.equal(event.canceled_at, null);
    assert.ok(event.created_at instanceof Date);
    assert.deepEqual(event.updated_at, event.created_at);
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [event.id]);
    assert.equal(version[0].v, 7);

    for (const kind of ['live', 'meeting', 'workshop', 'other']) {
      await insertEvent({ kind });
    }
    await rejects('events', await eventValues({ kind: 'class' }), 'events_kind_valid');

    for (const audience of ['all', 'active', 'product']) {
      await insertEvent({ audience });
    }
    await rejects('events', await eventValues({ audience: 'students' }), 'events_audience_valid');

    for (const title of ['', '   ', 'T'.repeat(161)]) {
      await rejects('events', await eventValues({ title }), 'events_title_length');
    }
    await insertEvent({ title: 'T'.repeat(160) });

    for (const description of ['', '   ', 'd'.repeat(20001)]) {
      await rejects(
        'events',
        await eventValues({ description_md: description }),
        'events_description_md_length',
      );
    }
    await insertEvent({ description_md: 'd'.repeat(20000) });
    await rejects(
      'events',
      await eventValues({ description_html: '' }),
      'events_description_html_not_empty',
    );

    for (const streamUrl of ['http://zoom.us/j/1', 'javascript:alert(1)', 'zoom.us/j/1']) {
      await rejects(
        'events',
        await eventValues({ stream_url: streamUrl }),
        'events_stream_url_format',
      );
    }
    await insertEvent({ stream_url: 'https://zoom.us/j/123' });
    await rejects(
      'events',
      await eventValues({ stream_url: `https://${'a'.repeat(2000)}` }),
      'events_stream_url_format',
    );

    const startsAt = new Date('2026-12-01T18:00:00Z');
    await rejects(
      'events',
      await eventValues({ starts_at: startsAt, ends_at: startsAt }),
      'events_ends_after_starts',
    );
    await rejects(
      'events',
      await eventValues({
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() - 60_000),
      }),
      'events_ends_after_starts',
    );
    await insertEvent({
      starts_at: startsAt,
      ends_at: new Date(startsAt.getTime() + 12 * 60 * 60 * 1000),
    });
    await rejects(
      'events',
      await eventValues({
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + 12 * 60 * 60 * 1000 + 1000),
      }),
      'events_duration_limit',
    );

    const canceled = await insertEvent({ canceled_at: new Date() });
    assert.ok(canceled.canceled_at instanceof Date);

    await assert.rejects(insertEvent({ created_by: randomUUID() }), {
      code: '23503',
      constraint: 'events_created_by_fkey',
    });
    for (const [column, constraint] of [
      ['course_id', 'events_course_id_fkey'],
      ['recording_lesson_id', 'events_recording_lesson_id_fkey'],
      ['cover_image_id', 'events_cover_image_id_fkey'],
    ] as const) {
      await assert.rejects(insertEvent({ [column]: randomUUID() }), {
        code: '23503',
        constraint,
      });
    }

    const created = await insertEvent();
    await sleep(5);
    await query(`UPDATE events SET title = 'Live editada' WHERE id = $1`, [created.id]);
    const { rows } = await query(
      'SELECT updated_at > created_at AS moved FROM events WHERE id = $1',
      [created.id],
    );
    assert.equal(rows[0].moved, true);

    async function eventValues(overrides: Row): Promise<Row> {
      return {
        title: 'Evento de teste',
        description_md: 'Descrição',
        description_html: '<p>Descrição</p>',
        kind: 'live',
        starts_at: new Date('2026-12-02T18:00:00Z'),
        ends_at: new Date('2026-12-02T19:00:00Z'),
        created_by: await insertUser(),
        ...overrides,
      };
    }
  });

  test('evento: vínculos opcionais sobrevivem à exclusão do curso, da aula e da imagem', async () => {
    for (const [column, constraint, table] of [
      ['course_id', 'events_course_id_fkey', 'courses'],
      ['recording_lesson_id', 'events_recording_lesson_id_fkey', 'lessons'],
      ['cover_image_id', 'events_cover_image_id_fkey', 'images'],
    ] as const) {
      assert.equal(await foreignKeyDeleteAction('events', constraint), 'n', constraint);
      const value =
        table === 'courses'
          ? await insertCourse()
          : table === 'lessons'
            ? await insertLesson()
            : await insertImage('event_cover');
      const event = await insertEvent({ [column]: value });
      await query(`DELETE FROM ${table} WHERE id = $1`, [value]);
      const { rows } = await query(`SELECT ${column} AS link FROM events WHERE id = $1`, [
        event.id,
      ]);
      assert.equal(rows[0].link, null, column);
    }

    // A linha de users nunca é apagada (spec 030): autor do evento sem cascata.
    assert.equal(await foreignKeyDeleteAction('events', 'events_created_by_fkey'), 'a');
  });

  test('event_products: chave, produto polimórfico, cascata do evento e índice por produto', async () => {
    const event = await insertEvent({ audience: 'product' });
    const course = await insertCourse();
    const product = await insertRow('event_products', {
      event_id: event.id,
      product_type: 'course',
      product_id: course,
    });
    assert.ok(product.created_at instanceof Date);

    await assert.rejects(
      insertRow('event_products', {
        event_id: event.id,
        product_type: 'course',
        product_id: course,
      }),
      { code: '23505', constraint: 'event_products_pkey' },
    );
    await rejects(
      'event_products',
      { event_id: event.id, product_type: 'plan', product_id: randomUUID() },
      'event_products_product_type_valid',
    );
    // product_id é polimórfico e sem chave estrangeira, como em bundle_items.
    await insertRow('event_products', {
      event_id: event.id,
      product_type: 'bundle',
      product_id: randomUUID(),
    });
    await assert.rejects(
      insertRow('event_products', {
        event_id: randomUUID(),
        product_type: 'course',
        product_id: course,
      }),
      { code: '23503', constraint: 'event_products_event_id_fkey' },
    );
    assert.equal(
      await foreignKeyDeleteAction('event_products', 'event_products_event_id_fkey'),
      'c',
    );

    await query('DELETE FROM events WHERE id = $1', [event.id]);
    const { rows } = await query(
      'SELECT count(*)::int AS n FROM event_products WHERE event_id = $1',
      [event.id],
    );
    assert.equal(rows[0].n, 0);
  });

  test('novidade: padrões, limites, link e estado com datas', async () => {
    const announcement = await insertAnnouncement();
    assert.equal(announcement.status, 'draft');
    assert.equal(announcement.audience, 'all');
    assert.equal(announcement.pinned, false);
    assert.equal(announcement.notify, false);
    assert.equal(announcement.cover_image_id, null);
    assert.equal(announcement.link_url, null);
    assert.equal(announcement.link_label, null);
    assert.equal(announcement.publish_at, null);
    assert.equal(announcement.published_at, null);
    assert.equal(announcement.archived_at, null);
    assert.ok(announcement.created_at instanceof Date);
    assert.deepEqual(announcement.updated_at, announcement.created_at);
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [
      announcement.id,
    ]);
    assert.equal(version[0].v, 7);

    // O piso de 5 caracteres da RNF-02 é do código; o banco recusa vazio e acima de 150.
    await insertAnnouncement({ title: 'Oi' });
    for (const title of ['', '   ', 'T'.repeat(151)]) {
      await rejects(
        'announcements',
        await announcementValues({ title }),
        'announcements_title_length',
      );
    }
    await insertAnnouncement({ title: 'T'.repeat(150) });

    for (const body of ['', '   ', 'b'.repeat(20001)]) {
      await rejects(
        'announcements',
        await announcementValues({ body_md: body }),
        'announcements_body_md_length',
      );
    }
    await insertAnnouncement({ body_md: 'b'.repeat(20000) });
    await rejects(
      'announcements',
      await announcementValues({ body_html: '' }),
      'announcements_body_html_not_empty',
    );

    await rejects(
      'announcements',
      await announcementValues({ audience: 'public' }),
      'announcements_audience_valid',
    );
    for (const audience of ['all', 'active', 'product']) {
      await insertAnnouncement({ audience });
    }

    for (const linkUrl of ['https://example.com/curso', '/cursos/curso-x', '/eventos/1']) {
      await insertAnnouncement({ link_url: linkUrl });
    }
    for (const linkUrl of [
      'http://example.com',
      'curso-x',
      '//evil.example',
      '',
      `https://${'a'.repeat(2000)}`,
    ]) {
      await rejects(
        'announcements',
        await announcementValues({ link_url: linkUrl }),
        'announcements_link_url_format',
      );
    }

    const linked = await insertAnnouncement({
      link_url: '/cursos/curso-x',
      link_label: 'Conhecer o curso',
    });
    assert.equal(linked.link_label, 'Conhecer o curso');
    await rejects(
      'announcements',
      await announcementValues({ link_label: 'Sem destino' }),
      'announcements_link_label_matches_url',
    );
    await rejects(
      'announcements',
      await announcementValues({ link_url: '/cursos/x', link_label: '   ' }),
      'announcements_link_label_matches_url',
    );
    await rejects(
      'announcements',
      await announcementValues({ link_url: '/cursos/x', link_label: 'L'.repeat(101) }),
      'announcements_link_label_length',
    );

    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    const base = async (overrides: Row) => announcementValues(overrides);
    for (const row of [
      await base({ status: 'draft', published_at: now }),
      await base({ status: 'draft', archived_at: now }),
      await base({ status: 'scheduled' }),
      await base({ status: 'scheduled', published_at: now }),
      await base({ status: 'published' }),
      await base({ status: 'archived', published_at: now }),
      await base({ status: 'archived', published_at: now, archived_at: earlier }),
      await base({ status: 'published', published_at: now, archived_at: now }),
    ]) {
      await rejects('announcements', row, 'announcements_status_matches_timestamps');
    }
    await assert.rejects(insertRow('announcements', await base({ status: 'shipped' })), {
      code: '23514',
    });

    const scheduled = await insertAnnouncement({
      status: 'scheduled',
      publish_at: new Date(now.getTime() + 60 * 60 * 1000),
    });
    assert.ok(scheduled.publish_at instanceof Date);
    const published = await insertAnnouncement({ status: 'published', published_at: now });
    assert.ok(published.published_at instanceof Date);
    const archived = await insertAnnouncement({
      status: 'archived',
      published_at: earlier,
      archived_at: now,
    });
    assert.ok(archived.archived_at instanceof Date);

    // Fixada não pode estar arquivada; arquivar limpa pinned na mesma transação (código).
    await rejects(
      'announcements',
      await base({ status: 'archived', published_at: earlier, archived_at: now, pinned: true }),
      'announcements_pinned_not_archived',
    );
    const pinnedDraft = await insertAnnouncement({ pinned: true });
    assert.equal(pinnedDraft.pinned, true);

    const notified = await insertAnnouncement({ notify: true });
    assert.equal(notified.notify, true);

    await assert.rejects(insertAnnouncement({ author_id: randomUUID() }), {
      code: '23503',
      constraint: 'announcements_author_id_fkey',
    });
    await assert.rejects(insertAnnouncement({ cover_image_id: randomUUID() }), {
      code: '23503',
      constraint: 'announcements_cover_image_id_fkey',
    });

    await sleep(5);
    await query(`UPDATE announcements SET title = 'Novidade editada' WHERE id = $1`, [
      announcement.id,
    ]);
    const { rows } = await query(
      'SELECT updated_at > created_at AS moved FROM announcements WHERE id = $1',
      [announcement.id],
    );
    assert.equal(rows[0].moved, true);

    async function announcementValues(overrides: Row): Promise<Row> {
      return {
        title: 'Novidade de teste',
        body_md: 'Corpo',
        body_html: '<p>Corpo</p>',
        author_id: await insertUser(),
        ...overrides,
      };
    }
  });

  test('novidade: no máximo três fixadas, com liberação ao desfixar', async () => {
    await query('UPDATE announcements SET pinned = false WHERE pinned');

    const pinned: Row[] = [];
    for (let index = 0; index < 3; index += 1) {
      pinned.push(await insertAnnouncement({ pinned: true }));
    }
    await rejects(
      'announcements',
      {
        title: 'Quarta fixada',
        body_md: 'Corpo',
        body_html: '<p>Corpo</p>',
        author_id: await insertUser(),
        pinned: true,
      },
      'announcements_pinned_limit',
    );

    // Editar outra coluna de uma fixada não passa pela contagem.
    const [firstPinned] = pinned;
    assert.ok(firstPinned);
    await query(`UPDATE announcements SET title = 'Fixada editada' WHERE id = $1`, [
      firstPinned.id,
    ]);

    await query('UPDATE announcements SET pinned = false WHERE id = $1', [firstPinned.id]);
    const fourth = await insertAnnouncement({ pinned: true });
    assert.equal(fourth.pinned, true);

    await query('UPDATE announcements SET pinned = false WHERE pinned');
  });

  test('announcement_products: chave, produto polimórfico e cascata da novidade', async () => {
    const announcement = await insertAnnouncement({ audience: 'product' });
    const course = await insertCourse();
    const product = await insertRow('announcement_products', {
      announcement_id: announcement.id,
      product_type: 'course',
      product_id: course,
    });
    assert.ok(product.created_at instanceof Date);

    await assert.rejects(
      insertRow('announcement_products', {
        announcement_id: announcement.id,
        product_type: 'course',
        product_id: course,
      }),
      { code: '23505', constraint: 'announcement_products_pkey' },
    );
    await rejects(
      'announcement_products',
      { announcement_id: announcement.id, product_type: 'plan', product_id: randomUUID() },
      'announcement_products_product_type_valid',
    );
    await insertRow('announcement_products', {
      announcement_id: announcement.id,
      product_type: 'ebook',
      product_id: randomUUID(),
    });
    await assert.rejects(
      insertRow('announcement_products', {
        announcement_id: randomUUID(),
        product_type: 'course',
        product_id: course,
      }),
      { code: '23503', constraint: 'announcement_products_announcement_id_fkey' },
    );
    assert.equal(
      await foreignKeyDeleteAction(
        'announcement_products',
        'announcement_products_announcement_id_fkey',
      ),
      'c',
    );

    await query('DELETE FROM announcements WHERE id = $1', [announcement.id]);
    const { rows } = await query(
      'SELECT count(*)::int AS n FROM announcement_products WHERE announcement_id = $1',
      [announcement.id],
    );
    assert.equal(rows[0].n, 0);
  });

  test('profiles.announcements_seen_at nasce nulo e recebe a abertura do mural', async () => {
    const user = await insertUser();
    await insertRow('profiles', { user_id: user });
    const { rows: fresh } = await query(
      'SELECT announcements_seen_at FROM profiles WHERE user_id = $1',
      [user],
    );
    assert.equal(fresh[0].announcements_seen_at, null);

    const seenAt = new Date();
    await query('UPDATE profiles SET announcements_seen_at = $1 WHERE user_id = $2', [
      seenAt,
      user,
    ]);
    const { rows } = await query('SELECT announcements_seen_at FROM profiles WHERE user_id = $1', [
      user,
    ]);
    assert.ok(rows[0].announcements_seen_at instanceof Date);
    assert.equal(rows[0].announcements_seen_at.getTime(), seenAt.getTime());
  });

  test('índices e planos: agenda, gravações, lista, não lidas e publicação agendada', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('events', 'event_products', 'announcements', 'announcement_products')
        ORDER BY indexname`,
    );
    const defs = new Map<string, string>(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(
      [...defs.keys()],
      [
        'announcement_products_pkey',
        'announcement_products_product_idx',
        'announcements_cover_image_idx',
        'announcements_pinned_idx',
        'announcements_pkey',
        'announcements_published_at_idx',
        'announcements_published_list_idx',
        'announcements_scheduled_idx',
        'announcements_status_created_idx',
        'event_products_pkey',
        'event_products_product_idx',
        'events_course_idx',
        'events_cover_image_idx',
        'events_pkey',
        'events_recording_idx',
        'events_series_idx',
        'events_starts_idx',
      ],
    );
    const def = (name: string) => defs.get(name) ?? '';
    assert.match(def('events_starts_idx'), /\(starts_at, id\)$/);
    assert.match(
      def('events_recording_idx'),
      /\(starts_at DESC, id DESC\) WHERE \(\(recording_lesson_id IS NOT NULL\) AND \(canceled_at IS NULL\)\)$/,
    );
    assert.match(def('events_course_idx'), /\(course_id, starts_at DESC\) WHERE/);
    assert.match(def('events_series_idx'), /\(series_id\) WHERE/);
    assert.match(
      def('announcements_published_list_idx'),
      /\(pinned DESC, published_at DESC, id DESC\) WHERE \(status = 'published'::text\)$/,
    );
    assert.match(
      def('announcements_published_at_idx'),
      /\(published_at\) WHERE \(status = 'published'::text\)$/,
    );
    assert.match(
      def('announcements_scheduled_idx'),
      /\(publish_at, id\) WHERE \(status = 'scheduled'::text\)$/,
    );
    assert.match(def('announcements_pinned_idx'), /\(id\) WHERE pinned$/);
    assert.match(def('announcement_products_product_idx'), /\(product_type, product_id\)$/);

    const author = await insertUser();
    const lesson = await insertLesson();
    await query(
      `INSERT INTO events
         (title, description_md, description_html, kind, starts_at, ends_at,
          recording_lesson_id, canceled_at, created_by)
       SELECT 'Evento ' || g, 'Descrição', '<p>Descrição</p>', 'live',
              now() + (g || ' hours')::interval,
              now() + (g || ' hours')::interval + interval '1 hour',
              CASE WHEN g % 10 = 0 THEN $1::uuid END,
              NULL, $2
         FROM generate_series(1, 3000) AS g`,
      [lesson, author],
    );
    await query(
      `INSERT INTO announcements
         (title, body_md, body_html, status, publish_at, published_at, author_id, created_at)
       SELECT 'Novidade ' || g, 'Corpo', '<p>Corpo</p>',
              CASE WHEN g % 100 = 0 THEN 'scheduled' ELSE 'published' END,
              CASE WHEN g % 100 = 0 THEN now() - (g || ' seconds')::interval END,
              CASE WHEN g % 100 = 0 THEN NULL ELSE now() - (g || ' minutes')::interval END,
              $1,
              now() - (g || ' hours')::interval
         FROM generate_series(1, 3000) AS g`,
      [author],
    );
    await query('ANALYZE events');
    await query('ANALYZE announcements');

    const plan = async (sql: string, values: unknown[]) =>
      (await query(`EXPLAIN ${sql}`, values)).rows.map((row) => row['QUERY PLAN']).join('\n');

    const agenda = await plan(
      `SELECT id FROM events WHERE starts_at >= $1 AND starts_at < $2
        ORDER BY starts_at, id LIMIT 50`,
      [new Date(Date.now() + 24 * 60 * 60 * 1000), new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)],
    );
    assert.match(agenda, /events_starts_idx/, agenda);
    assert.doesNotMatch(agenda, /Sort/, agenda);

    const recordings = await plan(
      `SELECT id FROM events
        WHERE recording_lesson_id IS NOT NULL AND canceled_at IS NULL
        ORDER BY starts_at DESC, id DESC LIMIT 20`,
      [],
    );
    assert.match(recordings, /events_recording_idx/, recordings);
    assert.doesNotMatch(recordings, /Sort/, recordings);

    const list = await plan(
      `SELECT id FROM announcements WHERE status = 'published'
        ORDER BY pinned DESC, published_at DESC, id DESC LIMIT 20`,
      [],
    );
    assert.match(list, /announcements_published_list_idx/, list);
    assert.doesNotMatch(list, /Sort/, list);

    const unread = await plan(
      `SELECT count(*) FROM announcements
        WHERE status = 'published' AND published_at > $1`,
      [new Date(Date.now() - 5 * 60 * 1000)],
    );
    assert.match(unread, /announcements_published_at_idx/, unread);
    assert.doesNotMatch(unread, /Seq Scan on announcements/, unread);

    const scheduled = await plan(
      `SELECT id FROM announcements
        WHERE status = 'scheduled' AND publish_at <= now()
        ORDER BY publish_at, id LIMIT 10`,
      [],
    );
    assert.match(scheduled, /announcements_scheduled_idx/, scheduled);
    assert.doesNotMatch(scheduled, /Seq Scan on announcements/, scheduled);
  });
});
