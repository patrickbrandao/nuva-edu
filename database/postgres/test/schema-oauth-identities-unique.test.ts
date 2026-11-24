import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

describe('0008: uma identidade por provedor em cada conta', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 8 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  async function insertUser(): Promise<string> {
    const { rows } = await query(
      `INSERT INTO users (email, name) VALUES ($1, 'Pessoa') RETURNING id`,
      [`u${unique()}@example.com`],
    );
    return rows[0].id;
  }

  const insertIdentity = (userId: string, provider: string) =>
    query(
      `INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)`,
      [userId, provider, `sub-${unique()}`],
    );

  const indexes = async () =>
    (
      await query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'oauth_identities'
          ORDER BY indexname`,
      )
    ).rows.map((row) => `${row.indexname}: ${row.indexdef.replace(/^.* USING /, '')}`);

  test('segunda identidade do mesmo provedor na mesma conta é recusada', async () => {
    const user = await insertUser();
    const other = await insertUser();
    await insertIdentity(user, 'google');
    await assert.rejects(insertIdentity(user, 'google'), {
      code: '23505',
      constraint: 'oauth_identities_user_provider_unique',
    });
    // A mesma conta com provedores diferentes e outra conta com o mesmo provedor seguem aceitas.
    await insertIdentity(user, 'facebook');
    await insertIdentity(user, 'apple');
    await insertIdentity(other, 'google');
    const { rows } = await query(
      `SELECT user_id, provider FROM oauth_identities WHERE user_id IN ($1, $2)
        ORDER BY user_id = $1 DESC, provider`,
      [user, other],
    );
    assert.deepEqual(
      rows.map((row) => `${row.user_id === user ? 'user' : 'other'}:${row.provider}`),
      ['user:apple', 'user:facebook', 'user:google', 'other:google'],
    );
  });

  test('o índice único substitui oauth_identities_user_idx', async () => {
    assert.deepEqual(await indexes(), [
      'oauth_identities_pkey: btree (id)',
      'oauth_identities_provider_user_unique: btree (provider, provider_user_id)',
      'oauth_identities_user_provider_unique: btree (user_id, provider)',
    ]);
  });

  test('down e up da 0008 voltam aos índices da 0005 e de volta', async () => {
    const full = await indexes();
    await migrateDown(db.client, { dir, to: 7 });
    assert.deepEqual(await indexes(), [
      'oauth_identities_pkey: btree (id)',
      'oauth_identities_provider_user_unique: btree (provider, provider_user_id)',
      'oauth_identities_user_idx: btree (user_id)',
    ]);
    // Sem o índice, o banco volta a aceitar a duplicata; ela impede o up de novo (23505).
    const user = await insertUser();
    await insertIdentity(user, 'google');
    await insertIdentity(user, 'google');
    await assert.rejects(migrateUp(db.client, { dir, to: 8 }), (error: Error) => {
      assert.equal((error.cause as { code?: string }).code, '23505');
      return true;
    });
    await query(`DELETE FROM oauth_identities WHERE user_id = $1`, [user]);
    await migrateUp(db.client, { dir, to: 8 });
    assert.deepEqual(await indexes(), full);
  });
});
