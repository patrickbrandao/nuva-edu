import { type SqlBool, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  notFound,
  permissionDenied,
  rateLimited,
} from '../../errors/domain-error.ts';
import { recordAudit } from '../audit/record.ts';
import {
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import {
  type ForumUser,
  getForumUser,
  visibleForumCategory,
} from '../entitlements/forum-access.ts';
import {
  type ForumTarget,
  forumAuthor,
  requireForumPost,
  requireForumTopic,
} from '../forum/read.ts';
import { forumLimit, lockForumAuthor } from '../forum/write.ts';
import { notify } from '../notifications/central/notify.ts';
import { requireForumModerator } from '../permissions/forum.ts';
import { isStaffRole, type Role } from '../permissions/roles.ts';

export const FORUM_REPORT_REASONS = [
  'spam',
  'harassment',
  'inappropriate',
  'piracy',
  'personal_data',
  'other',
] as const;
type ReportReason = (typeof FORUM_REPORT_REASONS)[number];

export interface CreateForumReportInput {
  targetType: ForumTarget;
  targetId: string;
  reason: ReportReason;
  details?: string | undefined;
}

export async function forumReportTarget(
  db: Database,
  user: ForumUser,
  targetType: ForumTarget,
  targetId: string,
  moderation: boolean,
  lock = false,
) {
  if (moderation) {
    const topicId =
      targetType === 'forum_topic'
        ? targetId
        : (
            await db
              .selectFrom('forumPosts')
              .select('topicId')
              .where('id', '=', targetId)
              .executeTakeFirst()
          )?.topicId;
    if (!topicId) throw notFound();
    const row = await db
      .selectFrom('forumTopics')
      .select('categoryId')
      .where('id', '=', topicId)
      .executeTakeFirst();
    if (!row) throw notFound();
    await requireForumModerator(db, user, row.categoryId);
  }
  const post =
    targetType === 'forum_post' ? await requireForumPost(db, user, targetId, moderation) : null;
  const topic = await requireForumTopic(db, user, post?.topicId ?? targetId, moderation, lock);
  const content =
    post && lock ? await requireForumPost(db, user, targetId, moderation) : (post ?? topic);
  const author = content.authorId
    ? await db
        .selectFrom('users')
        .select(['id', 'name', 'role', 'deletedAt'])
        .where('id', '=', content.authorId)
        .executeTakeFirst()
    : undefined;
  if (moderation && user.role !== 'admin' && author && isStaffRole(author.role as Role))
    throw permissionDenied();
  return { topic, post, content, author };
}

function reportView(row: {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    status: row.status === 'open' ? 'open' : 'reviewed',
    createdAt: row.createdAt,
  };
}

async function hideAutomatically(
  trx: Database,
  input: CreateForumReportInput,
  target: Awaited<ReturnType<typeof forumReportTarget>>,
): Promise<boolean> {
  if (target.content.hiddenAt !== null) return false;
  const threshold = await forumLimit(trx, 'moderation.auto_hide_threshold', 5);
  const row = await trx
    .selectFrom('reports')
    .select(sql<number>`count(distinct reporter_id)::int`.as('count'))
    .where('targetType', '=', input.targetType)
    .where('targetId', '=', input.targetId)
    .where('status', '=', 'open')
    .executeTakeFirstOrThrow();
  if (row.count < threshold) return false;
  const hiddenAt = sql<Date>`now()`;
  if (input.targetType === 'forum_topic') {
    await trx
      .updateTable('forumTopics')
      .set({ hiddenAt })
      .where('id', '=', input.targetId)
      .execute();
  } else {
    await trx
      .updateTable('forumPosts')
      .set({ hiddenAt })
      .where('id', '=', input.targetId)
      .execute();
    await trx
      .updateTable('forumTopics')
      .set({ solutionPostId: null })
      .where('id', '=', target.topic.id)
      .where('solutionPostId', '=', input.targetId)
      .execute();
  }
  await recordAudit(trx, {
    context: { origin: 'worker' },
    action: 'forum.content_auto_hide',
    targetType: input.targetType,
    targetId: input.targetId,
    details: { reporters: row.count },
  });
  if (target.content.authorId) {
    await notify(trx, 'moderation.content_hidden', target.content.authorId, {
      targetType: input.targetType,
      targetId: input.targetId,
      data: { reason: 'Ocultação automática por denúncias.', topicId: target.topic.id },
    });
  }
  return true;
}

export async function createForumReport(
  db: Database,
  userId: string,
  input: CreateForumReportInput,
) {
  const details = input.details?.trim() || null;
  if (
    !FORUM_REPORT_REASONS.includes(input.reason) ||
    (input.reason === 'other' && details === null) ||
    (details !== null && [...details].length > 2000)
  ) {
    throw businessRule(
      'report_reason_invalid',
      'Informe um motivo válido e descreva quando marcar Outro.',
    );
  }
  return db.transaction().execute(async (trx) => {
    const user = await lockForumAuthor(trx, userId);
    const existing = await trx
      .selectFrom('reports')
      .selectAll()
      .where('reporterId', '=', user.id)
      .where('targetType', '=', input.targetType)
      .where('targetId', '=', input.targetId)
      .executeTakeFirst();
    if (existing) return { created: false, report: reportView(existing) };
    const target = await forumReportTarget(
      trx,
      user,
      input.targetType,
      input.targetId,
      false,
      true,
    );
    if (target.content.deletedAt !== null) throw notFound();
    if (target.content.authorId === user.id) {
      throw businessRule('report_own_content', 'Você não pode denunciar a própria publicação.');
    }
    const recent = await trx
      .selectFrom('reports')
      .select([
        sql<number>`count(*)::int`.as('count'),
        sql<number>`coalesce(ceil(extract(epoch from min(created_at) + interval '1 day' - now())), 1)::int`.as(
          'retryAfter',
        ),
      ])
      .where('reporterId', '=', user.id)
      .where('createdAt', '>', sql<Date>`now() - interval '1 day'`)
      .executeTakeFirstOrThrow();
    if (recent.count >= 20)
      throw rateLimited(Math.max(recent.retryAfter, 1), 'Limite diário de denúncias atingido.');
    const row = await trx
      .insertInto('reports')
      .values({
        reporterId: user.id,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const priority = await hideAutomatically(trx, input, target);
    let staff = trx.selectFrom('users').select('id').where('deletedAt', 'is', null);
    const restricted = target.author && isStaffRole(target.author.role as Role);
    staff = restricted
      ? staff.where('role', '=', 'admin')
      : staff.where('role', 'in', ['admin', 'manager']);
    await notify(
      trx,
      'report.created',
      (await staff.execute()).map(({ id }) => id),
      {
        actorId: user.id,
        targetType: 'report',
        targetId: row.id,
        data: {
          contentType: input.targetType,
          contentId: input.targetId,
          topicId: target.topic.id,
          priority,
        },
      },
    );
    return { created: true, report: reportView(row) };
  });
}

export async function listMyForumReports(
  db: Database,
  userId: string,
  input: CatalogPageInput = {},
) {
  await getForumUser(db, userId);
  const scope = `my-forum-reports/${userId}`;
  const params = readCatalogPageParams(input, scope, ['recent'], 'recent');
  let query = db
    .selectFrom('reports')
    .selectAll()
    .where('reporterId', '=', userId)
    .where('targetType', 'in', ['forum_topic', 'forum_post']);
  if (params.afterId) query = query.where('id', '<', params.afterId);
  const rows = await query
    .orderBy('id', 'desc')
    .limit(params.limit + 1)
    .execute();
  return toCatalogPage(rows, params, scope, reportView);
}

export interface ForumQueueInput extends CatalogPageInput {
  targetType?: ForumTarget;
  status?: 'open' | 'resolved' | 'dismissed';
  reason?: ReportReason;
}

function queueRows(db: Database, user: ForumUser, input: ForumQueueInput) {
  const scope = visibleForumCategory(
    user,
    {
      kind: sql.ref('forumCategories.kind'),
      courseId: sql.ref('forumCategories.courseId'),
      audience: sql.ref('forumCategories.audience'),
      archivedAt: sql.ref('forumCategories.archivedAt'),
    },
    true,
  );
  const grouped = db
    .selectFrom('reports')
    .select(['targetType', 'targetId'])
    .select([
      sql<number>`count(distinct reporter_id)::int`.as('reporterCount'),
      sql<Date>`min(created_at)`.as('firstReportedAt'),
    ])
    .where(
      'targetType',
      'in',
      input.targetType ? [input.targetType] : ['forum_topic', 'forum_post'],
    )
    .where('status', '=', input.status ?? 'open')
    .$if(input.reason !== undefined, (q) => q.where('reason', '=', input.reason as ReportReason))
    .groupBy(['targetType', 'targetId']);
  return db
    .selectFrom(grouped.as('groups'))
    .leftJoin('forumPosts', (join) =>
      join
        .onRef('forumPosts.id', '=', 'groups.targetId')
        .on('groups.targetType', '=', 'forum_post'),
    )
    .innerJoin('forumTopics', (join) =>
      join.on(sql<SqlBool>`${sql.ref('forumTopics.id')} =
      CASE WHEN ${sql.ref('groups.targetType')} = 'forum_topic' THEN ${sql.ref('groups.targetId')}
      ELSE ${sql.ref('forumPosts.topicId')} END`),
    )
    .innerJoin('forumCategories', 'forumCategories.id', 'forumTopics.categoryId')
    .leftJoin('users', (join) =>
      join.on(sql<SqlBool>`${sql.ref('users.id')} =
      CASE WHEN ${sql.ref('groups.targetType')} = 'forum_topic' THEN ${sql.ref('forumTopics.authorId')}
      ELSE ${sql.ref('forumPosts.authorId')} END`),
    )
    .where(scope)
    .where((eb) =>
      user.role === 'admin'
        ? sql<SqlBool>`TRUE`
        : eb.or([eb('users.role', '=', 'student'), eb('users.role', 'is', null)]),
    )
    .select([
      'groups.targetId as id',
      'groups.targetId',
      'groups.targetType',
      'forumTopics.id as topicId',
      'forumTopics.categoryId',
      'users.id as authorId',
      'users.name as authorName',
      'users.deletedAt as authorDeletedAt',
      'forumTopics.title',
      'groups.reporterCount',
      'groups.firstReportedAt',
    ])
    .select(
      sql<boolean>`(
      CASE WHEN ${sql.ref('groups.targetType')} = 'forum_topic' THEN ${sql.ref('forumTopics.hiddenAt')}
      ELSE ${sql.ref('forumPosts.hiddenAt')} END
    ) IS NOT NULL`.as('hidden'),
    );
}

function queueItem(row: Awaited<ReturnType<ReturnType<typeof queueRows>['execute']>>[number]) {
  return {
    targetId: row.targetId,
    targetType: row.targetType,
    topicId: row.topicId,
    categoryId: row.categoryId,
    author: forumAuthor(row.authorId, row.authorName, row.authorDeletedAt),
    title: row.title,
    hidden: row.hidden,
    reporterCount: Math.max(row.reporterCount, 1),
    firstReportedAt: row.firstReportedAt,
  };
}

export async function listForumModerationQueue(
  db: Database,
  userId: string,
  input: ForumQueueInput = {},
) {
  const user = await getForumUser(db, userId);
  if (user.role === 'student') throw permissionDenied();
  const scope = ['forum-queue', input.status, input.targetType, input.reason]
    .map((part) => part ?? '')
    .join('/');
  const params = readCatalogPageParams(input, scope, ['priority'], 'priority');
  const base = queueRows(db, user, input);
  let query = db.selectFrom(base.as('items')).selectAll();
  if (params.afterId) {
    const previous = await base.where('groups.targetId', '=', params.afterId).executeTakeFirst();
    if (!previous) return { items: [], nextCursor: null };
    query = query.where((eb) =>
      eb.or([
        eb('reporterCount', '<', previous.reporterCount),
        eb.and([
          eb('reporterCount', '=', previous.reporterCount),
          eb('firstReportedAt', '>', previous.firstReportedAt),
        ]),
        eb.and([
          eb('reporterCount', '=', previous.reporterCount),
          eb('firstReportedAt', '=', previous.firstReportedAt),
          eb('targetId', '>', previous.targetId),
        ]),
      ]),
    );
  }
  const rows = await query
    .orderBy('reporterCount', 'desc')
    .orderBy('firstReportedAt')
    .orderBy('targetId')
    .limit(params.limit + 1)
    .execute();
  return toCatalogPage(rows, params, scope, queueItem);
}

export async function readForumReportDetails(
  db: Database,
  userId: string,
  targetType: ForumTarget,
  targetId: string,
) {
  const user = await getForumUser(db, userId);
  const target = await forumReportTarget(db, user, targetType, targetId, true);
  const rows = await db
    .selectFrom('reports')
    .leftJoin('users', 'users.id', 'reports.reporterId')
    .selectAll('reports')
    .select(['users.name as reporterName', 'users.deletedAt as reporterDeletedAt'])
    .where('reports.targetType', '=', targetType)
    .where('reports.targetId', '=', targetId)
    .orderBy('reports.createdAt')
    .execute();
  const first = rows[0];
  if (!first) throw notFound();
  return {
    item: {
      targetType,
      targetId,
      topicId: target.topic.id,
      categoryId: target.topic.categoryId,
      author: forumAuthor(
        target.content.authorId,
        target.author?.name ?? null,
        target.author?.deletedAt ?? null,
      ),
      title: target.topic.title,
      hidden: target.content.hiddenAt !== null,
      reporterCount: new Set(rows.map(({ reporterId }) => reporterId).filter(Boolean)).size || 1,
      firstReportedAt: first.createdAt,
    },
    authorId: target.content.authorId,
    bodyHtml: target.content.bodyHtml,
    reports: rows.map((row) => ({
      id: row.id,
      reporter:
        row.reporterId === null
          ? null
          : forumAuthor(row.reporterId, row.reporterName, row.reporterDeletedAt),
      reason: row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.createdAt,
    })),
  };
}
