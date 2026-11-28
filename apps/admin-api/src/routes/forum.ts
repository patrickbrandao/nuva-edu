import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  type AdminForumTopicPatch,
  createForumCategory,
  type Database,
  type ForumTopicQuery,
  listForumCategories,
  listForumPosts,
  listForumTopics,
  managementAuditContext,
  moderateForumTopic,
  readForumCategory,
  readForumTopic,
  updateForumCategory,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

export function forumWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function forumActor(request: FastifyRequest) {
  const management = managementRequest(request);
  return { id: management.actor.id, audit: managementAuditContext(management) };
}

type Id = { id: string };
type PageInput = { limit?: number; cursor?: string };

export function registerAdminForumRoutes(app: FastifyInstance, { db }: { db: Database }): void {
  app.operation('listForumCategories', async (request) =>
    forumWire(
      await listForumCategories(db, forumActor(request).id, request.query as PageInput, true),
    ),
  );
  app.operation('createForumCategory', async (request, reply) => {
    const actor = forumActor(request);
    const result = await createForumCategory(
      db,
      actor.id,
      request.body as Parameters<typeof createForumCategory>[2],
      actor.audit,
    );
    reply.status(201);
    return forumWire(result);
  });
  app.operation('getForumCategory', async (request) => {
    const { id } = request.params as Id;
    return forumWire(await readForumCategory(db, forumActor(request).id, id, true));
  });
  app.operation('updateForumCategory', async (request) => {
    const { id } = request.params as Id;
    const actor = forumActor(request);
    return forumWire(
      await updateForumCategory(
        db,
        actor.id,
        id,
        request.body as Parameters<typeof updateForumCategory>[3],
        actor.audit,
      ),
    );
  });
  app.operation('deleteForumCategory', async (request, reply) => {
    const { id } = request.params as Id;
    const actor = forumActor(request);
    await updateForumCategory(db, actor.id, id, { archived: true }, actor.audit);
    reply.status(204);
  });
  app.operation('listForumTopicsForModeration', async (request) =>
    forumWire(
      await listForumTopics(db, forumActor(request).id, request.query as ForumTopicQuery, true),
    ),
  );
  app.operation('getForumTopicForModeration', async (request) => {
    const { id } = request.params as Id;
    return forumWire(await readForumTopic(db, forumActor(request).id, id, true));
  });
  app.operation('listForumPostsForModeration', async (request) => {
    const { id } = request.params as Id;
    return forumWire(
      await listForumPosts(db, forumActor(request).id, id, request.query as PageInput, true),
    );
  });
  app.operation('moderateForumTopic', async (request) => {
    const { id } = request.params as Id;
    const actor = forumActor(request);
    return forumWire(
      await moderateForumTopic(db, actor.id, id, request.body as AdminForumTopicPatch, actor.audit),
    );
  });
}
