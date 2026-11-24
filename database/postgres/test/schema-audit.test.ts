import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch } from './helpers.ts';

const dir = defaultMigrationsDir;
const immutable = { code: 'P0001', message: 'audit_log é imutável' };

describe('0006: auditoria imutável', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 6 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  /** Insere um registro com `age` de idade (intervalo do Postgres) e devolve o id. */
  async function insertEntry(age = '0 seconds', fields: Record<string, string> = {}) {
    const { rows } = await query(
      `INSERT INTO audit_log (created_at, origin, action, outcome, ip, user_agent, target_type,
                              target_id, details)
       VALUES (now() - $1::interval, ${fields.origin ?? `'admin_panel'`},
               ${fields.action ?? `'user.password_view'`}, ${fields.outcome ?? `'ok'`},
               '203.0.113.9', 'Firefox', ${fields.targetType ?? `'user'`},
               ${fields.targetId ?? `'alvo'`}, ${fields.details ?? `'{"a": 1}'`})
       RETURNING id`,
      [age],
    );
    return rows[0].id as string;
  }

  async function count(): Promise<number> {
    return (await query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
  }

  /** Roda `fn` numa transação desfeita no fim, para não deixar marca nem linha para trás. */
  async function inRollback(fn: () => Promise<void>): Promise<void> {
    await query('BEGIN');
    try {
      await fn();
    } finally {
      await query('ROLLBACK');
    }
  }

  test('down e up da 0006 removem e recriam tabela, gatilhos e funções', async () => {
    const objects = async () =>
      (
        await query(
          `SELECT proname AS name FROM pg_proc WHERE proname LIKE 'audit_log%'
           UNION ALL SELECT tgname FROM pg_trigger WHERE tgname LIKE 'audit_log%'
           UNION ALL SELECT tablename FROM pg_tables WHERE tablename = 'audit_log'
           ORDER BY 1`,
        )
      ).rows.map((row) => row.name);
    const full = await objects();
    assert.deepEqual(full, [
      'audit_log',
      'audit_log_guard_delete',
      'audit_log_guard_delete',
      'audit_log_guard_truncate',
      'audit_log_guard_truncate',
      'audit_log_guard_update',
      'audit_log_guard_update',
      'audit_log_purge',
    ]);
    await migrateDown(db.client, { dir });
    assert.deepEqual(await objects(), []);
    await migrateUp(db.client, { dir, to: 6 });
    assert.deepEqual(await objects(), full);
  });

  test('colunas, padrões e UUID v7', async () => {
    const { rows } = await query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'audit_log' ORDER BY ordinal_position`,
    );
    const tz = 'timestamp with time zone';
    assert.deepEqual(
      rows.map((row) => [row.column_name, row.data_type, row.is_nullable]),
      [
        ['id', 'uuid', 'NO'],
        ['created_at', tz, 'NO'],
        ['actor_user_id', 'uuid', 'YES'],
        ['actor_role', 'text', 'YES'],
        ['origin', 'text', 'NO'],
        ['mcp_key_id', 'uuid', 'YES'],
        ['action', 'text', 'NO'],
        ['target_type', 'text', 'YES'],
        ['target_id', 'text', 'YES'],
        ['outcome', 'text', 'NO'],
        ['ip', 'inet', 'YES'],
        ['user_agent', 'text', 'YES'],
        ['request_id', 'text', 'YES'],
        ['details', 'jsonb', 'NO'],
      ],
    );
    await inRollback(async () => {
      const { rows: inserted } = await query(
        `INSERT INTO audit_log (origin, action, outcome) VALUES ('cli', 'user.create', 'ok')
         RETURNING uuid_extract_version(id) AS v, details, created_at = now() AS now`,
      );
      assert.deepEqual(inserted, [{ v: 7, details: {}, now: true }]);
    });
  });

  test('restrições de origem, resultado, papel, ação, chave MCP, alvo e details', async () => {
    await inRollback(async () => {
      for (const origin of ['admin_panel', 'mcp', 'classroom', 'worker', 'cli']) {
        await insertEntry('0 seconds', { origin: `'${origin}'` });
      }
      for (const outcome of ['ok', 'denied', 'error']) {
        await insertEntry('0 seconds', { outcome: `'${outcome}'` });
      }
      await insertEntry('0 seconds', { targetType: 'NULL', targetId: 'NULL' });
      await insertEntry('0 seconds', { targetId: 'NULL' });
      await insertEntry('0 seconds', { action: `'forum.category.create'` });
    });
    const cases: [Record<string, string>, string][] = [
      [{ origin: `'api'` }, 'audit_log_origin_valid'],
      [{ outcome: `'allowed'` }, 'audit_log_outcome_valid'],
      [{ action: `'login'` }, 'audit_log_action_format'],
      [{ action: `'User.create'` }, 'audit_log_action_format'],
      [{ action: `'user.'` }, 'audit_log_action_format'],
      [{ targetType: 'NULL' }, 'audit_log_target_matches_type'],
      [{ details: `'[]'` }, 'audit_log_details_object'],
      [{ details: `'"texto"'` }, 'audit_log_details_object'],
    ];
    for (const [fields, constraint] of cases) {
      await assert.rejects(insertEntry('0 seconds', fields), { code: '23514', constraint });
    }
    await assert.rejects(
      query(
        `INSERT INTO audit_log (origin, action, outcome, actor_role)
         VALUES ('admin_panel', 'user.create', 'ok', 'owner')`,
      ),
      { code: '23514', constraint: 'audit_log_actor_role_valid' },
    );
    await assert.rejects(
      query(
        `INSERT INTO audit_log (origin, action, outcome, mcp_key_id)
         VALUES ('admin_panel', 'mcp.tool_call', 'ok', uuidv7())`,
      ),
      { code: '23514', constraint: 'audit_log_mcp_key_matches_origin' },
    );
    await assert.rejects(
      query(
        `INSERT INTO audit_log (origin, action, outcome, actor_user_id)
         VALUES ('admin_panel', 'user.create', 'ok', uuidv7())`,
      ),
      { code: '23503', constraint: 'audit_log_actor_user_id_fkey' },
    );
    await inRollback(async () => {
      const { rows } = await query(
        `INSERT INTO users (email, name, role) VALUES ('auditor@example.com', 'Auditor', 'admin')
         RETURNING id`,
      );
      await query(
        `INSERT INTO audit_log (origin, action, outcome, actor_user_id, actor_role, mcp_key_id)
         VALUES ('mcp', 'mcp.tool_call', 'ok', $1, 'admin', uuidv7())`,
        [rows[0].id],
      );
    });
    assert.equal(await count(), 0);
  });

  test('UPDATE comum é recusado; só anular ip e user_agent é aceito', async () => {
    const id = await insertEntry();
    const refused = [
      `action = 'user.delete'`,
      `details = '{}'`,
      `created_at = now() - interval '3 years'`,
      `ip = '198.51.100.1'`,
      `ip = NULL`,
      `user_agent = NULL`,
      `ip = NULL, user_agent = NULL, outcome = 'error'`,
      `ip = NULL, user_agent = NULL, request_id = 'r'`,
    ];
    for (const set of refused) {
      await assert.rejects(
        query(`UPDATE audit_log SET ${set} WHERE id = $1`, [id]),
        immutable,
        set,
      );
    }
    const result = await query('UPDATE audit_log SET ip = NULL, user_agent = NULL WHERE id = $1', [
      id,
    ]);
    assert.equal(result.rowCount, 1);
    const { rows } = await query(
      'SELECT ip, user_agent, action, details FROM audit_log WHERE id = $1',
      [id],
    );
    assert.deepEqual(rows, [
      { ip: null, user_agent: null, action: 'user.password_view', details: { a: 1 } },
    ]);
    // Já anonimizado, continua sem volta: não se regrava o IP.
    await assert.rejects(
      query(`UPDATE audit_log SET ip = '203.0.113.9' WHERE id = $1`, [id]),
      immutable,
    );
  });

  test('DELETE e TRUNCATE são recusados, inclusive com linha vencida', async () => {
    const recent = await insertEntry();
    const old = await insertEntry('800 days');
    for (const id of [recent, old]) {
      await assert.rejects(query('DELETE FROM audit_log WHERE id = $1', [id]), immutable);
    }
    await assert.rejects(query('DELETE FROM audit_log'), immutable);
    await assert.rejects(query('TRUNCATE audit_log'), immutable);
    // A marca avulsa, fora da função, não apaga registro recente.
    await inRollback(async () => {
      await query(`SET LOCAL nuva.audit_purge = 'on'`);
      await assert.rejects(query('DELETE FROM audit_log WHERE id = $1', [recent]), immutable);
    });
    assert.ok((await count()) >= 2);
  });

  test('audit_log_purge recusa prazo menor que 365 dias ou nulo', async () => {
    const before = await count();
    for (const days of [30, 364, 0, -1, null]) {
      await assert.rejects(
        query('SELECT audit_log_purge($1)', [days]),
        { code: '22023', message: /retention_days deve ser pelo menos 365/ },
        String(days),
      );
    }
    assert.equal(await count(), before);
  });

  test('audit_log_purge(730) apaga só o que passou do prazo, em lotes, e devolve o total', async () => {
    // Começa limpo: o que os testes anteriores deixaram com mais de 365 dias sai aqui.
    await query('SELECT audit_log_purge(365)');
    const keep = [
      await insertEntry('0 seconds'),
      await insertEntry('400 days'),
      await insertEntry('729 days 23 hours'),
    ];
    const gone = [await insertEntry('730 days 1 hour'), await insertEntry('5 years')];
    // Mais de dois lotes de 5.000.
    await query(
      `INSERT INTO audit_log (created_at, origin, action, outcome)
       SELECT now() - interval '731 days' - make_interval(secs => g), 'worker', 'jobs.purge', 'ok'
         FROM generate_series(1, 12001) AS g`,
    );
    const { rows } = await query('SELECT audit_log_purge(730) AS total');
    assert.equal(Number(rows[0].total), 12001 + gone.length);

    const { rows: left } = await query(
      `SELECT id FROM audit_log WHERE created_at < now() - interval '730 days'`,
    );
    assert.deepEqual(left, []);
    for (const id of keep) {
      const { rowCount } = await query('SELECT 1 FROM audit_log WHERE id = $1', [id]);
      assert.equal(rowCount, 1, id);
    }
    // Nada mais a apagar: devolve zero.
    assert.equal(Number((await query('SELECT audit_log_purge(730) AS total')).rows[0].total), 0);
  });

  test('a marca do expurgo vale só dentro da função', async () => {
    const old = await insertEntry('800 days');
    await inRollback(async () => {
      await query('SELECT audit_log_purge(900)');
      const { rows } = await query(`SELECT current_setting('nuva.audit_purge', true) AS flag`);
      assert.equal(rows[0].flag, 'off');
      // Na mesma transação, depois da função, o DELETE direto continua recusado.
      await query('SAVEPOINT s');
      await assert.rejects(query('DELETE FROM audit_log WHERE id = $1', [old]), immutable);
      await query('ROLLBACK TO SAVEPOINT s');
    });
    const { rowCount } = await query('SELECT 1 FROM audit_log WHERE id = $1', [old]);
    assert.equal(rowCount, 1);
  });

  test('os cinco índices da spec 028', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'audit_log' ORDER BY indexname`,
    );
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(Object.keys(defs), [
      'audit_log_action_created_idx',
      'audit_log_actor_created_idx',
      'audit_log_created_at_idx',
      'audit_log_mcp_key_created_idx',
      'audit_log_pkey',
      'audit_log_target_created_idx',
    ]);
    assert.match(defs.audit_log_created_at_idx, /\(created_at\)$/);
    assert.match(defs.audit_log_actor_created_idx, /\(actor_user_id, created_at\)$/);
    assert.match(defs.audit_log_target_created_idx, /\(target_type, target_id, created_at\)$/);
    assert.match(defs.audit_log_action_created_idx, /\(action text_pattern_ops, created_at\)$/);
    assert.match(defs.audit_log_mcp_key_created_idx, /\(mcp_key_id, created_at\)$/);

    // O filtro por prefixo (user.*) consegue usar o índice de ação, apesar da colação en_US.
    await inRollback(async () => {
      await query('SET LOCAL enable_seqscan = off');
      const { rows: plan } = await query(
        `EXPLAIN SELECT id FROM audit_log WHERE action LIKE 'user.%' ORDER BY created_at DESC`,
      );
      assert.match(plan.map((row) => row['QUERY PLAN']).join('\n'), /audit_log_action_created_idx/);
    });
  });
});
