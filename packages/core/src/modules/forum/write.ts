import { sql } from 'kysely';
import type { RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  conflict,
  DomainError,
  notFound,
  rateLimited,
} from '../../errors/domain-error.ts';
import { type AuditContext, recordAudit } from '../audit/record.ts';
import {
  type ForumUser,
  forumRecipientCategoryAccess,
  getForumUser,
} from '../entitlements/forum-access.ts';
import { assertMarkdownWithinLimit, renderMarkdownToHtml } from '../markdown/render.ts';
import { notify } from '../notifications/central/notify.ts';
import { mayModerateForum } from '../permissions/forum.ts';
import { publishForumReply } from '../stream/forum.ts';
import {
  FORUM_EMOJIS,
  type ForumCategory,
  type ForumEmoji,
  type ForumTarget,
  type ForumTopic,
  readForumPost,
  readForumReactions,
  readForumTopic,
  requireForumCategory,
  requireForumPost,
  requireForumTopic,
} from './read.ts';

const REMOVED_BODY = 'Mensagem removida pelo autor.';

export function forumForbidden(): DomainError {
  return new DomainError({
    status: 403,
    code: 'forum_forbidden',
    title: 'Publicação não permitida.',
  });
}

export function assertForumWrite(user: ForumUser, archivedAt: Date | null): void {
  if (!user.verified || user.suspended || archivedAt !== null) throw forumForbidden();
}

export function forumMarkdown(input: unknown) {
  const bodyMd = assertMarkdownWithinLimit(input, 20_000).trim();
  const bodyHtml = renderMarkdownToHtml(bodyMd);
  if (!bodyMd || !bodyHtml.trim())
    throw businessRule('markdown_invalid', 'Informe o texto da publicação.');
  return { bodyMd, bodyHtml };
}

function topicTitle(title: string): string {
  const clean = title.trim();
  const length = [...clean].length;
  if (length < 5 || length > 150) {
    throw businessRule('forum_title_invalid', 'O título deve ter de 5 a 150 caracteres.');
  }
  return clean;
}

export async function forumLimit(db: Database, key: string, fallback: number): Promise<number> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst();
  const value = row?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export async function lockForumAuthor(db: Database, userId: string): Promise<ForumUser> {
  await db.selectFrom('users').select('id').where('id', '=', userId).forUpdate().executeTakeFirst();
  return getForumUser(db, userId);
}

