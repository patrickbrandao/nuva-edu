import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

type Row = Record<string, unknown>;

describe('0018: chamados de suporte', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 18 });
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
      email: `suporte-${unique()}@example.com`,
      name: 'Pessoa',
    });
    return user.id as string;
  }

  async function insertTicket(overrides: Row = {}): Promise<Row> {
    return insertRow('tickets', {
      user_id: await insertUser(),
      kind: 'question',
      subject: 'Dúvida sobre o curso',
      ...overrides,
    });
  }

  async function insertMessage(ticketId: string, overrides: Row = {}): Promise<Row> {
    return insertRow('ticket_messages', {
      ticket_id: ticketId,
      author_id: await insertUser(),
      body_md: 'Mensagem do chamado',
      body_html: '<p>Mensagem do chamado</p>',
      ...overrides,
    });
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

  async function insertEbook(): Promise<string> {
    const ebook = await insertRow('ebooks', {
      slug: `ebook-${unique()}`,
      title: 'Ebook de teste',
    });
    return ebook.id as string;
  }

  async function insertOrder(userId?: string): Promise<string> {
    const order = await insertRow('orders', {
      user_id: userId ?? (await insertUser()),
      subtotal_cents: 0,
      total_cents: 0,
      currency: 'BRL',
      buyer_name: 'Comprador',
      buyer_tax_id_type: 'cpf',
      buyer_tax_id: '00000000000',
    });
    return order.id as string;
  }

  async function foreignKeyDeleteAction(table: string, constraint: string): Promise<string> {
    const { rows } = await query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = $1 AND conrelid = $2::regclass`,
      [constraint, table],
    );
    return rows[0]?.confdeltype as string;
  }

  test('down e up da 0018 removem e recriam tabelas e a sequência', async () => {
    const tables = ['tickets', 'ticket_messages', 'ticket_followers'];
    const sequences = async () =>
      (
        await query(`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`)
      ).rows.map((row) => row.sequencename);

    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.deepEqual(await sequences(), [
      'order_number_seq',
      'ticket_number_seq',
      'user_event_id_seq',
    ]);

    await migrateDown(db.client, { dir });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), false, table);
    }
    assert.deepEqual(await sequences(), ['order_number_seq', 'user_event_id_seq']);
    // O chamado reutiliza contas, catálogo, vendas e notificações; a 0018 não as remove.
    for (const table of [
      'users',
      'orders',
      'courses',
      'lessons',
      'ebooks',
      'notifications',
      'email_outbox',
      'audit_log',
    ]) {
      assert.equal(await tableExists(db.client, table), true, table);
    }

    await migrateUp(db.client, { dir, to: 18 });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.deepEqual(await sequences(), [
      'order_number_seq',
      'ticket_number_seq',
      'user_event_id_seq',
    ]);
  });

  test('chamado: número legível, padrões, tipo, assunto e estado', async () => {
    const first = await insertTicket({ kind: 'question', subject: 'Não consigo acessar' });
    assert.equal(first.status, 'open');
    assert.equal(first.assignee_id, null);
    assert.equal(first.order_id, null);
    assert.equal(first.course_id, null);
    assert.equal(first.lesson_id, null);
    assert.equal(first.ebook_id, null);
    assert.equal(first.reports_count, 1);
    assert.equal(first.resolved_at, null);
    assert.equal(first.closed_at, null);
    assert.ok(first.last_user_message_at instanceof Date);
    assert.ok(first.created_at instanceof Date);
    assert.deepEqual(first.updated_at, first.created_at);
    assert.ok((first.number as number) > 0);
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [first.id]);
    assert.equal(version[0].v, 7);

    const second = await insertTicket();
    assert.equal(Number(second.number), Number(first.number) + 1);

    for (const kind of [
      'question',
      'access',
      'payment',
      'refund',
      'broken_link',
      'bug',
      'suggestion',
      'privacy',
    ]) {
      await insertTicket({ kind });
    }
    await rejects(
      'tickets',
      { user_id: await insertUser(), kind: 'complaint', subject: 'Tipo inválido' },
      'tickets_kind_valid',
    );
    await rejects(
      'tickets',
      {
        user_id: await insertUser(),
        kind: 'question',
        subject: 'Estado inválido',
        status: 'waiting',
      },
      'tickets_status_valid',
    );

    for (const subject of ['', '   ', 'S'.repeat(151)]) {
      await rejects(
        'tickets',
        { user_id: await insertUser(), kind: 'question', subject },
        'tickets_subject_length',
      );
    }
    // O piso de 5 caracteres da RNF-02 é do código; o banco só recusa vazio e acima de 150.
    await insertTicket({ subject: 'S'.repeat(150) });

    for (const reportsCount of [0, -1]) {
      await rejects(
        'tickets',
        {
          user_id: await insertUser(),
          kind: 'broken_link',
          subject: 'Link quebrado',
          reports_count: reportsCount,
        },
        'tickets_reports_count_range',
      );
    }
    await insertTicket({ reports_count: 3 });

    await assert.rejects(insertTicket({ user_id: randomUUID() }), {
      code: '23503',
      constraint: 'tickets_user_id_fkey',
    });
    await assert.rejects(insertTicket({ assignee_id: randomUUID() }), {
      code: '23503',
      constraint: 'tickets_assignee_id_fkey',
    });
    for (const [column, constraint] of [
      ['order_id', 'tickets_order_id_fkey'],
      ['course_id', 'tickets_course_id_fkey'],
      ['lesson_id', 'tickets_lesson_id_fkey'],
      ['ebook_id', 'tickets_ebook_id_fkey'],
    ] as const) {
      await assert.rejects(insertTicket({ [column]: randomUUID() }), {
        code: '23503',
        constraint,
      });
    }
  });

  test('estado e datas: resolved e closed coerentes, inclusive no fechamento direto', async () => {
    const user = await insertUser();
    const base = { user_id: user, kind: 'question', subject: 'Chamado com estado' };
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);

    await rejects(
      'tickets',
      { ...base, status: 'open', resolved_at: now },
      'tickets_status_matches_timestamps',
    );
    await rejects(
      'tickets',
      { ...base, status: 'pending', closed_at: now },
      'tickets_status_matches_timestamps',
    );
    await rejects('tickets', { ...base, status: 'resolved' }, 'tickets_status_matches_timestamps');
    await rejects(
      'tickets',
      { ...base, status: 'resolved', resolved_at: now, closed_at: now },
      'tickets_status_matches_timestamps',
    );
    await rejects('tickets', { ...base, status: 'closed' }, 'tickets_status_matches_timestamps');
    await rejects(
      'tickets',
      { ...base, status: 'closed', resolved_at: now, closed_at: earlier },
      'tickets_status_matches_timestamps',
    );

    const pending = await insertTicket({ ...base, status: 'pending' });
    assert.equal(pending.status, 'pending');
    const resolved = await insertTicket({ ...base, status: 'resolved', resolved_at: now });
    assert.ok(resolved.resolved_at instanceof Date);
    // Fechamento direto de open/pending: sem resolved_at.
    const closedDirect = await insertTicket({ ...base, status: 'closed', closed_at: now });
    assert.equal(closedDirect.resolved_at, null);
    // Fechamento depois de resolvido preserva resolved_at.
    const closedResolved = await insertTicket({
      ...base,
      status: 'closed',
      resolved_at: earlier,
      closed_at: now,
    });
    assert.ok(closedResolved.resolved_at instanceof Date);
  });

  test('vínculos sobrevivem à exclusão do pedido, curso, aula e ebook', async () => {
    for (const [column, constraint, table] of [
      ['order_id', 'tickets_order_id_fkey', 'orders'],
      ['course_id', 'tickets_course_id_fkey', 'courses'],
      ['lesson_id', 'tickets_lesson_id_fkey', 'lessons'],
      ['ebook_id', 'tickets_ebook_id_fkey', 'ebooks'],
    ] as const) {
      assert.equal(await foreignKeyDeleteAction('tickets', constraint), 'n', constraint);
      const value =
        table === 'orders'
          ? await insertOrder()
          : table === 'courses'
            ? await insertCourse()
            : table === 'lessons'
              ? await insertLesson()
              : await insertEbook();
      const ticket = await insertTicket({ [column]: value });
      await query(`DELETE FROM ${table} WHERE id = $1`, [value]);
      const { rows } = await query(`SELECT ${column} AS link FROM tickets WHERE id = $1`, [
        ticket.id,
      ]);
      assert.equal(rows[0].link, null, column);
    }

    // users e responsável não têm cascata: a linha nunca é apagada (spec 030).
    assert.equal(await foreignKeyDeleteAction('tickets', 'tickets_user_id_fkey'), 'a');
    assert.equal(await foreignKeyDeleteAction('tickets', 'tickets_assignee_id_fkey'), 'a');
  });

  test('mensagens: Markdown e HTML juntos, nota interna e cascata do chamado', async () => {
    const ticket = await insertTicket();
    const message = await insertMessage(ticket.id as string);
    assert.equal(message.internal, false);
    assert.ok(message.created_at instanceof Date);
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [
      message.id,
    ]);
    assert.equal(version[0].v, 7);

    const internal = await insertMessage(ticket.id as string, { internal: true });
    assert.equal(internal.internal, true);

    const base = { ticket_id: ticket.id, author_id: await insertUser() };
    for (const body of ['', '   ', 'b'.repeat(10001)]) {
      await rejects(
        'ticket_messages',
        { ...base, body_md: body, body_html: '<p>x</p>' },
        'ticket_messages_body_md_length',
      );
    }
    await insertMessage(ticket.id as string, { body_md: 'b'.repeat(10000) });
    await rejects(
      'ticket_messages',
      { ...base, body_md: 'Corpo', body_html: '' },
      'ticket_messages_body_html_not_empty',
    );
    await assert.rejects(
      query(
        `INSERT INTO ticket_messages (ticket_id, body_md, body_html)
         VALUES ($1, 'Corpo', '<p>x</p>')`,
        [ticket.id],
      ),
      { code: '23502', column: 'author_id' },
    );
    await assert.rejects(insertMessage(randomUUID()), {
      code: '23503',
      constraint: 'ticket_messages_ticket_id_fkey',
    });
    await assert.rejects(insertMessage(ticket.id as string, { author_id: randomUUID() }), {
      code: '23503',
      constraint: 'ticket_messages_author_id_fkey',
    });
    assert.equal(
      await foreignKeyDeleteAction('ticket_messages', 'ticket_messages_ticket_id_fkey'),
      'c',
    );

    const { rows: before } = await query(
      'SELECT count(*)::int AS n FROM ticket_messages WHERE ticket_id = $1',
      [ticket.id],
    );
    await query('DELETE FROM tickets WHERE id = $1', [ticket.id]);
    const { rows: after } = await query(
      'SELECT count(*)::int AS n FROM ticket_messages WHERE ticket_id = $1',
      [ticket.id],
    );
    assert.ok(before[0].n > 0);
    assert.equal(after[0].n, 0);
  });

  test('seguidores: um por chamado e usuário, somem com o chamado', async () => {
    const ticket = await insertTicket();
    const follower = await insertUser();
    const row = await insertRow('ticket_followers', { ticket_id: ticket.id, user_id: follower });
    assert.ok(row.created_at instanceof Date);

    await assert.rejects(
      insertRow('ticket_followers', { ticket_id: ticket.id, user_id: follower }),
      { code: '23505', constraint: 'ticket_followers_pkey' },
    );
    await assert.rejects(
      insertRow('ticket_followers', { ticket_id: ticket.id, user_id: randomUUID() }),
      { code: '23503', constraint: 'ticket_followers_user_id_fkey' },
    );
    await assert.rejects(
      insertRow('ticket_followers', { ticket_id: randomUUID(), user_id: follower }),
      { code: '23503', constraint: 'ticket_followers_ticket_id_fkey' },
    );
    assert.equal(
      await foreignKeyDeleteAction('ticket_followers', 'ticket_followers_ticket_id_fkey'),
      'c',
    );

    await query('DELETE FROM tickets WHERE id = $1', [ticket.id]);
    const { rows } = await query('SELECT count(*)::int AS n FROM ticket_followers');
    assert.equal(rows[0].n, 0);
  });

  test('broken_link: índice parcial por aula e ebook e contador de relatos', async () => {
    const lesson = await insertLesson();
    const ebook = await insertEbook();
    const first = await insertTicket({
      kind: 'broken_link',
      subject: 'Vídeo indisponível',
      lesson_id: lesson,
    });
    const second = await insertTicket({
      kind: 'broken_link',
      subject: 'Material indisponível',
      ebook_id: ebook,
    });
    assert.equal(first.reports_count, 1);
    assert.equal(second.reports_count, 1);

    // O código soma o relato no chamado existente; não é unicidade no banco.
    await query('UPDATE tickets SET reports_count = reports_count + 1 WHERE id = $1', [first.id]);
    await insertRow('ticket_followers', { ticket_id: first.id, user_id: await insertUser() });
    const { rows } = await query('SELECT reports_count FROM tickets WHERE id = $1', [first.id]);
    assert.deepEqual(rows, [{ reports_count: 2 }]);
    // Um segundo chamado do mesmo tipo e aula é aceito no banco: a deduplicação é do código.
    await insertTicket({ kind: 'broken_link', subject: 'Mesmo link', lesson_id: lesson });

    // Chamado fechado ou de outro tipo não entra na busca da deduplicação.
    const closed = await insertTicket({
      kind: 'broken_link',
      subject: 'Antigo',
      lesson_id: lesson,
      status: 'closed',
      closed_at: new Date(),
    });
    assert.equal(closed.status, 'closed');

    const { rows: indexes } = await query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('tickets', 'ticket_messages', 'ticket_followers')
        ORDER BY indexname`,
    );
    const defs = new Map<string, string>(indexes.map((row) => [row.indexname, row.indexdef]));
    const def = (name: string) => defs.get(name) ?? '';
    assert.match(
      def('tickets_broken_link_lesson_idx'),
      /\(lesson_id\) WHERE \(\(kind = 'broken_link'::text\) AND \(status = ANY/,
    );
    assert.match(
      def('tickets_broken_link_ebook_idx'),
      /\(ebook_id\) WHERE \(\(kind = 'broken_link'::text\) AND \(status = ANY/,
    );
    assert.match(
      def('tickets_autoclose_idx'),
      /\(resolved_at\) WHERE \(status = 'resolved'::text\)$/,
    );
  });

  test('índices e planos: lista do admin, fechamento automático e acompanhamento', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('tickets', 'ticket_messages', 'ticket_followers')
        ORDER BY indexname`,
    );
    const defs = new Map<string, string>(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(
      [...defs.keys()],
      [
        'ticket_followers_pkey',
        'ticket_followers_user_idx',
        'ticket_messages_pkey',
        'ticket_messages_ticket_author_created_idx',
        'ticket_messages_ticket_created_idx',
        'tickets_assignee_status_idx',
        'tickets_autoclose_idx',
        'tickets_broken_link_ebook_idx',
        'tickets_broken_link_lesson_idx',
        'tickets_course_status_idx',
        'tickets_kind_status_idx',
        'tickets_number_unique',
        'tickets_pkey',
        'tickets_status_last_user_idx',
        'tickets_user_created_idx',
      ],
    );
    const def = (name: string) => defs.get(name) ?? '';
    assert.match(def('tickets_status_last_user_idx'), /\(status, last_user_message_at, id\)$/);
    assert.match(
      def('tickets_assignee_status_idx'),
      /\(assignee_id, status, last_user_message_at, id\) WHERE \(assignee_id IS NOT NULL\)$/,
    );
    assert.match(
      def('tickets_course_status_idx'),
      /\(course_id, status, last_user_message_at, id\) WHERE \(course_id IS NOT NULL\)$/,
    );
    assert.match(
      def('ticket_messages_ticket_author_created_idx'),
      /\(ticket_id, author_id, created_at DESC\)$/,
    );
    assert.match(def('ticket_followers_user_idx'), /\(user_id, ticket_id\)$/);

    const author = await insertUser();
    await query(
      `INSERT INTO tickets (user_id, kind, subject, status, last_user_message_at, created_at)
       SELECT $1, 'question', 'Chamado ' || g,
              CASE WHEN g % 2 = 0 THEN 'open' ELSE 'pending' END,
              now() - (g || ' minutes')::interval, now() - (g || ' hours')::interval
         FROM generate_series(1, 3000) AS g`,
      [author],
    );
    await query(
      `INSERT INTO tickets (user_id, kind, subject, status, resolved_at, closed_at)
       SELECT $1, 'question', 'Resolvido ' || g, 'resolved',
              now() - (g || ' days')::interval, NULL
         FROM generate_series(1, 200) AS g`,
      [author],
    );
    await query('ANALYZE tickets');

    const plan = async (sql: string, values: unknown[]) =>
      (await query(`EXPLAIN ${sql}`, values)).rows.map((row) => row['QUERY PLAN']).join('\n');

    const list = await plan(
      `SELECT id FROM tickets WHERE status = 'open'
        ORDER BY last_user_message_at, id LIMIT 25`,
      [],
    );
    assert.match(list, /tickets_status_last_user_idx/, list);
    assert.doesNotMatch(list, /Sort/, list);

    const autoclose = await plan(
      `SELECT id FROM tickets WHERE status = 'resolved'
        AND resolved_at <= now() - interval '7 days'`,
      [],
    );
    assert.match(autoclose, /tickets_autoclose_idx/, autoclose);
    assert.doesNotMatch(autoclose, /Seq Scan on tickets/, autoclose);

    const mine = await plan(
      `SELECT id FROM tickets WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 25`,
      [author],
    );
    assert.match(mine, /tickets_user_created_idx/, mine);
    assert.doesNotMatch(mine, /Sort/, mine);
  });
});
