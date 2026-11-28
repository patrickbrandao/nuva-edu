import { type Selectable, type SqlBool, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import type { ForumCategories, ForumPosts, ForumTopics } from '../../db/generated/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import {
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import {
  type ForumUser,
  forumRecipientCategoryAccess,
  getForumUser,
  visibleForumCategory,
} from '../entitlements/forum-access.ts';

export type ForumCategory = Selectable<ForumCategories>;
export type ForumTopic = Selectable<ForumTopics>;
export type ForumPost = Selectable<ForumPosts>;
export type ForumTarget = 'forum_topic' | 'forum_post';

export const FORUM_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const;
export type ForumEmoji = (typeof FORUM_EMOJIS)[number];

function forCategory(user: ForumUser, moderation: boolean) {
  return visibleForumCategory(
    user,
    {
      kind: sql.ref('forumCategories.kind'),
      audience: sql.ref('forumCategories.audience'),
      courseId: sql.ref('forumCategories.courseId'),
      archivedAt: sql.ref('forumCategories.archivedAt'),
    },
    moderation,
  );
}

function allCategories(db: Database, user: ForumUser, moderation: boolean) {
  return db.selectFrom('forumCategories').selectAll().where(forCategory(user, moderation));
}

export async function requireForumCategory(
  db: Database,
  user: ForumUser,
  id: string,
  moderation = false,
): Promise<ForumCategory> {
  const row = await allCategories(db, user, moderation).where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound();
  return row;
}

function categoryView(row: ForumCategory) {
  return {
    id: row.id,
    kind: row.kind,
    courseId: row.courseId,
    audience: row.audience,
    name: row.name,
    description: row.description,
    position: row.position,
    archivedAt: row.archivedAt,
  };
}

export async function readForumCategory(
  db: Database,
  userId: string,
  id: string,
  moderation = false,
) {
  return categoryView(
    await requireForumCategory(db, await getForumUser(db, userId), id, moderation),
  );
}

export async function listForumCategories(
  db: Database,
  userId: string,
  input: CatalogPageInput = {},
  moderation = false,
) {
  const viewer = await getForumUser(db, userId);
  const scope = moderation ? 'admin-forum-categories' : 'forum-categories';
  const params = readCatalogPageParams(input, scope, ['position'], 'position');
  let query = allCategories(db, viewer, moderation);
  if (params.afterId) {
    query = query.where(sql<SqlBool>`(position, id) > (
      SELECT position, id FROM forum_categories WHERE id = ${params.afterId}
    )`);
  }
  const rows = await query
    .orderBy('position')
    .orderBy('id')
    .limit(params.limit + 1)
    .execute();
  return toCatalogPage(rows, params, scope, categoryView);
}

function allTopics(db: Database, user: ForumUser, moderation: boolean) {
  let query = db
    .selectFrom('forumTopics')
    .innerJoin('forumCategories', 'forumCategories.id', 'forumTopics.categoryId')
    .leftJoin('users', 'users.id', 'forumTopics.authorId')
    .selectAll('forumTopics')
    .select([
      'forumCategories.archivedAt as categoryArchivedAt',
      'users.name as authorName',
      'users.deletedAt as authorDeletedAt',
    ])
    .select(
      sql<boolean>`EXISTS (
      SELECT 1 FROM forum_topic_follows f
      WHERE f.topic_id = ${sql.ref('forumTopics.id')} AND f.user_id = ${user.id}
    )`.as('following'),
    )
    .where(forCategory(user, moderation));
  if (!moderation) {
    if (user.role === 'student') {
      query = query.where((eb) =>
        eb.or([eb('forumTopics.hiddenAt', 'is', null), eb('forumTopics.authorId', '=', user.id)]),
      );
    }
    query = query.where(sql<SqlBool>`(
      (${sql.ref('forumTopics.lessonId')} IS NULL AND ${sql.ref('forumTopics.authorId')} IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM lessons l
        WHERE l.id = ${sql.ref('forumTopics.lessonId')} AND l.status = 'published'
      )
    )`);
  }
  return query;
}

export async function requireForumTopic(
  db: Database,
  user: ForumUser,
  id: string,
  moderation = false,
  lock = false,
) {
  let query = allTopics(db, user, moderation).where('forumTopics.id', '=', id);
  if (lock) query = query.forUpdate('forumTopics');
  const topic = await query.executeTakeFirst();
  if (!topic) throw notFound();
  return topic;
}

export function forumAuthor(id: string | null, name: string | null, deletedAt: Date | null) {
  if (id === null) return { id: null, displayName: 'Equipe' };
  return name !== null && deletedAt === null
    ? { id, displayName: name }
    : { id: null, displayName: 'Usuário removido' };
}

function topicSummary(
  row: ForumTopic & {
    authorName: string | null;
    authorDeletedAt: Date | null;
    following: boolean;
  },
) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    lessonId: row.lessonId,
    author: forumAuthor(row.authorId, row.authorName, row.authorDeletedAt),
    title: row.title,
    status: row.hiddenAt === null ? row.status : 'hidden',
    pinned: row.pinned,
    solutionPostId: row.solutionPostId,
    postsCount: row.postsCount,
    lastActivityAt: row.lastActivityAt,
    following: row.following,
  };
}

