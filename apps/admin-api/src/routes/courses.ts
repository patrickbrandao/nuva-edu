import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type AdminCourseDetail,
  type AdminCourseModule,
  type AdminCourseSummary,
  type AdminEbookRef,
  type AdminLessonDetail,
  type AdminLessonSummary,
  archiveCourse,
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
  getAdminModule,
  listAdminCourses,
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
} from './catalog-common.ts';

// Cursos, módulos, aulas e links de apoio (spec 009; 008, "Regra do instrutor"). O tratador de
// `sessionCookie` confere a ação de `x-permission`; o que depende do alvo (curso alheio ao
// instrutor é `404`; modo de acesso, preço, dono e publicação exigem ações próprias) fica nas
// regras do núcleo, que também gravam a negação e a auditoria de cada escrita (spec 028).
//
// As regras de escrita devolvem a linha gravada; a resposta é sempre a leitura do editor
// (`getAdminCourse`, `getAdminModule`, `getAdminLesson`), montada campo a campo, com a `version`
// da edição. A `version` do corpo (obrigatória nos `PATCH`, opcional nas trocas de lista e no
// dono) vai ao núcleo como veio: diferente da gravada é `409` `version_conflict`, sem gravar.

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
function moduleBody(module: AdminCourseModule) {
  return {
    id: module.id,
    courseId: module.courseId,
    title: module.title,
    position: module.position,
    version: module.version,
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
    version: course.version,
    studentCount: course.studentCount,
    modules: course.modules.map(moduleBody),
    ebooks: course.ebooks.map(ebookRefBody),
  };
}

/** `EbookRef` do contrato. */
function ebookRefBody(ebook: AdminEbookRef) {
  return { id: ebook.id, slug: ebook.slug, title: ebook.title, status: ebook.status };
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
    version: lesson.version,
    links: lesson.links.map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      kind: link.kind,
      position: link.position,
    })),
    ebooks: lesson.ebooks.map(ebookRefBody),
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

/** Campos de aula do corpo; `durationSeconds` `null` ("sem duração") vai ao núcleo como veio. */
const LESSON_FIELDS = ['title', 'videoUrl', 'durationSeconds', 'isSample', 'status'] as const;

export function registerCourseRoutes(app: FastifyInstance, options: CourseRoutesOptions): void {
  const { db } = options;

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

  // `POST /api/v1/courses`: nasce `draft`; sem `slug`, o núcleo o gera do título.
  app.operation('createCourse', async (request, reply) => {
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown> & { title: string };
    const created = await createCourse(db, actor, {
      ...pick(body, COURSE_FIELDS),
      ...pick(body, ['ownerId'] as const),
      title: body.title,
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
    const body = request.body as Record<string, unknown>;
    await updateCourse(db, actor, id, { ...pick(body, COURSE_FIELDS), version: body.version });
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
    const { ownerId, version } = request.body as { ownerId: string | null; version?: number };
    const course = await setCourseOwner(db, actor, id, { ownerId, version });
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
    const { title, version } = request.body as { title: string; version: number };
    await updateModule(db, actor, id, { title, version });
    return moduleBody(await getAdminModule(db, actor, id));
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
      ...pick(body, LESSON_FIELDS),
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
    return moduleBody(await getAdminModule(db, actor, id));
  });

  app.operation('getLesson', async (request) => {
    const { id } = request.params as IdParams;
    return lessonDetailBody(await getAdminLesson(db, catalogRequest(request), id));
  });

  // `PATCH /api/v1/lessons/{id}`: `status` publica ou despublica, com a regra do curso.
  app.operation('updateLesson', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown>;
    await updateLesson(db, actor, id, { ...pick(body, LESSON_FIELDS), version: body.version });
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
    const { links, version } = request.body as {
      links: Array<{ label: string; url: string | null; kind: string }>;
      version?: number;
    };
    await setLessonLinks(db, actor, id, {
      links: links.map((link) => ({ label: link.label, url: link.url, kind: link.kind })),
      version,
    });
    return lessonDetailBody(await getAdminLesson(db, actor, id));
  });
}
