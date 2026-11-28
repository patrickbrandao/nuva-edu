import type { FastifyInstance } from '@nuva-edu/api-kit';
import { type CreateForumReportInput, createForumReport, listMyForumReports } from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { privateCache } from './catalog.ts';
import { bodyOf, type RouteContext, requireSession } from './context.ts';

export function registerReportRoutes(app: FastifyInstance, { db }: RouteContext): void {
  app.operation('createForumReport', async (request, reply) => {
    const session = requireSession(request);
    const result = await createForumReport(
      db,
      session.user.id,
      bodyOf<CreateForumReportInput>(request),
    );
    reply.status(result.created ? 201 : 200);
    privateCache(reply);
    return toWire(result.report);
  });
  app.operation('listMyForumReports', async (request, reply) => {
    const session = requireSession(request);
    privateCache(reply);
    return toWire(
      await listMyForumReports(
        db,
        session.user.id,
        request.query as { limit?: number; cursor?: string },
      ),
    );
  });
}
