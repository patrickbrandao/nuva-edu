import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect, loadConfig, loadEnvFiles, parseDatabaseUrl } from '@nuva-edu/database';
import { setup, startTestDatabase, teardown } from './test-db.mjs';

// Roda contra o servidor que o verify indicar: o contêiner do modo completo (NUVA_TEST_PG_URL)
// ou o Postgres local do modo rápido (NUVA_TEST_DB=local).
loadEnvFiles();
const env = process.env.NUVA_TEST_PG_URL
  ? { NUVA_TEST_PG_URL: process.env.NUVA_TEST_PG_URL }
  : { ...process.env, NUVA_TEST_DB: 'local' };
const admin = env.NUVA_TEST_PG_URL ? parseDatabaseUrl(env.NUVA_TEST_PG_URL) : loadConfig();

async function query(config, text, values = []) {
  const client = await connect(config);
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function databaseExists(name) {
  const rows = await query(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return rows.length === 1;
}

test('cria o banco da execução a partir do modelo e o apaga no fim', async () => {
  const database = await startTestDatabase(env);
  try {
    assert.match(database.name, new RegExp(`^${admin.database}_test_[0-9a-z]+_[0-9a-f]{8}$`));
    assert.equal(parseDatabaseUrl(database.url).database, database.name);
    const rows = await query(
      parseDatabaseUrl(database.url),
      'SELECT count(*)::int AS applied FROM schema_migrations',
    );
    assert.ok(rows[0].applied >= 1, 'o banco copiado traz as migrations aplicadas');
  } finally {
    await database.stop();
  }
  assert.equal(await databaseExists(database.name), false);
});

test('duas execuções ao mesmo tempo recebem bancos diferentes', async () => {
  const [a, b] = await Promise.all([startTestDatabase(env), startTestDatabase(env)]);
  try {
    assert.notEqual(a.name, b.name);
    await query(parseDatabaseUrl(a.url), 'CREATE TABLE only_in_a (id int)');
    const rows = await query(parseDatabaseUrl(b.url), "SELECT to_regclass('only_in_a') AS oid");
    assert.equal(rows[0].oid, null);
  } finally {
    await Promise.all([a.stop(), b.stop()]);
  }
});

test('setup global põe a URL em DATABASE_URL e o teardown a devolve', async () => {
  const before = { ...process.env };
  const provided = {};
  Object.assign(process.env, env);
  try {
    await setup({ provide: (key, value) => Object.assign(provided, { [key]: value }) });
    const url = process.env.DATABASE_URL;
    assert.equal(provided.databaseUrl, url);
    const name = parseDatabaseUrl(url).database;
    assert.equal(await databaseExists(name), true);
    await teardown();
    assert.equal(process.env.DATABASE_URL, before.DATABASE_URL);
    assert.equal(await databaseExists(name), false);
  } finally {
    for (const key of ['NUVA_TEST_DB', 'NUVA_TEST_PG_URL', 'DATABASE_URL']) {
      if (before[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = before[key];
      }
    }
  }
});

test('recusa valor desconhecido de NUVA_TEST_DB', async () => {
  await assert.rejects(startTestDatabase({ NUVA_TEST_DB: 'producao' }), /NUVA_TEST_DB inválida/);
});