export interface ForumTopicQuery extends CatalogPageInput {
  categoryId?: string;
  kind?: 'all' | 'lessons' | 'discussions';
  filter?: 'all' | 'unanswered' | 'solved' | 'unsolved' | 'following';
  status?: 'open' | 'closed' | 'hidden';
}

export async function listForumTopics(
  db: Database,
  userId: string,
  input: ForumTopicQuery = {},
  moderation = false,
) {
  const user = await getForumUser(db, userId);
  if (input.categoryId) await requireForumCategory(db, user, input.categoryId, moderation);
  const scope = [
    'forum-topics',
    moderation,
    input.categoryId,
    input.kind,
    input.filter,
    input.status,
    input.q,
  ]
    .map((part) => part ?? '')
    .join('/');
  const params = readCatalogPageParams(input, scope, ['activity'], 'activity');
  let query = allTopics(db, user, moderation);
  if (input.categoryId) query = query.where('forumTopics.categoryId', '=', input.categoryId);
  if (input.kind === 'lessons') query = query.where('forumTopics.lessonId', 'is not', null);
  if (input.kind === 'discussions') query = query.where('forumTopics.authorId', 'is not', null);
  if (input.filter === 'unanswered') query = query.where('forumTopics.postsCount', '=', 0);
  if (input.filter === 'solved') query = query.where('forumTopics.solutionPostId', 'is not', null);
  if (input.filter === 'unsolved') query = query.where('forumTopics.solutionPostId', 'is', null);
  if (input.filter === 'following') {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('forumTopicFollows')
          .select('userId')
          .where('userId', '=', user.id)
          .whereRef('topicId', '=', 'forumTopics.id'),
      ),
    );
  }
  if (input.status === 'hidden') query = query.where('forumTopics.hiddenAt', 'is not', null);
  if (input.status === 'open' || input.status === 'closed') {
    query = query
      .where('forumTopics.status', '=', input.status)
      .where('forumTopics.hiddenAt', 'is', null);
  }
  const pattern = params.pattern;
  if (pattern) {
    query = query.where((eb) =>
      eb.or([
        eb('forumTopics.title', 'ilike', pattern),
        eb('forumTopics.bodyMd', 'ilike', pattern),
        eb.exists(
          eb
            .selectFrom('forumPosts')
            .select('id')
            .whereRef('topicId', '=', 'forumTopics.id')
            .where('bodyMd', 'ilike', pattern)
            .where('deletedAt', 'is', null)
            .where((p) =>
              p.or([
                p('hiddenAt', 'is', null),
                p('authorId', '=', user.id),
                sql<SqlBool>`${moderation}`,
              ]),
            ),
        ),
      ]),
    );
  }
  if (params.afterId) {
    query = query.where(sql<SqlBool>`(
      ${sql.ref('forumTopics.pinned')}, ${sql.ref('forumTopics.lastActivityAt')}, ${sql.ref('forumTopics.id')}
    ) < (SELECT pinned, last_activity_at, id FROM forum_topics WHERE id = ${params.afterId})`);
  }
  const rows = await query
    .orderBy('forumTopics.pinned', 'desc')
    .orderBy('forumTopics.lastActivityAt', 'desc')
    .orderBy('forumTopics.id', 'desc')
    .limit(params.limit + 1)
    .execute();
  return toCatalogPage(rows, params, scope, topicSummary);
}

