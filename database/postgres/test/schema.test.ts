import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { defaultMigrationsDir } from '../src/config.ts';
import { loadMigrations } from '../src/migrations.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch } from './helpers.ts';

const dir = defaultMigrationsDir;

/** Tudo o que existe no esquema public, fora a tabela de controle. */
async function publicObjects(db: Scratch): Promise<string[]> {
  const { rows } = await db.client.query<{ item: string }>(`
    SELECT 'tabela ' || tablename AS item FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    UNION ALL
    SELECT 'função ' || p.proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE n.nspname = 'public' AND d.objid IS NULL
    UNION ALL
    SELECT 'extensão ' || extname FROM pg_extension WHERE extname <> 'plpgsql'
    UNION ALL
    SELECT 'sequência ' || sequencename FROM pg_sequences WHERE schemaname = 'public'
    UNION ALL
    SELECT 'índice ' || indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    ORDER BY 1`);
  return rows.map((row) => row.item);
}

describe('migrations reais', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir });
  });
  after(async () => {
    await db.drop();
  });

  test('do zero, depois down de todas e up de novo, sem sobras', async () => {
    const full = await publicObjects(db);
    for (const item of [
      'tabela settings',
      'tabela jobs',
      'função jobs_notify',
      'índice jobs_unique_key_idx',
      'sequência user_event_id_seq',
      'tabela images',
      'tabela image_variants',
      'índice images_created_at_idx',
      'tabela users',
      'tabela user_suspensions',
      'índice users_email_active_unique',
    ]) {
      assert.ok(full.includes(item), item);
    }

    const total = (await loadMigrations(dir)).length;
    const reverted = await migrateDown(db.client, { dir, to: 0 });
    assert.equal(reverted.length, total);
    assert.deepEqual(await publicObjects(db), []);

    await migrateUp(db.client, { dir });
    assert.deepEqual(await publicObjects(db), full);
  });

  test('ida e volta da última migration', async () => {
    const full = await publicObjects(db);
    await migrateDown(db.client, { dir });
    await migrateUp(db.client, { dir });
    assert.deepEqual(await publicObjects(db), full);
  });

  test('0001: uuidv7() é nativa do PostgreSQL 18 e gera UUID versão 7', async () => {
    const { rows } = await db.client.query(
      `SELECT uuid_extract_version(uuidv7()) AS version, n.nspname AS schema
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'uuidv7' AND p.pronargs = 0`,
    );
    assert.deepEqual(rows, [{ version: 7, schema: 'pg_catalog' }]);
  });

  test('0001: settings tem id UUID v7, datas em timestamptz e valor jsonb', async () => {
    const { rows: columns } = await db.client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'settings' ORDER BY ordinal_position`,
    );
    assert.deepEqual(columns, [
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'key', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'value', data_type: 'jsonb', is_nullable: 'NO' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);

    const { rows } = await db.client.query(
      `INSERT INTO settings (key, value) VALUES ('timezone', '"America/Sao_Paulo"')
       RETURNING uuid_extract_version(id) AS version, value, created_at = updated_at AS same`,
    );
    assert.deepEqual(rows, [{ version: 7, value: 'America/Sao_Paulo', same: true }]);
  });

  test('0001: settings recusa chave repetida e chave fora do formato', async () => {
    await db.client.query(
      `INSERT INTO settings (key, value) VALUES ('gamification.actions', '{}')`,
    );
    await assert.rejects(
      db.client.query(`INSERT INTO settings (key, value) VALUES ('gamification.actions', '[]')`),
      { code: '23505', constraint: 'settings_key_unique' },
    );
    for (const key of ['', 'Timezone', 'a..b', '.a', 'a.', 'a b', '1a']) {
      await assert.rejects(
        db.client.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, '1']),
        { code: '23514', constraint: 'settings_key_format' },
        `chave ${JSON.stringify(key)}`,
      );
    }
    await assert.rejects(
      db.client.query(`INSERT INTO settings (key, value) VALUES ('nulo', NULL)`),
      { code: '23502' },
    );
  });

  test('0001: updated_at avança sozinho no UPDATE e created_at não muda', async () => {
    await db.client.query(
      `INSERT INTO settings (key, value) VALUES ('forum.topics_per_hour', '10')`,
    );
    await sleep(5);
    const { rows } = await db.client.query(
      `UPDATE settings SET value = '20' WHERE key = 'forum.topics_per_hour'
       RETURNING updated_at > created_at AS advanced, value`,
    );
    assert.deepEqual(rows, [{ advanced: true, value: 20 }]);
  });

  test('0001: pg_trgm disponível para índice de busca', async () => {
    const { rows } = await db.client.query(`SELECT similarity('curso', 'cursos') > 0.5 AS ok`);
    assert.deepEqual(rows, [{ ok: true }]);
  });

  test('0002: jobs tem as colunas da spec 005, com tipos e padrões', async () => {
    const { rows: columns } = await db.client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'jobs' ORDER BY ordinal_position`,
    );
    const tz = 'timestamp with time zone';
    assert.deepEqual(columns, [
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'type', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'payload', data_type: 'jsonb', is_nullable: 'NO' },
      { column_name: 'status', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'priority', data_type: 'smallint', is_nullable: 'NO' },
      { column_name: 'run_at', data_type: tz, is_nullable: 'NO' },
      { column_name: 'attempts', data_type: 'smallint', is_nullable: 'NO' },
      { column_name: 'max_attempts', data_type: 'smallint', is_nullable: 'NO' },
      { column_name: 'unique_key', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'locked_by', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'locked_at', data_type: tz, is_nullable: 'YES' },
      { column_name: 'heartbeat_at', data_type: tz, is_nullable: 'YES' },
      { column_name: 'last_error', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'created_at', data_type: tz, is_nullable: 'NO' },
      { column_name: 'finished_at', data_type: tz, is_nullable: 'YES' },
    ]);

    const { rows } = await db.client.query(
      `INSERT INTO jobs (type) VALUES ('email.send')
       RETURNING uuid_extract_version(id) AS version, payload, status, priority, attempts,
                 max_attempts, run_at = created_at AS now, unique_key, locked_by, finished_at`,
    );
    assert.deepEqual(rows, [
      {
        version: 7,
        payload: {},
        status: 'queued',
        priority: 0,
        attempts: 0,
        max_attempts: 5,
        now: true,
        unique_key: null,
        locked_by: null,
        finished_at: null,
      },
    ]);
    await db.client.query('DELETE FROM jobs');
  });

  test('0002 e 0003: jobs tem os índices de consumo, deduplicação, batimento, retenção e chave', async () => {
    const { rows } = await db.client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'jobs' ORDER BY indexname`,
    );
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(Object.keys(defs), [
      'jobs_finished_idx',
      'jobs_pkey',
      'jobs_ready_idx',
      'jobs_running_heartbeat_idx',
      'jobs_unique_key_active_unique',
      'jobs_unique_key_idx',
    ]);
    assert.match(
      defs.jobs_ready_idx ?? '',
      /\(priority DESC, run_at\) WHERE \(status = 'queued'::text\)/,
    );
    assert.match(defs.jobs_unique_key_active_unique ?? '', /^CREATE UNIQUE INDEX .*\(unique_key\)/);
    assert.match(defs.jobs_running_heartbeat_idx ?? '', /\(heartbeat_at\) WHERE/);
    assert.match(defs.jobs_finished_idx ?? '', /\(status, finished_at\) WHERE/);
    assert.match(
      defs.jobs_unique_key_idx ?? '',
      /^CREATE INDEX .*\(unique_key\) WHERE \(unique_key IS NOT NULL\)$/,
    );
  });

  test('0002: jobs recusa estado, tipo, payload e tentativas inválidos', async () => {
    const cases: [string, string, string][] = [
      ['jobs_status_valid', `(type, status) VALUES ('notify', 'paused')`, 'estado desconhecido'],
      ['jobs_type_format', `(type) VALUES ('Email.Send')`, 'tipo com maiúscula'],
      ['jobs_type_format', `(type) VALUES ('')`, 'tipo vazio'],
      ['jobs_payload_object', `(type, payload) VALUES ('notify', '[1]')`, 'payload lista'],
      ['jobs_payload_object', `(type, payload) VALUES ('notify', '"x"')`, 'payload texto'],
      ['jobs_attempts_range', `(type, attempts) VALUES ('notify', -1)`, 'tentativa negativa'],
      [
        'jobs_attempts_range',
        `(type, attempts, max_attempts) VALUES ('notify', 4, 3)`,
        'acima do máximo',
      ],
      ['jobs_max_attempts_range', `(type, max_attempts) VALUES ('notify', 0)`, 'máximo zero'],
      ['jobs_unique_key_not_empty', `(type, unique_key) VALUES ('notify', '')`, 'chave vazia'],
    ];
    for (const [constraint, values, label] of cases) {
      await assert.rejects(
        db.client.query(`INSERT INTO jobs ${values}`),
        { code: '23514', constraint },
        label,
      );
    }
    for (const column of ['payload', 'status', 'priority', 'run_at', 'attempts', 'max_attempts']) {
      await assert.rejects(
        db.client.query(`INSERT INTO jobs (type, ${column}) VALUES ('notify', NULL)`),
        { code: '23502' },
        `coluna ${column}`,
      );
    }
    await assert.rejects(db.client.query('INSERT INTO jobs (type) VALUES (NULL)'), {
      code: '23502',
    });
  });

  test('0002: trava e finished_at acompanham o estado em todo o ciclo de vida', async () => {
    const bad: [string, string, string][] = [
      ['jobs_lock_matches_status', `(type, status) VALUES ('notify', 'running')`, 'sem trava'],
      [
        'jobs_lock_matches_status',
        `(type, status, locked_by, locked_at) VALUES ('notify', 'running', 'w1', now())`,
        'running sem batimento',
      ],
      [
        'jobs_lock_matches_status',
        `(type, locked_by, locked_at, heartbeat_at) VALUES ('notify', 'w1', now(), now())`,
        'queued com trava',
      ],
      ['jobs_finished_at_matches_status', `(type, status) VALUES ('notify', 'done')`, 'done'],
      ['jobs_finished_at_matches_status', `(type, status) VALUES ('notify', 'failed')`, 'failed'],
      [
        'jobs_finished_at_matches_status',
        `(type, finished_at) VALUES ('notify', now())`,
        'queued com finished_at',
      ],
    ];
    for (const [constraint, values, label] of bad) {
      await assert.rejects(
        db.client.query(`INSERT INTO jobs ${values}`),
        { code: '23514', constraint },
        label,
      );
    }

    // queued → running → queued (nova tentativa) → running → failed → queued (reenfileirada) → done
    const { rows } = await db.client.query<{ id: string }>(
      `INSERT INTO jobs (type, max_attempts) VALUES ('order.fulfill', 2) RETURNING id`,
    );
    const id = rows[0]?.id;
    const start = `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = 'w1',
                     locked_at = now(), heartbeat_at = now() WHERE id = $1`;
    const release = 'locked_by = NULL, locked_at = NULL, heartbeat_at = NULL';
    await db.client.query(start, [id]);
    await assert.rejects(
      db.client.query(`UPDATE jobs SET status = 'queued' WHERE id = $1`, [id]),
      { code: '23514', constraint: 'jobs_lock_matches_status' },
      'devolver à fila sem limpar a trava',
    );
    await db.client.query(
      `UPDATE jobs SET status = 'queued', run_at = now() + interval '60 seconds',
              last_error = 'falhou', ${release} WHERE id = $1`,
      [id],
    );
    await db.client.query(start, [id]);
    await assert.rejects(
      db.client.query(start, [id]),
      { code: '23514', constraint: 'jobs_attempts_range' },
      'terceira tentativa com máximo 2',
    );
    await db.client.query(
      `UPDATE jobs SET status = 'failed', finished_at = now(), last_error = 'esgotou' WHERE id = $1`,
      [id],
    );
    await db.client.query(
      `UPDATE jobs SET status = 'queued', attempts = 0, run_at = now(), finished_at = NULL,
              ${release} WHERE id = $1`,
      [id],
    );
    await db.client.query(start, [id]);
    const done = await db.client.query(
      `UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1
       RETURNING status, attempts, locked_by`,
      [id],
    );
    assert.deepEqual(done.rows, [{ status: 'done', attempts: 1, locked_by: 'w1' }]);
    await db.client.query('DELETE FROM jobs');
  });

  test('0002: unique_key é única só entre tarefas queued e running', async () => {
    const key = 'payment.reconcile_orders:2026-11-24T10:05';
    const insert = `INSERT INTO jobs (type, unique_key) VALUES ('payment.reconcile_orders', $1)`;
    const first = await db.client.query<{ id: string }>(`${insert} RETURNING id`, [key]);
    const id = first.rows[0]?.id;

    await assert.rejects(db.client.query(insert, [key]), {
      code: '23505',
      constraint: 'jobs_unique_key_active_unique',
    });
    // Forma usada pelo enqueue: não cria a segunda e não dá erro.
    const onConflict = `${insert}
      ON CONFLICT (unique_key) WHERE status IN ('queued', 'running') DO NOTHING`;
    assert.equal((await db.client.query(onConflict, [key])).rowCount, 0);

    await db.client.query(
      `UPDATE jobs SET status = 'running', locked_by = 'w1', locked_at = now(),
              heartbeat_at = now() WHERE id = $1`,
      [id],
    );
    assert.equal((await db.client.query(onConflict, [key])).rowCount, 0, 'running ainda segura');

    await db.client.query(`UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1`, [
      id,
    ]);
    assert.equal((await db.client.query(onConflict, [key])).rowCount, 1, 'done libera a chave');

    // A concluída não pode voltar à fila enquanto houver outra ativa com a mesma chave.
    await assert.rejects(
      db.client.query(
        `UPDATE jobs SET status = 'queued', finished_at = NULL, locked_by = NULL,
                locked_at = NULL, heartbeat_at = NULL WHERE id = $1`,
        [id],
      ),
      { code: '23505', constraint: 'jobs_unique_key_active_unique' },
    );

    // Sem chave não há deduplicação; chaves diferentes convivem.
    await db.client.query(`INSERT INTO jobs (type) VALUES ('notify'), ('notify')`);
    await db.client.query(insert, [`${key}:outra`]);
    await db.client.query('DELETE FROM jobs');
  });

  test('0002: duas inserções simultâneas com a mesma unique_key criam uma tarefa só', async () => {
    const other = await db.connect();
    const insert = `INSERT INTO jobs (type, unique_key) VALUES ('ops.digest', 'ops.digest:dia')
      ON CONFLICT (unique_key) WHERE status IN ('queued', 'running') DO NOTHING`;
    await db.client.query('BEGIN');
    assert.equal((await db.client.query(insert)).rowCount, 1);
    // A segunda espera a primeira transação decidir e, com o COMMIT, não insere.
    const second = other.query(insert);
    await sleep(50);
    await db.client.query('COMMIT');
    assert.equal((await second).rowCount, 0);
    const { rows } = await db.client.query('SELECT count(*)::int AS total FROM jobs');
    assert.deepEqual(rows, [{ total: 1 }]);
    await db.client.query('DELETE FROM jobs');
  });

  const claim = `
    UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = $1,
           locked_at = now(), heartbeat_at = now()
     WHERE id IN (
       SELECT id FROM jobs
        WHERE status = 'queued' AND run_at <= now()
        ORDER BY priority DESC, run_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED)
    RETURNING id, type`;

  test('0002: consumo segue prioridade e run_at e ignora agendada e não queued', async () => {
    await db.client.query(`
      INSERT INTO jobs (type, priority, run_at) VALUES
        ('a.old', 0, now() - interval '2 minutes'),
        ('a.new', 0, now() - interval '1 minute'),
        ('a.pay', 10, now() - interval '1 second'),
        ('a.future', 10, now() + interval '1 hour')`);
    await db.client.query(
      `INSERT INTO jobs (type, status, priority, finished_at) VALUES
        ('a.done', 'done', 10, now()), ('a.failed', 'failed', 10, now())`,
    );
    const order: string[] = [];
    for (;;) {
      const { rows } = await db.client.query<{ type: string }>(claim, ['w1', 1]);
      if (rows[0] === undefined) break;
      order.push(rows[0].type);
    }
    assert.deepEqual(order, ['a.pay', 'a.old', 'a.new']);
    await db.client.query('DELETE FROM jobs');
  });

  test('0002: a consulta de consumo usa jobs_ready_idx sem ordenar', async () => {
    await db.client.query(
      `INSERT INTO jobs (type, status, finished_at)
       SELECT 'x.done', 'done', now() FROM generate_series(1, 2000)`,
    );
    await db.client.query(`INSERT INTO jobs (type) SELECT 'x.q' FROM generate_series(1, 50)`);
    await db.client.query('ANALYZE jobs');
    const { rows } = await db.client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
        ORDER BY priority DESC, run_at LIMIT 10 FOR UPDATE SKIP LOCKED`,
    );
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    assert.match(plan, /Index Scan using jobs_ready_idx/, plan);
    assert.doesNotMatch(plan, /Sort/, plan);
    await db.client.query('DELETE FROM jobs');
  });

  test('0002: com SKIP LOCKED, duas transações abertas não pegam a mesma tarefa', async () => {
    const a = await db.connect();
    const b = await db.connect();
    const lock = `SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
      ORDER BY priority DESC, run_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const inserted = await db.client.query<{ id: string }>(
      `INSERT INTO jobs (type, run_at) VALUES
         ('s.one', now() - interval '2 seconds'), ('s.two', now() - interval '1 second')
       RETURNING id`,
    );
    const [one, two] = inserted.rows.map((row) => row.id);

    await a.query('BEGIN');
    await b.query('BEGIN');
    const fromA = await a.query<{ id: string }>(lock);
    // A ainda não fez COMMIT: B não espera e não recebe a mesma linha.
    const fromB = await b.query<{ id: string }>(lock);
    assert.deepEqual(fromA.rows, [{ id: one }]);
    assert.deepEqual(fromB.rows, [{ id: two }]);
    // Uma terceira conexão, com as duas travadas, não recebe nada (e não fica esperando).
    assert.deepEqual((await db.client.query(lock)).rows, []);
    await a.query('ROLLBACK');
    // Desfeita a transação de A, a tarefa volta a ser visível.
    assert.deepEqual((await db.client.query(lock)).rows, [{ id: one }]);
    await b.query('ROLLBACK');
    await db.client.query('DELETE FROM jobs');
  });

  test('0002: dois consumidores concorrentes esvaziam 1.000 tarefas sem repetir nenhuma', async () => {
    const total = 1000;
    await db.client.query(
      `INSERT INTO jobs (type, priority) SELECT 'load.test', n % 3 FROM generate_series(1, $1) n`,
      [total],
    );
    const consume = async (worker: string, client: pg.Client): Promise<string[]> => {
      const taken: string[] = [];
      for (;;) {
        const { rows } = await client.query<{ id: string }>(claim, [worker, 7]);
        if (rows.length === 0) return taken;
        taken.push(...rows.map((row) => row.id));
      }
    };
    // Conexões abertas antes, para os três começarem juntos.
    const clients = [await db.connect(), await db.connect(), await db.connect()];
    const lists = await Promise.all(clients.map((client, i) => consume(`w${i + 1}`, client)));
    const all = lists.flat();
    assert.equal(all.length, total);
    assert.equal(new Set(all).size, total, 'nenhuma tarefa entregue duas vezes');
    assert.ok(
      lists.filter((list) => list.length > 0).length > 1,
      'mais de um consumidor trabalhou',
    );
    const { rows } = await db.client.query(
      `SELECT status, count(*)::int AS total, max(attempts) AS attempts FROM jobs GROUP BY status`,
    );
    assert.deepEqual(rows, [{ status: 'running', total, attempts: 1 }]);
    await db.client.query('DELETE FROM jobs');
  });

  test('0002: NOTIFY nuva_jobs só para tarefa executável e só depois do COMMIT', async () => {
    const listener = await db.connect();
    let received = 0;
    listener.on('notification', (message) => {
      if (message.channel === 'nuva_jobs') received += 1;
    });
    await listener.query('LISTEN nuva_jobs');
    /** Avisos chegados desde a última leitura; a consulta vazia faz o cliente ler o socket. */
    const drain = async (): Promise<number> => {
      await sleep(100);
      await listener.query('SELECT 1');
      const count = received;
      received = 0;
      return count;
    };

    await db.client.query(`INSERT INTO jobs (type) VALUES ('email.send')`);
    assert.equal(await drain(), 1, 'inserção de tarefa pronta');

    await db.client.query(
      `INSERT INTO jobs (type, run_at) VALUES ('event.reminder', now() + interval '1 hour')`,
    );
    assert.equal(await drain(), 0, 'agendada para depois não acorda');

    await db.client.query(
      `INSERT INTO jobs (type, status, finished_at) VALUES ('notify', 'done', now())`,
    );
    assert.equal(await drain(), 0, 'inserida já concluída não acorda');

    await db.client.query('BEGIN');
    await db.client.query(`INSERT INTO jobs (type) VALUES ('notify')`);
    assert.equal(await drain(), 0, 'antes do COMMIT ninguém é avisado');
    await db.client.query('ROLLBACK');
    assert.equal(await drain(), 0, 'transação desfeita não avisa');

    await db.client.query('BEGIN');
    await db.client.query(`INSERT INTO jobs (type) SELECT 'notify' FROM generate_series(1, 20)`);
    await db.client.query('COMMIT');
    assert.equal(await drain(), 1, 'várias tarefas na mesma transação viram um aviso');

    // Antecipar a agendada e reenfileirar uma falha também acordam.
    await db.client.query(`UPDATE jobs SET run_at = now() WHERE type = 'event.reminder'`);
    assert.equal(await drain(), 1, 'run_at antecipado');
    await db.client.query(
      `UPDATE jobs SET status = 'failed', finished_at = now() WHERE type = 'email.send'`,
    );
    assert.equal(await drain(), 0, 'falha não acorda');
    await db.client.query(
      `UPDATE jobs SET status = 'queued', finished_at = NULL, attempts = 0
        WHERE type = 'email.send'`,
    );
    assert.equal(await drain(), 1, 'reenfileirada');
    // Mudança que não torna a tarefa executável (payload, prioridade) não avisa.
    await db.client.query(`UPDATE jobs SET priority = 10 WHERE type = 'email.send'`);
    assert.equal(await drain(), 0, 'mudança de prioridade');
    await db.client.query('DELETE FROM jobs');
  });

  // A consulta de enqueueRecurring (packages/core/src/modules/jobs/queue.ts), com os mesmos
  // parâmetros e conversões.
  const enqueueRecurring = `
    INSERT INTO jobs (type, payload, priority, max_attempts, unique_key, run_at)
    SELECT
      $1,
      $2::jsonb,
      $3::smallint,
      $4::smallint,
      $5,
      COALESCE($6::timestamptz, now())
    WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE unique_key = $5)
    ON CONFLICT (unique_key) WHERE status IN ('queued', 'running') DO NOTHING
    RETURNING *`;
  const recurringParams = (key: string) => ['retention.purge', '{}', 0, 5, key, null];

  test('0003: a recorrente não é reenfileirada depois de concluída', async () => {
    const key = 'retention.purge:2026-11-24';
    const first = await db.client.query<{ id: string }>(enqueueRecurring, recurringParams(key));
    assert.equal(first.rowCount, 1);
    assert.equal((await db.client.query(enqueueRecurring, recurringParams(key))).rowCount, 0);
    await db.client.query(
      `UPDATE jobs SET status = 'done', finished_at = now(), locked_by = 'w1' WHERE id = $1`,
      [first.rows[0]?.id],
    );
    assert.equal(
      (await db.client.query(enqueueRecurring, recurringParams(key))).rowCount,
      0,
      'janela já concluída',
    );
    const next = recurringParams('retention.purge:2026-11-25');
    assert.equal((await db.client.query(enqueueRecurring, next)).rowCount, 1, 'janela seguinte');
    await db.client.query('DELETE FROM jobs');
  });

  test('0003: a consulta de existência da recorrente usa jobs_unique_key_idx', async () => {
    // Histórico de recorrentes concluídas, mais tarefas sem chave (fora do índice parcial).
    await db.client.query(
      `INSERT INTO jobs (type, status, finished_at, unique_key)
       SELECT 'retention.purge', 'done', now(), 'retention.purge:janela-' || n
         FROM generate_series(1, 3000) n`,
    );
    await db.client.query(
      `INSERT INTO jobs (type, status, finished_at)
       SELECT 'email.send', 'done', now() FROM generate_series(1, 3000)`,
    );
    await db.client.query('ANALYZE jobs');
    const explain = async (): Promise<string> => {
      const { rows } = await db.client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN ${enqueueRecurring}`,
        recurringParams('retention.purge:janela-1500'),
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    };

    const plan = await explain();
    assert.match(plan, /Index (Only )?Scan using jobs_unique_key_idx on jobs/, plan);
    assert.doesNotMatch(plan, /Seq Scan/, plan);

    // Contraprova: sem o índice (como antes da 0003), a mesma consulta varre a tabela.
    await db.client.query('BEGIN');
    await db.client.query('DROP INDEX jobs_unique_key_idx');
    const before = await explain();
    await db.client.query('ROLLBACK');
    assert.match(before, /Seq Scan on jobs/, before);

    const { rows: size } = await db.client.query(
      `SELECT pg_relation_size('jobs_unique_key_idx') < pg_relation_size('jobs_pkey') AS smaller`,
    );
    assert.deepEqual(size, [{ smaller: true }], 'parcial: só as tarefas com chave');
    await db.client.query('DELETE FROM jobs');
  });

  test('0003: user_event_id_seq é bigint, começa em 1 e só cresce, mesmo com ROLLBACK', async () => {
    const { rows: meta } = await db.client.query(
      `SELECT data_type::text AS type, start_value::text AS start, increment_by::text AS step,
              max_value::text AS max, cycle
         FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'user_event_id_seq'`,
    );
    assert.deepEqual(meta, [
      { type: 'bigint', start: '1', step: '1', max: '9223372036854775807', cycle: false },
    ]);

    const other = await db.connect();
    const next = async (client: pg.Client): Promise<bigint> => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT nextval('user_event_id_seq')::text AS id`,
      );
      return BigInt(rows[0]?.id ?? '0');
    };
    const a = await next(db.client);
    const b = await next(other);
    await db.client.query('BEGIN');
    const c = await next(db.client);
    await db.client.query('ROLLBACK');
    const d = await next(other);
    assert.ok(a >= 1n && a < b && b < c && c < d, `${a} < ${b} < ${c} < ${d}`);

    // Duas conexões ao mesmo tempo nunca recebem o mesmo número.
    const take = async (client: pg.Client): Promise<bigint[]> => {
      const taken: bigint[] = [];
      for (let i = 0; i < 100; i += 1) taken.push(await next(client));
      return taken;
    };
    const ids = (await Promise.all([take(db.client), take(other)])).flat();
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id > d));
  });

  const owner = '0192f0c1-0000-7000-8000-000000000001';

  /** A 0005 ligou images.owner_user_id a users: o dono precisa existir. */
  async function ensureOwner(): Promise<void> {
    await db.client.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'dono-das-imagens@example.com', 'Dono')
       ON CONFLICT DO NOTHING`,
      [owner],
    );
  }

  async function insertImage(purpose = 'avatar', width = 800, height = 600): Promise<string> {
    await ensureOwner();
    const { rows } = await db.client.query<{ id: string }>(
      `INSERT INTO images (owner_user_id, purpose, original_width, original_height)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [owner, purpose, width, height],
    );
    return rows[0]?.id ?? '';
  }

  /** Variante com `size` bytes; bytes e sha256 coerentes com data, salvo o que vier em `override`. */
  function variantSql(
    override: Partial<Record<'width' | 'height' | 'bytes' | 'sha256', string>> = {},
  ) {
    const data = `decode(repeat('ab', $2::integer), 'hex')`;
    return `INSERT INTO image_variants (image_id, width, height, bytes, sha256, data)
      VALUES ($1, ${override.width ?? '256'}, ${override.height ?? '256'},
              ${override.bytes ?? '$2'}, ${override.sha256 ?? `encode(sha256(${data}), 'hex')`},
              ${data})`;
  }

  test('0004: images e image_variants têm as colunas da spec 029', async () => {
    const columnsOf = async (table: string) =>
      (
        await db.client.query(
          `SELECT column_name, data_type, is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [table],
        )
      ).rows;
    const tz = 'timestamp with time zone';
    assert.deepEqual(await columnsOf('images'), [
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'owner_user_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'purpose', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'original_width', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'original_height', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'created_at', data_type: tz, is_nullable: 'NO' },
      { column_name: 'hidden_at', data_type: tz, is_nullable: 'YES' },
    ]);
    assert.deepEqual(await columnsOf('image_variants'), [
      { column_name: 'image_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'width', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'height', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'bytes', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'sha256', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'data', data_type: 'bytea', is_nullable: 'NO' },
    ]);

    const id = await insertImage();
    const { rows } = await db.client.query(
      `SELECT uuid_extract_version(id) AS version, hidden_at, created_at <= now() AS past
         FROM images WHERE id = $1`,
      [id],
    );
    assert.deepEqual(rows, [{ version: 7, hidden_at: null, past: true }]);
    await db.client.query('DELETE FROM images');
  });

  test('0004: data usa armazenamento EXTERNAL e é guardada sem compressão', async () => {
    const { rows } = await db.client.query(
      `SELECT attstorage FROM pg_attribute
        WHERE attrelid = 'image_variants'::regclass AND attname = 'data'`,
    );
    assert.deepEqual(rows, [{ attstorage: 'e' }]);

    // Conteúdo repetitivo comprimiria muito; com EXTERNAL o tamanho guardado é o tamanho real.
    const id = await insertImage();
    await db.client.query(variantSql(), [id, 300000]);
    const { rows: stored } = await db.client.query(
      `SELECT pg_column_size(data) >= 300000 AS raw, pg_column_compression(data) AS method
         FROM image_variants WHERE image_id = $1`,
      [id],
    );
    assert.deepEqual(stored, [{ raw: true, method: null }]);
    await db.client.query('DELETE FROM images');
  });

  test('0004: images aceita as sete finalidades e recusa finalidade e dimensões inválidas', async () => {
    for (const purpose of [
      'avatar',
      'profile_cover',
      'product_cover',
      'event_cover',
      'case_image',
      'content_image',
      'school_logo',
    ]) {
      await insertImage(purpose);
    }
    // Limites exatos da RNF-02: 8000 px no maior lado e 40 megapixels.
    await insertImage('avatar', 8000, 5000);
    await insertImage('avatar', 1, 8000);

    const cases: [string, string, number, number, string][] = [
      ['images_purpose_valid', 'gif', 10, 10, 'finalidade desconhecida'],
      ['images_purpose_valid', 'Avatar', 10, 10, 'finalidade com maiúscula'],
      ['images_original_width_range', 'avatar', 0, 10, 'largura zero'],
      ['images_original_width_range', 'avatar', 8001, 10, 'largura acima de 8000'],
      ['images_original_height_range', 'avatar', 10, -1, 'altura negativa'],
      ['images_original_height_range', 'avatar', 10, 8001, 'altura acima de 8000'],
      ['images_original_pixels_range', 'avatar', 8000, 5001, 'acima de 40 megapixels'],
    ];
    for (const [constraint, purpose, width, height, label] of cases) {
      await assert.rejects(
        insertImage(purpose, width, height),
        { code: '23514', constraint },
        label,
      );
    }
    const valid: Record<string, string> = {
      owner_user_id: `'${owner}'`,
      purpose: `'avatar'`,
      original_width: '10',
      original_height: '10',
    };
    for (const column of Object.keys(valid)) {
      const values = Object.keys(valid).map((key) => (key === column ? 'NULL' : valid[key]));
      await assert.rejects(
        db.client.query(
          `INSERT INTO images (${Object.keys(valid).join(', ')}) VALUES (${values.join(', ')})`,
        ),
        { code: '23502' },
        `coluna ${column}`,
      );
    }
    await db.client.query('DELETE FROM images');
  });

  test('0004: image_variants recusa largura, altura, tamanho e hash inválidos', async () => {
    const id = await insertImage();
    for (const width of ['64', '256', '480', '512', '1280', '1600']) {
      await db.client.query(variantSql({ width, height: '1' }), [id, 10]);
    }
    await db.client.query('DELETE FROM image_variants');
    // Limite exato da RNF-03: 400 KB.
    await db.client.query(variantSql({ height: '1600' }), [id, 409600]);
    await db.client.query('DELETE FROM image_variants');

    const cases: [string, Parameters<typeof variantSql>[0], number, string][] = [
      ['image_variants_width_valid', { width: '128' }, 10, 'largura fora da tabela'],
      ['image_variants_width_valid', { width: '2000' }, 10, 'largura acima de 1600'],
      ['image_variants_height_range', { height: '0' }, 10, 'altura zero'],
      ['image_variants_height_range', { height: '1601' }, 10, 'altura acima de 1600'],
      ['image_variants_bytes_range', {}, 409601, 'acima de 400 KB'],
      ['image_variants_bytes_range', {}, 0, 'vazia'],
      ['image_variants_bytes_matches_data', { bytes: '11' }, 10, 'bytes diferente de data'],
      ['image_variants_sha256_format', { sha256: `repeat('A', 64)` }, 10, 'hash maiúsculo'],
      ['image_variants_sha256_format', { sha256: `repeat('a', 63)` }, 10, 'hash curto'],
      ['image_variants_sha256_format', { sha256: `'x'` }, 10, 'hash não hexadecimal'],
    ];
    for (const [constraint, override, size, label] of cases) {
      await assert.rejects(
        db.client.query(variantSql(override), [id, size]),
        { code: '23514', constraint },
        label,
      );
    }
    for (const column of ['width', 'height', 'bytes', 'sha256']) {
      await assert.rejects(
        db.client.query(variantSql({ [column]: 'NULL' }), [id, 10]),
        { code: '23502' },
        `coluna ${column}`,
      );
    }
    await assert.rejects(
      db.client.query(
        `INSERT INTO image_variants (image_id, width, height, bytes, sha256, data)
         VALUES ($1, 64, 64, 1, repeat('a', 64), NULL)`,
        [id],
      ),
      { code: '23502' },
      'coluna data',
    );
    await db.client.query('DELETE FROM images');
  });

  test('0004: uma variante por largura, imagem obrigatória e apagada junto com a imagem', async () => {
    const id = await insertImage();
    const other = await insertImage();
    await db.client.query(variantSql({ width: '64' }), [id, 10]);
    await db.client.query(variantSql({ width: '256' }), [id, 10]);
    await db.client.query(variantSql({ width: '64' }), [other, 10]);
    await assert.rejects(db.client.query(variantSql({ width: '64' }), [id, 20]), {
      code: '23505',
      constraint: 'image_variants_pkey',
    });
    await assert.rejects(
      db.client.query(variantSql(), ['0192f0c1-0000-7000-8000-0000000000ff', 10]),
      { code: '23503', constraint: 'image_variants_image_id_fkey' },
    );

    await db.client.query('DELETE FROM images WHERE id = $1', [id]);
    const { rows } = await db.client.query(
      'SELECT image_id, width FROM image_variants ORDER BY width',
    );
    assert.deepEqual(rows, [{ image_id: other, width: 64 }]);
    await db.client.query('DELETE FROM images');
  });

  test('0004: índices do expurgo por created_at e dos envios por usuário', async () => {
    const { rows } = await db.client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('images', 'image_variants')
        ORDER BY indexname`,
    );
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(Object.keys(defs), [
      'image_variants_pkey',
      'images_created_at_idx',
      'images_owner_created_idx',
      'images_pkey',
    ]);
    assert.match(defs.images_created_at_idx ?? '', /^CREATE INDEX .*\(created_at\)$/);
    assert.match(defs.images_owner_created_idx ?? '', /\(owner_user_id, created_at\)$/);
    assert.match(defs.image_variants_pkey ?? '', /\(image_id, width\)$/);

    // A varredura do expurgo usa o índice, mesmo com a tabela cheia de imagens recentes.
    await ensureOwner();
    await db.client.query(
      `INSERT INTO images (owner_user_id, purpose, original_width, original_height, created_at)
       SELECT $1, 'avatar', 10, 10, now() - make_interval(secs => g)
         FROM generate_series(1, 5000) AS g`,
      [owner],
    );
    await db.client.query('ANALYZE images');
    const { rows: plan } = await db.client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT id FROM images WHERE created_at < now() - interval '24 hours'`,
    );
    assert.match(plan.map((row) => row['QUERY PLAN']).join('\n'), /images_created_at_idx/);
    await db.client.query('DELETE FROM images');
  });
});
