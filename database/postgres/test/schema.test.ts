import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
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
    assert.ok(full.includes('tabela settings'));

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
});