export async function readForumReactions(
  db: Database,
  userId: string,
  targetType: ForumTarget,
  ids: string[],
) {
  const rows =
    ids.length === 0
      ? []
      : await db
          .selectFrom('reactions')
          .select(['targetId', 'emoji'])
          .select([
            sql<number>`count(*)::int`.as('count'),
            sql<boolean>`bool_or(${sql.ref('userId')} = ${userId})`.as('reacted'),
          ])
          .where('targetType', '=', targetType)
          .where('targetId', 'in', ids)
          .groupBy(['targetId', 'emoji'])
          .execute();
  const grouped = new Map<string, { emoji: string; count: number; reacted: boolean }[]>();
  for (const { targetId, ...reaction } of rows) {
    const group = grouped.get(targetId) ?? [];
    group.push(reaction);
    grouped.set(targetId, group);
  }
  return grouped;
}

export async function readForumTopic(db: Database, userId: string, id: string, moderation = false) {
  const user = await getForumUser(db, userId);
  const row = await requireForumTopic(db, user, id, moderation);
  const reactions = await readForumReactions(db, userId, 'forum_topic', [id]);
  const player =
    row.lessonId === null
      ? null
      : await db
          .selectFrom('forumCategories')
          .innerJoin('courses', 'courses.id', 'forumCategories.courseId')
          .where('forumCategories.id', '=', row.categoryId)
          .select('courses.slug')
          .executeTakeFirst();
  const lessonUrl =
    player && row.lessonId !== null
      ? `/meus-cursos/${encodeURIComponent(player.slug)}/aulas/${row.lessonId}`
      : null;
  return {
    topic: topicSummary(row),
    bodyHtml: row.bodyHtml,
    ...(lessonUrl === null ? {} : { lessonUrl }),
    ...(row.deletedAt === null && (moderation || row.authorId === userId)
      ? { bodyMd: row.bodyMd }
      : {}),
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    hiddenAt: row.hiddenAt,
    moderatedAt: row.editedBy !== row.authorId ? row.editedAt : null,
    reactions: reactions.get(id) ?? [],
    canWrite:
      user.verified &&
      !user.suspended &&
      row.categoryArchivedAt === null &&
      row.status === 'open' &&
      row.hiddenAt === null &&
      row.deletedAt === null,
  };
}

function allPosts(db: Database, user: ForumUser, moderation: boolean) {
  let query = db
    .selectFrom('forumPosts')
    .innerJoin('users', 'users.id', 'forumPosts.authorId')
    .selectAll('forumPosts')
    .select(['users.name as authorName', 'users.deletedAt as authorDeletedAt']);
  if (!moderation && user.role === 'student') {
    query = query.where((eb) =>
      eb.or([eb('forumPosts.hiddenAt', 'is', null), eb('forumPosts.authorId', '=', user.id)]),
    );
  }
  return query;
}

