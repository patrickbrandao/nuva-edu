import type { FastifyInstance } from '@nuva-edu/api-kit';
import { acceptTerms, getLegalDocument } from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { requestContext } from '../session.ts';
import { bodyOf, paramsOf, type RouteContext, requireSession } from './context.ts';

/** Termos de Uso, Política de Privacidade e aceite (spec 030, "Termos na Fase 1"). */
export function registerLegalRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db } = ctx;

  // `GET /legal/{document}`: a vigente, com o texto; sem versão publicada, `404`.
  app.operation('getLegalDocument', async (request) =>
    toWire(await getLegalDocument(db, paramsOf<{ document: string }>(request).document)),
  );

  // `POST /me/terms-acceptance`: um aceite por versão vigente, com IP e navegador.
  app.operation('acceptTerms', async (request, reply) => {
    const current = requireSession(request);
    const { termsVersionIds } = bodyOf<{ termsVersionIds: string[] }>(request);
    const context = requestContext(request);
    await db
      .transaction()
      .execute((trx) =>
        acceptTerms(trx, current.user.id, termsVersionIds, context.ip, context.userAgent ?? null),
      );
    reply.status(204);
  });
}
