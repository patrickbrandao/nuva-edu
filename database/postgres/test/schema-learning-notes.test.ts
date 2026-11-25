import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;
const tables = ['lesson_progress', 'activity_days', 'notes'];

describe('0011: progresso, atividade e anotações', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 11 });
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

  /** Curso com um módulo e uma aula. */
  async function insertLesson(): Promise<{ courseId: string; lessonId: string }> {
    const { rows: c } = await query(
      `INSERT INTO courses (slug, title) VALUES ($1, 'Curso') RETURNING id`,
      [`curso-${unique()}`],
    );
    const { rows: m } = await query(
      `INSERT INTO modules (course_id, title, position) VALUES ($1, 'Módulo', 0) RETURNING id`,
      [c[0].id],
    );
    const { rows: l } = await query(
      `INSERT INTO lessons (module_id, title, position) VALUES ($1, 'Aula', 0) RETURNING id`,
      [m[0].id],
    );
    return { courseId: c[0].id, lessonId: l[0].id };
  }

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

  test('down e up da 0011 removem e recriam as tabelas', async () => {
    for (const table of tables) assert.equal(await tableExists(db.client, table), true);
    await migrateDown(db.client, { dir });
    for (const table of tables) assert.equal(await tableExists(db.client, table), false);
    assert.equal(await tableExists(db.client, 'entitlements'), true);
    await migrateUp(db.client, { dir, to: 11 });
    for (const table of tables) assert.equal(await tableExists(db.client, table), true);
  });

  describe('lesson_progress', () => {
    test('padrões, conclusão e updated_at pelo gatilho', async () => {
      const user = await insertUser();
      const { courseId, lessonId } = await insertLesson();
      const row = await insertRow('lesson_progress', {
        user_id: user,
        lesson_id: lessonId,
        course_id: courseId,
      });
      assert.equal(row.position_seconds, 0);
      assert.equal(row.completed_at, null);
      assert.ok(row.first_opened_at instanceof Date);
      assert.ok(row.last_opened_at instanceof Date);
      for (const via of ['manual', 'video_end']) {
        await query(
          `UPDATE lesson_progress SET completed_at = now(), completed_via = $3,
             updated_at = now() - interval '1 day'
           WHERE user_id = $1 AND lesson_id = $2`,
          [user, lessonId, via],
        );
      }
      const { rows } = await query(
        `SELECT updated_at > now() - interval '1 minute' AS fresh, completed_via
         FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2`,
        [user, lessonId],
      );
      assert.deepEqual(rows[0], { fresh: true, completed_via: 'video_end' });
      await rejects(
        insertRow('lesson_progress', { user_id: user, lesson_id: lessonId, course_id: courseId }),
        'lesson_progress_pkey',
      );
    });

    test('restrições recusam valores fora da spec', async () => {
      const user = await insertUser();
      const cases: [Record<string, unknown>, string][] = [
        [{ position_seconds: -1 }, 'lesson_progress_position_seconds_range'],
        [
          { completed_at: new Date(), completed_via: 'auto' },
          'lesson_progress_completed_via_valid',
        ],
        [{ completed_at: new Date() }, 'lesson_progress_completed_together'],
        [{ completed_via: 'manual' }, 'lesson_progress_completed_together'],
        [
          { first_opened_at: '2030-01-02T00:00:00Z', last_opened_at: '2030-01-01T00:00:00Z' },
          'lesson_progress_opened_order',
        ],
        [{ user_id: randomUUID() }, 'lesson_progress_user_id_fkey'],
        [{ course_id: randomUUID() }, 'lesson_progress_course_id_fkey'],
      ];
      for (const [fields, constraint] of cases) {
        const { courseId, lessonId } = await insertLesson();
        await rejects(
          insertRow('lesson_progress', {
            user_id: user,
            lesson_id: lessonId,
            course_id: courseId,
            ...fields,
          }),
          constraint,
        );
      }
    });

    test('excluir a aula ou a conta apaga o progresso', async () => {
      const user = await insertUser();
      const a = await insertLesson();
      const b = await insertLesson();
      for (const { courseId, lessonId } of [a, b]) {
        await insertRow('lesson_progress', {
          user_id: user,
          lesson_id: lessonId,
          course_id: courseId,
        });
      }
      await query('DELETE FROM lessons WHERE id = $1', [a.lessonId]);
      const count = async () =>
        (await query('SELECT count(*)::int AS n FROM lesson_progress WHERE user_id = $1', [user]))
          .rows[0].n;
      assert.equal(await count(), 1);
      await query('DELETE FROM users WHERE id = $1', [user]);
      assert.equal(await count(), 0);
    });
  });

  describe('activity_days', () => {
    test('total gerado, contadores não negativos e um dia por usuário', async () => {
      const user = await insertUser();
      const row = await insertRow('activity_days', {
        user_id: user,
        day: '2026-11-25',
        lessons_completed: 2,
        forum_posts: 1,
      });
      assert.equal(row.community_actions, 0);
      assert.equal(row.total, 3);
      await query(
        `UPDATE activity_days SET community_actions = community_actions + 4
         WHERE user_id = $1 AND day = '2026-11-25'`,
        [user],
      );
      const { rows } = await query('SELECT total FROM activity_days WHERE user_id = $1', [user]);
      assert.equal(rows[0].total, 7);
      await rejects(
        insertRow('activity_days', { user_id: user, day: '2026-11-25' }),
        'activity_days_pkey',
      );
      for (const column of ['lessons_completed', 'forum_posts', 'community_actions']) {
        await rejects(
          insertRow('activity_days', { user_id: user, day: '2026-01-01', [column]: -1 }),
          `activity_days_${column}_range`,
        );
      }
      await assert.rejects(
        query(`INSERT INTO activity_days (user_id, day, total) VALUES ($1, '2026-01-02', 9)`, [
          user,
        ]),
      );
      await query('DELETE FROM users WHERE id = $1', [user]);
      const { rows: left } = await query('SELECT 1 FROM activity_days WHERE user_id = $1', [user]);
      assert.equal(left.length, 0);
    });
  });

  describe('notes', () => {
    async function lessonNote(user: string, fields: Record<string, unknown> = {}) {
      const { courseId, lessonId } = await insertLesson();
      const row = await insertRow('notes', {
        user_id: user,
        lesson_id: lessonId,
        course_id: courseId,
        lesson_title_snapshot: 'Aula',
        course_title_snapshot: 'Curso',
        body: 'Texto',
        ...fields,
      });
      return { row, courseId, lessonId };
    }

    test('nota avulsa e nota de aula, UUID v7 e updated_at em milissegundos', async () => {
      const user = await insertUser();
      const loose = await insertRow('notes', { user_id: user, body: 'Ideia solta' });
      assert.equal(loose.lesson_id, null);
      assert.equal(loose.title, null);
      const { rows: v } = await query('SELECT uuid_extract_version($1::uuid) AS v', [loose.id]);
      assert.equal(v[0].v, 7);
      const { row } = await lessonNote(user, { video_seconds: 42, title: 'Resumo' });
      assert.equal(row.video_seconds, 42);
      await query(
        `UPDATE notes SET body = 'Outro', updated_at = now() - interval '1 day'
                   WHERE id = $1`,
        [row.id],
      );
      const { rows } = await query(
        `SELECT updated_at, updated_at > now() - interval '1 minute' AS fresh,
                extract(microseconds FROM updated_at)::bigint % 1000 AS micro
         FROM notes WHERE id = $1`,
        [row.id],
      );
      assert.equal(rows[0].fresh, true);
      assert.equal(Number(rows[0].micro), 0);
      // O updated_at lido pelo cliente (Date, milissegundos) bate com o do banco.
      const { rows: same } = await query('SELECT 1 FROM notes WHERE id = $1 AND updated_at = $2', [
        row.id,
        rows[0].updated_at,
      ]);
      assert.equal(same.length, 1);
    });

    test('restrições recusam valores fora da spec', async () => {
      const user = await insertUser();
      await insertRow('notes', { user_id: user, body: 'a'.repeat(20000), title: 'b'.repeat(160) });
      const loose: [Record<string, unknown>, string][] = [
        [{ body: 'a'.repeat(20001) }, 'notes_body_length'],
        [{ body: ' \n\t ' }, 'notes_body_length'],
        [{ title: '   ' }, 'notes_title_length'],
        [{ title: 'b'.repeat(161) }, 'notes_title_length'],
        [{ video_seconds: 10 }, 'notes_video_seconds_lesson_only'],
        [{ lesson_title_snapshot: 'Aula' }, 'notes_snapshots_together'],
        [{ course_id: (await insertLesson()).courseId }, 'notes_lesson_has_snapshot'],
        [{ user_id: randomUUID() }, 'notes_user_id_fkey'],
      ];
      for (const [fields, constraint] of loose) {
        await rejects(insertRow('notes', { user_id: user, body: 'Texto', ...fields }), constraint);
      }
      await rejects(lessonNote(user, { video_seconds: -1 }), 'notes_video_seconds_range');
      await rejects(
        lessonNote(user, { lesson_title_snapshot: null, course_title_snapshot: null }),
        'notes_lesson_has_snapshot',
      );
    });

    test('busca em portuguese encontra palavra do corpo e do título', async () => {
      const user = await insertUser();
      const { row } = await lessonNote(user, {
        title: 'Programação funcional',
        body: 'Os vetores ficam ordenados depois da recursão.',
      });
      const search = async (text: string) =>
        (
          await query(
            `SELECT id FROM notes
             WHERE user_id = $1 AND search @@ plainto_tsquery('portuguese', $2)`,
            [user, text],
          )
        ).rows.map((r) => r.id);
      assert.deepEqual(await search('vetor'), [row.id]);
      assert.deepEqual(await search('recursão ordenado'), [row.id]);
      assert.deepEqual(await search('programação'), [row.id]);
      assert.deepEqual(await search('funcional'), [row.id]);
      assert.deepEqual(await search('banana'), []);
      await query(`UPDATE notes SET title = NULL, body = 'Agora fala de banana' WHERE id = $1`, [
        row.id,
      ]);
      assert.deepEqual(await search('banana'), [row.id]);
      assert.deepEqual(await search('programação'), []);
    });

    test('excluir a aula mantém a nota com lesson_id nulo e os títulos', async () => {
      const user = await insertUser();
      const { row, lessonId, courseId } = await lessonNote(user, { video_seconds: 5 });
      await query('DELETE FROM lessons WHERE id = $1', [lessonId]);
      const { rows } = await query('SELECT * FROM notes WHERE id = $1', [row.id]);
      assert.equal(rows[0].lesson_id, null);
      assert.equal(rows[0].course_id, courseId);
      assert.equal(rows[0].lesson_title_snapshot, 'Aula');
      assert.equal(rows[0].video_seconds, 5);
      // Excluir o curso (em cascata módulos e aulas) também mantém a nota.
      const other = await lessonNote(user);
      await query('DELETE FROM courses WHERE id = $1', [other.courseId]);
      const { rows: kept } = await query('SELECT * FROM notes WHERE id = $1', [other.row.id]);
      assert.equal(kept[0].lesson_id, null);
      assert.equal(kept[0].course_id, null);
      assert.equal(kept[0].course_title_snapshot, 'Curso');
    });

    test('excluir a conta apaga as notas', async () => {
      const user = await insertUser();
      await lessonNote(user);
      await insertRow('notes', { user_id: user, body: 'Avulsa' });
      await query('DELETE FROM users WHERE id = $1', [user]);
      const { rows } = await query('SELECT 1 FROM notes WHERE user_id = $1', [user]);
      assert.equal(rows.length, 0);
    });
  });
});
