import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, unique } from './helpers.ts';

const dir = defaultMigrationsDir;
const columns = ['checkout_url', 'provider_checkout_id'] as const;

type Row = Record<string, unknown>;

describe('0020: URL e identificador do checkout no pedido', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 20 });
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

  async function insertUser(): Promise<string> {
    const user = await insertRow('users', {
      email: `checkout-${unique()}@example.com`,
      name: 'Pessoa',
    });
    return user.id as string;
  }

  async function insertOrder(userId: string, overrides: Row = {}): Promise<Row> {
    return insertRow('orders', {
      user_id: userId,
      status: 'pending',
      subtotal_cents: 10_000,
      discount_cents: 0,
      total_cents: 10_000,
      currency: 'BRL',
      buyer_name: 'Ana Souza',
      buyer_tax_id_type: 'cpf',
      buyer_tax_id: '12345678901',
      provider: 'mercadopago',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ...overrides,
    });
  }

  /** Colunas de checkout vistas pelo catálogo, ordenadas por nome. */
  async function catalog() {
    const { rows } = await query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = ANY($1)
        ORDER BY column_name`,
      [columns],
    );
    return rows as {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }[];
  }

  test('as duas colunas nascem text, nulas e sem valor padrão', async () => {
    assert.deepEqual(await catalog(), [
      {
        column_name: 'checkout_url',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'provider_checkout_id',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
  });

  test('o fechamento grava a URL e o identificador, e o pedido os relê pela chave', async () => {
    const user = await insertUser();
    const created = await insertOrder(user, {
      checkout_url: 'https://pagamento.provedor.test/checkout/abc123',
      provider_checkout_id: 'fake_checkout_000001',
    });
    assert.equal(created.checkout_url, 'https://pagamento.provedor.test/checkout/abc123');
    assert.equal(created.provider_checkout_id, 'fake_checkout_000001');

    // A consulta posterior do pedido (tarefa 540) relê pela chave primária.
    const { rows } = await query(
      'SELECT checkout_url, provider_checkout_id FROM orders WHERE id = $1',
      [created.id],
    );
    assert.deepEqual(rows[0], {
      checkout_url: 'https://pagamento.provedor.test/checkout/abc123',
      provider_checkout_id: 'fake_checkout_000001',
    });

    // Sem CHECK de formato: o que o provedor devolver é gravado como veio.
    const odd = await insertOrder(user, {
      checkout_url: 'endereco-do-provedor-sem-forma-fixa',
      provider_checkout_id: 'id com espaço e ç',
    });
    assert.equal(odd.checkout_url, 'endereco-do-provedor-sem-forma-fixa');
    assert.equal(odd.provider_checkout_id, 'id com espaço e ç');

    // Sem valor no fechamento, as duas ficam nulas.
    const plain = await insertOrder(user);
    assert.equal(plain.checkout_url, null);
    assert.equal(plain.provider_checkout_id, null);

    // Pedido de total zero (provider 'none') e pedido que ficou `draft` não têm checkout.
    const free = await insertOrder(user, {
      subtotal_cents: 0,
      discount_cents: 0,
      total_cents: 0,
      provider: 'none',
    });
    assert.equal(free.checkout_url, null);
    assert.equal(free.provider_checkout_id, null);
    const draft = await insertOrder(user, {
      status: 'draft',
      subtotal_cents: 0,
      discount_cents: 0,
      total_cents: 0,
      provider: 'none',
      expires_at: null,
    });
    assert.equal(draft.checkout_url, null);
    assert.equal(draft.provider_checkout_id, null);
  });

  test('down volta à 0019 sem tocar nas linhas; up recria as colunas nulas', async () => {
    const user = await insertUser();
    const order = await insertOrder(user, {
      checkout_url: 'https://pagamento.provedor.test/checkout/def456',
      provider_checkout_id: 'fake_checkout_000002',
    });

    await migrateDown(db.client, { dir, to: 19 });
    assert.deepEqual(await catalog(), []);

    const { rows: kept } = await query(
      'SELECT status, total_cents, buyer_name FROM orders WHERE id = $1',
      [order.id],
    );
    assert.deepEqual(kept, [{ status: 'pending', total_cents: '10000', buyer_name: 'Ana Souza' }]);

    await migrateUp(db.client, { dir, to: 20 });
    assert.equal((await catalog()).length, 2);
    // A linha anterior continua lá; as colunas novas chegam nulas.
    const { rows: replayed } = await query(
      'SELECT checkout_url, provider_checkout_id FROM orders WHERE id = $1',
      [order.id],
    );
    assert.deepEqual(replayed, [{ checkout_url: null, provider_checkout_id: null }]);
  });
});
