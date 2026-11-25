import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;
const tables = [
  'certificate_template_versions',
  'certificate_templates',
  'certificates',
  'certificate_previews',
];
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

describe('0012: certificados e templates', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 12 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  async function insertRow(table: string, row: Record<string, unknown>) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      Object.values(row),
    );
    return rows[0];
  }

  async function rejects(promise: Promise<unknown>, constraint: string) {
    await assert.rejects(promise, (error: { constraint?: string }) => {
      assert.equal(error.constraint, constraint);
      return true;
    });
  }

  async function insertUser(): Promise<string> {
    return (await insertRow('users', { email: `u${unique()}@example.com`, name: 'Pessoa' })).id;
  }

  async function insertCourse(): Promise<string> {
    return (await insertRow('courses', { slug: `curso-${unique()}`, title: 'Curso' })).id;
  }

  async function insertVersion(courseId: string | null, by: string): Promise<string> {
    return (
      await insertRow('certificate_template_versions', {
        course_id: courseId,
        html: '<p>{{aluno.nome}}</p>',
        created_by: by,
      })
    ).id;
  }

  function code(): string {
    let out = '';
    for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  async function insertCertificate(fields: Record<string, unknown> = {}) {
    const user = (fields.user_id as string | undefined) ?? (await insertUser());
    const course = (fields.course_id as string | undefined) ?? (await insertCourse());
    const version =
      (fields.template_version_id as string | undefined) ??
      (await insertVersion(course, await insertUser()));
    return insertRow('certificates', {
      user_id: user,
      course_id: course,
      code: code(),
      student_name: 'Maria Exemplo',
      course_title: 'Curso',
      hours: 12,
      completed_at: new Date(),
      school_name: 'Escola',
      template_version_id: version,
      ...fields,
    });
  }

  test('down e up da 0012 removem e recriam as tabelas', async () => {
    for (const table of tables) assert.equal(await tableExists(db.client, table), true);
    await migrateDown(db.client, { dir });
    for (const table of tables) assert.equal(await tableExists(db.client, table), false);
    assert.equal(await tableExists(db.client, 'notes'), true);
    const { rows } = await query(
      `SELECT 1 FROM pg_proc WHERE proname = 'certificate_template_versions_guard_update'`,
    );
    assert.equal(rows.length, 0);
    await migrateUp(db.client, { dir, to: 12 });
    for (const table of tables) assert.equal(await tableExists(db.client, table), true);
  });

  describe('certificate_template_versions', () => {
    test('UPDATE é recusado; o SET NULL da exclusão do curso passa', async () => {
      const user = await insertUser();
      const course = await insertCourse();
      const id = await insertVersion(course, user);
      const { rows: v } = await query('SELECT uuid_extract_version($1::uuid) AS v', [id]);
      assert.equal(v[0].v, 7);
      await assert.rejects(
        query(`UPDATE certificate_template_versions SET html = '<p>x</p>' WHERE id = $1`, [id]),
        /imutável/,
      );
      await assert.rejects(
        query(
          'UPDATE certificate_template_versions SET course_id = NULL, html = $2 WHERE id = $1',
          [id, '<p>y</p>'],
        ),
        /imutável/,
      );
      await query('DELETE FROM courses WHERE id = $1', [course]);
      const { rows } = await query(
        'SELECT course_id, html FROM certificate_template_versions WHERE id = $1',
        [id],
      );
      assert.deepEqual(rows[0], { course_id: null, html: '<p>{{aluno.nome}}</p>' });
    });

    test('html até 768 KiB em bytes e não vazio', async () => {
      const user = await insertUser();
      // 'é' ocupa 2 bytes: 393216 caracteres = 786432 bytes, no limite.
      await insertRow('certificate_template_versions', {
        html: 'é'.repeat(393216),
        created_by: user,
      });
      for (const html of [`${'é'.repeat(393216)}a`, '']) {
        await rejects(
          insertRow('certificate_template_versions', { html, created_by: user }),
          'certificate_template_versions_html_size',
        );
      }
      await rejects(
        insertRow('certificate_template_versions', { html: '<p></p>', created_by: randomUUID() }),
        'certificate_template_versions_created_by_fkey',
      );
    });

    test('versão usada por certificado ou template não é apagada; sem uso, é', async () => {
      const cert = await insertCertificate();
      await rejects(
        query('DELETE FROM certificate_template_versions WHERE id = $1', [
          cert.template_version_id,
        ]),
        'certificates_template_version_id_fkey',
      );
      const user = await insertUser();
      const course = await insertCourse();
      const version = await insertVersion(course, user);
      await insertRow('certificate_templates', {
        course_id: course,
        version_id: version,
        updated_by: user,
      });
      await rejects(
        query('DELETE FROM certificate_template_versions WHERE id = $1', [version]),
        'certificate_templates_version_id_fkey',
      );
      const loose = await insertVersion(null, user);
      await query('DELETE FROM certificate_template_versions WHERE id = $1', [loose]);
    });
  });

  describe('certificate_templates', () => {
    test('um template por curso e um só padrão da escola', async () => {
      const user = await insertUser();
      const course = await insertCourse();
      const row = {
        course_id: course,
        version_id: await insertVersion(course, user),
        updated_by: user,
      };
      await insertRow('certificate_templates', row);
      await rejects(insertRow('certificate_templates', row), 'certificate_templates_course_unique');

      const school = { version_id: await insertVersion(null, user), updated_by: user };
      await insertRow('certificate_templates', school);
      await rejects(
        insertRow('certificate_templates', school),
        'certificate_templates_school_default_unique',
      );
    });

    test('updated_at pelo gatilho; excluir o curso exclui o template', async () => {
      const user = await insertUser();
      const course = await insertCourse();
      const first = await insertVersion(course, user);
      const tpl = await insertRow('certificate_templates', {
        course_id: course,
        version_id: first,
        updated_by: user,
      });
      const second = await insertVersion(course, user);
      await query(
        `UPDATE certificate_templates SET version_id = $2, updated_at = now() - interval '1 day'
         WHERE id = $1`,
        [tpl.id, second],
      );
      const { rows } = await query(
        `SELECT updated_at > now() - interval '1 minute' AS fresh, version_id
         FROM certificate_templates WHERE id = $1`,
        [tpl.id],
      );
      assert.deepEqual(rows[0], { fresh: true, version_id: second });
      await query('DELETE FROM courses WHERE id = $1', [course]);
      const { rows: left } = await query('SELECT 1 FROM certificate_templates WHERE id = $1', [
        tpl.id,
      ]);
      assert.equal(left.length, 0);
      // As versões ficam, sem curso, para o expurgo de 30 dias.
      const { rows: versions } = await query(
        'SELECT count(*)::int AS n FROM certificate_template_versions WHERE id IN ($1, $2)',
        [first, second],
      );
      assert.equal(versions[0].n, 2);
    });
  });

  describe('certificates', () => {
    test('segundo certificado do mesmo aluno e curso viola o índice único', async () => {
      const cert = await insertCertificate();
      await rejects(
        insertCertificate({
          user_id: cert.user_id,
          course_id: cert.course_id,
          template_version_id: cert.template_version_id,
        }),
        'certificates_user_course_unique',
      );
      await rejects(
        insertCertificate({ code: cert.code, template_version_id: cert.template_version_id }),
        'certificates_code_unique',
      );
    });

    test('código fora do alfabeto é recusado', async () => {
      await insertCertificate({ code: 'ABCDEFGHJKMN' });
      for (const bad of [
        'ABCDEFGHJKM0',
        'ABCDEFGHJKMO',
        'ABCDEFGHJKM1',
        'ABCDEFGHJKMI',
        'ABCDEFGHJKML',
        'abcdefghjkmn',
        'ABCD-EFGH-JK',
        'ABCDEFGHJKM',
        'ABCDEFGHJKMNP',
      ]) {
        await rejects(insertCertificate({ code: bad }), 'certificates_code_format');
      }
    });

    test('emissão manual, revogação e PDF andam juntos', async () => {
      const admin = await insertUser();
      const manual = await insertCertificate({
        issued_manually: true,
        issued_by: admin,
        issue_reason: 'Turma migrada',
      });
      assert.equal(manual.issued_manually, true);
      const cases: [Record<string, unknown>, string][] = [
        [{ issued_manually: true, issued_by: admin }, 'certificates_manual_issue_complete'],
        [{ issued_manually: true, issue_reason: 'Motivo' }, 'certificates_manual_issue_complete'],
        [{ issue_reason: 'Motivo' }, 'certificates_manual_issue_complete'],
        [
          { issued_manually: true, issued_by: admin, issue_reason: '  ' },
          'certificates_issue_reason_length',
        ],
        [{ revoked_at: new Date() }, 'certificates_revocation_together'],
        [
          { revoked_at: new Date(), revoked_by: admin, revoke_reason: 'r'.repeat(501) },
          'certificates_revoke_reason_length',
        ],
        [{ pdf: Buffer.from('%PDF') }, 'certificates_pdf_together'],
        [{ pdf: Buffer.alloc(2097153), pdf_rendered_at: new Date() }, 'certificates_pdf_size'],
        [
          { student_name: null, pdf: Buffer.from('%PDF'), pdf_rendered_at: new Date() },
          'certificates_removed_holder_without_pdf',
        ],
        [{ hours: -1 }, 'certificates_hours_range'],
        [{ course_title: ' ' }, 'certificates_course_title_length'],
        [{ school_name: '' }, 'certificates_school_name_length'],
        [{ issued_by: randomUUID() }, 'certificates_issued_by_fkey'],
      ];
      for (const [fields, constraint] of cases) {
        await rejects(insertCertificate(fields), constraint);
      }
      // Revogar e desfazer; PDF gravado; updated_at pelo gatilho.
      const cert = await insertCertificate({ student_name: null, instructor_name: null });
      await query(
        `UPDATE certificates SET revoked_at = now(), revoked_by = $2, revoke_reason = 'Reembolso',
           updated_at = now() - interval '1 day' WHERE id = $1`,
        [cert.id, admin],
      );
      await query(
        `UPDATE certificates SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
           student_name = 'Maria', pdf = $2, pdf_rendered_at = now() WHERE id = $1`,
        [cert.id, Buffer.from('%PDF')],
      );
      const { rows } = await query(
        `SELECT updated_at > now() - interval '1 minute' AS fresh, revoked_at
         FROM certificates WHERE id = $1`,
        [cert.id],
      );
      assert.deepEqual(rows[0], { fresh: true, revoked_at: null });
    });

    test('o certificado segura o curso, e a conta excluída fica sem nome e sem PDF', async () => {
      const cert = await insertCertificate({
        pdf: Buffer.from('%PDF'),
        pdf_rendered_at: new Date(),
      });
      await rejects(
        query('DELETE FROM courses WHERE id = $1', [cert.course_id]),
        'certificates_course_id_fkey',
      );
      await rejects(
        query('DELETE FROM users WHERE id = $1', [cert.user_id]),
        'certificates_user_id_fkey',
      );
      // Exclusão da conta (030): a linha de users fica com deleted_at e o certificado perde
      // o nome e o PDF.
      await query('UPDATE users SET deleted_at = now() WHERE id = $1', [cert.user_id]);
      await query(
        `UPDATE certificates SET student_name = NULL, pdf = NULL, pdf_rendered_at = NULL
         WHERE id = $1`,
        [cert.id],
      );
      const { rows } = await query('SELECT code, course_title FROM certificates WHERE id = $1', [
        cert.id,
      ]);
      assert.deepEqual(rows[0], { code: cert.code, course_title: 'Curso' });
    });
  });

  describe('certificate_previews', () => {
    test('estados, campos de cada estado e limites', async () => {
      const user = await insertUser();
      const base = { requested_by: user, html: '<p>{{aluno.nome}}</p>' };
      const pending = await insertRow('certificate_previews', base);
      assert.equal(pending.status, 'pending');
      await query(
        `UPDATE certificate_previews SET status = 'ready', pdf = $2, rendered_at = now()
         WHERE id = $1`,
        [pending.id, Buffer.from('%PDF')],
      );
      await insertRow('certificate_previews', {
        ...base,
        status: 'failed',
        error: 'Tempo esgotado',
      });
      const cases: [Record<string, unknown>, string][] = [
        [{ status: 'done' }, 'certificate_previews_status_valid'],
        [{ status: 'ready', rendered_at: new Date() }, 'certificate_previews_ready_has_pdf'],
        [
          { pdf: Buffer.from('%PDF'), rendered_at: new Date() },
          'certificate_previews_ready_has_pdf',
        ],
        [{ status: 'failed' }, 'certificate_previews_failed_has_error'],
        [{ error: 'x' }, 'certificate_previews_failed_has_error'],
        [{ status: 'failed', error: ' ' }, 'certificate_previews_error_length'],
        [
          { status: 'ready', pdf: Buffer.alloc(2097153), rendered_at: new Date() },
          'certificate_previews_pdf_size',
        ],
        [{ html: 'a'.repeat(786433) }, 'certificate_previews_html_size'],
        [{ course_id: randomUUID() }, 'certificate_previews_course_id_fkey'],
      ];
      for (const [fields, constraint] of cases) {
        await rejects(insertRow('certificate_previews', { ...base, ...fields }), constraint);
      }
    });

    test('excluir o curso limpa course_id; excluir a conta apaga os pedidos', async () => {
      const user = await insertUser();
      const course = await insertCourse();
      const row = await insertRow('certificate_previews', {
        requested_by: user,
        course_id: course,
        html: '<p></p>',
      });
      await query('DELETE FROM courses WHERE id = $1', [course]);
      const { rows } = await query('SELECT course_id FROM certificate_previews WHERE id = $1', [
        row.id,
      ]);
      assert.equal(rows[0].course_id, null);
      await query('DELETE FROM users WHERE id = $1', [user]);
      const { rows: left } = await query('SELECT 1 FROM certificate_previews WHERE id = $1', [
        row.id,
      ]);
      assert.equal(left.length, 0);
    });

    test('o expurgo de 24 horas usa o índice de created_at', async () => {
      await query('SET enable_seqscan = off');
      try {
        const { rows } = await query(
          `EXPLAIN SELECT id FROM certificate_previews
           WHERE created_at < now() - interval '24 hours'`,
        );
        const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        assert.match(plan, /certificate_previews_created_idx/);
      } finally {
        await query('RESET enable_seqscan');
      }
    });
  });
});