export async function requireForumPost(
  db: Database,
  user: ForumUser,
  id: string,
  moderation = false,
) {
  const row = await allPosts(db, user, moderation)
    .where('forumPosts.id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound();
  return row;
}

function postView(
  user: ForumUser,
  moderation: boolean,
  row: Awaited<ReturnType<typeof requireForumPost>>,
  reactions: Awaited<ReturnType<typeof readForumReactions>>,
) {
  return {
    id: row.id,
    topicId: row.topicId,
    parentPostId: row.parentPostId,
    author: forumAuthor(row.authorId, row.authorName, row.authorDeletedAt),
    bodyHtml: row.bodyHtml,
    ...(row.deletedAt === null && (moderation || row.authorId === user.id)
      ? { bodyMd: row.bodyMd }
      : {}),
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    hiddenAt: row.hiddenAt,
    moderatedAt: row.editedBy !== row.authorId ? row.editedAt : null,
    reactions: reactions.get(row.id) ?? [],
  };
}

export async function readForumPost(db: Database, userId: string, id: string, moderation = false) {
  const user = await getForumUser(db, userId);
  const row = await requireForumPost(db, user, id, moderation);
  await requireForumTopic(db, user, row.topicId, moderation);
  return postView(user, moderation, row, await readForumReactions(db, userId, 'forum_post', [id]));
}

export async function listForumPosts(
  db: Database,
  userId: string,
  topicId: string,
  input: CatalogPageInput = {},
  moderation = false,
) {
  const user = await getForumUser(db, userId);
  await requireForumTopic(db, user, topicId, moderation);
  const scope = ['forum-posts', moderation, topicId].join('/');
  const params = readCatalogPageParams(input, scope, ['chronological'], 'chronological');
  let query = allPosts(db, user, moderation).where('forumPosts.topicId', '=', topicId);
  if (params.afterId) query = query.where('forumPosts.id', '>', params.afterId);
  const rows = await query
    .orderBy('forumPosts.id')
    .limit(params.limit + 1)
    .execute();
  const reactions = await readForumReactions(
    db,
    userId,
    'forum_post',
    rows.map((row) => row.id),
  );
  return toCatalogPage(rows, params, scope, (row) => postView(user, moderation, row, reactions));
}

export async function lookupLessonForumTopic(db: Database, userId: string, lessonId: string) {
  const user = await getForumUser(db, userId);
  const lesson = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .innerJoin('courses', 'courses.id', 'modules.courseId')
    .innerJoin('forumTopics', 'forumTopics.id', 'lessons.forumTopicId')
    .select([
      'forumTopics.id as topicId',
      'forumTopics.postsCount',
      'lessons.isSample',
      'lessons.status as lessonStatus',
      'courses.status as courseStatus',
      'courses.archivedAt',
      'courses.accessMode',
    ])
    .where('lessons.id', '=', lessonId)
    .executeTakeFirst();
  if (lesson?.lessonStatus !== 'published') throw notFound();
  const topic = await allTopics(db, user, false)
    .where('forumTopics.id', '=', lesson.topicId)
    .executeTakeFirst();
  if (topic) return { topicId: topic.id, postsCount: topic.postsCount, canRead: true };
  if (
    lesson.isSample &&
    lesson.courseStatus === 'published' &&
    !lesson.archivedAt &&
    lesson.accessMode !== 'private'
  ) {
    return { topicId: null, postsCount: lesson.postsCount, canRead: false };
  }
  throw notFound();
}

export async function canReadForumTopic(
  db: Database,
  userId: string,
  topicId: string,
): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'emailVerifiedAt', 'suspendedKind'])
    .where('id', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!user || user.suspendedKind !== null) return false;
  const row = await allTopics(
    db,
    {
      id: user.id,
      role: user.role as ForumUser['role'],
      verified: user.emailVerifiedAt !== null,
      suspended: false,
    },
    false,
  )
    .where('forumTopics.id', '=', topicId)
    .where('forumTopics.deletedAt', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

export async function searchForumMentions(
  db: Database,
  userId: string,
  categoryId: string,
  input: CatalogPageInput,
) {
  await requireForumCategory(db, await getForumUser(db, userId), categoryId);
  const scope = `forum-mentions/${categoryId}/${String(input.q ?? '')}`;
  const params = readCatalogPageParams(input, scope, ['name'], 'name');
  let query = db
    .selectFrom('users')
    .crossJoin('forumCategories')
    .select(['users.id', 'users.name'])
    .where('forumCategories.id', '=', categoryId)
    .where('users.deletedAt', 'is', null)
    .where('users.suspendedKind', 'is', null);
  if (params.pattern) query = query.where('users.name', 'ilike', params.pattern);
  query = query.where(forumRecipientCategoryAccess());
  if (params.afterId) {
    query = query.where(sql<SqlBool>`(${sql.ref('users.name')}, ${sql.ref('users.id')}) > (
      SELECT name, id FROM users WHERE id = ${params.afterId}
    )`);
  }
  const rows = await query
    .orderBy('users.name')
    .orderBy('users.id')
    .limit(params.limit + 1)
    .execute();
  return toCatalogPage(rows, params, scope, (row) => ({ id: row.id, displayName: row.name }));
}
