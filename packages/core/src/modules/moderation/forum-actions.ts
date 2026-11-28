import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { businessRule, notFound, permissionDenied } from '../../errors/domain-error.ts';
import { type AuditContext, recordAudit, recordDenied } from '../audit/record.ts';
import {
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import { type ForumUser, getForumUser } from '../entitlements/forum-access.ts';
import {
  type ForumTarget,
  forumAuthor,
  readForumTopic,
  requireForumCategory,
  requireForumPost,
} from '../forum/read.ts';
import { forumMarkdown } from '../forum/write.ts';
import { notify } from '../notifications/central/notify.ts';
import { isForumStaff, requireForumModerator } from '../permissions/forum.ts';
import { checkUserManagement } from '../permissions/management.ts';
import { isStaffRole, type Role } from '../permissions/roles.ts';
import { forumReportTarget, readForumReportDetails } from './forum-reports.ts';

export interface ForumActionInput {
  action: 'dismiss' | 'hide' | 'unhide' | 'edit' | 'close';
  targetType: ForumTarget;
  targetId: string;
  reason: string;
  bodyMd?: string | undefined;
}

function actionReason(reason: string, maxLength = 2000) {
  const normalized = reason.trim();
  if (!normalized || [...normalized].length > maxLength) {
    throw businessRule('moderation_reason_required', 'Informe o motivo da moderação.');
  }
  return normalized;
}

async function actionRecord(
  trx: Database,
  actor: ForumUser,
  record: {
    action: string;
    targetType: string;
    targetId: string;
    userId: string | null;
    reason: string;
  },
  audit: { code: string; details?: Record<string, unknown> },
  context: AuditContext,
) {
  const trail = await recordAudit(trx, {
    context: { ...context, actorUserId: actor.id, actorRole: actor.role },
    action: audit.code,
    targetType: record.targetType,
    targetId: record.targetId,
    details: { reason: record.reason, ...audit.details },
  });
  const saved =
    record.userId === null
      ? trail
      : await trx
          .insertInto('moderationActions')
          .values({
            moderatorId: actor.id,
            action: record.action,
            targetType: record.targetType,
            targetId: record.targetId,
            targetUserId: record.userId,
            reason: record.reason,
          })
          .returning(['id', 'createdAt'])
          .executeTakeFirstOrThrow();
  const name = await trx
    .selectFrom('users')
    .select('name')
    .where('id', '=', actor.id)
    .executeTakeFirstOrThrow();
  return { ...record, ...saved, moderator: forumAuthor(actor.id, name.name, null) };
}

async function applyAction(
  trx: Database,
  actor: ForumUser,
  input: ForumActionInput,
  context: AuditContext,
) {
  const reason = actionReason(input.reason);
  if (actor.role === 'instructor' && (input.action === 'edit' || input.action === 'dismiss')) {
    throw permissionDenied();
  }
  const target = await forumReportTarget(trx, actor, input.targetType, input.targetId, true, true);
  const { action, targetType, targetId } = input;
  const table = targetType === 'forum_topic' ? 'forumTopics' : 'forumPosts';
  let auditDetails: Record<string, unknown> = {};
  switch (action) {
    case 'dismiss':
      break;
    case 'hide':
    case 'unhide':
      await trx
        .updateTable(table)
        .set({
          hiddenAt: action === 'hide' ? sql<Date>`now()` : null,
          hiddenBy: action === 'hide' ? actor.id : null,
        })
        .where('id', '=', targetId)
        .execute();
      if (action === 'hide' && targetType === 'forum_post') {
        await trx
          .updateTable('forumTopics')
          .set({ solutionPostId: null })
          .where('id', '=', target.topic.id)
          .where('solutionPostId', '=', targetId)
          .execute();
      }
      if (action === 'hide' && target.content.authorId && target.content.hiddenAt === null) {
        await notify(trx, 'moderation.content_hidden', target.content.authorId, {
          actorId: actor.id,
          targetType,
          targetId,
          data: { reason, topicId: target.topic.id },
        });
      }
      break;
    case 'edit':
      await trx
        .updateTable(table)
        .set({
          ...forumMarkdown(input.bodyMd),
          editedAt: sql<Date>`now()`,
          editedBy: actor.id,
        })
        .where('id', '=', targetId)
        .execute();
      auditDetails = { before: target.content.bodyMd };
      break;
    case 'close':
      if (targetType !== 'forum_topic')
        throw businessRule('forum_target_invalid', 'Selecione um tópico.');
      await trx
        .updateTable('forumTopics')
        .set({ status: 'closed' })
        .where('id', '=', targetId)
        .execute();
      break;
  }
  await trx
    .updateTable('reports')
    .set({
      status: action === 'dismiss' ? 'dismissed' : 'resolved',
      resolvedBy: actor.id,
      resolvedAt: sql<Date>`now()`,
      resolution: reason,
    })
    .where('targetType', '=', targetType)
    .where('targetId', '=', targetId)
    .where('status', '=', 'open')
    .execute();
  const prefix = targetType === 'forum_topic' ? 'topic' : 'post';
  return actionRecord(
    trx,
    actor,
    {
      action,
      targetType,
      targetId,
      userId: target.content.authorId,
      reason,
    },
    {
      code: action === 'dismiss' ? 'report.resolve' : `forum.${prefix}_${action}`,
      details: auditDetails,
    },
    context,
  );
}

export async function applyForumModerationAction(
  db: Database,
  userId: string,
  input: ForumActionInput,
  context: AuditContext = { origin: 'admin_panel' },
) {
  return db
    .transaction()
    .execute(async (trx) => applyAction(trx, await getForumUser(trx, userId), input, context));
}

export interface AdminForumTopicPatch {
  pinned?: boolean | undefined;
  closed?: boolean | undefined;
  hidden?: boolean | undefined;
  categoryId?: string | undefined;
  solutionPostId?: string | null | undefined;
  reason?: string | undefined;
}

export async function moderateForumTopic(
  db: Database,
  userId: string,
  id: string,
  input: AdminForumTopicPatch,
  context: AuditContext = { origin: 'admin_panel' },
) {
  await db.transaction().execute(async (trx) => {
    const actor = await getForumUser(trx, userId);
    const { topic } = await forumReportTarget(trx, actor, 'forum_topic', id, true, true);
    if (input.hidden !== undefined) {
      await applyAction(
        trx,
        actor,
        {
          action: input.hidden ? 'hide' : 'unhide',
          targetType: 'forum_topic',
          targetId: id,
          reason: input.reason ?? '',
        },
        context,
      );
    }
    const { pinned, closed, categoryId, solutionPostId } = input;
    const fields = {
      ...(pinned === undefined ? {} : { pinned }),
      ...(closed === undefined ? {} : { status: closed ? 'closed' : 'open' }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(solutionPostId === undefined ? {} : { solutionPostId }),
    };
    if (Object.keys(fields).length === 0) {
      if (input.hidden === undefined)
        throw businessRule('forum_patch_empty', 'Informe o que deseja moderar.');
      return;
    }
    if (categoryId !== undefined) {
      if (!isForumStaff(actor)) throw permissionDenied();
      if (topic.lessonId !== null || topic.authorId === null) {
        throw businessRule(
          'forum_topic_automatic',
          'Tópicos automáticos ficam na categoria do curso.',
        );
      }
      const category = await requireForumCategory(trx, actor, categoryId, true);
      await requireForumModerator(trx, actor, categoryId);
      if (category.archivedAt !== null)
        throw businessRule('forum_category_archived', 'A categoria foi arquivada.');
    }
    if (solutionPostId !== undefined) {
      if (topic.lessonId !== null || topic.authorId === null) {
        throw businessRule('forum_solution_not_allowed', 'Tópicos automáticos não têm solução.');
      }
      if (solutionPostId !== null) {
        const post = await requireForumPost(trx, actor, solutionPostId, true);
        if (post.topicId !== id || post.hiddenAt !== null || post.deletedAt !== null)
          throw notFound();
        if (solutionPostId !== topic.solutionPostId) {
          await notify(trx, 'forum.solution', post.authorId, {
            actorId: actor.id,
            targetType: 'forum_topic',
            targetId: id,
            data: { topicId: id, postId: solutionPostId },
          });
        }
      }
    }
    await trx.updateTable('forumTopics').set(fields).where('id', '=', id).execute();
    await recordAudit(trx, {
      context: { ...context, actorUserId: actor.id, actorRole: actor.role },
      action: 'forum.topic_update',
      targetType: 'forum_topic',
      targetId: id,
      details: { ...fields, reason: input.reason },
    });
  });
  return readForumTopic(db, userId, id, true);
}

export async function warnForumUser(
  db: Database,
  userId: string,
  targetUserId: string,
  rawReason: string,
  context: AuditContext = { origin: 'admin_panel' },
) {
  const actor = await getForumUser(db, userId);
  const reason = actionReason(rawReason, 500);
  const target = await db
    .selectFrom('users')
    .select(['id', 'role'])
    .where('id', '=', targetUserId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!target) throw notFound();
  const decision = checkUserManagement(actor, 'suspend', { ...target, role: target.role as Role });
  if (!decision.allowed) {
    if (decision.reason === 'self_action_not_allowed') throw businessRule(decision.reason);
    await recordDenied(db, {
      context: { ...context, actorUserId: actor.id, actorRole: actor.role },
      permission: decision.action,
      action: 'user.warn',
      targetType: 'user',
      targetId: targetUserId,
    });
    throw permissionDenied();
  }
  if (actor.suspended) throw permissionDenied();
  return db.transaction().execute(async (trx) => {
    const recorded = await actionRecord(
      trx,
      actor,
      {
        action: 'warn',
        targetType: 'user',
        targetId: targetUserId,
        userId: targetUserId,
        reason,
      },
      { code: 'user.warn' },
      context,
    );
    await notify(trx, 'moderation.warning', targetUserId, {
      actorId: actor.id,
      targetType: 'user',
      targetId: targetUserId,
      data: { reason },
    });
    return recorded;
  });
}

export function forumModerationHistoryQuery(db: Database, targetUserId: string) {
  return db
    .selectFrom('moderationActions')
    .innerJoin('users', 'users.id', 'moderationActions.moderatorId')
    .selectAll('moderationActions')
    .select(['users.name as moderatorName', 'users.deletedAt as moderatorDeletedAt'])
    .where('targetUserId', '=', targetUserId)
    .where('targetType', 'in', ['forum_topic', 'forum_post', 'user']);
}

export function forumModerationRecord(
  row: Awaited<ReturnType<ReturnType<typeof forumModerationHistoryQuery>['execute']>>[number],
) {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    userId: row.targetUserId,
    moderator: forumAuthor(row.moderatorId, row.moderatorName, row.moderatorDeletedAt),
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export async function listUserForumModerationHistory(
  db: Database,
  actorId: string,
  targetUserId: string,
  input: CatalogPageInput = {},
) {
  const actor = await getForumUser(db, actorId);
  if (!isForumStaff(actor)) throw permissionDenied();
  const target = await db
    .selectFrom('users')
    .select(['id', 'role'])
    .where('id', '=', targetUserId)
    .executeTakeFirst();
  if (!target) throw notFound();
  if (actor.role !== 'admin' && isStaffRole(target.role as Role)) throw permissionDenied();
  const scope = `forum-moderation-history/${targetUserId}`;
  const params = readCatalogPageParams(input, scope, ['recent'], 'recent');
  let query = forumModerationHistoryQuery(db, targetUserId);
  if (params.afterId) query = query.where('moderationActions.id', '<', params.afterId);
  const rows = await query
    .orderBy('moderationActions.id', 'desc')
    .limit(params.limit + 1)
    .execute();
  return toCatalogPage(rows, params, scope, forumModerationRecord);
}

export async function readForumModerationTarget(
  db: Database,
  actorId: string,
  targetType: ForumTarget,
  targetId: string,
) {
  const { authorId, ...view } = await readForumReportDetails(db, actorId, targetType, targetId);
  const actor = await getForumUser(db, actorId);
  const rows =
    authorId === null || actor.role === 'instructor'
      ? []
      : await forumModerationHistoryQuery(db, authorId)
          .orderBy('moderationActions.id', 'desc')
          .limit(25)
          .execute();
  return { ...view, history: rows.map(forumModerationRecord) };
}
