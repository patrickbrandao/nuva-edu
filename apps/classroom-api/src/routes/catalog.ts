import type { FastifyInstance, FastifyReply, FastifyRequest } from '@nuva-edu/api-kit';
import {
  type CatalogViewer,
  getCourseView,
  getEbookDownload,
  getEbookView,
  getLessonContent,
  getShowcaseProduct,
  listMyEntitlements,
  listSampleLessons,
  listShowcase,
  type SampleLessonsQuery,
  type ShowcaseQuery,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { paramsOf, type RouteContext, requireSession } from './context.ts';

/**
 * Vitrine e página de produto são iguais para todos e não levam dado de usuário: um cache
 * compartilhado pode guardá-las, mas confere com a API antes de reusar. Produto que vira
 * `private` ou é despublicado some na requisição seguinte (spec 009, "Modos de acesso").
 */
const PUBLIC_CACHE = 'public, no-cache';
/** Resposta que depende do usuário (estado de acesso, direitos): só o navegador, sem reuso cego. */
const PRIVATE_CACHE = 'private, no-cache';

/** O usuário da sessão, com o papel conferido nesta requisição (`authenticateSession`). */
function viewerOf(request: FastifyRequest): CatalogViewer {
  const { user } = requireSession(request);
  return { id: user.id, role: user.role };
}

function privateCache(reply: FastifyReply): void {
  reply.header('Cache-Control', PRIVATE_CACHE);
}

/** Progresso neutro até o núcleo de aprendizado entrar na rota (tarefa 431). */
function noProgress(totalLessons: number) {
  return { completedLessons: 0, totalLessons, percent: 0, state: 'not_started' as const };
}

/**
 * Leituras do catálogo (spec 009) e os direitos do aluno (spec 010). O direito de acesso é
 * decidido pelo núcleo (`canAccess`), dentro de cada função; a rota não o refaz. URL de conteúdo
 * só sai de `getLesson` e de `getEbookDownload`, ambas `no-store`.
 */
export function registerCatalogRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db } = ctx;

  // `GET /catalog`: vitrine, sem login. Os parâmetros chegam validados e com os padrões.
  app.operation('listCatalog', async (request, reply) => {
    reply.header('Cache-Control', PUBLIC_CACHE);
    return toWire(await listShowcase(db, request.query as ShowcaseQuery));
  });

  // `GET /catalog/{type}/{slug}`: `private`, rascunho, arquivado ou inexistente é `404`.
  app.operation('getCatalogProduct', async (request, reply) => {
    const { type, slug } = paramsOf<{ type: string; slug: string }>(request);
    const product = await getShowcaseProduct(db, type, slug);
    reply.header('Cache-Control', PUBLIC_CACHE);
    return toWire(product);
  });

  // `GET /courses/{slug}`: o programa com o estado de acesso. O contrato não tem
  // `certificateEnabled`. Progresso, "Continuar" e certificado vêm com as tarefas 431 e 433;
  // até lá saem neutros: nada concluído, sem aula para continuar, sem certificado.
  app.operation('getCourse', async (request, reply) => {
    const { slug } = paramsOf<{ slug: string }>(request);
    const view = await getCourseView(db, viewerOf(request), slug);
    const { certificateEnabled: _certificateEnabled, modules, ...course } = view;
    privateCache(reply);
    return toWire({
      ...course,
      progress: noProgress(view.lessonCount),
      continueLessonId: null,
      certificate: null,
      modules: modules.map(({ lessonCount, lessons, ...module }) => ({
        ...module,
        progress: noProgress(lessonCount),
        lessons: lessons.map((lesson) => ({ ...lesson, completed: false })),
      })),
    });
  });

  // `GET /lessons/{id}`: sem acesso, o núcleo lança `403 access_denied` com `reason` e nenhum
  // dado da aula. A abertura (`lastOpenedAt`) e o `userState` real entram com a tarefa 431.
  app.operation(
    'getLesson',
    async (request) => {
      const { id } = paramsOf<{ id: string }>(request);
      const { access: _access, ...lesson } = await getLessonContent(db, viewerOf(request), id);
      return toWire({
        ...lesson,
        userState: {
          completedAt: null,
          completedVia: null,
          positionSeconds: null,
          lastOpenedAt: null,
        },
      });
    },
    { noStore: true },
  );

  // `GET /samples`: "Aulas liberadas".
  app.operation('listSampleLessons', async (request, reply) => {
    const page = await listSampleLessons(
      db,
      viewerOf(request),
      request.query as SampleLessonsQuery,
    );
    privateCache(reply);
    return toWire(page);
  });

  // `GET /ebooks/{slug}`: o ebook com o estado de acesso, sem a URL do arquivo.
  app.operation('getEbook', async (request, reply) => {
    const { slug } = paramsOf<{ slug: string }>(request);
    const ebook = await getEbookView(db, viewerOf(request), slug);
    privateCache(reply);
    return toWire(ebook);
  });

  // `GET /ebooks/{id}/download`: a URL externa, só a quem tem acesso.
  app.operation(
    'getEbookDownload',
    async (request) => {
      const { id } = paramsOf<{ id: string }>(request);
      return getEbookDownload(db, viewerOf(request), id);
    },
    { noStore: true },
  );

  // `GET /me/entitlements`: os direitos do próprio usuário, com os vencidos, sem os revogados.
  app.operation('listMyEntitlements', async (request, reply) => {
    const list = await listMyEntitlements(db, requireSession(request).user.id);
    privateCache(reply);
    return toWire(list);
  });
}
