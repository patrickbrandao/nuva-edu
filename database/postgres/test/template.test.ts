import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { connect } from '../src/config.ts';
import { hashMigrationsDir } from '../src/migrations.ts';
import {
  createTestDatabase,
  dropStaleTestDatabases,
  dropTestDatabase,
  ensureTemplate,
  testDatabaseCreatedAt,
} from '../src/template.ts';
import {
  config,
  createMigrationsDir,
  databaseComment,
  databaseExists,
  dropDatabasesWithPrefix,
  type MigrationsDir,
  sql,
  unique,
} from './helpers.ts';

describe('banco modelo', () => {
  // Base própria: não toca no <db>_tpl nem nos <db>_test_* usados por outros agentes.
  const baseName = `${config.database}_selftest_${unique()}`;
  const template = `${baseName}_tpl`;
  let fixture: MigrationsDir;
  let options: { config: typeof config; baseName: string; dir: string };

  before(async () => {
    fixture = await createMigrationsDir({
      '0001_a.sql': sql(
        'CREATE TABLE a (id integer PRIMARY KEY, note text);\nINSERT INTO a VALUES (1, $$semente$$);',
        'DROP TABLE a;',
      ),
    });
    options = { config, baseName, dir: fixture.dir };
  });
  after(async () => {
    await dropDatabasesWithPrefix(baseName);
    await fixture.remove();
  });

  test('cria o modelo, grava o hash no COMMENT e não refaz sem mudança', async () => {
    const first = await ensureTemplate(options);
    assert.equal(first.name, template);
    assert.equal(first.rebuilt, true);
    assert.equal(first.hash, await hashMigrationsDir(fixture.dir));
    assert.equal(await databaseComment(template), `nuva-edu migrations sha256:${first.hash}`);

    const second = await ensureTemplate(options);
    assert.equal(second.rebuilt, false);
    assert.equal(second.hash, first.hash);
  });

  test('banco de teste nasce do modelo em menos de 1 segundo, com esquema e dados', async () => {
    await ensureTemplate(options);
    const started = performance.now();
    const db = await createTestDatabase(options);
    const elapsed = performance.now() - started;
    try {
      assert.ok(elapsed < 1000, `levou ${Math.round(elapsed)} ms`);
      assert.ok(db.name.startsWith(`${baseName}_test_`));
      assert.equal(db.config.database, db.name);
      assert.equal(new URL(db.url).pathname, `/${db.name}`);
      const client = await connect(db.config);
      try {
        const { rows } = await client.query('SELECT id, note FROM a');
        assert.deepEqual(rows, [{ id: 1, note: 'semente' }]);
        const control = await client.query('SELECT version FROM schema_migrations');
        assert.deepEqual(control.rows, [{ version: 1 }]);
      } finally {
        await client.end();
      }
    } finally {
      await db.drop();
    }
    assert.equal(await databaseExists(db.name), false);
  });

  test('bancos de teste simultâneos são independentes', async () => {
    await ensureTemplate(options);
    const dbs = await Promise.all([
      createTestDatabase(options),
      createTestDatabase(options),
      createTestDatabase(options),
    ]);
    try {
      assert.equal(new Set(dbs.map((db) => db.name)).size, 3);
      const [one, two] = await Promise.all([
        connect(dbs[0]?.config ?? config),
        connect(dbs[1]?.config ?? config),
      ]);
      try {
        await one.query('DELETE FROM a');
        const { rows } = await two.query('SELECT count(*)::int AS total FROM a');
        assert.deepEqual(rows, [{ total: 1 }]);
      } finally {
        await Promise.all([one.end(), two.end()]);
      }
    } finally {
      await Promise.all(dbs.map((db) => db.drop()));
    }
  });

  test('drop derruba conexões abertas; nome fora do padrão é recusado', async () => {
    await ensureTemplate(options);
    const db = await createTestDatabase(options);
    const client = await connect(db.config);
    await db.drop();
    assert.equal(await databaseExists(db.name), false);
    await client.end().catch(() => {});

    await assert.rejects(dropTestDatabase(config.database, options), /Só apago bancos/);
    await assert.rejects(dropTestDatabase(template, options), /Só apago bancos/);
  });

  test('mudar a pasta de migrations refaz o modelo; chamadas simultâneas refazem uma vez', async () => {
    const before = await ensureTemplate(options);
    await fixture.write('0002_b.sql', sql('CREATE TABLE b (id integer);', 'DROP TABLE b;'));

    const results = await Promise.all([ensureTemplate(options), ensureTemplate(options)]);
    assert.equal(results.filter((result) => result.rebuilt).length, 1);
    assert.notEqual(results[0]?.hash, before.hash);
    assert.equal(results[0]?.hash, results[1]?.hash);

    const db = await createTestDatabase(options);
    try {
      const client = await connect(db.config);
      try {
        const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY 1');
        assert.deepEqual(rows, [{ version: 1 }, { version: 2 }]);
      } finally {
        await client.end();
      }
    } finally {
      await db.drop();
    }
    assert.equal((await ensureTemplate(options)).rebuilt, false);
  });

  test('migration quebrada não deixa modelo marcado como pronto', async () => {
    const broken = await createMigrationsDir({
      '0001_a.sql': sql('SELECT nao_existe();', 'SELECT 1;'),
    });
    const brokenBase = `${baseName}_x`;
    try {
      await assert.rejects(
        ensureTemplate({ config, baseName: brokenBase, dir: broken.dir }),
        /Falha no up da migration 0001_a/,
      );
      assert.equal(await databaseComment(`${brokenBase}_tpl`), null);
      assert.equal(await databaseExists(`${brokenBase}_tpl`), false);
      await assert.rejects(
        createTestDatabase({ config, baseName: brokenBase, dir: broken.dir }),
        /ausente ou incompleto/,
      );

      await broken.write('0001_a.sql', sql('CREATE TABLE ok ();', 'DROP TABLE ok;'));
      const fixed = await ensureTemplate({ config, baseName: brokenBase, dir: broken.dir });
      assert.equal(fixed.rebuilt, true);
    } finally {
      await broken.remove();
    }
  });

  test('limpeza remove só os bancos de teste antigos', async () => {
    await ensureTemplate(options);
    const fresh = await createTestDatabase(options);
    const oldName = `${baseName}_test_${(Date.now() - 2 * 60 * 60 * 1000).toString(36)}_0badc0de`;
    const admin = await connect(config);
    try {
      await admin.query(`CREATE DATABASE "${oldName}" TEMPLATE "${template}"`);
    } finally {
      await admin.end();
    }
    const dropped = await dropStaleTestDatabases(options);
    assert.deepEqual(dropped, [oldName]);
    assert.equal(await databaseExists(oldName), false);
    assert.equal(await databaseExists(fresh.name), true);
    assert.equal(await databaseExists(template), true);

    assert.deepEqual(await dropStaleTestDatabases({ ...options, maxAgeMs: -1000 }), [fresh.name]);
  });

  test('testDatabaseCreatedAt lê o instante do nome', () => {
    const now = Date.now();
    assert.equal(testDatabaseCreatedAt(`x_test_${now.toString(36)}_0a1b2c3d`, 'x_test_'), now);
    assert.equal(testDatabaseCreatedAt('x_test_manual', 'x_test_'), null);
    assert.equal(testDatabaseCreatedAt('y_test_abc_0a1b2c3d', 'x_test_'), null);
  });
});
