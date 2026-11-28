import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateUp } from '../src/migrator.ts';
import { createScratchDatabase } from './helpers.ts';

test('0022: tópico e resposta aceitam ocultação automática sem moderador', async () => {
  const db = await createScratchDatabase();
  try {
    await migrateUp(db.client, { dir: defaultMigrationsDir, to: 22 });
    const {
      rows: [content],
    } = await db.client.query<{ topicId: string; postId: string; userId: string }>(`
      WITH author AS (INSERT INTO users (name, email) VALUES ('Autora', 'forum@example.test') RETURNING id),
      category AS (INSERT INTO forum_categories (kind, name) VALUES ('free', 'Livre') RETURNING id),
      topic AS (
        INSERT INTO forum_topics (category_id, author_id, title, body_md, body_html)
        SELECT category.id, author.id, 'Teste de ocultação', 'Teste', '<p>Teste</p>' FROM category, author
        RETURNING id
      ),
      post AS (
        INSERT INTO forum_posts (topic_id, author_id, body_md, body_html)
        SELECT topic.id, author.id, 'Resposta', '<p>Resposta</p>' FROM topic, author RETURNING id
      )
      SELECT topic.id AS "topicId", post.id AS "postId", author.id AS "userId" FROM topic, post, author
    `);
    assert.ok(content);
    for (const [table, id] of [
      ['forum_topics', content.topicId],
      ['forum_posts', content.postId],
    ] as const) {
      const { rows } = await db.client.query(
        `UPDATE ${table} SET hidden_at = now() WHERE id = $1 RETURNING hidden_at, hidden_by`,
        [id],
      );
      assert.ok(rows[0].hidden_at instanceof Date);
      assert.equal(rows[0].hidden_by, null);
      await assert.rejects(
        db.client.query(`UPDATE ${table} SET hidden_at = NULL, hidden_by = $2 WHERE id = $1`, [
          id,
          content.userId,
        ]),
        { constraint: `${table}_hidden_matches_by` },
      );
    }
  } finally {
    await db.drop();
  }
});