async function assertPostRate(db: Database, user: ForumUser, kind: 'topic' | 'post') {
  const limit = await forumLimit(
    db,
    kind === 'topic' ? 'forum.topics_per_hour' : 'forum.posts_per_hour',
    kind === 'topic' ? 10 : 60,
  );
  const rate = await db
    .selectFrom('auditLog')
    .select([
      sql<number>`count(*)::int`.as('count'),
      sql<number>`coalesce(ceil(extract(epoch from min(created_at) + interval '1 hour' - now())), 1)::int`.as(
        'retryAfter',
      ),
    ])
    .where('actorUserId', '=', user.id)
    .where('action', '=', `forum.${kind}_create`)
    .where('createdAt', '>', sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirstOrThrow();
  if (rate.count >= limit)
    throw rateLimited(Math.max(rate.retryAfter, 1), 'Limite de publicações por hora atingido.');
}

function recordPublication(
  db: Database,
  user: ForumUser,
  kind: 'topic' | 'post',
  id: string,
  context: AuditContext,
) {
  return recordAudit(db, {
    context: { ...context, actorUserId: user.id, actorRole: user.role },
    action: `forum.${kind}_create`,
    targetType: `forum_${kind}`,
    targetId: id,
  });
}

async function follow(trx: Database, topicId: string, userId: string) {
  await trx
    .insertInto('forumTopicFollows')
    .values({ topicId, userId })
    .onConflict((oc) => oc.columns(['topicId', 'userId']).doNothing())
    .execute();
}

export async function createForumTopic(
  db: Database,
  userId: string,
  categoryId: string,
  input: { title: string; bodyMd: string },
  context: AuditContext = { origin: 'classroom' },
) {
  const fields = { title: topicTitle(input.title), ...forumMarkdown(input.bodyMd) };
  const id = await db.transaction().execute(async (trx) => {
    const user = await lockForumAuthor(trx, userId);
    const category = await requireForumCategory(trx, user, categoryId);
    assertForumWrite(user, category.archivedAt);
    await assertPostRate(trx, user, 'topic');
    const row = await trx
      .insertInto('forumTopics')
      .values({ ...fields, categoryId, authorId: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await follow(trx, row.id, user.id);
    await recordPublication(trx, user, 'topic', row.id, context);
    await alertMentions(trx, user.id, category.id, row.id, fields.bodyMd);
    return row.id;
  });
  return readForumTopic(db, userId, id);
}

function assertMutableTopic(
  row: ForumTopic & { categoryArchivedAt: Date | null },
  user: ForumUser,
  reply = false,
) {
  assertForumWrite(user, row.categoryArchivedAt);
  if (row.deletedAt !== null || (reply && (row.status !== 'open' || row.hiddenAt !== null))) {
    throw conflict('topic_closed', 'Este tópico está fechado para novas respostas.');
  }
}

export async function editForumTopic(
  db: Database,
  userId: string,
  id: string,
  input: { title?: string | undefined; bodyMd?: string | undefined },
) {
  const fields = {
    ...(input.title === undefined ? {} : { title: topicTitle(input.title) }),
    ...(input.bodyMd === undefined ? {} : forumMarkdown(input.bodyMd)),
  };
  if (Object.keys(fields).length === 0)
    throw businessRule('forum_patch_empty', 'Informe o que deseja editar.');
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    const row = await requireForumTopic(trx, user, id, false, true);
    assertMutableTopic(row, user);
    if (row.authorId !== user.id) throw forumForbidden();
    await trx
      .updateTable('forumTopics')
      .set({ ...fields, editedAt: sql<Date>`now()`, editedBy: user.id })
      .where('id', '=', id)
      .execute();
    if (input.bodyMd !== undefined)
      await alertMentions(trx, user.id, row.categoryId, id, input.bodyMd, row.bodyMd);
  });
  return readForumTopic(db, userId, id);
}

export async function deleteForumTopic(db: Database, userId: string, id: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    const row = await requireForumTopic(trx, user, id, false, true);
    assertForumWrite(user, row.categoryArchivedAt);
    if (row.authorId !== user.id || row.lessonId !== null) throw forumForbidden();
    if (row.deletedAt !== null) return;
    const post = await trx
      .selectFrom('forumPosts')
      .select('id')
      .where('topicId', '=', id)
      .executeTakeFirst();
    if (post) {
      await trx
        .updateTable('forumTopics')
        .set({ ...forumMarkdown(REMOVED_BODY), deletedAt: sql<Date>`now()` })
        .where('id', '=', id)
        .execute();
    } else {
      await trx.deleteFrom('forumTopics').where('id', '=', id).execute();
    }
  });
}

