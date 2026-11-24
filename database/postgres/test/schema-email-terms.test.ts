import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, unique } from './helpers.ts';

const dir = defaultMigrationsDir;
const published = { code: 'P0001', message: 'terms_versions publicada é imutável' };

describe('0007: fila de e-mails e termos', () => {
  let db: Scratch;
  let user: string;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 7 });
    user = await insertUser();
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

  function insertEmail(fields: Record<string, string> = {}) {
    return query(
      `INSERT INTO email_outbox (user_id, "to", type, data, status, attempts, sent_at)
       VALUES ($1, ${fields.to ?? `'pessoa@example.com'`}, ${fields.type ?? `'account.verify_email'`},
               ${fields.data ?? `'{}'`}, ${fields.status ?? `'queued'`}, ${fields.attempts ?? '0'},
               ${fields.sentAt ?? 'NULL'})
       RETURNING id, subject, last_error, created_at <= now() AS past`,
      [fields.userId ?? user],
    );
  }

  /** Cria um rascunho; com `version`, já o publica. */
  async function insertTerms(document = 'terms', version?: number): Promise<string> {
    const { rows } = await query(
      `INSERT INTO terms_versions (document, body_md) VALUES ($1, '# Termos') RETURNING id`,
      [document],
    );
    const id = rows[0].id;
    if (version !== undefined) {
      await publish(id, version);
    }
    return id;
  }

  function publish(id: string, version: number) {
    return query(
      `UPDATE terms_versions SET version = $2, effective_at = now(), published_at = now()
        WHERE id = $1`,
      [id, version],
    );
  }

  test('down e up da 0007 removem e recriam as três tabelas e a função', async () => {
    const objects = async () =>
      (
        await query(
          `SELECT tablename AS name FROM pg_tables
            WHERE tablename IN ('email_outbox', 'terms_versions', 'terms_acceptances')
           UNION ALL SELECT proname FROM pg_proc WHERE proname = 'terms_versions_guard_published'
           ORDER BY 1`,
        )
      ).rows.map((row) => row.name);
    const full = await objects();
    assert.deepEqual(full, [
      'email_outbox',
      'terms_acceptances',
      'terms_versions',
      'terms_versions_guard_published',
    ]);
    await migrateDown(db.client, { dir });
    assert.deepEqual(await objects(), []);
    await migrateUp(db.client, { dir, to: 7 });
    assert.deepEqual(await objects(), full);
  });

  test('email_outbox: padrões, subject nulo até o envio e restrições', async () => {
    const { rows } = await insertEmail();
    assert.deepEqual(
      { subject: rows[0].subject, lastError: rows[0].last_error, past: rows[0].past },
      { subject: null, lastError: null, past: true },
    );
    const { rows: defaults } = await query(
      'SELECT status, attempts, data, sent_at FROM email_outbox WHERE id = $1',
      [rows[0].id],
    );
    assert.deepEqual(defaults, [{ status: 'queued', attempts: 0, data: {}, sent_at: null }]);

    await insertEmail({ status: `'sent'`, sentAt: 'now()' });
    await insertEmail({ status: `'failed'`, attempts: '5' });
    await insertEmail({ type: `'moderation.suspended'`, data: `'{"kind": "full"}'` });
    const cases: [Record<string, string>, string][] = [
      [{ status: `'sending'` }, 'email_outbox_status_valid'],
      [{ type: `'verify_email'` }, 'email_outbox_type_format'],
      [{ type: `'Account.exists'` }, 'email_outbox_type_format'],
      [{ to: `' '` }, 'email_outbox_to_not_empty'],
      [{ data: `'[1]'` }, 'email_outbox_data_object'],
      [{ attempts: '-1' }, 'email_outbox_attempts_range'],
      [{ status: `'sent'` }, 'email_outbox_sent_at_matches_status'],
      [{ sentAt: 'now()' }, 'email_outbox_sent_at_matches_status'],
      [{ status: `'failed'`, sentAt: 'now()' }, 'email_outbox_sent_at_matches_status'],
    ];
    for (const [fields, constraint] of cases) {
      await assert.rejects(insertEmail(fields), { code: '23514', constraint }, constraint);
    }
    await assert.rejects(insertEmail({ userId: '0192f0c1-0000-7000-8000-0000000000ee' }), {
      code: '23503',
      constraint: 'email_outbox_user_id_fkey',
    });

    // Ciclo do worker: monta (assunto), envia; e o "reenviar" de uma falha.
    const id = rows[0].id;
    await query(
      `UPDATE email_outbox SET subject = 'Confirme seu e-mail', status = 'sent', sent_at = now(),
              attempts = attempts + 1 WHERE id = $1`,
      [id],
    );
    const { rows: failed } = await insertEmail({ status: `'failed'`, attempts: '5' });
    await query(
      `UPDATE email_outbox SET status = 'queued', attempts = 0, last_error = NULL WHERE id = $1`,
      [failed[0].id],
    );
  });

  test('email_outbox: índices da tela de operação, do expurgo e do usuário', async () => {
    const { rows } = await query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'email_outbox'
        ORDER BY indexname`,
    );
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    assert.deepEqual(Object.keys(defs), [
      'email_outbox_pkey',
      'email_outbox_sent_at_idx',
      'email_outbox_status_created_idx',
      'email_outbox_user_created_idx',
    ]);
    assert.match(defs.email_outbox_status_created_idx, /\(status, created_at\)$/);
    assert.match(defs.email_outbox_sent_at_idx, /\(sent_at\) WHERE \(status = 'sent'::text\)$/);
    assert.match(defs.email_outbox_user_created_idx, /\(user_id, created_at\)$/);

    await query(
      `INSERT INTO email_outbox (user_id, "to", type, status, sent_at, created_at)
       SELECT $1, 'massa@example.com', 'account.new_login', 'sent', now() - make_interval(secs => g),
              now() - make_interval(secs => g)
         FROM generate_series(1, 5000) AS g`,
      [user],
    );
    await query('ANALYZE email_outbox');
    const plan = async (sql: string) =>
      (await query(`EXPLAIN ${sql}`)).rows.map((row) => row['QUERY PLAN']).join('\n');
    assert.match(
      await plan(
        `SELECT id FROM email_outbox WHERE status IN ('queued', 'failed') ORDER BY created_at`,
      ),
      /email_outbox_status_created_idx/,
    );
    assert.match(
      await plan(
        `SELECT id FROM email_outbox WHERE status = 'sent' AND sent_at < now() - interval '30 days'`,
      ),
      /email_outbox_sent_at_idx/,
    );
  });

  test('terms_versions: rascunho sem número, publicação amarra version e datas', async () => {
    const draft = await insertTerms('privacy');
    const { rows } = await query(
      `SELECT version, effective_at, published_at, requires_reacceptance,
              uuid_extract_version(id) AS v FROM terms_versions WHERE id = $1`,
      [draft],
    );
    assert.deepEqual(rows, [
      { version: null, effective_at: null, published_at: null, requires_reacceptance: false, v: 7 },
    ]);
    const cases: [string, string][] = [
      ['version = 1', 'terms_versions_publication_matches_version'],
      ['published_at = now()', 'terms_versions_publication_matches_version'],
      ['version = 1, published_at = now()', 'terms_versions_publication_matches_version'],
      [
        'version = 0, published_at = now(), effective_at = now()',
        'terms_versions_version_positive',
      ],
      [`document = 'cookies'`, 'terms_versions_document_valid'],
      [`body_md = ''`, 'terms_versions_body_md_length'],
      [`body_md = repeat('a', 100001)`, 'terms_versions_body_md_length'],
    ];
    for (const [set, constraint] of cases) {
      await assert.rejects(
        query(`UPDATE terms_versions SET ${set} WHERE id = $1`, [draft]),
        { code: '23514', constraint },
        set,
      );
    }
    await query(`UPDATE terms_versions SET body_md = repeat('a', 100000) WHERE id = $1`, [draft]);
    await publish(draft, 1);
  });

  test('versão publicada é imutável: UPDATE e DELETE recusados; rascunho pode ser apagado', async () => {
    const id = await insertTerms('terms', 1);
    for (const set of [
      `body_md = 'outro texto'`,
      'requires_reacceptance = true',
      'effective_at = now()',
      'version = 2',
      'version = NULL, effective_at = NULL, published_at = NULL',
    ]) {
      await assert.rejects(
        query(`UPDATE terms_versions SET ${set} WHERE id = $1`, [id]),
        published,
        set,
      );
    }
    await assert.rejects(query('DELETE FROM terms_versions WHERE id = $1', [id]), published);
    const { rows } = await query('SELECT body_md, version FROM terms_versions WHERE id = $1', [id]);
    assert.deepEqual(rows, [{ body_md: '# Termos', version: 1 }]);

    const draft = await insertTerms('terms');
    const { rowCount } = await query('DELETE FROM terms_versions WHERE id = $1', [draft]);
    assert.equal(rowCount, 1);
  });

  test('duas versões publicadas com o mesmo número no mesmo documento são recusadas', async () => {
    await insertTerms('terms', 2);
    const other = await insertTerms('terms');
    await assert.rejects(publish(other, 2), {
      code: '23505',
      constraint: 'terms_versions_document_version_unique',
    });
    // O mesmo número em outro documento é aceito, e rascunhos convivem sem número.
    await insertTerms('privacy', 2);
    await insertTerms('terms');
    await insertTerms('terms');
    await publish(other, 3);

    const { rows } = await query(
      `SELECT version FROM terms_versions WHERE document = 'terms' AND version IS NOT NULL
        ORDER BY version DESC LIMIT 1`,
    );
    assert.deepEqual(rows, [{ version: 3 }]);
  });

  test('terms_acceptances: um aceite por usuário e versão, IP e navegador opcionais', async () => {
    const version = await insertTerms('privacy', 10);
    const other = await insertUser();
    const accept = (userId: string, ip: string | null = '203.0.113.5') =>
      query(
        `INSERT INTO terms_acceptances (user_id, terms_version_id, ip, user_agent)
         VALUES ($1, $2, $3, 'Firefox') RETURNING accepted_at <= now() AS past`,
        [userId, version, ip],
      );
    const { rows } = await accept(user);
    assert.deepEqual(rows, [{ past: true }]);
    await accept(other, null);
    await assert.rejects(accept(user), {
      code: '23505',
      constraint: 'terms_acceptances_user_version_unique',
    });
    // Aceitar de novo não duplica.
    const again = await query(
      `INSERT INTO terms_acceptances (user_id, terms_version_id) VALUES ($1, $2)
       ON CONFLICT (user_id, terms_version_id) DO NOTHING`,
      [user, version],
    );
    assert.equal(again.rowCount, 0);
    await assert.rejects(
      query('INSERT INTO terms_acceptances (user_id, terms_version_id) VALUES ($1, uuidv7())', [
        user,
      ]),
      { code: '23503', constraint: 'terms_acceptances_terms_version_id_fkey' },
    );
    await assert.rejects(
      query('INSERT INTO terms_acceptances (user_id, terms_version_id) VALUES (uuidv7(), $1)', [
        version,
      ]),
      { code: '23503', constraint: 'terms_acceptances_user_id_fkey' },
    );
    // Anonimização da exclusão de conta: o aceite fica sem IP nem navegador.
    await query('UPDATE terms_acceptances SET ip = NULL, user_agent = NULL WHERE user_id = $1', [
      user,
    ]);

    // Rascunho aceito por engano não pode ser apagado por baixo do aceite.
    const draft = await insertTerms('terms');
    await query('INSERT INTO terms_acceptances (user_id, terms_version_id) VALUES ($1, $2)', [
      user,
      draft,
    ]);
    await assert.rejects(query('DELETE FROM terms_versions WHERE id = $1', [draft]), {
      code: '23503',
      constraint: 'terms_acceptances_terms_version_id_fkey',
    });
  });
});
