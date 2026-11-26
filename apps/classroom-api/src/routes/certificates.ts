import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  assertCan,
  type CatalogViewer,
  getMyCertificatePdf,
  listMyCertificates,
  type PermissionAction,
  setCertificateName,
  verifyCertificate,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { privateCache, viewerOf } from './catalog.ts';
import { bodyOf, paramsOf, type RouteContext } from './context.ts';

/** O aluno da sessão, com a permissão da operação (`x-permission`) conferida pelo papel. */
function studentOf(request: FastifyRequest, action: PermissionAction): CatalogViewer {
  const viewer = viewerOf(request);
  assertCan(viewer, action);
  return viewer;
}

/**
 * Certificados do lado do aluno e a validação pública (spec 015). As regras (só o dono baixa,
 * revogado e sem PDF pela exclusão da conta dão `404`, "em preparação" é `409`, a mesma resposta
 * para qualquer código inexistente) são do núcleo; a rota só adapta ao contrato. O limite de 30
 * validações por minuto por IP fica em `rate-limits.ts`.
 */
export function registerCertificateRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { config, db } = ctx;

  // `GET /me/certificates`: os certificados (todos os estados), o nome dos próximos e, à parte,
  // os cursos concluídos que aguardam template.
  app.operation('listMyCertificates', async (request, reply) => {
    const list = await listMyCertificates(db, studentOf(request, 'learning.track'), {
      classroomUrl: config.classroomUrl,
    });
    privateCache(reply);
    return toWire(list);
  });

  // `GET /me/certificates/{id}/pdf`: o arquivo guardado, sem nova renderização. De outro aluno,
  // inexistente ou revogado: `404`; PDF ainda não gerado: `409 certificate_preparing`.
  app.operation(
    'getMyCertificatePdf',
    async (request, reply) => {
      const { id } = paramsOf<{ id: string }>(request);
      const file = await getMyCertificatePdf(db, studentOf(request, 'learning.track'), id);
      reply.headers({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'X-Content-Type-Options': 'nosniff',
      });
      return file.pdf;
    },
    { noStore: true },
  );

  // `PUT /me/certificate-name`: grava o nome completo dos próximos certificados, sem prazo de
  // confirmação (ADR 0026). `null` apaga e vale o nome de exibição.
  app.operation('setCertificateName', async (request) => {
    const name = await setCertificateName(
      db,
      studentOf(request, 'account.self_service'),
      bodyOf<{ fullName: string | null }>(request),
    );
    return toWire(name);
  });

  // `GET /certificates/verify/{code}`: público. Com ou sem hífens, em qualquer caixa; inexistente
  // e fora do formato dão o mesmo `404 certificate_not_found`. A resposta muda com a revogação,
  // então o cache confere com a API antes de reusar.
  app.operation('verifyCertificate', async (request, reply) => {
    const { code } = paramsOf<{ code: string }>(request);
    const verification = await verifyCertificate(db, code);
    reply.header('Cache-Control', 'no-cache');
    return toWire(verification);
  });
}