export async function createForumPost(
  db: Database,
  userId: string,
  topicId: string,
  input: { bodyMd: string; parentPostId?: string | null | undefined },
  context: AuditContext = { origin: 'classroom' },
) {
  const body = forumMarkdown(input.bodyMd);
  const id = await db.transaction().execute(async (trx) => {
    const user = await lockForumAuthor(trx, userId);
    const topic = await requireForumTopic(trx, user, topicId, false, true);
    assertMutableTopic(topic, user, true);
    await assertPostRate(trx, user, 'post');
    const parentPostId = input.parentPostId ?? null;
    if (parentPostId !== null) {
      const parent = await requireForumPost(trx, user, parentPostId);
      if (parent.topicId !== topicId) throw notFound();
      if (parent.parentPostId !== null || parent.deletedAt !== null || parent.hiddenAt !== null) {
        throw businessRule(
          'forum_invalid_parent',
          'Responda ao tópico ou a uma resposta principal visível.',
        );
      }
    }
    const row = await trx
      .insertInto('forumPosts')
      .values({ ...body, topicId, parentPostId, authorId: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .updateTable('forumTopics')
      .set({
        postsCount: sql<number>`posts_count + 1`,
        lastActivityAt: sql<Date>`now()`,
      })
      .where('id', '=', topicId)
      .execute();
    const followers = await trx
      .selectFrom('forumTopicFollows')
      .select('userId')
      .where('topicId', '=', topicId)
      .where('userId', '!=', user.id)
      .execute();
    await follow(trx, topicId, user.id);
    await recordPublication(trx, user, 'post', row.id, context);
    const mentioned = await alertMentions(trx, user.id, topic.categoryId, topicId, body.bodyMd);
    const recipients = await permittedRecipients(
      trx,
      topic.categoryId,
      followers.map(({ userId }) => userId),
    );
    await notify(
      trx,
      'forum.reply',
      recipients.filter((id) => !mentioned.includes(id)),
      {
        actorId: user.id,
        targetType: 'forum_topic',
        targetId: topicId,
        data: { topicId, postId: row.id },
      },
    );
    await publishForumReply(trx, user.id, topic.categoryId, topicId, row.id);
    return row.id;
  });
  return readForumPost(db, userId, id);
}

export async function editForumPost(db: Database, userId: string, id: string, bodyMd: string) {
  const body = forumMarkdown(bodyMd);
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    const post = await requireForumPost(trx, user, id);
    const topic = await requireForumTopic(trx, user, post.topicId, false, true);
    assertForumWrite(user, topic.categoryArchivedAt);
    if (post.authorId !== user.id || post.deletedAt !== null) throw forumForbidden();
    await trx
      .updateTable('forumPosts')
      .set({ ...body, editedBy: user.id, editedAt: sql<Date>`now()` })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .execute();
    await alertMentions(trx, user.id, topic.categoryId, topic.id, bodyMd, post.bodyMd);
  });
  return readForumPost(db, userId, id);
}

export async function deleteForumPost(db: Database, userId: string, id: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    const initial = await requireForumPost(trx, user, id);
    const topic = await requireForumTopic(trx, user, initial.topicId, false, true);
    const post = await requireForumPost(trx, user, id);
    assertForumWrite(user, topic.categoryArchivedAt);
    if (post.authorId !== user.id) throw forumForbidden();
    if (post.deletedAt !== null) return;
    const child = await trx
      .selectFrom('forumPosts')
      .select('id')
      .where('parentPostId', '=', id)
      .executeTakeFirst();
    if (child) {
      await trx
        .updateTable('forumPosts')
        .set({ ...forumMarkdown(REMOVED_BODY), deletedAt: sql<Date>`now()` })
        .where('id', '=', id)
        .execute();
    } else {
      await trx.deleteFrom('forumPosts').where('id', '=', id).execute();
    }
    await trx
      .updateTable('forumTopics')
      .set({
        postsCount: sql<number>`greatest(posts_count - 1, 0)`,
        ...(topic.solutionPostId === id ? { solutionPostId: null } : {}),
      })
      .where('id', '=', topic.id)
      .execute();
  });
}

export async function toggleForumFollow(
  db: Database,
  userId: string,
  id: string,
  selected: boolean,
) {
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    const topic = await requireForumTopic(trx, user, id, false, true);
    if (selected) {
      assertMutableTopic(topic, user);
      await follow(trx, topic.id, user.id);
    } else {
      await trx
        .deleteFrom('forumTopicFollows')
        .where('topicId', '=', topic.id)
        .where('userId', '=', user.id)
        .execute();
    }
  });
}

