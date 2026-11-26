import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

type Row = Record<string, unknown>;

describe('0016: central de notificações', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 16 });
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
      email: `central-${unique()}@example.com`,
      name: 'Pessoa',
    });
    return user.id as string;
  }

  async function insertNotification(overrides: Row = {}): Promise<Row> {
    return insertRow('notifications', {
      user_id: await insertUser(),
      type: 'forum.reply',
      ...overrides,
    });
  }

  async function insertPref(overrides: Row = {}): Promise<Row> {
    return insertRow('notification_prefs', {
      user_id: await insertUser(),
      group: 'forum',
      in_app: true,
      email: true,
      ...overrides,
    });
  }

  const hex64 = (seed: string) => seed.repeat(64).slice(0, 64);

  async function insertToken(overrides: Row = {}): Promise<Row> {
    return insertRow('notification_unsubscribe_tokens', {
      token: hex64(unique().padEnd(4, '0')),
      user_id: await insertUser(),
      group: 'forum',
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

  test('down e up da 0016 removem e recriam tabelas, coluna gerada e gatilho', async () => {
    const tables = ['notifications', 'notification_prefs', 'notification_unsubscribe_tokens'];
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    const generated = async () =>
      (
        await query(
          `SELECT is_generated, is_nullable FROM information_schema.columns
            WHERE table_name = 'notifications' AND column_name = 'group_key'`,
        )
      ).rows.map((row) => `${row.is_generated} ${row.is_nullable}`);
    assert.deepEqual(await generated(), ['ALWAYS NO']);

    // A central reutiliza a sequência única dos eventos do SSE; não nasce infraestrutura paralela.
    const sequences = async () =>
      (
        await query(`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`)
      ).rows.map((row) => row.sequencename);
    assert.deepEqual(await sequences(), ['order_number_seq', 'user_event_id_seq']);

    await migrateDown(db.client, { dir });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), false, table);
    }
    assert.deepEqual(await sequences(), ['order_number_seq', 'user_event_id_seq']);
    assert.equal(await tableExists(db.client, 'email_outbox'), true);
    assert.equal(await tableExists(db.client, 'jobs'), true);

    await migrateUp(db.client, { dir, to: 16 });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.deepEqual(await generated(), ['ALWAYS NO']);
  });

  test('notifications: padrões, UUID v7 e chave de agrupamento gerada', async () => {
    const user = await insertUser();
    const actor = await insertUser();
    const plain = await insertNotification({ user_id: user });
    assert.equal(plain.count, 1);
    assert.deepEqual(plain.data, {});
    assert.equal(plain.read_at, null);
    assert.ok(plain.created_at instanceof Date);
    assert.equal(plain.group_key, 'forum.reply');
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [plain.id]);
    assert.equal(version[0].v, 7);

    const target = randomUUID();
    const targeted = await insertNotification({
      user_id: user,
      type: 'forum.reply',
      actor_id: actor,
      target_type: 'topic',
      target_id: target,
      data: { title: 'Boas-vindas' },
    });
    assert.equal(targeted.group_key, `forum.reply:topic:${target}`);
    assert.deepEqual(targeted.data, { title: 'Boas-vindas' });

    const cases: [Row, string][] = [
      [{ type: 'reply' }, 'notifications_type_format'],
      [{ type: 'Forum.reply' }, 'notifications_type_format'],
      [{ type: 'forum.reply.extra.' }, 'notifications_type_format'],
      [{ target_type: 'topic' }, 'notifications_target_pair'],
      [{ target_id: target }, 'notifications_target_pair'],
      [{ target_type: 'Topic', target_id: target }, 'notifications_target_type_format'],
      [{ target_type: 'topic-x', target_id: target }, 'notifications_target_type_format'],
      [{ target_type: 'x'.repeat(41), target_id: target }, 'notifications_target_type_format'],
      [{ data: '[1]' }, 'notifications_data_object'],
      [{ count: 0 }, 'notifications_count_range'],
      [
        { created_at: new Date(), read_at: new Date(Date.now() - 60_000) },
        'notifications_read_after_created',
      ],
    ];
    for (const [fields, constraint] of cases) {
      await rejects('notifications', { user_id: user, type: 'forum.reply', ...fields }, constraint);
    }
    await insertNotification({
      user_id: user,
      type: 'forum.reply',
      created_at: new Date(Date.now() - 60_000),
      read_at: new Date(),
    });
    await assert.rejects(
      insertRow('notifications', { user_id: randomUUID(), type: 'forum.reply' }),
      { code: '23503', constraint: 'notifications_user_id_fkey' },
    );
    await assert.rejects(
      insertRow('notifications', {
        user_id: user,
        type: 'forum.reply',
        target_type: 'topic',
        target_id: randomUUID(),
        actor_id: randomUUID(),
      }),
      { code: '23503', constraint: 'notifications_actor_id_fkey' },
    );
    // A exclusão de conta apaga as notificações explicitamente; nenhuma chave tem cascata.
    assert.equal(await foreignKeyDeleteAction('notifications', 'notifications_user_id_fkey'), 'a');
    assert.equal(await foreignKeyDeleteAction('notifications', 'notifications_actor_id_fkey'), 'a');
  });

  test('notifications: todos os tipos da spec 024 cabem no formato do catálogo', async () => {
    const user = await insertUser();
    const types = [
      'account.verify_email',
      'account.password_reset',
      'account.exists',
      'account.new_login',
      'account.locked',
      'account.password_changed',
      'account.role_changed',
      'account.deleted',
      'order.approved',
      'order.refunded',
      'subscription.renewed',
      'subscription.payment_failed',
      'subscription.canceled',
      'subscription.expired',
      'access.granted',
      'access.revoked',
      'lesson.published',
      'course.published',
      'certificate.issued',
      'forum.reply',
      'forum.mention',
      'forum.solution',
      'dm.received',
      'follow.created',
      'case.liked',
      'case.commented',
      'badge.awarded',
      'level.up',
      'event.created',
      'event.reminder',
      'event.canceled',
      'ticket.reply',
      'ticket.status_changed',
      'announcement.published',
      'moderation.content_hidden',
      'moderation.warning',
      'moderation.suspended',
      'ticket.opened',
      'ticket.user_reply',
      'report.created',
      'ops.job_failed',
    ];
    for (const type of types) {
      // Alvo distinto por tipo: o agrupamento é por tipo + alvo.
      await insertNotification({
        user_id: user,
        type,
        target_type: 'course',
        target_id: randomUUID(),
      });
    }
    const { rows } = await query(
      'SELECT count(*)::int AS total FROM notifications WHERE user_id = $1',
      [user],
    );
    assert.equal(rows[0].total, types.length);
  });

  test('agrupamento: mesmo tipo e alvo não lido funde; lido abre linha nova', async () => {
    const user = await insertUser();
    const other = await insertUser();
    const first = await insertUser();
    const second = await insertUser();
    const target = randomUUID();

    const merge = `
      INSERT INTO notifications (user_id, type, actor_id, target_type, target_id, data, created_at)
      VALUES ($1, 'forum.reply', $2, 'topic', $3, $4::jsonb, $5::timestamptz)
      ON CONFLICT (user_id, group_key) WHERE read_at IS NULL
      DO UPDATE SET count = notifications.count + 1, actor_id = excluded.actor_id,
                    data = excluded.data, created_at = excluded.created_at
      RETURNING id, count, actor_id, data, created_at, group_key`;

    const one = await query(merge, [
      user,
      first,
      target,
      { title: 'Dúvida' },
      new Date(Date.now() - 60 * 60 * 1000),
    ]);
    const two = await query(merge, [
      user,
      second,
      target,
      { title: 'Dúvida, com mais detalhes' },
      new Date(),
    ]);
    assert.equal(two.rows[0].id, one.rows[0].id);
    assert.equal(Number(two.rows[0].count), 2);
    assert.equal(two.rows[0].actor_id, second);
    assert.deepEqual(two.rows[0].data, { title: 'Dúvida, com mais detalhes' });
    assert.ok(new Date(two.rows[0].created_at) > new Date(one.rows[0].created_at));
    assert.equal(two.rows[0].group_key, `forum.reply:topic:${target}`);

    // Outro alvo, outro tipo e outro usuário não fundem.
    const otherTarget = await query(merge, [user, first, randomUUID(), {}, new Date()]);
    assert.notEqual(otherTarget.rows[0].id, one.rows[0].id);
    const otherType = await insertNotification({
      user_id: user,
      type: 'forum.mention',
      target_type: 'topic',
      target_id: target,
    });
    assert.notEqual(otherType.id, one.rows[0].id);
    const otherUser = await query(merge, [other, first, target, {}, new Date()]);
    assert.notEqual(otherUser.rows[0].id, one.rows[0].id);

    // Lida, a próxima do mesmo tipo e alvo abre linha nova: o histórico lido fica.
    await query('UPDATE notifications SET read_at = now() WHERE id = $1', [one.rows[0].id]);
    const afterRead = await query(merge, [user, first, target, {}, new Date()]);
    assert.notEqual(afterRead.rows[0].id, one.rows[0].id);
    assert.equal(Number(afterRead.rows[0].count), 1);
    const { rows: total } = await query(
      `SELECT count(*)::int AS n FROM notifications
        WHERE user_id = $1 AND group_key = $2`,
      [user, `forum.reply:topic:${target}`],
    );
    assert.equal(total[0].n, 2);
  });

  test('central: contador, marcar todas como lidas e limpar todas', async () => {
    const user = await insertUser();
    const other = await insertUser();
    const unread = async (userId: string) =>
      (
        await query(
          'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
          [userId],
        )
      ).rows[0].n as number;

    await insertNotification({ user_id: user, type: 'forum.reply' });
    await insertNotification({ user_id: user, type: 'lesson.published' });
    await insertNotification({ user_id: user, type: 'dm.received' });
    await insertNotification({
      user_id: user,
      type: 'order.approved',
      created_at: new Date(Date.now() - 60_000),
      read_at: new Date(),
    });
    await insertNotification({ user_id: other, type: 'forum.reply' });
    assert.equal(await unread(user), 3);
    assert.equal(await unread(other), 1);

    const marked = await query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [user],
    );
    assert.equal(marked.rowCount, 3);
    assert.equal(await unread(user), 0);
    assert.equal(await unread(other), 1);

    const cleared = await query('DELETE FROM notifications WHERE user_id = $1', [user]);
    assert.equal(cleared.rowCount, 4);
    assert.equal(await unread(other), 1);
  });

  test('notification_prefs: grupos, canais obrigatórios e um registro por usuário e grupo', async () => {
    const user = await insertUser();

    const pref = await insertPref({ user_id: user });
    assert.equal(pref.in_app, true);
    assert.equal(pref.email, true);
    assert.ok(pref.updated_at instanceof Date);
    await assert.rejects(insertPref({ user_id: user }), {
      code: '23505',
      constraint: 'notification_prefs_pkey',
    });

    // Todos os grupos da spec 024, com o canal que a tabela permite.
    await insertPref({ user_id: user, group: 'account', in_app: false, email: true });
    await insertPref({ user_id: user, group: 'purchase', in_app: true, email: true });
    await insertPref({ user_id: user, group: 'courses', in_app: true, email: false });
    await insertPref({ user_id: user, group: 'messages', in_app: true, email: false });
    await insertPref({ user_id: user, group: 'community', in_app: true, email: true });
    await insertPref({ user_id: user, group: 'events', in_app: true, email: true });
    await insertPref({ user_id: user, group: 'support', in_app: true, email: true });
    await insertPref({ user_id: user, group: 'announcements', in_app: true, email: true });
    await insertPref({ user_id: user, group: 'moderation', in_app: true, email: true });
    await insertPref({ user_id: user, group: 'staff', in_app: true, email: true });

    await rejects(
      'notification_prefs',
      { user_id: user, group: 'billing', in_app: true, email: true },
      'notification_prefs_group_valid',
    );
    // RF-04: conta, compra, suporte e moderação não desligam o e-mail.
    for (const group of ['account', 'purchase', 'support', 'moderation']) {
      await rejects(
        'notification_prefs',
        { user_id: user, group, in_app: false, email: false },
        'notification_prefs_email_required',
      );
    }
    // O grupo account não tem canal "plataforma".
    await rejects(
      'notification_prefs',
      { user_id: user, group: 'account', in_app: true, email: true },
      'notification_prefs_account_has_no_in_app',
    );
    // Os canais não têm padrão no banco: o padrão de cada grupo é do código.
    await assert.rejects(
      query(`INSERT INTO notification_prefs (user_id, "group", email) VALUES ($1, 'forum', true)`, [
        await insertUser(),
      ]),
      { code: '23502', column: 'in_app' },
    );
    await assert.rejects(insertPref({ user_id: randomUUID() }), {
      code: '23503',
      constraint: 'notification_prefs_user_id_fkey',
    });

    // Alternar um canal é upsert; o gatilho mantém updated_at.
    await query(
      `UPDATE notification_prefs SET updated_at = now() - interval '1 hour'
        WHERE user_id = $1 AND "group" = 'forum'`,
      [user],
    );
    const { rows } = await query(
      `INSERT INTO notification_prefs (user_id, "group", in_app, email)
       VALUES ($1, 'forum', true, false)
       ON CONFLICT (user_id, "group")
       DO UPDATE SET in_app = excluded.in_app, email = excluded.email
       RETURNING email, updated_at > now() - interval '1 minute' AS fresh`,
      [user],
    );
    assert.deepEqual(rows, [{ email: false, fresh: true }]);
    assert.equal(
      await foreignKeyDeleteAction('notification_prefs', 'notification_prefs_user_id_fkey'),
      'a',
    );
  });

  test('descadastro: token único por usuário e grupo, só de grupo desligável, sem expiração', async () => {
    const user = await insertUser();
    const token = hex64(unique().padEnd(4, '0'));
    const created = await insertToken({ token, user_id: user });
    assert.ok(created.created_at instanceof Date);

    // O worker reusa o mesmo token para todo e-mail do grupo.
    const again = await query(
      `INSERT INTO notification_unsubscribe_tokens (token, user_id, "group")
       VALUES ($1, $2, 'forum') ON CONFLICT DO NOTHING`,
      [hex64('f'.repeat(4)), user],
    );
    assert.equal(again.rowCount, 0);
    const { rows: link } = await query(
      `SELECT user_id, "group" FROM notification_unsubscribe_tokens WHERE token = $1`,
      [token],
    );
    assert.deepEqual(link, [{ user_id: user, group: 'forum' }]);

    // Um grupo desligável tem token; um obrigatório nem chega a gerar link.
    for (const group of ['courses', 'messages', 'community', 'events', 'announcements', 'staff']) {
      await insertToken({
        token: hex64(unique().padEnd(4, '0')),
        user_id: await insertUser(),
        group,
      });
    }
    for (const group of ['account', 'purchase', 'support', 'moderation']) {
      await assert.rejects(
        insertToken({
          token: hex64(unique().padEnd(4, '0')),
          user_id: await insertUser(),
          group,
        }),
        { code: '23514', constraint: 'notification_unsubscribe_tokens_group_valid' },
      );
    }

    // Formato: 32 bytes em hexadecimal minúsculo.
    for (const bad of ['abc', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63)]) {
      await assert.rejects(insertToken({ token: bad, user_id: await insertUser() }), {
        code: '23514',
        constraint: 'notification_unsubscribe_tokens_token_format',
      });
    }
    await assert.rejects(insertToken({ user_id: randomUUID() }), {
      code: '23503',
      constraint: 'notification_unsubscribe_tokens_user_id_fkey',
    });
    // Uma linha por usuário e grupo: o segundo token do mesmo grupo é recusado.
    await assert.rejects(insertToken({ user_id: user }), {
      code: '23505',
      constraint: 'notification_unsubscribe_tokens_user_group_unique',
    });
    assert.equal(
      await foreignKeyDeleteAction(
        'notification_unsubscribe_tokens',
        'notification_unsubscribe_tokens_user_id_fkey',
      ),
      'a',
    );
  });

  test('expurgo: lidas em 90 dias, não lidas em 180, como nas retenções da spec 033', async () => {
    const user = await insertUser();
    const insert = (created: string, read: string | null) =>
      query(
        `INSERT INTO notifications (user_id, type, target_type, target_id, created_at, read_at)
         VALUES ($1, 'forum.reply', 'topic', uuidv7(), ${created}, ${read})`,
        [user],
      );
    await insert(`now() - interval '200 days'`, `now() - interval '100 days'`); // sai
    await insert(`now() - interval '110 days'`, `now() - interval '89 days'`); // fica
    await insert(`now() - interval '181 days'`, 'NULL'); // sai
    await insert(`now() - interval '179 days'`, 'NULL'); // fica
    await insert(`now() - interval '30 days'`, 'NULL'); // fica

    const read = await query(
      `DELETE FROM notifications
        WHERE read_at IS NOT NULL AND read_at < now() - interval '90 days'`,
    );
    assert.equal(read.rowCount, 1);
    const unread = await query(
      `DELETE FROM notifications
        WHERE read_at IS NULL AND created_at < now() - interval '180 days'`,
    );
    assert.equal(unread.rowCount, 1);

    const { rows: kept } = await query(
      `SELECT (created_at > now() - interval '120 days') AS recent, read_at IS NULL AS unread
         FROM notifications WHERE user_id = $1 ORDER BY created_at`,
      [user],
    );
    assert.deepEqual(kept, [
      { recent: false, unread: true },
      { recent: true, unread: false },
      { recent: true, unread: true },
    ]);
  });

  test('índices: agrupamento, lista da central, contador e expurgo', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('notifications', 'notification_prefs', 'notification_unsubscribe_tokens')
        ORDER BY indexname`,
    );
    const defs = new Map<string, string>(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(
      [...defs.keys()],
      [
        'notification_prefs_pkey',
        'notification_unsubscribe_tokens_pkey',
        'notification_unsubscribe_tokens_user_group_unique',
        'notifications_pkey',
        'notifications_read_retention_idx',
        'notifications_unread_retention_idx',
        'notifications_user_created_idx',
        'notifications_user_group_unread_unique',
        'notifications_user_unread_idx',
      ],
    );
    const def = (name: string) => defs.get(name) ?? '';
    assert.match(
      def('notifications_user_group_unread_unique'),
      /UNIQUE INDEX .*\(user_id, group_key\) WHERE \(read_at IS NULL\)/,
    );
    assert.match(def('notifications_user_created_idx'), /\(user_id, created_at DESC, id DESC\)$/);
    assert.match(def('notifications_user_unread_idx'), /\(user_id\) WHERE \(read_at IS NULL\)$/);
    assert.match(
      def('notifications_read_retention_idx'),
      /\(read_at\) WHERE \(read_at IS NOT NULL\)$/,
    );
    assert.match(
      def('notifications_unread_retention_idx'),
      /\(created_at\) WHERE \(read_at IS NULL\)$/,
    );
    assert.match(def('notification_unsubscribe_tokens_user_group_unique'), /\(user_id, "group"\)$/);

    // Volume para a central não ordenar em memória nem varrer a tabela no contador do sino.
    const user = await insertUser();
    await query(
      `INSERT INTO notifications (user_id, type, target_type, target_id, read_at)
       SELECT $1, 'forum.reply', 'topic', uuidv7(),
              CASE WHEN g % 2 = 0 THEN now() ELSE NULL END
         FROM generate_series(1, 3000) AS g`,
      [user],
    );
    await query(
      `INSERT INTO notifications (user_id, type, target_type, target_id)
       SELECT $1, 'lesson.published', 'course', uuidv7() FROM generate_series(1, 3000)`,
      [await insertUser()],
    );
    await query('ANALYZE notifications');
    const plan = async (sql: string, values: unknown[] = []) =>
      (await query(`EXPLAIN ${sql}`, values)).rows.map((row) => row['QUERY PLAN']).join('\n');

    const list = await plan(
      `SELECT id FROM notifications WHERE user_id = $1
        ORDER BY created_at DESC, id DESC LIMIT 25`,
      [user],
    );
    assert.match(list, /notifications_user_created_idx/, list);
    assert.doesNotMatch(list, /Sort/, list);

    const unreadPlan = await plan(
      'SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [user],
    );
    assert.match(unreadPlan, /notifications_user_unread_idx/, unreadPlan);
    assert.doesNotMatch(unreadPlan, /Seq Scan/, unreadPlan);
  });
});
