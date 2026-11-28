import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  applyForumModerationAction,
  type Database,
  type ForumActionInput,
  type ForumQueueInput,
  type ForumTarget,
  listForumModerationQueue,
  listUserForumModerationHistory,
  reactivateUser,
  readForumModerationTarget,
  warnForumUser,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';
import { forumActor, forumWire } from './forum.ts';
import { userDetailBody } from './users.ts';

type Id = { id: string };
type Reason = { reason: string };

export function registerModerationRoutes(app: FastifyInstance, { db }: { db: Database }): void {
  app.operation('listForumModerationQueue', async (request) =>
    forumWire(
      await listForumModerationQueue(db, forumActor(request).id, request.query as ForumQueueInput),
    ),
  );
  app.operation('getForumModerationCase', async (request) => {
    const { targetType, targetId } = request.params as {
      targetType: ForumTarget;
      targetId: string;
    };
    return forumWire(
      await readForumModerationTarget(db, forumActor(request).id, targetType, targetId),
    );
  });
  app.operation('createForumModerationAction', async (request, reply) => {
    const actor = forumActor(request);
    const result = await applyForumModerationAction(
      db,
      actor.id,
      request.body as ForumActionInput,
      actor.audit,
    );
    reply.status(201);
    return forumWire(result);
  });
  app.operation('listUserForumModerationHistory', async (request) => {
    const { id } = request.params as Id;
    return forumWire(
      await listUserForumModerationHistory(
        db,
        forumActor(request).id,
        id,
        request.query as { limit?: number; cursor?: string },
      ),
    );
  });
  app.operation('warnUser', async (request, reply) => {
    const actor = forumActor(request);
    const { id } = request.params as Id;
    const { reason } = request.body as Reason;
    const result = await warnForumUser(db, actor.id, id, reason, actor.audit);
    reply.status(201);
    return forumWire(result);
  });
  app.operation('unsuspendUser', async (request) => {
    const { id } = request.params as Id;
    const { reason } = request.body as Reason;
    return userDetailBody(await reactivateUser(db, managementRequest(request), id, reason));
  });
}
