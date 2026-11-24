import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { connect } from '../src/config.ts';
import { hashMigrationsDir } from '../src/migrations.ts';
import {
  createTestDatabase,
  dropStaleTemplates,
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
  tableExists,
  unique,
} from './helpers.ts';

/** Nome do modelo de um conjunto: `<base>_tpl_<12 primeiros do hash>`. */
function templateName(base: string, hash: string): string {
  return `${base}_tpl_${hash.slice(0, 12)}`;
}

describe('banco modelo', () => {
  // Base própria: não toca nos <db>_tpl* nem nos <db>_test_* usados por outros agentes.
  const baseName = `${config.database}_selftest_${unique()}`;
  let template: string;
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
    template = templateName(baseName, await hashMigrationsDir(fixture.dir));
  });
  after(async () => {
    await dropDatabasesWithPrefix(baseName);
    await fixture.remove();
  });

  test('cria o modelo do conjunto, grava o hash no COMMENT e não refaz sem mudança', async () => {
    const first = await ensureTemplate(options);
    assert.equal(first.name, template);
    assert.equal(first.rebuilt, true);
    assert.equal(first.hash, await hashMigrationsDir(fixture.dir));
    assert.match(
      (await databaseComment(template)) ?? '',
      new RegExp(`^nuva-edu migrations sha256:${first.hash} usado:\\d+$`),
    );

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

  test('mudar a pasta cria outro modelo e guarda o antigo; simultâneas criam uma vez', async () => {
    const before = await ensureTemplate(options);
    await fixture.write('0002_b.sql', sql('CREATE TABLE b (id integer);', 'DROP TABLE b;'));

    const results = await Promise.all([ensureTemplate(options), ensureTemplate(options)]);
    assert.equal(results.filter((result) => result.rebuilt).length, 1);
    assert.notEqual(results[0]?.hash, before.hash);
    assert.notEqual(results[0]?.name, before.name);
    assert.equal(results[0]?.hash, results[1]?.hash);
    assert.equal(await databaseExists(before.name), true);

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
    const brokenTemplate = templateName(brokenBase, await hashMigrationsDir(broken.dir));
    try {
      await assert.rejects(
        ensureTemplate({ config, baseName: brokenBase, dir: broken.dir }),
        /Falha no up da migration 0001_a/,
      );
      assert.equal(await databaseComment(brokenTemplate), null);
      assert.equal(await databaseExists(brokenTemplate), false);
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
    template = (await ensureTemplate(options)).name;
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
  test('dois conjuntos de migrations em paralelo: cada clone tem o esquema do seu', async () => {
    const parallelBase = `${baseName}_p`;
    const setA = await createMigrationsDir({
      '0001_a.sql': sql('CREATE TABLE so_a (id integer);', 'DROP TABLE so_a;'),
    });
    const setB = await createMigrationsDir({
      '0001_b.sql': sql('CREATE TABLE so_b (id integer);', 'DROP TABLE so_b;'),
      '0002_b.sql': sql('CREATE TABLE so_b2 (id integer);', 'DROP TABLE so_b2;'),
    });
    const optionsA = { config, baseName: parallelBase, dir: setA.dir };
    const optionsB = { config, baseName: parallelBase, dir: setB.dir };
    // Um "worktree" prepara o modelo e clona; o esquema do clone diz de qual conjunto ele veio.
    const run = async (opts: typeof optionsA) => {
      const prepared = await ensureTemplate(opts);
      const db = await createTestDatabase(opts);
      try {
        const client = await connect(db.config);
        try {
          const tables = [];
          for (const table of ['so_a', 'so_b', 'so_b2']) {
            if (await tableExists(client, table)) {
              tables.push(table);
            }
          }
          const { rows } = await client.query<{ version: number }>(
            'SELECT version FROM schema_migrations ORDER BY 1',
          );
          return { prepared, tables, versions: rows.map((row) => row.version) };
        } finally {
          await client.end();
        }
      } finally {
        await db.drop();
      }
    };
    try {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => [run(optionsA), run(optionsB)]).flat(),
      );
      const fromA = results.filter((_, index) => index % 2 === 0);
      const fromB = results.filter((_, index) => index % 2 === 1);
      for (const result of fromA) {
        assert.deepEqual(result.tables, ['so_a']);
        assert.deepEqual(result.versions, [1]);
      }
      for (const result of fromB) {
        assert.deepEqual(result.tables, ['so_b', 'so_b2']);
        assert.deepEqual(result.versions, [1, 2]);
      }
      // Cada conjunto criou o seu modelo uma vez só, e os dois continuam lá.
      assert.equal(fromA.filter((result) => result.prepared.rebuilt).length, 1);
      assert.equal(fromB.filter((result) => result.prepared.rebuilt).length, 1);
      assert.notEqual(fromA[0]?.prepared.name, fromB[0]?.prepared.name);
      assert.equal(await databaseExists(fromA[0]?.prepared.name ?? ''), true);
      assert.equal(await databaseExists(fromB[0]?.prepared.name ?? ''), true);

      // Depois de o B preparar de novo, o A ainda clona o esquema dele (o caso da tarefa 138).
      await ensureTemplate(optionsB);
      const again = await run(optionsA);
      assert.deepEqual(again.tables, ['so_a']);
      assert.equal(again.prepared.rebuilt, false);
    } finally {
      await Promise.all([setA.remove(), setB.remove()]);
    }
  });

  test('expurgo tira os modelos velhos e sem uso, nunca o em uso nem o do conjunto atual', async () => {
    const gcBase = `${baseName}_g`;
    const dirs = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        createMigrationsDir({
          '0001_t.sql': sql(`CREATE TABLE t${n} (id integer);`, `DROP TABLE t${n};`),
        }),
      ),
    );
    const day = 24 * 60 * 60 * 1000;
    const admin = await connect(config);
    const holder = await connect(config);
    try {
      // Todos criados antes de envelhecer: o expurgo de quem cria não entra no teste.
      const results = [];
      for (const item of dirs) {
        results.push(await ensureTemplate({ config, baseName: gcBase, dir: item.dir }));
      }
      const names = results.map((result) => result.name);
      for (const [index, result] of results.entries()) {
        // Último uso: 30, 20, 20 dias atrás; o quarto, agora.
        const age = [30, 20, 20, 0][index] ?? 0;
        await admin.query(
          `COMMENT ON DATABASE "${result.name}" IS 'nuva-edu migrations sha256:${result.hash} usado:${Date.now() - age * day}'`,
        );
      }
      const [old1, old2, busy, current] = names as [string, string, string, string];
      // Resto de criação interrompida (sem COMMENT) e o modelo antigo de nome fixo.
      const orphan = `${gcBase}_tpl_0123456789ab`;
      const legacy = `${gcBase}_tpl`;
      await admin.query(`CREATE DATABASE "${orphan}"`);
      await admin.query(`CREATE DATABASE "${legacy}"`);
      // Outro processo copiando o terceiro modelo: segura a trava compartilhada dele.
      const busyKey = Number.parseInt(busy.slice(-12, -4), 16) | 0;
      await holder.query('SELECT pg_advisory_lock_shared(774100300, $1)', [busyKey]);

      const dropped = await dropStaleTemplates({
        config,
        baseName: gcBase,
        dir: dirs[3]?.dir ?? '',
        keep: 1,
      });
      assert.deepEqual(dropped, [old1, old2, orphan].sort());
      for (const name of [busy, current, legacy]) {
        assert.equal(await databaseExists(name), true, name);
      }

      await holder.query('SELECT pg_advisory_unlock_shared(774100300, $1)', [busyKey]);
      assert.deepEqual(
        await dropStaleTemplates({ config, baseName: gcBase, dir: dirs[3]?.dir ?? '', keep: 0 }),
        [busy],
      );
      // O do conjunto atual fica mesmo "velho" e sem nenhum guardado.
      assert.deepEqual(
        await dropStaleTemplates({
          config,
          baseName: gcBase,
          dir: dirs[3]?.dir ?? '',
          keep: 0,
          maxAgeMs: -day,
        }),
        [],
      );
      assert.equal(await databaseExists(current), true);
      assert.equal(await databaseExists(legacy), true);
    } finally {
      await Promise.all([holder.end(), admin.end()]);
      await Promise.all(dirs.map((item) => item.remove()));
    }
  });

  test('criar um modelo novo expurga os velhos sem uso do mesmo banco', async () => {
    const autoBase = `${baseName}_a`;
    const first = await createMigrationsDir({
      '0001_t.sql': sql('CREATE TABLE t (id integer);', 'DROP TABLE t;'),
    });
    const admin = await connect(config);
    try {
      const old = await ensureTemplate({ config, baseName: autoBase, dir: first.dir });
      await admin.query(
        `COMMENT ON DATABASE "${old.name}" IS 'nuva-edu migrations sha256:${old.hash} usado:${Date.now() - 30 * 24 * 60 * 60 * 1000}'`,
      );
      // Três conjuntos novos em seguida: o velho sai da lista dos três guardados e é expurgado.
      for (const n of [2, 3, 4]) {
        await first.write(`000${n}_t.sql`, sql(`CREATE TABLE t${n} ();`, `DROP TABLE t${n};`));
        assert.equal(
          (await ensureTemplate({ config, baseName: autoBase, dir: first.dir })).rebuilt,
          true,
        );
      }
      assert.equal(await databaseExists(old.name), false);
    } finally {
      await admin.end();
      await first.remove();
    }
  });
});
