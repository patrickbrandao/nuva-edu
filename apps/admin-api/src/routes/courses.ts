import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type AdminCourseDetail,
  type AdminCourseModule,
  type AdminCourseSummary,
  type AdminLessonDetail,
  type AdminLessonSummary,
  archiveCourse,
  type CatalogRequest,
  cancelCourseReview,
  createCourse,
  createLesson,
  createModule,
  type Database,
  deleteCourse,
  deleteLesson,
  deleteModule,
  getAdminCourse,
  getAdminLesson,
  listAdminCourses,
  notFound,
  publishCourse,
  reorderLessons,
  reorderModules,
  requestCourseReview,
  setCourseOwner,
  setLessonLinks,
  unarchiveCourse,
  unpublishCourse,
  updateCourse,
  updateLesson,
  updateModule,
} from '@nuva-edu/core';
import {
  catalogRequest,
  coverBody,
  type IdParams,
  iso,
  isoOrNull,
  pick,
  slugFromTitle,
  withCurrentVersion,
} from './catalog-common.ts';

// Cursos, módulos, aulas e links de apoio (spec 009; 008, "Regra do instrutor"). O tratador de
// `sessionCookie` confere a ação de `x-permission`; o que depende do alvo (curso alheio ao
// instrutor é `404`; modo de acesso, preço, dono e publicação exigem ações próprias) fica nas
// regras do núcleo, que também gravam a negação e a auditoria de cada escrita (spec 028).
//
// As regras de escrita devolvem a linha gravada; a resposta é sempre a leitura do editor
// (`getAdminCourse`, `getAdminLesson`), montada campo a campo: a `version` que o núcleo traz não
// está nos esquemas `CourseDetail`, `CourseModule` e `LessonDetail` e não sai na resposta.

export interface CourseRoutesOptions {
  db: Database;
}

/** `CourseSummary` do contrato. */
export function courseSummaryBody(course: AdminCourseSummary) {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    summary: course.summary,
    cover: coverBody(course.cover),
    accessMode: course.accessMode,
    priceCents: course.priceCents,
    accessDays: course.accessDays,
    status: course.status,
    level: course.level,
    owner: course.owner === null ? null : { id: course.owner.id, name: course.owner.name },
    reviewRequestedAt: isoOrNull(course.reviewRequestedAt),
    moduleCount: course.moduleCount,
    lessonCount: course.lessonCount,
    durationSeconds: course.durationSeconds,
    publishedAt: isoOrNull(course.publishedAt),
    archivedAt: isoOrNull(course.archivedAt),
    createdAt: iso(course.createdAt),
    updatedAt: iso(course.updatedAt),
  };
}

/** `LessonSummary` do contrato. */
function lessonSummaryBody(lesson: AdminLessonSummary) {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    status: lesson.status,
    isSample: lesson.isSample,
    durationSeconds: lesson.durationSeconds,
    videoProvider: lesson.videoProvider,
    position: lesson.position,
  };
}

/** `CourseModule` do contrato. */
function moduleBody(module: Omit<AdminCourseModule, 'version'>) {
  return {
    id: module.id,
    courseId: module.courseId,
    title: module.title,
    position: module.position,
    lessons: module.lessons.map(lessonSummaryBody),
    createdAt: iso(module.createdAt),
    updatedAt: iso(module.updatedAt),
  };
}

/** `CourseDetail` do contrato. */
export function courseDetailBody(course: AdminCourseDetail) {
  return {
    ...courseSummaryBody(course),
    description: course.description,
    certificateEnabled: course.certificateEnabled,
    certificateHours: course.certificateHours,
    studentCount: course.studentCount,
    modules: course.modules.map(moduleBody),
  };
}

/** `LessonDetail` do contrato. */
export function lessonDetailBody(lesson: AdminLessonDetail) {
  return {
    id: lesson.id,
    courseId: lesson.courseId,
    moduleId: lesson.moduleId,
    title: lesson.title,
    description: lesson.description,
    type: lesson.type,
    status: lesson.status,
    isSample: lesson.isSample,
    videoUrl: lesson.videoUrl,
    videoProvider: lesson.videoProvider,
    durationSeconds: lesson.durationSeconds,
    position: lesson.position,
    links: lesson.links.map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      kind: link.kind,
      position: link.position,
    })),
    ebooks: lesson.ebooks.map((ebook) => ({
      id: ebook.id,
      slug: ebook.slug,
      title: ebook.title,
      status: ebook.status,
    })),
    createdAt: iso(lesson.createdAt),
    updatedAt: iso(lesson.updatedAt),
  };
}

