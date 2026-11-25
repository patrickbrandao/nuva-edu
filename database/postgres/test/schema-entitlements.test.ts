import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

describe('0010: direitos de acesso', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 10 });
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

  interface Fields {
    user_id: string;
    product_type?: string;
    product_id?: string;
    source?: string;
    source_id?: string;
    parent_entitlement_id?: string | null;
    starts_at?: string;
    expires_at?: string | null;
    revoked_at?: string | null;
    revoke_reason?: string | null;
    granted_reason?: string | null;
  }

  /** Insere um direito; por padrão, uma raiz `grant` de curso. */
  async function insert(fields: Fields) {
    const row = {
      product_type: 'course',
      product_id: randomUUID(),
      source: 'grant',
      source_id: randomUUID(),
      granted_reason: fields.source && fields.source !== 'grant' ? null : 'Cortesia',
      ...fields,
    };
    const columns = Object.keys(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO entitlements (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      Object.values(row),
    );
    return rows[0];
  }

  async function rejects(fields: Fields, constraint: string) {
    await assert.rejects(insert(fields), (error: { constraint?: string }) => {
      assert.equal(error.constraint, constraint);
      return true;
    });
  }

  test('down e up da 0010 removem e recriam a tabela', async () => {
    assert.equal(await tableExists(db.client, 'entitlements'), true);
    await migrateDown(db.client, { dir });
    assert.equal(await tableExists(db.client, 'entitlements'), false);
    assert.equal(await tableExists(db.client, 'courses'), true);
    await migrateUp(db.client, { dir, to: 10 });
    assert.equal(await tableExists(db.client, 'entitlements'), true);
  });

  test('padrões, UUID v7 e updated_at pelo gatilho', async () => {
    const user = await insertUser();
    const row = await insert({ user_id: user });
    assert.equal(row.version, 1);
    assert.equal(row.parent_entitlement_id, null);
    assert.equal(row.expires_at, null);
    assert.equal(row.revoked_at, null);
    assert.ok(row.starts_at instanceof Date);
    const { rows: v } = await query('SELECT uuid_extract_version($1::uuid) AS v', [row.id]);
    assert.equal(v[0].v, 7);
    await query(`UPDATE entitlements SET updated_at = now() - interval '1 day' WHERE id = $1`, [
      row.id,
    ]);
    const { rows } = await query(
      "SELECT updated_at > now() - interval '1 minute' AS fresh FROM entitlements WHERE id = $1",
      [row.id],
    );
    assert.equal(rows[0].fresh, true);
  });

  test('fontes, tipos e motivos válidos', async () => {
    const user = await insertUser();
    for (const product_type of ['course', 'bundle', 'ebook']) {
      await insert({ user_id: user, product_type });
    }
    await insert({ user_id: user, source: 'order' });
    await insert({ user_id: user, source: 'subscription', expires_at: '2999-01-01' });
    for (const revoke_reason of [
      'refund',
      'chargeback',
      'subscription_ended',
      'manual',
      'recalculation',
      'account_deleted',
    ]) {
      await insert({ user_id: user, revoked_at: new Date().toISOString(), revoke_reason });
    }
  });

  test('restrições recusam valores fora da spec', async () => {
    const user = await insertUser();
    const cases: [Partial<Fields>, string][] = [
      [{ product_type: 'lesson' }, 'entitlements_product_type_valid'],
      [{ source: 'gift' }, 'entitlements_source_valid'],
      [
        { revoked_at: new Date().toISOString(), revoke_reason: 'expired' },
        'entitlements_revoke_reason_valid',
      ],
      [{ revoked_at: new Date().toISOString() }, 'entitlements_revoked_together'],
      [{ revoke_reason: 'manual' }, 'entitlements_revoked_together'],
      [{ granted_reason: null }, 'entitlements_granted_reason_matches_source'],
      [{ source: 'order', granted_reason: 'x' }, 'entitlements_granted_reason_matches_source'],
      [{ granted_reason: '   ' }, 'entitlements_granted_reason_length'],
      [{ granted_reason: 'a'.repeat(501) }, 'entitlements_granted_reason_length'],
      [
        { starts_at: '2030-01-02T00:00:00Z', expires_at: '2030-01-01T00:00:00Z' },
        'entitlements_expires_after_starts',
      ],
      [
        { starts_at: '2030-01-01T00:00:00Z', expires_at: '2030-01-01T00:00:00Z' },
        'entitlements_expires_after_starts',
      ],
    ];
    await insert({ user_id: user, granted_reason: 'a'.repeat(500) });
    for (const [fields, constraint] of cases) {
      await rejects({ user_id: user, ...fields }, constraint);
    }
    await assert.rejects(
      insert({ user_id: randomUUID() }),
      (error: { constraint?: string }) => error.constraint === 'entitlements_user_id_fkey',
    );
  });

  test('cascade exige pai do mesmo usuário e da mesma fonte; raiz não tem pai', async () => {
    const user = await insertUser();
    const other = await insertUser();
    const root = await insert({ user_id: user, product_type: 'bundle' });
    const child = await insert({
      user_id: user,
      source: 'cascade',
      source_id: root.source_id,
      parent_entitlement_id: root.id,
    });
    // Curso vindo do pacote libera o ebook (profundidade 2).
    await insert({
      user_id: user,
      product_type: 'ebook',
      source: 'cascade',
      source_id: root.source_id,
      parent_entitlement_id: child.id,
    });

    await rejects(
      { user_id: user, source: 'cascade', source_id: root.source_id },
      'entitlements_parent_matches_source',
    );
    await rejects(
      { user_id: user, parent_entitlement_id: root.id, source_id: root.source_id },
      'entitlements_parent_matches_source',
    );
    await rejects(
      {
        user_id: user,
        product_type: 'bundle',
        source: 'cascade',
        source_id: root.source_id,
        parent_entitlement_id: root.id,
      },
      'entitlements_cascade_product_type',
    );
    // Outro dono ou outro source_id não casam com a chave composta do pai.
    await rejects(
      {
        user_id: other,
        source: 'cascade',
        source_id: root.source_id,
        parent_entitlement_id: root.id,
      },
      'entitlements_parent_entitlement_id_fkey',
    );
    await rejects(
      { user_id: user, source: 'cascade', parent_entitlement_id: root.id },
      'entitlements_parent_entitlement_id_fkey',
    );
    await rejects(
      {
        user_id: user,
        source: 'cascade',
        source_id: root.source_id,
        parent_entitlement_id: randomUUID(),
      },
      'entitlements_parent_entitlement_id_fkey',
    );
  });

  test('idempotência: a mesma raiz ou o mesmo derivado ativo não se repete', async () => {
    const user = await insertUser();
    const root = { user_id: user, source_id: randomUUID(), product_id: randomUUID() };
    const first = await insert(root);
    await rejects(root, 'entitlements_idempotency_unique');

    const child = {
      user_id: user,
      product_type: 'ebook',
      product_id: randomUUID(),
      source: 'cascade',
      source_id: root.source_id,
      parent_entitlement_id: first.id,
    };
    await insert(child);
    await rejects(child, 'entitlements_idempotency_unique');

    // O mesmo ebook sob outra raiz é outro direito (cada raiz tem a própria árvore).
    const otherRoot = await insert({ user_id: user, source_id: root.source_id });
    await insert({ ...child, parent_entitlement_id: otherRoot.id });

    // Revogado, o mesmo direito pode ser concedido de novo.
    await query(
      `UPDATE entitlements SET revoked_at = now(), revoke_reason = 'manual'
        WHERE id = $1 OR parent_entitlement_id = $1`,
      [first.id],
    );
    const again = await insert(root);
    await insert({ ...child, parent_entitlement_id: again.id });
    await rejects(root, 'entitlements_idempotency_unique');
  });

  test('apagar a raiz apaga a árvore; apagar o usuário apaga os direitos', async () => {
    const user = await insertUser();
    const root = await insert({ user_id: user });
    await insert({
      user_id: user,
      product_type: 'ebook',
      source: 'cascade',
      source_id: root.source_id,
      parent_entitlement_id: root.id,
    });
    const count = async () =>
      (await query('SELECT count(*)::int AS n FROM entitlements WHERE user_id = $1', [user]))
        .rows[0].n;
    await query('DELETE FROM entitlements WHERE id = $1', [root.id]);
    assert.equal(await count(), 0);

    await insert({ user_id: user });
    await query('DELETE FROM users WHERE id = $1', [user]);
    assert.equal(await count(), 0);
  });

  test('índices da verificação, da árvore, da fonte e da idempotência', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'entitlements'`,
    );
    const defs = new Map(rows.map((row) => [row.indexname, row.indexdef as string]));
    assert.match(
      defs.get('entitlements_user_product_idx') ?? '',
      /\(user_id, product_type, product_id\)/,
    );
    assert.match(defs.get('entitlements_parent_idx') ?? '', /\(parent_entitlement_id\)/);
    assert.match(defs.get('entitlements_source_idx') ?? '', /\(source, source_id\)/);
    const idempotency = defs.get('entitlements_idempotency_unique') ?? '';
    assert.match(
      idempotency,
      /UNIQUE INDEX .*\(user_id, source, source_id, product_type, product_id, parent_entitlement_id\) NULLS NOT DISTINCT WHERE \(revoked_at IS NULL\)/,
    );
  });
});