export async function setForumReaction(
  db: Database,
  userId: string,
  targetType: ForumTarget,
  targetId: string,
  emoji: ForumEmoji,
  selected: boolean,
) {
  if (!FORUM_EMOJIS.includes(emoji))
    throw businessRule('forum_emoji_invalid', 'Escolha uma reação disponível.');
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    const post = targetType === 'forum_post' ? await requireForumPost(trx, user, targetId) : null;
    const topic = await requireForumTopic(trx, user, post?.topicId ?? targetId, false, true);
    assertMutableTopic(topic, user);
    if (topic.hiddenAt !== null || (post && (post.deletedAt !== null || post.hiddenAt !== null)))
      throw notFound();
    const key = { targetId, targetType, emoji, userId: user.id };
    if (selected) {
      await trx
        .insertInto('reactions')
        .values(key)
        .onConflict((oc) => oc.columns(['targetId', 'targetType', 'emoji', 'userId']).doNothing())
        .execute();
    } else {
      await trx
        .deleteFrom('reactions')
        .where('targetId', '=', targetId)
        .where('targetType', '=', targetType)
        .where('emoji', '=', emoji)
        .where('userId', '=', user.id)
        .execute();
    }
  });
  return (await readForumReactions(db, userId, targetType, [targetId])).get(targetId) ?? [];
}

export async function setForumSolution(
  db: Database,
  userId: string,
  id: string,
  postId: string | null,
) {
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    const topic = await requireForumTopic(trx, user, id, false, true);
    assertMutableTopic(topic, user);
    if (topic.authorId !== user.id && !(await mayModerateForum(trx, user, topic.categoryId))) {
      throw forumForbidden();
    }
    if (topic.lessonId !== null || topic.authorId === null) {
      throw businessRule('forum_solution_not_allowed', 'Tópicos de aula não têm solução.');
    }
    if (topic.solutionPostId === postId) return;
    if (postId !== null) {
      const post = await requireForumPost(trx, user, postId);
      if (post.topicId !== id || post.hiddenAt !== null || post.deletedAt !== null)
        throw notFound();
      await notify(trx, 'forum.solution', post.authorId, {
        actorId: user.id,
        targetType: 'forum_topic',
        targetId: id,
        data: { topicId: id, postId },
      });
    }
    await trx
      .updateTable('forumTopics')
      .set({ solutionPostId: postId })
      .where('id', '=', id)
      .execute();
  });
  return readForumTopic(db, userId, id);
}

async function permittedRecipients(
  db: Database,
  categoryId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom('users')
    .crossJoin('forumCategories')
    .select('users.id')
    .where('forumCategories.id', '=', categoryId)
    .where('users.id', 'in', ids)
    .where('users.deletedAt', 'is', null)
    .where('users.suspendedKind', 'is', null)
    .where(forumRecipientCategoryAccess())
    .execute();
  return rows.map(({ id }) => id);
}

const MENTION = /^#([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function mentionedIds(markdown: string) {
  const ids = new Set<string>();
  if (!markdown.includes('](#')) return ids;
  const nodes: RootContent[] = [...unified().use(remarkParse).parse(markdown).children];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (
      node?.type === 'link' &&
      node.children.some((child) => child.type === 'text' && child.value.startsWith('@'))
    ) {
      const id = MENTION.exec(node.url)?.[1];
      if (id) ids.add(id.toLowerCase());
    }
    if (node && 'children' in node) nodes.push(...node.children);
  }
  return ids;
}

async function alertMentions(
  trx: Database,
  actorId: string,
  categoryId: string,
  topicId: string,
  markdown: string,
  prior = '',
) {
  const before = mentionedIds(prior);
  const selected = [...mentionedIds(markdown)].filter((id) => id !== actorId && !before.has(id));
  const recipients = await permittedRecipients(trx, categoryId, selected);
  await notify(trx, 'forum.mention', recipients, {
    actorId,
    targetType: 'forum_topic',
    targetId: topicId,
    data: { topicId },
  });
  return recipients;
}

export function requireFreeForumCategory(category: ForumCategory): void {
  if (category.kind !== 'free') {
    throw businessRule('forum_category_automatic', 'A categoria vinculada ao curso é automática.');
  }
}
