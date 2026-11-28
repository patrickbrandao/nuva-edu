import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  type AuditContext,
  createForumPost,
  createForumTopic,
  deleteForumPost,
  deleteForumTopic,
  editForumPost,
  editForumTopic,
  type ForumEmoji,
  type ForumTarget,
  type ForumTopicQuery,
  listForumCategories,
  listForumPosts,
  listForumTopics,
  lookupLessonForumTopic,
  readForumTopic,
  searchForumMentions,
  setForumReaction,
  setForumSolution,
  toggleForumFollow,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { requestContext } from '../session.ts';
import { privateCache } from './catalog.ts';
import { bodyOf, paramsOf, type RouteContext, requireSession } from './context.ts';

type Id = { id: string };
type PageQuery = { cursor?: string; limit?: number; q?: string };

function viewerId(request: FastifyRequest): string {
  return requireSession(request).user.id;
}

function audit(request: FastifyRequest): AuditContext {
  return { origin: 'classroom', ...requestContext(request) };
}

export function registerForumRoutes(app: FastifyInstance, { db }: RouteContext): void {
  app.operation('listForumCategories', async (request, reply) => {
    privateCache(reply);
    return toWire(await listForumCategories(db, viewerId(request), request.query as PageQuery));
  });
  app.operation('listForumCategoryTopics', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    privateCache(reply);
    return toWire(
      await listForumTopics(db, viewerId(request), {
        ...(request.query as ForumTopicQuery),
        categoryId: id,
      }),
    );
  });
  app.operation('createForumTopic', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    const item = await createForumTopic(
      db,
      viewerId(request),
      id,
      bodyOf<{ title: string; bodyMd: string }>(request),
      audit(request),
    );
    reply.status(201);
    privateCache(reply);
    return toWire(item);
  });
  app.operation('searchForumMentions', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    privateCache(reply);
    return toWire(await searchForumMentions(db, viewerId(request), id, request.query as PageQuery));
  });
  app.operation('getForumTopic', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    privateCache(reply);
    return toWire(await readForumTopic(db, viewerId(request), id));
  });
  app.operation('updateForumTopic', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    privateCache(reply);
    return toWire(
      await editForumTopic(
        db,
        viewerId(request),
        id,
        bodyOf<{ title?: string; bodyMd?: string }>(request),
      ),
    );
  });
  app.operation('deleteForumTopic', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    await deleteForumTopic(db, viewerId(request), id);
    reply.status(204);
  });
  app.operation('listForumPosts', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    privateCache(reply);
    return toWire(await listForumPosts(db, viewerId(request), id, request.query as PageQuery));
  });
  app.operation('createForumPost', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    const item = await createForumPost(
      db,
      viewerId(request),
      id,
      bodyOf<{ bodyMd: string; parentPostId?: string | null }>(request),
      audit(request),
    );
    reply.status(201);
    privateCache(reply);
    return toWire(item);
  });
  app.operation('updateForumPost', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    const { bodyMd } = bodyOf<{ bodyMd: string }>(request);
    privateCache(reply);
    return toWire(await editForumPost(db, viewerId(request), id, bodyMd));
  });
  app.operation('deleteForumPost', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    await deleteForumPost(db, viewerId(request), id);
    reply.status(204);
  });

  const reaction =
    (targetType: ForumTarget, selected: boolean) => async (request: FastifyRequest) => {
      const { id, emoji } = paramsOf<{ id: string; emoji: ForumEmoji }>(request);
      return setForumReaction(db, viewerId(request), targetType, id, emoji, selected);
    };
  app.operation('addForumTopicReaction', reaction('forum_topic', true));
  app.operation('removeForumTopicReaction', reaction('forum_topic', false));
  app.operation('addForumPostReaction', reaction('forum_post', true));
  app.operation('removeForumPostReaction', reaction('forum_post', false));

  app.operation('setForumTopicSolution', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    const { postId } = bodyOf<{ postId: string | null }>(request);
    privateCache(reply);
    return toWire(await setForumSolution(db, viewerId(request), id, postId));
  });
  app.operation('followForumTopic', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    await toggleForumFollow(db, viewerId(request), id, true);
    reply.status(204);
  });
  app.operation('unfollowForumTopic', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    await toggleForumFollow(db, viewerId(request), id, false);
    reply.status(204);
  });
  app.operation('searchForum', async (request, reply) => {
    privateCache(reply);
    return toWire(await listForumTopics(db, viewerId(request), request.query as ForumTopicQuery));
  });
  app.operation('getLessonTopic', async (request, reply) => {
    const { id } = paramsOf<Id>(request);
    privateCache(reply);
    return lookupLessonForumTopic(db, viewerId(request), id);
  });
}
