import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  CONTROL_TABLE,
  currentVersion,
  latestVersion,
  MigrationError,
  migrateDown,
  migrateUp,
  migrationStatus,
  withMigrationLock,
} from '../src/migrator.ts';
import {
  createMigrationsDir,
  createScratchDatabase,
  type MigrationsDir,
  type Scratch,
  sql,
  tableExists,
} from './helpers.ts';

const FILES = {
  '0001_a.sql': sql('CREATE TABLE a (id integer PRIMARY KEY);', 'DROP TABLE a;'),
  '0002_b.sql': sql(
    'CREATE TABLE b (id integer PRIMARY KEY);\nINSERT INTO b VALUES (1), (2);',
    'DROP TABLE b;',
  ),
  '0003_c.sql': sql('CREATE TABLE c (id integer PRIMARY KEY);', 'DROP TABLE c;'),
};

describe('migrator', () => {
  let db: Scratch;
  let fixture: MigrationsDir;

  before(async () => {
    db = await createScratchDatabase();
  });
  after(async () => {
    await db.drop();
  });
  beforeEach(async () => {
    await db.client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await fixture?.remove();
    fixture = await createMigrationsDir(FILES);
  });
  after(async () => {
    await fixture?.remove();
  });

  async function appliedVersions(): Promise<number[]> {
    const { rows } = await db.client.query<{ version: number }>(
      `SELECT version FROM ${CONTROL_TABLE} ORDER BY version`,
    );
    return rows.map((row) => row.version);
  }

  test('up aplica as pendentes em ordem e registra na tabela de controle', async () => {
    const lines: string[] = [];
    const applied = await migrateUp(db.client, {
      dir: fixture.dir,
      log: (line) => lines.push(line),
    });
    assert.deepEqual(
      applied.map((migration) => migration.name),
      ['0001_a', '0002_b', '0003_c'],
    );
    assert.deepEqual(await appliedVersions(), [1, 2, 3]);
    assert.equal(lines.length, 3);
    assert.match(lines[0] ?? '', /^up {3}0001_a/);
    const { rows } = await db.client.query('SELECT id FROM b ORDER BY id');
    assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
    assert.equal(await currentVersion(db.client), 3);
    assert.equal(await latestVersion(fixture.dir), 3);
  });

  test('up repetido não faz nada; migration nova entra sozinha', async () => {
    await migrateUp(db.client, { dir: fixture.dir });
    assert.deepEqual(await migrateUp(db.client, { dir: fixture.dir }), []);

    await fixture.write('0004_d.sql', sql('CREATE TABLE d ();', 'DROP TABLE d;'));
    const applied = await migrateUp(db.client, { dir: fixture.dir });
    assert.deepEqual(
      applied.map((migration) => migration.version),
      [4],
    );
  });

  test('up --to para na versão pedida', async () => {
    await migrateUp(db.client, { dir: fixture.dir, to: 2 });
    assert.deepEqual(await appliedVersions(), [1, 2]);
    assert.equal(await tableExists(db.client, 'c'), false);
    await assert.rejects(migrateUp(db.client, { dir: fixture.dir, to: 9 }), MigrationError);
  });

  test('down desfaz só a última por padrão', async () => {
    await migrateUp(db.client, { dir: fixture.dir });
    const reverted = await migrateDown(db.client, { dir: fixture.dir });
    assert.deepEqual(
      reverted.map((migration) => migration.name),
      ['0003_c'],
    );
    assert.deepEqual(await appliedVersions(), [1, 2]);
    assert.equal(await tableExists(db.client, 'c'), false);
    assert.equal(await tableExists(db.client, 'b'), true);
  });

  test('down com steps e com to; ida e volta completa', async () => {
    await migrateUp(db.client, { dir: fixture.dir });
    await migrateDown(db.client, { dir: fixture.dir, steps: 2 });
    assert.deepEqual(await appliedVersions(), [1]);

    await migrateUp(db.client, { dir: fixture.dir });
    const reverted = await migrateDown(db.client, { dir: fixture.dir, to: 0 });
    assert.deepEqual(
      reverted.map((migration) => migration.version),
      [3, 2, 1],
    );
    assert.deepEqual(await appliedVersions(), []);
    assert.equal(await tableExists(db.client, 'a'), false);

    assert.deepEqual(await migrateDown(db.client, { dir: fixture.dir }), []);
    await migrateUp(db.client, { dir: fixture.dir });
    assert.deepEqual(await appliedVersions(), [1, 2, 3]);

    await assert.rejects(
      migrateDown(db.client, { dir: fixture.dir, steps: 1, to: 1 }),
      /steps ou to/,
    );
    await assert.rejects(migrateDown(db.client, { dir: fixture.dir, to: 7 }), MigrationError);
  });

  test('migration com erro é desfeita inteira e as anteriores ficam', async () => {
    await fixture.write(
      '0003_c.sql',
      sql('CREATE TABLE c (id integer);\nINSERT INTO nao_existe VALUES (1);', 'DROP TABLE c;'),
    );
    await assert.rejects(
      migrateUp(db.client, { dir: fixture.dir }),
      /Falha no up da migration 0003_c: .*nao_existe/,
    );
    assert.deepEqual(await appliedVersions(), [1, 2]);
    assert.equal(await tableExists(db.client, 'c'), false);

    // A trava foi solta e a conexão continua utilizável: corrigir e repetir funciona.
    await fixture.write('0003_c.sql', FILES['0003_c.sql']);
    await migrateUp(db.client, { dir: fixture.dir });
    assert.deepEqual(await appliedVersions(), [1, 2, 3]);
  });

  test('up alterado depois de aplicado é recusado; mudar só o down é permitido', async () => {
    await migrateUp(db.client, { dir: fixture.dir, to: 2 });

    await fixture.write(
      '0002_b.sql',
      sql('CREATE TABLE b (id integer PRIMARY KEY);', 'DROP TABLE IF EXISTS b;'),
    );
    await assert.rejects(migrateUp(db.client, { dir: fixture.dir }), /0002_b foi alterada/);
    await assert.rejects(migrateDown(db.client, { dir: fixture.dir }), /0002_b foi alterada/);
    assert.equal(await tableExists(db.client, 'c'), false);
    const status = await migrationStatus(db.client, { dir: fixture.dir });
    assert.deepEqual(
      status.map((entry) => entry.state),
      ['aplicada', 'alterada', 'pendente'],
    );

    await fixture.write(
      '0002_b.sql',
      FILES['0002_b.sql'].replace('DROP TABLE b;', 'DROP TABLE IF EXISTS b;'),
    );
    await migrateDown(db.client, { dir: fixture.dir });
    assert.deepEqual(await appliedVersions(), [1]);
  });

  test('banco mais novo que a pasta é recusado', async () => {
    await migrateUp(db.client, { dir: fixture.dir });
    const older = await createMigrationsDir({ '0001_a.sql': FILES['0001_a.sql'] });
    try {
      await assert.rejects(migrateUp(db.client, { dir: older.dir }), /arquivo não existe na pasta/);
      const status = await migrationStatus(db.client, { dir: older.dir });
      assert.deepEqual(
        status.map((entry) => entry.state),
        ['aplicada', 'sem-arquivo', 'sem-arquivo'],
      );
    } finally {
      await older.remove();
    }
  });

  test('migration irreversível não é desfeita', async () => {
    await fixture.write('0004_d.sql', sql('CREATE TABLE d ();', '-- migrate:irreversible'));
    await fixture.write('0005_e.sql', sql('CREATE TABLE e ();', 'DROP TABLE e;'));
    await migrateUp(db.client, { dir: fixture.dir });
    await assert.rejects(
      migrateDown(db.client, { dir: fixture.dir, to: 0 }),
      /0004_d é irreversível/,
    );
    // A 0005 foi desfeita antes de chegar na irreversível; a 0004 ficou.
    assert.deepEqual(await appliedVersions(), [1, 2, 3, 4]);
  });

  test('status não cria a tabela de controle e mostra as datas', async () => {
    const empty = await migrationStatus(db.client, { dir: fixture.dir });
    assert.deepEqual(
      empty.map((entry) => [entry.name, entry.state, entry.appliedAt]),
      [
        ['0001_a', 'pendente', null],
        ['0002_b', 'pendente', null],
        ['0003_c', 'pendente', null],
      ],
    );
    assert.equal(await tableExists(db.client, CONTROL_TABLE), false);
    assert.equal(await currentVersion(db.client), 0);

    await migrateUp(db.client, { dir: fixture.dir, to: 1 });
    const status = await migrationStatus(db.client, { dir: fixture.dir });
    assert.equal(status[0]?.state, 'aplicada');
    assert.ok(status[0]?.appliedAt instanceof Date);
    assert.equal(status[1]?.state, 'pendente');
  });

  test('duas execuções simultâneas aplicam cada migration uma vez só', async () => {
    await fixture.write('0004_lenta.sql', sql('SELECT pg_sleep(0.3);', 'SELECT 1;'));
    const other = await db.connect();
    const lines: string[] = [];
    const [first, second] = await Promise.all([
      migrateUp(db.client, { dir: fixture.dir }),
      migrateUp(other, { dir: fixture.dir, log: (line) => lines.push(line) }),
    ]);
    assert.equal(first.length + second.length, 4);
    assert.ok(first.length === 0 || second.length === 0, 'uma das execuções não aplica nada');
    assert.deepEqual(await appliedVersions(), [1, 2, 3, 4]);
  });

  test('trava ocupada além do tempo limite vira erro, sem aplicar nada', async () => {
    const other = await db.connect();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withMigrationLock(other, {}, () => held);
    // Garante que a outra conexão já pegou a trava.
    await other.query('SELECT 1');
    try {
      const lines: string[] = [];
      await assert.rejects(
        migrateUp(db.client, {
          dir: fixture.dir,
          lockTimeoutMs: 150,
          log: (line) => lines.push(line),
        }),
        /segura a trava/,
      );
      assert.match(lines[0] ?? '', /aguardando a trava/);
      assert.equal(await tableExists(db.client, 'a'), false);
    } finally {
      release();
      await holder;
    }
    await migrateUp(db.client, { dir: fixture.dir });
    assert.deepEqual(await appliedVersions(), [1, 2, 3]);
  });
});
