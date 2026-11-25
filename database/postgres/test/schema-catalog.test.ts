import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, unique } from './helpers.ts';

const dir = defaultMigrationsDir;
const tables = [
  'bundle_items',
  'bundles',
  'courses',
  'ebooks',
  'lesson_links',
  'lessons',
  'modules',
  'product_ebooks',
];

describe('0009: catálogo', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 9 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);
  const slug = () => `s-${unique()}`;

  async function insertUser(): Promise<string> {
    const { rows } = await query(
      `INSERT INTO users (email, name) VALUES ($1, 'Pessoa') RETURNING id`,
      [`u${unique()}@example.com`],
    );
    return rows[0].id;
  }

  /** Insere em `table` com os campos dados (valores SQL literais). */
  function insert(table: string, fields: Record<string, string>) {
    const columns = Object.keys(fields).join(', ');
    const values = Object.values(fields).join(', ');
    return query(`INSERT INTO ${table} (${columns}) VALUES (${values}) RETURNING *`);
  }

  async function insertCourse(fields: Record<string, string> = {}): Promise<string> {
    const { rows } = await insert('courses', { slug: `'${slug()}'`, title: `'Curso'`, ...fields });
    return rows[0].id;
  }

  async function insertModule(courseId: string, position: number): Promise<string> {
    const { rows } = await insert('modules', {
      course_id: `'${courseId}'`,
      title: `'Módulo'`,
      position: String(position),
    });
    return rows[0].id;
  }

  async function insertLesson(moduleId: string, fields: Record<string, string> = {}) {
    const { rows } = await insert('lessons', {
      module_id: `'${moduleId}'`,
      title: `'Aula'`,
      position: '0',
      ...fields,
    });
    return rows[0].id as string;
  }

  test('down e up da 0009 removem e recriam as oito tabelas', async () => {
    const objects = async () =>
      (
        await query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
            AND tablename = ANY($1) ORDER BY 1`,
          [tables],
        )
      ).rows.map((row) => row.tablename);
    assert.deepEqual(await objects(), tables);
    await migrateDown(db.client, { dir });
    assert.deepEqual(await objects(), []);
    await migrateUp(db.client, { dir, to: 9 });
    assert.deepEqual(await objects(), tables);
  });

  test('courses: padrões, UUID v7 e updated_at pelo gatilho', async () => {
    const { rows } = await insert('courses', { slug: `'${slug()}'`, title: `'Curso'` });
    const row = rows[0];
    assert.deepEqual(
      {
        access_mode: row.access_mode,
        status: row.status,
        certificate_enabled: row.certificate_enabled,
        certificate_hours: row.certificate_hours,
        price_cents: row.price_cents,
        version: row.version,
      },
      {
        access_mode: 'open',
        status: 'draft',
        certificate_enabled: true,
        certificate_hours: null,
        price_cents: null,
        version: 1,
      },
    );
    const { rows: v } = await query('SELECT uuid_extract_version($1::uuid) AS v', [row.id]);
    assert.equal(v[0].v, 7);
    await query(`UPDATE courses SET updated_at = now() - interval '1 day' WHERE id = $1`, [row.id]);
    const { rows: updated } = await query(
      "SELECT updated_at > created_at - interval '1 minute' AS fresh FROM courses WHERE id = $1",
      [row.id],
    );
    assert.equal(updated[0].fresh, true);
  });

  test('courses: restrições recusam valores fora da spec', async () => {
    await insertCourse({ title: `repeat('a', 160)`, summary: `repeat('a', 300)` });
    await insertCourse({ description: `repeat('a', 20000)`, level: `'advanced'` });
    await insertCourse({ access_mode: `'paid'`, price_cents: '0', access_days: '1' });
    await insertCourse({ access_mode: `'private'`, certificate_hours: '1' });
    await insertCourse({ status: `'published'`, published_at: 'now()' });
    const cases: [Record<string, string>, string][] = [
      [{ title: `repeat('a', 161)` }, 'courses_title_length'],
      [{ title: `'  '` }, 'courses_title_length'],
      [{ summary: `repeat('a', 301)` }, 'courses_summary_length'],
      [{ description: `repeat('a', 20001)` }, 'courses_description_length'],
      [{ slug: `'Com Espaço'` }, 'courses_slug_format'],
      [{ slug: `'-a'` }, 'courses_slug_format'],
      [{ slug: `repeat('a', 161)` }, 'courses_slug_format'],
      [{ level: `'expert'` }, 'courses_level_valid'],
      [{ access_mode: `'free'` }, 'courses_access_mode_valid'],
      [{ access_mode: `'paid'`, price_cents: '-1' }, 'courses_price_cents_range'],
      [{ price_cents: '100' }, 'courses_price_matches_access_mode'],
      [{ access_days: '0' }, 'courses_access_days_range'],
      [{ certificate_hours: '0' }, 'courses_certificate_hours_range'],
      [{ status: `'archived'` }, 'courses_status_valid'],
      [{ status: `'published'` }, 'courses_published_at_matches_status'],
      [{ version: '0' }, 'courses_version_positive'],
    ];
    for (const [fields, constraint] of cases) {
      await assert.rejects(insertCourse(fields), { code: '23514', constraint }, constraint);
    }
  });

  test('slug único por tipo: repetido recusa na mesma tabela, aceito em outra', async () => {
    const same = slug();
    await insertCourse({ slug: `'${same}'` });
    await assert.rejects(insertCourse({ slug: `'${same}'` }), {
      code: '23505',
      constraint: 'courses_slug_unique',
    });
    await insert('ebooks', { slug: `'${same}'`, title: `'Ebook'` });
    await insert('bundles', { slug: `'${same}'`, title: `'Pacote'` });
    await assert.rejects(insert('ebooks', { slug: `'${same}'`, title: `'Ebook'` }), {
      code: '23505',
      constraint: 'ebooks_slug_unique',
    });
    await assert.rejects(insert('bundles', { slug: `'${same}'`, title: `'Pacote'` }), {
      code: '23505',
      constraint: 'bundles_slug_unique',
    });
  });

  test('capa e dono: chaves para images e users com ON DELETE SET NULL', async () => {
    const owner = await insertUser();
    const { rows: images } = await query(
      `INSERT INTO images (owner_user_id, purpose, original_width, original_height)
       VALUES ($1, 'product_cover', 10, 10) RETURNING id`,
      [owner],
    );
    const image = images[0].id;
    const course = await insertCourse({ cover_image_id: `'${image}'`, owner_id: `'${owner}'` });
    const { rows: ebooks } = await insert('ebooks', {
      slug: `'${slug()}'`,
      title: `'Ebook'`,
      cover_image_id: `'${image}'`,
    });
    const { rows: bundles } = await insert('bundles', {
      slug: `'${slug()}'`,
      title: `'Pacote'`,
      cover_image_id: `'${image}'`,
    });
    await assert.rejects(insertCourse({ cover_image_id: 'uuidv7()' }), {
      code: '23503',
      constraint: 'courses_cover_image_id_fkey',
    });
    await assert.rejects(insertCourse({ owner_id: 'uuidv7()' }), {
      code: '23503',
      constraint: 'courses_owner_id_fkey',
    });

    await query('DELETE FROM images WHERE id = $1', [image]);
    const { rows } = await query(
      `SELECT (SELECT cover_image_id FROM courses WHERE id = $1) AS course,
              (SELECT cover_image_id FROM ebooks WHERE id = $2) AS ebook,
              (SELECT cover_image_id FROM bundles WHERE id = $3) AS bundle`,
      [course, ebooks[0].id, bundles[0].id],
    );
    assert.deepEqual(rows, [{ course: null, ebook: null, bundle: null }]);

    // A linha de users nunca é apagada pelo código (spec 030), mas a chave não trava o curso.
    await query('DELETE FROM users WHERE id = $1', [owner]);
    const { rows: owned } = await query('SELECT owner_id FROM courses WHERE id = $1', [course]);
    assert.deepEqual(owned, [{ owner_id: null }]);
  });

  test('módulos e aulas: posição única por pai, conferida no COMMIT', async () => {
    const course = await insertCourse();
    const a = await insertModule(course, 0);
    const b = await insertModule(course, 1);
    await assert.rejects(insertModule(course, 1), {
      code: '23505',
      constraint: 'modules_course_position_unique',
    });
    // Outro curso pode usar a mesma posição.
    await insertModule(await insertCourse(), 0);

    // Trocar as posições numa transação passa, porque a unicidade é adiada.
    await query('BEGIN');
    await query('UPDATE modules SET position = 1 WHERE id = $1', [a]);
    await query('UPDATE modules SET position = 0 WHERE id = $1', [b]);
    await query('COMMIT');
    const { rows } = await query('SELECT id FROM modules WHERE course_id = $1 ORDER BY position', [
      course,
    ]);
    assert.deepEqual(
      rows.map((row) => row.id),
      [b, a],
    );

    await insertLesson(a, { position: '0' });
    await assert.rejects(insertLesson(a, { position: '0' }), {
      code: '23505',
      constraint: 'lessons_module_position_unique',
    });
    await assert.rejects(insertModule(course, -1), {
      code: '23514',
      constraint: 'modules_position_range',
    });
  });

  test('lessons: padrões, provedor de vídeo, limites e forum_topic_id sem chave', async () => {
    const module = await insertModule(await insertCourse(), 0);
    const { rows } = await query(
      `SELECT type, status, is_sample, duration_seconds, video_url, video_provider, forum_topic_id
         FROM lessons WHERE id = $1`,
      [await insertLesson(module)],
    );
    assert.deepEqual(rows, [
      {
        type: 'video',
        status: 'draft',
        is_sample: false,
        duration_seconds: 0,
        video_url: null,
        video_provider: null,
        forum_topic_id: null,
      },
    ]);
    let position = 1;
    const lesson = (fields: Record<string, string>) =>
      insertLesson(module, { position: String(position++), ...fields });
    for (const provider of ['youtube', 'vimeo', 'bunny', 'panda', 'file', 'link']) {
      await lesson({ video_url: `'https://example.com/v'`, video_provider: `'${provider}'` });
    }
    await lesson({ forum_topic_id: 'uuidv7()', is_sample: 'true', status: `'published'` });
    await lesson({ video_url: `'https://e.com/' || repeat('a', 1986)`, video_provider: `'link'` });
    const cases: [Record<string, string>, string][] = [
      [
        { video_url: `'https://e.com/v'`, video_provider: `'dailymotion'` },
        'lessons_video_provider_valid',
      ],
      [{ video_url: `'https://e.com/v'` }, 'lessons_video_provider_matches_url'],
      [{ video_provider: `'youtube'` }, 'lessons_video_provider_matches_url'],
      [{ video_url: `'ftp://e.com/v'`, video_provider: `'link'` }, 'lessons_video_url_format'],
      [{ video_url: `'https://e.com/a b'`, video_provider: `'link'` }, 'lessons_video_url_format'],
      [
        { video_url: `'https://e.com/' || repeat('a', 1987)`, video_provider: `'link'` },
        'lessons_video_url_format',
      ],
      [{ type: `'quiz'` }, 'lessons_type_valid'],
      [{ status: `'hidden'` }, 'lessons_status_valid'],
      [{ title: `repeat('a', 161)` }, 'lessons_title_length'],
      [{ description: `repeat('a', 20001)` }, 'lessons_description_length'],
      [{ duration_seconds: '-1' }, 'lessons_duration_seconds_range'],
    ];
    for (const [fields, constraint] of cases) {
      await assert.rejects(lesson(fields), { code: '23514', constraint }, constraint);
    }
  });

  test('lesson_links: tipo, URL e posição; excluir o curso apaga módulos, aulas e links', async () => {
    const course = await insertCourse();
    const module = await insertModule(course, 0);
    const lesson = await insertLesson(module);
    const link = (fields: Record<string, string>) =>
      insert('lesson_links', {
        lesson_id: `'${lesson}'`,
        label: `'Apostila'`,
        url: `'https://example.com/a.pdf'`,
        kind: `'file'`,
        position: '0',
        ...fields,
      });
    await link({});
    await link({ kind: `'page'`, position: '1' });
    await assert.rejects(link({ position: '1' }), {
      code: '23505',
      constraint: 'lesson_links_lesson_position_unique',
    });
    const cases: [Record<string, string>, string][] = [
      [{ kind: `'video'`, position: '2' }, 'lesson_links_kind_valid'],
      [{ url: `'javascript:alert(1)'`, position: '2' }, 'lesson_links_url_format'],
      [{ label: `''`, position: '2' }, 'lesson_links_label_length'],
    ];
    for (const [fields, constraint] of cases) {
      await assert.rejects(link(fields), { code: '23514', constraint }, constraint);
    }

    await query('DELETE FROM courses WHERE id = $1', [course]);
    const { rows } = await query(
      `SELECT (SELECT count(*) FROM modules WHERE id = $1)::int AS modules,
              (SELECT count(*) FROM lessons WHERE id = $2)::int AS lessons,
              (SELECT count(*) FROM lesson_links WHERE lesson_id = $2)::int AS links`,
      [module, lesson],
    );
    assert.deepEqual(rows, [{ modules: 0, lessons: 0, links: 0 }]);
  });

  test('ebooks e bundles: preço, validade, título e publicação', async () => {
    const ebook = (fields: Record<string, string>) =>
      insert('ebooks', { slug: `'${slug()}'`, title: `'Ebook'`, ...fields });
    const bundle = (fields: Record<string, string>) =>
      insert('bundles', { slug: `'${slug()}'`, title: `'Pacote'`, ...fields });
    await ebook({
      status: `'published'`,
      published_at: 'now()',
      file_url: `'https://example.com/e.pdf'`,
      pages: '10',
      author_name: `'Autora'`,
    });
    await bundle({ access_mode: `'paid'`, price_cents: '4990', access_days: '365' });
    const ebookCases: [Record<string, string>, string][] = [
      [{ access_mode: `'paid'`, price_cents: '-1' }, 'ebooks_price_cents_range'],
      [{ price_cents: '10' }, 'ebooks_price_matches_access_mode'],
      [{ access_days: '0' }, 'ebooks_access_days_range'],
      [{ title: `repeat('a', 161)` }, 'ebooks_title_length'],
      [{ pages: '0' }, 'ebooks_pages_range'],
      [{ file_url: `'http://e.com/a b'` }, 'ebooks_file_url_format'],
      [{ status: `'published'`, published_at: 'now()' }, 'ebooks_file_url_matches_status'],
      [
        { status: `'published'`, file_url: `'https://e.com/e.pdf'` },
        'ebooks_published_at_matches_status',
      ],
    ];
    for (const [fields, constraint] of ebookCases) {
      await assert.rejects(ebook(fields), { code: '23514', constraint }, constraint);
    }
    const bundleCases: [Record<string, string>, string][] = [
      [{ access_mode: `'paid'`, price_cents: '-1' }, 'bundles_price_cents_range'],
      [{ price_cents: '10' }, 'bundles_price_matches_access_mode'],
      [{ access_days: '0' }, 'bundles_access_days_range'],
      [{ title: `repeat('a', 161)` }, 'bundles_title_length'],
      [{ summary: `repeat('a', 301)` }, 'bundles_summary_length'],
      [{ status: `'published'` }, 'bundles_published_at_matches_status'],
    ];
    for (const [fields, constraint] of bundleCases) {
      await assert.rejects(bundle(fields), { code: '23514', constraint }, constraint);
    }
  });

  test('bundle_items: cursos e ebooks, nunca pacote; posição única; cascata ao excluir', async () => {
    const { rows } = await insert('bundles', { slug: `'${slug()}'`, title: `'Pacote'` });
    const bundle = rows[0].id;
    const item = (type: string, id: string, position: number) =>
      insert('bundle_items', {
        bundle_id: `'${bundle}'`,
        product_type: `'${type}'`,
        product_id: `'${id}'`,
        position: String(position),
      });
    const course = await insertCourse();
    const { rows: ebooks } = await insert('ebooks', { slug: `'${slug()}'`, title: `'Ebook'` });
    await item('course', course, 0);
    await item('ebook', ebooks[0].id, 1);
    await assert.rejects(item('bundle', bundle, 2), {
      code: '23514',
      constraint: 'bundle_items_product_type_valid',
    });
    await assert.rejects(item('course', course, 2), {
      code: '23505',
      constraint: 'bundle_items_pkey',
    });
    await assert.rejects(item('course', await insertCourse(), 1), {
      code: '23505',
      constraint: 'bundle_items_bundle_position_unique',
    });
    await query('DELETE FROM bundles WHERE id = $1', [bundle]);
    const { rows: left } = await query(
      'SELECT count(*)::int AS n FROM bundle_items WHERE bundle_id = $1',
      [bundle],
    );
    assert.deepEqual(left, [{ n: 0 }]);
  });

  test('product_ebooks: chave (ebook_id, target_type, target_id) e alvos válidos', async () => {
    const { rows } = await insert('ebooks', { slug: `'${slug()}'`, title: `'Ebook'` });
    const ebook = rows[0].id;
    const course = await insertCourse();
    const link = (type: string, target: string) =>
      insert('product_ebooks', {
        ebook_id: `'${ebook}'`,
        target_type: `'${type}'`,
        target_id: `'${target}'`,
      });
    await link('course', course);
    await link('lesson', course);
    await link('bundle', course);
    await assert.rejects(link('course', course), {
      code: '23505',
      constraint: 'product_ebooks_pkey',
    });
    await assert.rejects(link('module', course), {
      code: '23514',
      constraint: 'product_ebooks_target_type_valid',
    });
    await assert.rejects(
      insert('product_ebooks', {
        ebook_id: 'uuidv7()',
        target_type: `'course'`,
        target_id: `'${course}'`,
      }),
      { code: '23503', constraint: 'product_ebooks_ebook_id_fkey' },
    );
    await query('DELETE FROM ebooks WHERE id = $1', [ebook]);
    const { rows: left } = await query(
      'SELECT count(*)::int AS n FROM product_ebooks WHERE ebook_id = $1',
      [ebook],
    );
    assert.deepEqual(left, [{ n: 0 }]);
  });

  test('índices da vitrine, do programa, da busca e da cascata', async () => {
    const { rows } = await query(
      `SELECT indexname FROM pg_indexes WHERE tablename = ANY($1) ORDER BY indexname`,
      [tables],
    );
    const names = rows.map((row) => row.indexname);
    for (const name of [
      'courses_catalog_idx',
      'courses_owner_idx',
      'courses_review_requested_idx',
      'courses_title_trgm_idx',
      'courses_summary_trgm_idx',
      'ebooks_catalog_idx',
      'ebooks_title_trgm_idx',
      'bundles_catalog_idx',
      'bundles_summary_trgm_idx',
      'modules_course_position_unique',
      'lessons_module_position_unique',
      'lesson_links_lesson_position_unique',
      'bundle_items_product_idx',
      'product_ebooks_target_idx',
    ]) {
      assert.ok(names.includes(name), name);
    }

    await query(
      `INSERT INTO courses (slug, title, summary)
       SELECT 'massa-' || g, 'Curso de tema ' || g, 'Resumo ' || g FROM generate_series(1, 3000) g`,
    );
    await query('ANALYZE courses');
    await query('SET enable_seqscan = off');
    try {
      const plan = async (sql: string) =>
        (await query(`EXPLAIN ${sql}`)).rows.map((row) => row['QUERY PLAN']).join('\n');
      assert.match(
        await plan(`SELECT id FROM courses WHERE title ILIKE '%tema 12%'`),
        /courses_title_trgm_idx/,
      );
      assert.match(
        await plan(
          `SELECT id FROM courses WHERE status = 'published' AND access_mode IN ('open', 'paid')
             AND archived_at IS NULL`,
        ),
        /courses_catalog_idx/,
      );
    } finally {
      await query('RESET enable_seqscan');
    }
  });
});
