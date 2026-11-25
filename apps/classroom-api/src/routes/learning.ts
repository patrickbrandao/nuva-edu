import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  getCourseProgress,
  getMyActivity,
  getMyProgress,
  listContinueWatching,
  listMyCourses,
  listMyEbooks,
  type SaveLessonProgressInput,
  type ShelfQuery,
  saveLessonProgress,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { privateCache, viewerOf } from './catalog.ts';
import { bodyOf, paramsOf, type RouteContext } from './context.ts';

/**
 * Aprendizado e progresso (spec 014): gravar conclusão e posição, estante, "continue assistindo",
 * progresso e mapa de atividade. As regras (direito de acesso por `canAccess`, faixa da posição,
 * `course.completed` na mesma transação) são do núcleo; a rota só adapta ao contrato. A abertura
 * da aula e o curso com progresso ficam em `catalog.ts` (`getLesson`, `getCourse`).
 *
 * O estado do certificado (`certificate`) é composto na tarefa 433; até lá sai `null`, que o
 * contrato define como "certificado desabilitado".
 */
export function registerLearningRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db } = ctx;

  // `PUT /lessons/{id}/progress`: só os campos enviados. `403 access_denied` com `reason` sem
  // acesso, `404` aula fora do ar, `422 position_out_of_range`. O contrato não tem
  // `courseCompleted`: o site lê o `course.progress` devolvido.
  app.operation(
    'saveLessonProgress',
    async (request) => {
      const { id } = paramsOf<{ id: string }>(request);
      const { courseCompleted: _courseCompleted, ...result } = await saveLessonProgress(
        db,
        viewerOf(request),
        id,
        bodyOf<SaveLessonProgressInput>(request),
      );
      return toWire(result);
    },
    { noStore: true },
  );

  // `GET /me/courses`: a estante. Filtro, busca e ordem chegam validados e com os padrões.
  app.operation('listMyCourses', async (request, reply) => {
    const shelf = await listMyCourses(db, viewerOf(request), request.query as ShelfQuery);
    privateCache(reply);
    return toWire({
      ...shelf,
      items: shelf.items.map(({ certificateEnabled: _certificateEnabled, ...course }) => ({
        ...course,
        certificate: null,
      })),
    });
  });

  // `GET /me/continue`: até 3 cursos em andamento, com a aula de "Continuar".
  app.operation('listContinueWatching', async (request, reply) => {
    const list = await listContinueWatching(db, viewerOf(request));
    privateCache(reply);
    return toWire(list);
  });

  // `GET /courses/{slug}/progress`: por módulo e aula; `private` sem direito é `404`.
  app.operation('getCourseProgress', async (request, reply) => {
    const { slug } = paramsOf<{ slug: string }>(request);
    const progress = await getCourseProgress(db, viewerOf(request), slug);
    privateCache(reply);
    return toWire(progress);
  });

  // `GET /me/progress`: os cursos iniciados, um quadrado por aula.
  app.operation('getMyProgress', async (request, reply) => {
    const progress = await getMyProgress(db, viewerOf(request));
    privateCache(reply);
    return toWire(progress);
  });

  // `GET /me/activity`: os dias com atividade das últimas 53 semanas, no fuso do usuário.
  app.operation('getMyActivity', async (request, reply) => {
    const map = await getMyActivity(db, viewerOf(request));
    privateCache(reply);
    return toWire(map);
  });

  // `GET /me/ebooks`: os ebooks com direito ativo; o arquivo sai só de `getEbookDownload`.
  app.operation('listMyEbooks', async (request, reply) => {
    const list = await listMyEbooks(db, viewerOf(request));
    privateCache(reply);
    return toWire(list);
  });
}
