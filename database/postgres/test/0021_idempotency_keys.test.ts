import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

type Row = Record<string, unknown>;

describe('0021: chaves de idempotência financeira', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 21 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  async function insertRow(table: string, row: Row): Promise<Row> {
    const names = Object.keys(row);
    const placeholders = names.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      Object.values(row),
    );
    return rows[0] as Row;
  }

  async function rejects(table: string, row: Row, constraint: string, code = '23514') {
    await assert.rejects(insertRow(table, row), (error: { code?: string; constraint?: string }) => {
      assert.equal(error.code, code);
      assert.equal(error.constraint, constraint);
      return true;
    });
  }

  async function insertUser(): Promise<string> {
    const user = await insertRow('users', {
      email: `idem-${unique()}@example.com`,
      name: 'Pessoa',
    });
    return user.id as string;
  }

  async function insertKey(userId: string, overrides: Row = {}): Promise<Row> {
    return insertRow('idempotency_keys', {
      key: `chave-${unique()}`,
      scope: 'refund.order',
      user_id: userId,
      request_hash: `hash-${unique()}`,
      ...overrides,
    });
  }

  async function insertOrder(userId: string): Promise<Row> {
    return insertRow('orders', {
      user_id: userId,
      status: 'paid',
      subtotal_cents: 10_000,
      discount_cents: 0,
      total_cents: 10_000,
      currency: 'BRL',
      buyer_name: 'Ana Souza',
      buyer_tax_id_type: 'cpf',
      buyer_tax_id: '12345678901',
      provider: 'fake',
      paid_at: new Date().toISOString(),
    });
  }

  async function countRows(table: string, where = 'true', values: unknown[] = []): Promise<number> {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, values);
    return rows[0].n as number;
  }

  /** Colunas vistas pelo catálogo, na ordem da tabela. */
  async function catalog() {
    const { rows } = await query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'idempotency_keys'
        ORDER BY ordinal_position`,
    );
    return rows as {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }[];
  }

  async function indexes(): Promise<string[]> {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'idempotency_keys'
        ORDER BY indexname`,
    );
    return (rows as { indexname: string; indexdef: string }[]).map(
      (row) => `${row.indexname}: ${row.indexdef.replace(/^.* USING /, '')}`,
    );
  }

  async function foreignKeyDeleteAction(table: string, constraint: string): Promise<string> {
    const { rows } = await query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = $1 AND conrelid = $2::regclass`,
      [constraint, table],
    );
    return rows[0]?.confdeltype as string;
  }

  test('a tabela nasce com as oito colunas, os nulos e o padrão de created_at', async () => {
    assert.equal(await tableExists(db.client, 'idempotency_keys'), true);
    assert.deepEqual(await catalog(), [
      { column_name: 'key', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'scope', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'request_hash', data_type: 'text', is_nullable: 'NO', column_default: null },
      {
        column_name: 'response_status',
        data_type: 'integer',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'response_body',
        data_type: 'jsonb',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      {
        column_name: 'completed_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
  });

  test('a chave primária composta vem antes da cascata, e o expurgo tem índice', async () => {
    assert.deepEqual(await indexes(), [
      'idempotency_keys_created_at_idx: btree (created_at)',
      'idempotency_keys_pkey: btree (scope, user_id, key)',
      'idempotency_keys_user_idx: btree (user_id)',
    ]);
    // A cascata existe e é ON DELETE CASCADE (confdeltype 'c'), não RESTRICT nem SET NULL.
    assert.equal(
      await foreignKeyDeleteAction('idempotency_keys', 'idempotency_keys_user_id_fkey'),
      'c',
    );
  });

  test('mesma chave só colide no mesmo escopo e no mesmo usuário', async () => {
    const user = await insertUser();
    const other = await insertUser();
    const key = `chave-${unique()}`;

    const first = await insertKey(user, { key, scope: 'refund.order', request_hash: 'hash-1' });
    assert.equal(first.key, key);

    // Repetição da mesma chave: recusada mesmo com outra impressão digital da requisição; a
    // comparação do corpo é regra do código, a unicidade é do banco.
    await rejects(
      'idempotency_keys',
      {
        key,
        scope: 'refund.order',
        user_id: user,
        request_hash: 'hash-2',
      },
      'idempotency_keys_pkey',
      '23505',
    );

    // A mesma chave em outro escopo, em outro usuário e com outro escopo no mesmo usuário é
    // outra operação.
    await insertKey(user, { key, scope: 'refund.subscription' });
    await insertKey(other, { key, scope: 'refund.order' });
    await insertKey(user, { scope: 'order.create' });
    assert.equal(await countRows('idempotency_keys', 'key = $1', [key]), 3);
    assert.equal(await countRows('idempotency_keys', 'user_id = $1', [user]), 3);
  });

  test('apagar o usuário leva as chaves dele e deixa as dos outros', async () => {
    const doomed = await insertUser();
    const kept = await insertUser();
    await insertKey(doomed, { scope: 'order.create' });
    await insertKey(doomed, { scope: 'refund.order' });
    const survivor = await insertKey(kept, { scope: 'refund.subscription' });

    await query('DELETE FROM users WHERE id = $1', [doomed]);
    assert.equal(await countRows('idempotency_keys', 'user_id = $1', [doomed]), 0);
    const { rows } = await query('SELECT key, scope FROM idempotency_keys WHERE user_id = $1', [
      kept,
    ]);
    assert.deepEqual(rows, [{ key: survivor.key, scope: 'refund.subscription' }]);
  });

  test('a reserva nasce com os response_* nulos e termina com status, corpo e instante', async () => {
    const user = await insertUser();
    const key = `chave-${unique()}`;
    const claimed = await insertKey(user, { key });
    assert.equal(claimed.response_status, null);
    assert.equal(claimed.response_body, null);
    assert.equal(claimed.completed_at, null);
    assert.ok(claimed.created_at instanceof Date);

    const body = { id: '0b6f0d3c-0000-7000-8000-000000000000', status: 'requested' };
    const { rows } = await query(
      `UPDATE idempotency_keys
          SET response_status = $1, response_body = $2, completed_at = now()
        WHERE scope = $3 AND user_id = $4 AND key = $5
        RETURNING response_status, response_body, completed_at`,
      [202, JSON.stringify(body), 'refund.order', user, key],
    );
    assert.equal(rows[0].response_status, 202);
    assert.deepEqual(rows[0].response_body, body);
    assert.ok(rows[0].completed_at instanceof Date);

    // A leitura da repetição é pela chave primária composta, sem varrer a tabela.
    const { rows: replay } = await query(
      'SELECT response_status, response_body FROM idempotency_keys WHERE scope = $1 AND user_id = $2 AND key = $3',
      ['refund.order', user, key],
    );
    assert.deepEqual(replay, [{ response_status: 202, response_body: body }]);
  });

  test('os CHECKs recusam chave vazia ou longa, escopo fora do formato e status fora de HTTP', async () => {
    const user = await insertUser();
    await rejects(
      'idempotency_keys',
      {
        key: '',
        scope: 'order.create',
        user_id: user,
        request_hash: 'hash',
      },
      'idempotency_keys_key_length',
    );
    await rejects(
      'idempotency_keys',
      {
        key: 'a'.repeat(201),
        scope: 'order.create',
        user_id: user,
        request_hash: 'hash',
      },
      'idempotency_keys_key_length',
    );
    await insertKey(user, { key: 'a'.repeat(200) });

    for (const scope of ['Refund.Order', 'refund order', 'a'.repeat(101)]) {
      await rejects(
        'idempotency_keys',
        { key: `chave-${unique()}`, scope, user_id: user, request_hash: 'hash' },
        'idempotency_keys_scope_format',
      );
    }
    await insertKey(user, { scope: 'refund.subscription' });
    await insertKey(user, { scope: 'order.create' });

    for (const status of [99, 600]) {
      await rejects(
        'idempotency_keys',
        {
          key: `chave-${unique()}`,
          scope: 'order.create',
          user_id: user,
          request_hash: 'hash',
          response_status: status,
        },
        'idempotency_keys_response_status_range',
      );
    }
    for (const status of [100, 599]) {
      const row = await insertKey(user, { response_status: status });
      assert.equal(row.response_status, status);
    }

    // request_hash é obrigatório: a reserva sem a impressão digital não permitiria distinguir
    // repetição de conflito.
    await assert.rejects(
      insertRow('idempotency_keys', {
        key: `chave-${unique()}`,
        scope: 'order.create',
        user_id: user,
      }),
      (error: { code?: string; column?: string }) => {
        assert.equal(error.code, '23502');
        assert.equal(error.column, 'request_hash');
        return true;
      },
    );
  });

  test('down volta à 0020 sem tocar em usuário e pedido; up recria a tabela vazia', async () => {
    const user = await insertUser();
    const email = (await query('SELECT email FROM users WHERE id = $1', [user])).rows[0].email;
    const order = await insertOrder(user);
    await insertKey(user, { key: 'chave-da-0020' });

    await migrateDown(db.client, { dir, to: 20 });
    assert.equal(await tableExists(db.client, 'idempotency_keys'), false);
    assert.deepEqual((await query('SELECT email FROM users WHERE id = $1', [user])).rows, [
      { email },
    ]);
    assert.deepEqual(
      (await query('SELECT id, status, total_cents FROM orders WHERE id = $1', [order.id])).rows,
      [{ id: order.id, status: 'paid', total_cents: '10000' }],
    );

    await migrateUp(db.client, { dir, to: 21 });
    assert.equal(await tableExists(db.client, 'idempotency_keys'), true);
    assert.equal((await catalog()).length, 8);
    // A tabela volta vazia (o down a apagou, com as chaves) e aceita uma reserva nova.
    assert.equal(await countRows('idempotency_keys'), 0);
    const fresh = await insertKey(user, { key: 'chave-da-0020' });
    assert.equal(fresh.key, 'chave-da-0020');
    assert.equal(await countRows('users', 'id = $1', [user]), 1);
    assert.equal(await countRows('orders', 'id = $1', [order.id]), 1);
  });
});