const COURSE_FIELDS = [
  'slug',
  'title',
  'summary',
  'description',
  'coverImageId',
  'level',
  'accessMode',
  'priceCents',
  'accessDays',
  'certificateEnabled',
  'certificateHours',
] as const;

const LESSON_FIELDS = ['title', 'videoUrl', 'durationSeconds', 'isSample', 'status'] as const;

/**
 * Campos de aula do corpo. No contrato `durationSeconds` aceita `null` ("sem duração"); a coluna
 * não é nula, então `null` vai ao núcleo como `0`.
 */
function lessonFields(body: Record<string, unknown>) {
  const fields = pick(body, LESSON_FIELDS);
  if (fields.durationSeconds === null) {
    fields.durationSeconds = 0;
  }
  return fields;
}

export function registerCourseRoutes(app: FastifyInstance, options: CourseRoutesOptions): void {
  const { db } = options;

  /**
   * O curso e a `version` de um módulo. O núcleo não tem leitura de módulo por id: a busca do
   * curso é feita aqui, só pelas duas colunas; quem decide se o ator alcança o curso é o núcleo
   * (`getAdminCourse` e as regras de escrita), e módulo de curso alheio continua `404`.
   */
  async function moduleRef(moduleId: string): Promise<{ courseId: string; version: number }> {
    const row = await db
      .selectFrom('modules')
      .select(['courseId', 'version'])
      .where('id', '=', moduleId.toLowerCase())
      .executeTakeFirst();
    if (!row) {
      throw notFound('Módulo não encontrado.');
    }
    return row;
  }

  /** O módulo como o editor o vê, com as aulas na ordem. */
  async function moduleView(actor: CatalogRequest, courseId: string, moduleId: string) {
    const course = await getAdminCourse(db, actor, courseId);
    const module = course.modules.find((item) => item.id === moduleId.toLowerCase());
    if (!module) {
      throw notFound('Módulo não encontrado.');
    }
    return moduleBody(module);
  }

  // `GET /api/v1/courses`: filtros e cursor; o instrutor vê só os cursos de que é dono.
  app.operation('listCourses', async (request) => {
    const query = request.query as Record<string, unknown>;
    const page = await listAdminCourses(db, catalogRequest(request), {
      q: query.q,
      status: query.status,
      accessMode: query.accessMode,
      ownerId: query.ownerId,
      awaitingReview: query.awaitingReview,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor,
    });
    return { items: page.items.map(courseSummaryBody), nextCursor: page.nextCursor };
  });

  // `POST /api/v1/courses`: nasce `draft`; sem `slug`, ele sai do título.
  app.operation('createCourse', async (request, reply) => {
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown> & { title: string };
    const created = await createCourse(db, actor, {
      ...pick(body, COURSE_FIELDS),
      ...pick(body, ['ownerId'] as const),
      title: body.title,
      slug: typeof body.slug === 'string' ? body.slug : slugFromTitle(body.title),
    });
    return reply.status(201).send(courseDetailBody(await getAdminCourse(db, actor, created.id)));
  });

  app.operation('getCourse', async (request) => {
    const { id } = request.params as IdParams;
    return courseDetailBody(await getAdminCourse(db, catalogRequest(request), id));
  });

  // `PATCH /api/v1/courses/{id}`: campo omitido não muda. Modo de acesso e preço: `403` do
  // núcleo para quem não tem a ação.
  app.operation('updateCourse', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const fields = pick(request.body as Record<string, unknown>, COURSE_FIELDS);
    await withCurrentVersion(
      async () => (await getAdminCourse(db, actor, id)).version,
      (version) => updateCourse(db, actor, id, { ...fields, version }),
    );
    return courseDetailBody(await getAdminCourse(db, actor, id));
  });

  app.operation('deleteCourse', async (request, reply) => {
    const { id } = request.params as IdParams;
    await deleteCourse(db, catalogRequest(request), id);
    return reply.status(204).send();
  });

  // Mudanças de estado do curso: a regra grava e a resposta é o curso como o editor o vê.
  const transitions = {
    publishCourse,
    unpublishCourse,
    archiveCourse,
    unarchiveCourse,
    requestCourseReview,
    cancelCourseReview,
  } as const;
  for (const [operationId, transition] of Object.entries(transitions)) {
    app.operation(operationId, async (request) => {
      const { id } = request.params as IdParams;
      const actor = catalogRequest(request);
      const course = await transition(db, actor, id);
      return courseDetailBody(await getAdminCourse(db, actor, course.id));
    });
  }

  // `PATCH /api/v1/courses/{id}/owner`: gerente e admin; `null` deixa o curso sem dono.
  app.operation('setCourseOwner', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const { ownerId } = request.body as { ownerId: string | null };
    const course = await setCourseOwner(db, actor, id, { ownerId });
    return courseDetailBody(await getAdminCourse(db, actor, course.id));
  });

  app.operation('createModule', async (request, reply) => {
    const { id } = request.params as IdParams;
    const { title } = request.body as { title: string };
    const module = await createModule(db, catalogRequest(request), id, { title });
    return reply.status(201).send(moduleBody({ ...module, lessons: [] }));
  });

  app.operation('reorderModules', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const { moduleIds } = request.body as { moduleIds: string[] };
    await reorderModules(db, actor, id, { moduleIds });
    const course = await getAdminCourse(db, actor, id);
    return { items: course.modules.map(moduleBody) };
  });

  app.operation('updateModule', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const { title } = request.body as { title: string };
    const module = await withCurrentVersion(
      async () => (await moduleRef(id)).version,
      (version) => updateModule(db, actor, id, { title, version }),
    );
    return moduleView(actor, module.courseId, module.id);
  });

  app.operation('deleteModule', async (request, reply) => {
    const { id } = request.params as IdParams;
    await deleteModule(db, catalogRequest(request), id);
    return reply.status(204).send();
  });

  // `POST /api/v1/modules/{id}/lessons`: aula `draft` no fim do módulo.
  app.operation('createLesson', async (request, reply) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown> & { title: string };
    const lesson = await createLesson(db, actor, id, {
      ...lessonFields(body),
      title: body.title,
    });
    return reply.status(201).send(lessonDetailBody(await getAdminLesson(db, actor, lesson.id)));
  });

  // `PUT /api/v1/modules/{id}/lessons/order`: aula de outro módulo do mesmo curso é movida.
  app.operation('reorderLessons', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const { lessonIds } = request.body as { lessonIds: string[] };
    await reorderLessons(db, actor, id, { lessonIds });
    return moduleView(actor, (await moduleRef(id)).courseId, id);
  });

  app.operation('getLesson', async (request) => {
    const { id } = request.params as IdParams;
    return lessonDetailBody(await getAdminLesson(db, catalogRequest(request), id));
  });

  // `PATCH /api/v1/lessons/{id}`: `status` publica ou despublica, com a regra do curso.
  app.operation('updateLesson', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const fields = lessonFields(request.body as Record<string, unknown>);
    await withCurrentVersion(
      async () => (await getAdminLesson(db, actor, id)).version,
      (version) => updateLesson(db, actor, id, { ...fields, version }),
    );
    return lessonDetailBody(await getAdminLesson(db, actor, id));
  });

  app.operation('deleteLesson', async (request, reply) => {
    const { id } = request.params as IdParams;
    await deleteLesson(db, catalogRequest(request), id);
    return reply.status(204).send();
  });

  // `PUT /api/v1/lessons/{id}/links`: troca a lista inteira, na ordem enviada.
  app.operation('setLessonLinks', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const { links } = request.body as {
      links: Array<{ label: string; url: string | null; kind: string }>;
    };
    await setLessonLinks(db, actor, id, {
      links: links.map((link) => ({ label: link.label, url: link.url, kind: link.kind })),
    });
    return lessonDetailBody(await getAdminLesson(db, actor, id));
  });
}
