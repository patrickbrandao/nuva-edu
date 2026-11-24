import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, unique } from './helpers.ts';

const dir = defaultMigrationsDir;
const hash = () => `encode(sha256(uuidv7()::text::bytea), 'hex')`;

describe('0005: contas, sessões e suspensões', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 5 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  async function insertUser(fields: Record<string, unknown> = {}): Promise<string> {
    const row: Record<string, unknown> = {
      email: `u${unique()}@example.com`,
      name: 'Pessoa',
      ...fields,
    };
    const columns = Object.keys(row);
    const { rows } = await query(
      `INSERT INTO users (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return rows[0].id;
  }

  test('down e up da 0005 voltam ao mesmo esquema', async () => {
    const tables = async () =>
      (
        await query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        )
      ).rows.map((row) => row.tablename);
    const full = await tables();
    await migrateDown(db.client, { dir });
    const without = await tables();
    for (const table of [
      'users',
      'profiles',
      'oauth_identities',
      'sessions',
      'email_tokens',
      'login_attempts',
      'user_devices',
      'user_suspensions',
    ]) {
      assert.ok(full.includes(table), table);
      assert.ok(!without.includes(table), table);
    }
    const { rows: fk } = await query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'images_owner_user_id_fkey'`,
    );
    assert.equal(fk.length, 0);
    await migrateUp(db.client, { dir, to: 5 });
    assert.deepEqual(await tables(), full);
  });

  test('users: padrões de papel, versão, UUID v7 e updated_at pelo gatilho', async () => {
    const id = await insertUser();
    const { rows } = await query(
      `SELECT role, version, password, uuid_extract_version(id) AS v, created_at = updated_at AS same
         FROM users WHERE id = $1`,
      [id],
    );
    assert.deepEqual(rows, [{ role: 'student', version: 1, password: null, v: 7, same: true }]);
    await query(
      `UPDATE users SET created_at = now() - interval '1 hour', updated_at = created_at
        WHERE id = $1`,
      [id],
    );
    await query(`UPDATE users SET name = 'Outra' WHERE id = $1`, [id]);
    const { rows: changed } = await query(
      `SELECT updated_at > created_at AS moved FROM users WHERE id = $1`,
      [id],
    );
    assert.deepEqual(changed, [{ moved: true }]);
  });

  test('users: senha de 8 a 128 caracteres ou nula', async () => {
    await insertUser({ password: '12345678' });
    await insertUser({ password: 'a'.repeat(128) });
    await insertUser({ password: null });
    for (const [password, label] of [
      ['1234567', '7 caracteres'],
      ['a'.repeat(129), '129 caracteres'],
      ['', 'vazia'],
    ]) {
      await assert.rejects(
        insertUser({ password }),
        { code: '23514', constraint: 'users_password_length' },
        label,
      );
    }
  });

  test('users: e-mail único entre os ativos e reaproveitado depois de deleted_at', async () => {
    const email = `repetido${unique()}@example.com`;
    const first = await insertUser({ email });
    await assert.rejects(insertUser({ email }), {
      code: '23505',
      constraint: 'users_email_active_unique',
    });
    await query('UPDATE users SET deleted_at = now() WHERE id = $1', [first]);
    const second = await insertUser({ email });
    assert.notEqual(second, first);
    // Duas excluídas com o mesmo e-mail convivem.
    await query('UPDATE users SET deleted_at = now() WHERE id = $1', [second]);
    await insertUser({ email });
  });

  test('users: e-mail normalizado, nome, papel, suspensão e documento', async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ email: 'Maiuscula@example.com' }, 'users_email_normalized', 'maiúscula'],
      [{ email: ' a@example.com' }, 'users_email_normalized', 'espaço na ponta'],
      [{ email: '' }, 'users_email_normalized', 'vazio'],
      [{ name: '  ' }, 'users_name_not_empty', 'nome em branco'],
      [{ role: 'owner' }, 'users_role_valid', 'papel desconhecido'],
      [{ role: 'Admin' }, 'users_role_valid', 'papel com maiúscula'],
      [
        { suspended_at: new Date(), suspended_kind: 'ban' },
        'users_suspended_kind_valid',
        'tipo de suspensão desconhecido',
      ],
      [{ suspended_at: new Date() }, 'users_suspension_matches_suspended_at', 'sem tipo'],
      [{ suspended_kind: 'full' }, 'users_suspension_matches_suspended_at', 'sem data'],
      [{ suspended_reason: 'x' }, 'users_suspension_matches_suspended_at', 'motivo sem suspensão'],
      [{ tax_id_type: 'rg', tax_id: '1' }, 'users_tax_id_type_valid', 'documento desconhecido'],
      [{ tax_id_type: 'cpf' }, 'users_tax_id_matches_type', 'tipo sem número'],
      [{ tax_id: '12345678901' }, 'users_tax_id_matches_type', 'número sem tipo'],
      [{ version: 0 }, 'users_version_positive', 'versão zero'],
    ];
    for (const [fields, constraint, label] of cases) {
      await assert.rejects(insertUser(fields), { code: '23514', constraint }, label);
    }
    for (const role of ['student', 'instructor', 'manager', 'admin']) {
      await insertUser({ role });
    }
    const admin = await insertUser({ role: 'admin' });
    for (const kind of ['posting', 'full']) {
      await insertUser({
        suspended_at: new Date(),
        suspended_kind: kind,
        suspended_reason: 'spam',
        suspended_by: admin,
      });
    }
    await insertUser({ tax_id_type: 'cpf', tax_id: '12345678901' });
    await insertUser({ tax_id_type: 'cnpj', tax_id: '12ABC34501DE35' });
    await assert.rejects(
      insertUser({
        suspended_at: new Date(),
        suspended_kind: 'full',
        suspended_by: '0192f0c1-0000-7000-8000-0000000000aa',
      }),
      { code: '23503', constraint: 'users_suspended_by_fkey' },
    );
  });

  test('users: índices de e-mail e de busca trigram', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users' ORDER BY indexname`,
    );
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(Object.keys(defs), [
      'users_email_active_unique',
      'users_email_trgm_idx',
      'users_name_trgm_idx',
      'users_pkey',
    ]);
    assert.match(defs.users_email_active_unique, /UNIQUE .*\(email\) WHERE \(deleted_at IS NULL\)/);
    assert.match(defs.users_name_trgm_idx, /USING gin \(name gin_trgm_ops\)/);
    assert.match(defs.users_email_trgm_idx, /USING gin \(email gin_trgm_ops\)/);

    await query(
      `INSERT INTO users (email, name)
       SELECT md5(g::text) || '@example.com', 'Aluno ' || md5(g::text)
         FROM generate_series(1, 20000) AS g`,
    );
    await query('VACUUM ANALYZE users');
    // Busca seletiva: o índice trigram atende ao ILIKE com curinga dos dois lados.
    const sample = (await query(`SELECT substr(md5('2987'), 5, 12) AS term`)).rows[0].term;
    for (const [column, term] of [
      ['name', sample],
      ['email', sample],
    ]) {
      const { rows: plan } = await query(
        `EXPLAIN SELECT id FROM users WHERE ${column} ILIKE '%' || '${term}' || '%'`,
      );
      assert.match(
        plan.map((row) => row['QUERY PLAN']).join('\n'),
        new RegExp(`users_${column}_trgm_idx`),
      );
    }
  });

  test('profiles: chave é o usuário, avatar anulado quando a imagem some', async () => {
    const user = await insertUser();
    const { rows: image } = await query(
      `INSERT INTO images (owner_user_id, purpose, original_width, original_height)
       VALUES ($1, 'avatar', 10, 10) RETURNING id`,
      [user],
    );
    const imageId = image[0].id;
    await query('INSERT INTO profiles (user_id, avatar_image_id) VALUES ($1, $2)', [user, imageId]);
    await assert.rejects(query('INSERT INTO profiles (user_id) VALUES ($1)', [user]), {
      code: '23505',
      constraint: 'profiles_pkey',
    });
    await assert.rejects(
      query('INSERT INTO profiles (user_id) VALUES ($1)', ['0192f0c1-0000-7000-8000-0000000000bb']),
      { code: '23503', constraint: 'profiles_user_id_fkey' },
    );
    await assert.rejects(
      query('UPDATE profiles SET avatar_image_id = $2 WHERE user_id = $1', [
        user,
        '0192f0c1-0000-7000-8000-0000000000bc',
      ]),
      { code: '23503', constraint: 'profiles_avatar_image_id_fkey' },
    );
    await query('DELETE FROM images WHERE id = $1', [imageId]);
    const { rows } = await query('SELECT avatar_image_id FROM profiles WHERE user_id = $1', [user]);
    assert.deepEqual(rows, [{ avatar_image_id: null }]);
  });

  test('images: dono precisa existir em users', async () => {
    await assert.rejects(
      query(
        `INSERT INTO images (owner_user_id, purpose, original_width, original_height)
         VALUES ($1, 'avatar', 10, 10)`,
        ['0192f0c1-0000-7000-8000-0000000000cc'],
      ),
      { code: '23503', constraint: 'images_owner_user_id_fkey' },
    );
  });

  test('oauth_identities: provedor válido e identidade única por provedor', async () => {
    const user = await insertUser();
    const other = await insertUser();
    const sub = `sub-${unique()}`;
    const insert = (userId: string, provider: string, providerUserId = sub) =>
      query(
        `INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)`,
        [userId, provider, providerUserId],
      );
    for (const provider of ['google', 'facebook', 'apple']) {
      await insert(user, provider);
    }
    await assert.rejects(insert(other, 'google'), {
      code: '23505',
      constraint: 'oauth_identities_provider_user_unique',
    });
    await assert.rejects(insert(other, 'github', 'x'), {
      code: '23514',
      constraint: 'oauth_identities_provider_valid',
    });
    await assert.rejects(insert(other, 'google', ''), {
      code: '23514',
      constraint: 'oauth_identities_provider_user_id_not_empty',
    });
    const { rows } = await query(
      'SELECT email_verified FROM oauth_identities WHERE user_id = $1 LIMIT 1',
      [user],
    );
    assert.deepEqual(rows, [{ email_verified: false }]);
  });

  test('sessions: hash único, site válido, expiração e índices', async () => {
    const user = await insertUser();
    const insert = (fields: Record<string, string> = {}) =>
      query(
        `INSERT INTO sessions (id_hash, user_id, site, ip, csrf_token, expires_at)
         VALUES (${fields.id_hash ?? hash()}, $1, ${fields.site ?? `'classroom'`}, '203.0.113.7',
                 ${fields.csrf ?? `'csrf'`}, ${fields.expires ?? `now() + interval '30 days'`})
         RETURNING id, id_hash`,
        [user],
      );
    const { rows } = await insert();
    await insert({ site: `'admin'` });
    await assert.rejects(insert({ id_hash: `'${rows[0].id_hash}'` }), {
      code: '23505',
      constraint: 'sessions_id_hash_unique',
    });
    const cases: [Record<string, string>, string][] = [
      [{ site: `'mcp'` }, 'sessions_site_valid'],
      [{ id_hash: `'abc'` }, 'sessions_id_hash_format'],
      [{ id_hash: `upper(${hash()})` }, 'sessions_id_hash_format'],
      [{ csrf: `''` }, 'sessions_csrf_token_not_empty'],
      [{ expires: `now() - interval '1 second'` }, 'sessions_expires_after_created'],
    ];
    for (const [fields, constraint] of cases) {
      await assert.rejects(insert(fields), { code: '23514', constraint }, constraint);
    }
    const { rows: indexes } = await query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'sessions' ORDER BY indexname`,
    );
    assert.deepEqual(
      indexes.map((row) => row.indexname),
      ['sessions_expires_at_idx', 'sessions_id_hash_unique', 'sessions_pkey', 'sessions_user_idx'],
    );
  });

  test('email_tokens: propósito, hash e índices de uso e expurgo', async () => {
    const user = await insertUser();
    const insert = (purpose: string, tokenHash = hash()) =>
      query(
        `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
         VALUES (${tokenHash}, $1, $2, now() + interval '24 hours') RETURNING token_hash`,
        [user, purpose],
      );
    const { rows } = await insert('verify');
    await insert('reset');
    await assert.rejects(insert('verify', `'${rows[0].token_hash}'`), {
      code: '23505',
      constraint: 'email_tokens_token_hash_unique',
    });
    await assert.rejects(insert('login'), {
      code: '23514',
      constraint: 'email_tokens_purpose_valid',
    });
    await assert.rejects(insert('reset', `'x'`), {
      code: '23514',
      constraint: 'email_tokens_token_hash_format',
    });
    const { rows: indexes } = await query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'email_tokens'
        ORDER BY indexname`,
    );
    const defs = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));
    assert.match(
      defs.email_tokens_user_purpose_idx,
      /\(user_id, purpose\) WHERE \(used_at IS NULL\)/,
    );
    assert.ok(defs.email_tokens_expires_at_idx);
  });

  test('login_attempts: e-mail normalizado, site válido e índices da janela de bloqueio', async () => {
    const insert = (email: string, site = 'classroom') =>
      query(
        `INSERT INTO login_attempts (email, ip, success, site) VALUES ($1, '198.51.100.1', false, $2)`,
        [email, site],
      );
    await insert('ninguem@example.com');
    await insert('ninguem@example.com', 'admin');
    await assert.rejects(insert('Ninguem@example.com'), {
      code: '23514',
      constraint: 'login_attempts_email_normalized',
    });
    await assert.rejects(insert('a@example.com', 'mcp'), {
      code: '23514',
      constraint: 'login_attempts_site_valid',
    });
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'login_attempts'
        ORDER BY indexname`,
    );
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    assert.match(defs.login_attempts_email_created_idx, /\(email, created_at\)$/);
    assert.match(defs.login_attempts_ip_created_idx, /\(ip, created_at\)$/);
    assert.match(defs.login_attempts_created_at_idx, /\(created_at\)$/);
  });

  test('user_devices: um registro por dispositivo da conta', async () => {
    const user = await insertUser();
    const other = await insertUser();
    const insert = (userId: string, key: string) =>
      query('INSERT INTO user_devices (user_id, device_key) VALUES ($1, $2)', [userId, key]);
    await insert(user, 'Chrome|macOS');
    await insert(user, 'Firefox|Linux');
    await insert(other, 'Chrome|macOS');
    await assert.rejects(insert(user, 'Chrome|macOS'), {
      code: '23505',
      constraint: 'user_devices_user_device_unique',
    });
    await assert.rejects(insert(user, ''), {
      code: '23514',
      constraint: 'user_devices_device_key_not_empty',
    });
  });

  test('apagar o usuário leva perfil, identidades, sessões, tokens e dispositivos', async () => {
    const user = await insertUser();
    await query('INSERT INTO profiles (user_id) VALUES ($1)', [user]);
    await query(
      `INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, 'apple', $2)`,
      [user, `apple-${unique()}`],
    );
    await query(
      `INSERT INTO sessions (id_hash, user_id, site, ip, csrf_token, expires_at)
       VALUES (${hash()}, $1, 'admin', '::1', 'c', now() + interval '1 day')`,
      [user],
    );
    await query(
      `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
       VALUES (${hash()}, $1, 'reset', now() + interval '1 day')`,
      [user],
    );
    await query(`INSERT INTO user_devices (user_id, device_key) VALUES ($1, 'Safari|iOS')`, [user]);
    await query('DELETE FROM users WHERE id = $1', [user]);
    for (const table of [
      'profiles',
      'oauth_identities',
      'sessions',
      'email_tokens',
      'user_devices',
    ]) {
      const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [
        user,
      ]);
      assert.equal(rows[0].n, 0, table);
    }
  });

  test('user_suspensions: tipo, prazo, autor e índice do suspension.expire', async () => {
    const user = await insertUser();
    const admin = await insertUser({ role: 'admin' });
    const insert = (fields: Record<string, string> = {}) =>
      query(
        `INSERT INTO user_suspensions (user_id, kind, reason, ends_at, lifted_at, created_by)
         VALUES ($1, ${fields.kind ?? `'full'`}, ${fields.reason ?? `'spam'`},
                 ${fields.ends ?? `now() + interval '7 days'`}, ${fields.lifted ?? 'NULL'}, $2)`,
        [user, fields.createdBy ?? admin],
      );
    await insert();
    await insert({ kind: `'posting'`, ends: 'NULL' });
    await insert({ lifted: 'now()' });
    const cases: [Record<string, string>, string][] = [
      [{ kind: `'ban'` }, 'user_suspensions_kind_valid'],
      [{ reason: `' '` }, 'user_suspensions_reason_not_empty'],
      [{ ends: `now() - interval '1 day'` }, 'user_suspensions_ends_after_starts'],
      [{ lifted: `now() - interval '1 day'` }, 'user_suspensions_lifted_after_starts'],
    ];
    for (const [fields, constraint] of cases) {
      await assert.rejects(insert(fields), { code: '23514', constraint }, constraint);
    }
    await assert.rejects(insert({ createdBy: '0192f0c1-0000-7000-8000-0000000000dd' }), {
      code: '23503',
      constraint: 'user_suspensions_created_by_fkey',
    });
    // Histórico de terceiros: o usuário suspenso não pode ser apagado por baixo dele.
    await assert.rejects(query('DELETE FROM users WHERE id = $1', [user]), {
      code: '23503',
      constraint: 'user_suspensions_user_id_fkey',
    });

    const { rows } = await query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'user_suspensions_expire_idx'`,
    );
    assert.match(
      rows[0].indexdef,
      /\(ends_at\) WHERE \(\(lifted_at IS NULL\) AND \(ends_at IS NOT NULL\)\)/,
    );
  });
});
