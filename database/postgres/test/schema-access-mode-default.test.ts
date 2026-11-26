import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, unique } from './helpers.ts';

const dir = defaultMigrationsDir;
const tables = ['bundles', 'courses', 'ebooks'] as const;

describe('0013: modo de acesso private por padrão', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 13 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  /** Insere sem access_mode e devolve o modo gravado. */
  async function insertWithoutMode(table: (typeof tables)[number]): Promise<string> {
    const { rows } = await query(
      `INSERT INTO ${table} (slug, title) VALUES ($1, 'Produto') RETURNING access_mode`,
      [`s-${unique()}`],
    );
    return rows[0].access_mode;
  }

  const defaults = async () =>
    (
      await query(
        `SELECT table_name, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'access_mode' AND table_name = ANY($1)
          ORDER BY table_name`,
        [tables],
      )
    ).rows.map((row) => `${row.table_name}: ${row.column_default}`);

  test('INSERT sem access_mode grava private em cursos, ebooks e pacotes', async () => {
    for (const table of tables) {
      assert.equal(await insertWithoutMode(table), 'private', table);
    }
  });

  test('down volta ao padrão open sem alterar linhas existentes; up de novo volta a private', async () => {
    await migrateDown(db.client, { dir, to: 12 });
    assert.deepEqual(await defaults(), [
      "bundles: 'open'::text",
      "courses: 'open'::text",
      "ebooks: 'open'::text",
    ]);
    for (const table of tables) {
      assert.equal(await insertWithoutMode(table), 'open', table);
    }
    await migrateUp(db.client, { dir, to: 13 });
    assert.deepEqual(await defaults(), [
      "bundles: 'private'::text",
      "courses: 'private'::text",
      "ebooks: 'private'::text",
    ]);
    // As linhas gravadas antes continuam com o modo que tinham.
    const { rows } = await query(
      `SELECT access_mode, count(*)::int AS n FROM (
          SELECT access_mode FROM courses UNION ALL SELECT access_mode FROM ebooks
          UNION ALL SELECT access_mode FROM bundles) t
        GROUP BY access_mode ORDER BY access_mode`,
    );
    assert.deepEqual(rows, [
      { access_mode: 'open', n: 3 },
      { access_mode: 'private', n: 3 },
    ]);
  });
});
