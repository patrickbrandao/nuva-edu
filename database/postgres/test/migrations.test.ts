import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashMigrationsDir, loadMigrations, parseMigration } from '../src/migrations.ts';
import { createMigrationsDir, sql } from './helpers.ts';

test('parseMigration separa up e down e calcula o checksum só do up', () => {
  const a = parseMigration('0001_base.sql', sql('CREATE TABLE a ();', 'DROP TABLE a;'));
  assert.equal(a.version, 1);
  assert.equal(a.name, '0001_base');
  assert.equal(a.up, 'CREATE TABLE a ();');
  assert.equal(a.down, 'DROP TABLE a;');

  const sameUp = parseMigration(
    '0001_base.sql',
    sql('CREATE TABLE a ();', 'DROP TABLE IF EXISTS a;'),
  );
  const otherUp = parseMigration('0001_base.sql', sql('CREATE TABLE b ();', 'DROP TABLE a;'));
  assert.equal(sameUp.checksum, a.checksum);
  assert.notEqual(otherUp.checksum, a.checksum);
});

test('parseMigration aceita comentário de cabeçalho antes do up', () => {
  const parsed = parseMigration('0002_x.sql', `-- explicação\n\n${sql('SELECT 1;', 'SELECT 2;')}`);
  assert.equal(parsed.up, 'SELECT 1;');
});

test('parseMigration recusa nome fora do padrão', () => {
  for (const file of [
    '1_base.sql',
    '0001-base.sql',
    '0001_Base.sql',
    '00001_base.sql',
    '0001_.sql',
  ]) {
    assert.throws(() => parseMigration(file, sql('SELECT 1;', 'SELECT 1;')), /nome inválido/, file);
  }
});

test('parseMigration recusa arquivo sem seções, com seção repetida ou com SQL solto', () => {
  assert.throws(
    () => parseMigration('0001_a.sql', 'CREATE TABLE a ();'),
    /antes de "-- migrate:up"/,
  );
  assert.throws(() => parseMigration('0001_a.sql', '-- migrate:up\nSELECT 1;'), /faltam as seções/);
  assert.throws(
    () => parseMigration('0001_a.sql', '-- migrate:down\nSELECT 1;\n-- migrate:up\nSELECT 1;'),
    /antes de "-- migrate:up"/,
  );
  assert.throws(
    () => parseMigration('0001_a.sql', `${sql('SELECT 1;', 'SELECT 1;')}-- migrate:up\nSELECT 2;`),
    /repetida/,
  );
  assert.throws(() => parseMigration('0001_a.sql', sql('-- nada', 'SELECT 1;')), /up vazia/);
});

test('down vazio só é aceito com a marca de irreversível', () => {
  assert.throws(() => parseMigration('0001_a.sql', sql('SELECT 1;', '')), /down vazia/);
  assert.throws(() => parseMigration('0001_a.sql', sql('SELECT 1;', '-- depois')), /down vazia/);

  const parsed = parseMigration('0001_a.sql', sql('SELECT 1;', '-- migrate:irreversible'));
  assert.equal(parsed.down, null);

  assert.throws(
    () => parseMigration('0001_a.sql', sql('SELECT 1;', '-- migrate:irreversible\nSELECT 2;')),
    /não pode ter SQL no down/,
  );
  assert.throws(
    () => parseMigration('0001_a.sql', sql('-- migrate:irreversible\nSELECT 1;', 'SELECT 2;')),
    /só vale dentro da seção down/,
  );
});

test('loadMigrations lê em ordem e ignora o que não é .sql', async (t) => {
  const fixture = await createMigrationsDir({
    '0002_b.sql': sql('SELECT 2;', 'SELECT 2;'),
    '0001_a.sql': sql('SELECT 1;', 'SELECT 1;'),
    'README.md': 'texto',
  });
  t.after(fixture.remove);
  const migrations = await loadMigrations(fixture.dir);
  assert.deepEqual(
    migrations.map((migration) => migration.name),
    ['0001_a', '0002_b'],
  );
});

test('loadMigrations recusa salto e número repetido', async (t) => {
  const gap = await createMigrationsDir({
    '0001_a.sql': sql('SELECT 1;', 'SELECT 1;'),
    '0003_c.sql': sql('SELECT 1;', 'SELECT 1;'),
  });
  t.after(gap.remove);
  await assert.rejects(loadMigrations(gap.dir), /esperava a migration 0002/);

  const repeated = await createMigrationsDir({
    '0001_a.sql': sql('SELECT 1;', 'SELECT 1;'),
    '0001_b.sql': sql('SELECT 1;', 'SELECT 1;'),
  });
  t.after(repeated.remove);
  await assert.rejects(loadMigrations(repeated.dir), /esperava a migration 0002/);
});

test('hashMigrationsDir muda com conteúdo, nome e arquivo novo, e só com eles', async (t) => {
  const fixture = await createMigrationsDir({ '0001_a.sql': sql('SELECT 1;', 'SELECT 1;') });
  t.after(fixture.remove);
  const initial = await hashMigrationsDir(fixture.dir);
  assert.match(initial, /^[0-9a-f]{64}$/);
  assert.equal(await hashMigrationsDir(fixture.dir), initial);

  await fixture.write('notas.txt', 'não conta');
  assert.equal(await hashMigrationsDir(fixture.dir), initial);

  await fixture.write('0001_a.sql', sql('SELECT 1;', 'SELECT 2;'));
  const changed = await hashMigrationsDir(fixture.dir);
  assert.notEqual(changed, initial);

  await fixture.write('0002_b.sql', sql('SELECT 1;', 'SELECT 1;'));
  assert.notEqual(await hashMigrationsDir(fixture.dir), changed);
});
