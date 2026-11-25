// Módulos, aulas e links de apoio (spec 009, RF-01, RF-05, RF-08, RF-09): criar, alterar,
// excluir, reordenar e trocar a lista de links. Alcance do curso (008): o instrutor só nos
// próprios cursos, e curso alheio é `404`. Dono dos dados: admin-api.

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import {
  assertCatalogId,
  assertVersion,
  type CatalogRequest,
  catalogAudit,
  catalogWrite,
  diffFields,
  enqueueCompletionCheck,
  enqueueRecomputes,
  requireCatalogAction,
} from './common.ts';
import {
  type CatalogCourse,
  clearReviewIfNoDraftLessons,
  loadCourseForWrite,
  requireCoursePublication,
} from './courses.ts';
import {
  CATALOG_LIMITS,
  catalogLimitExceeded,
  catalogRule,
  FieldErrors,
  LESSON_LINK_KINDS,
  type LessonLinkKind,
  PUBLICATION_STATUSES,
  type PublicationStatus,
  readArray,
  readBoolean,
  readEnum,
  readInteger,
  readObject,
  readOptionalText,
  readOptionalVersion,
  readTitle,
  readVersion,
} from './fields.ts';
import { assertContentUrl, parseVideoUrl, type VideoProvider } from './urls.ts';

export interface CatalogModule {
  id: string;
  courseId: string;
  title: string;
  position: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogLesson {
  id: string;
  moduleId: string;
  title: string;
  description: string | null;
  type: 'video';
  videoUrl: string | null;
  videoProvider: VideoProvider | null;
  durationSeconds: number;
  isSample: boolean;
  status: PublicationStatus;
  position: number;
  forumTopicId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogLessonLink {
  id: string;
  lessonId: string;
  label: string;
  url: string;
  kind: LessonLinkKind;
  position: number;
}

async function findLesson(trx: Database, lessonId: string): Promise<CatalogLesson | undefined> {
  const row = await trx
    .selectFrom('lessons')
    .selectAll()
    .where('id', '=', lessonId)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    ...row,
    type: 'video',
    videoProvider: row.videoProvider as VideoProvider | null,
    status: row.status as PublicationStatus,
  };
}

/** Lista os links de apoio da aula, na ordem. */
export async function listCatalogLessonLinks(
  db: Database,
  lessonId: string,
): Promise<CatalogLessonLink[]> {
  const rows = await db
    .selectFrom('lessonLinks')
    .select(['id', 'lessonId', 'label', 'url', 'kind', 'position'])
    .where('lessonId', '=', lessonId)
    .orderBy('position')
    .execute();
  return rows.map((row) => ({ ...row, kind: row.kind as LessonLinkKind }));
}

/** Trava o curso do módulo (sempre o curso antes do módulo) e exige a ação. */
async function loadModuleForWrite(
  trx: Database,
  request: CatalogRequest,
  moduleId: unknown,
  auditAction: string,
): Promise<{ course: CatalogCourse; module: CatalogModule }> {
  const id = assertCatalogId(moduleId, 'Módulo');
  const ref = await trx
    .selectFrom('modules')
    .select('courseId')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!ref) throw notFound('Módulo não encontrado.');
  const course = await loadCourseForWrite(trx, request, ref.courseId, 'course.edit', auditAction);
  const module = await trx
    .selectFrom('modules')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!module) throw notFound('Módulo não encontrado.');
  return { course, module };
}

async function loadLessonForWrite(
  trx: Database,
  request: CatalogRequest,
  lessonId: unknown,
  auditAction: string,
): Promise<{ course: CatalogCourse; lesson: CatalogLesson }> {
  const id = assertCatalogId(lessonId, 'Aula');
  const ref = await trx
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select('modules.courseId')
    .where('lessons.id', '=', id)
    .executeTakeFirst();
  if (!ref) throw notFound('Aula não encontrada.');
  const course = await loadCourseForWrite(trx, request, ref.courseId, 'course.edit', auditAction);
  await trx.selectFrom('lessons').select('id').where('id', '=', id).forUpdate().execute();
  const lesson = await findLesson(trx, id);
  if (!lesson) throw notFound('Aula não encontrada.');
  return { course, lesson };
}

/** Grava a ordem nova de uma lista inteira numa só instrução (único adiado até o COMMIT). */
async function writeOrder(
  trx: Database,
  table: 'modules' | 'lessons',
  ids: readonly string[],
): Promise<void> {
  await sql`
    UPDATE ${sql.table(table)} AS t SET position = o.ord - 1
    FROM unnest(${sql.val(ids)}::uuid[]) WITH ORDINALITY AS o(id, ord)
    WHERE t.id = o.id`.execute(trx);
}

/** A lista pedida precisa ser exatamente a atual, em outra ordem. */
function readPermutation(value: unknown, current: readonly string[], path: string): string[] {
  const errors = new FieldErrors();
  const list = readArray(errors, value, path);
  errors.throwIfAny();
  const ids = list.map((item) => (typeof item === 'string' ? item.toLowerCase() : ''));
  const same =
    ids.length === current.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => current.includes(id));
  if (!same) {
    throw catalogRule(
      'order_mismatch',
      'A ordem precisa listar exatamente os itens atuais, cada um uma vez. Recarregue.',
    );
  }
  return ids;
}

// Módulos.

/**
 * `POST /courses/{id}/modules` (`course.edit`): módulo novo no fim. Até 100 por curso (`422`
 * `catalog_limit_exceeded`). Grava `module.create`.
 */
export async function createModule(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
  input: { title: unknown },
): Promise<CatalogModule> {
  return catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(trx, request, courseId, 'course.edit', 'module.create');
    const errors = new FieldErrors();
    const title = readTitle(errors, input.title, 'body.title');
    errors.throwIfAny();
    const stats = await trx
      .selectFrom('modules')
      .select([
        sql<number>`count(*)::int`.as('count'),
        sql<number>`coalesce(max(position) + 1, 0)::int`.as('next'),
      ])
      .where('courseId', '=', course.id)
      .executeTakeFirstOrThrow();
    if (stats.count >= CATALOG_LIMITS.modulesPerCourse) {
      throw catalogLimitExceeded(
        'modulesPerCourse',
        `O curso já tem ${CATALOG_LIMITS.modulesPerCourse} módulos.`,
      );
    }
    const module = await trx
      .insertInto('modules')
      .values({ courseId: course.id, title, position: stats.next })
      .returningAll()
      .executeTakeFirstOrThrow();
    await catalogAudit(trx, request, {
      action: 'module.create',
      targetType: 'module',
      targetId: module.id,
      details: { courseId: course.id, title },
    });
    return module;
  });
}

/** `PATCH /modules/{id}` (`course.edit`): título, com `version`. Grava `module.update`. */
export async function updateModule(
  db: Database,
  request: CatalogRequest,
  moduleId: unknown,
  input: { title?: unknown; version: unknown },
): Promise<CatalogModule> {
  return catalogWrite(db, request, async (trx) => {
    const { module } = await loadModuleForWrite(trx, request, moduleId, 'module.update');
    const version = readVersion(input.version);
    const errors = new FieldErrors();
    const title =
      input.title === undefined ? module.title : readTitle(errors, input.title, 'body.title');
    errors.throwIfAny();
    assertVersion(module.version, version);
    if (title === module.title) return module;
    const updated = await trx
      .updateTable('modules')
      .set({ title, version: sql<number>`version + 1` })
      .where('id', '=', module.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await catalogAudit(trx, request, {
      action: 'module.update',
      targetType: 'module',
      targetId: module.id,
      details: { title: { from: module.title, to: title } },
    });
    return updated;
  });
}

/**
 * Efeitos de aulas que saem do curso: os vínculos de ebook a elas somem (recálculo do curso) e,
 * se alguma estava publicada num curso publicado, `course.completion_check`.
 */
async function afterLessonsRemoved(
  trx: Database,
  course: CatalogCourse,
  lessons: readonly { id: string; status: string }[],
): Promise<void> {
  if (lessons.length === 0) return;
  const removed = await trx
    .deleteFrom('productEbooks')
    .where('targetType', '=', 'lesson')
    .where(
      'targetId',
      'in',
      lessons.map((lesson) => lesson.id),
    )
    .executeTakeFirst();
  if (Number(removed.numDeletedRows) > 0) {
    await enqueueRecomputes(trx, [{ productType: 'course', productId: course.id }]);
  }
  if (course.status === 'published' && lessons.some((lesson) => lesson.status === 'published')) {
    await enqueueCompletionCheck(trx, course.id);
  }
}

/**
 * `DELETE /modules/{id}` (`course.edit`): apaga o módulo e as aulas (cascata), com os efeitos de
 * `afterLessonsRemoved`. Grava `module.delete`.
 */
export async function deleteModule(
  db: Database,
  request: CatalogRequest,
  moduleId: unknown,
): Promise<void> {
  await catalogWrite(db, request, async (trx) => {
    const { course, module } = await loadModuleForWrite(trx, request, moduleId, 'module.delete');
    const lessons = await trx
      .selectFrom('lessons')
      .select(['id', 'status'])
      .where('moduleId', '=', module.id)
      .execute();
    await afterLessonsRemoved(trx, course, lessons);
    await trx.deleteFrom('modules').where('id', '=', module.id).execute();
    await catalogAudit(trx, request, {
      action: 'module.delete',
      targetType: 'module',
      targetId: module.id,
      details: { courseId: course.id, title: module.title, lessons: lessons.length },
    });
  });
}

/**
 * `PUT /courses/{id}/modules/order` (`course.edit`): a lista inteira dos módulos na ordem nova,
 * gravada numa transação. Lista diferente da atual: `422` `order_mismatch`. Grava
 * `module.reorder` (alvo: o curso não é módulo, então o alvo é o curso).
 */
export async function reorderModules(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
  input: { moduleIds: unknown },
): Promise<CatalogModule[]> {
  return catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(
      trx,
      request,
      courseId,
      'course.edit',
      'module.reorder',
    );
    const current = await trx
      .selectFrom('modules')
      .select('id')
      .where('courseId', '=', course.id)
      .orderBy('position')
      .execute();
    const ids = readPermutation(
      input.moduleIds,
      current.map((row) => row.id),
      'body.moduleIds',
    );
    await writeOrder(trx, 'modules', ids);
    await catalogAudit(trx, request, {
      action: 'module.reorder',
      targetType: 'course',
      targetId: course.id,
      details: { moduleIds: ids },
    });
    return trx
      .selectFrom('modules')
      .selectAll()
      .where('courseId', '=', course.id)
      .orderBy('position')
      .execute();
  });
}

// Aulas.

interface LessonFields {
  title?: string;
  description?: string | null;
  videoUrl?: string | null;
  videoProvider?: VideoProvider | null;
  durationSeconds?: number;
  isSample?: boolean;
  status?: PublicationStatus;
}

export interface LessonFieldsInput {
  title?: unknown;
  description?: unknown;
  /** `null` tira o vídeo. O provedor é classificado aqui, na gravação. */
  videoUrl?: unknown;
  durationSeconds?: unknown;
  /** Amostra grátis: `product.set_access` sobre o curso (o instrutor no próprio). */
  isSample?: unknown;
  /** Publicar e despublicar: a regra de publicação do curso. */
  status?: unknown;
}

function readLessonFields(errors: FieldErrors, input: LessonFieldsInput): LessonFields {
  const fields: LessonFields = {};
  if (input.title !== undefined) fields.title = readTitle(errors, input.title, 'body.title');
  if (input.description !== undefined) {
    fields.description = readOptionalText(
      errors,
      input.description,
      'body.description',
      CATALOG_LIMITS.descriptionMaxLength,
      { trim: false },
    );
  }
  if (input.durationSeconds !== undefined) {
    fields.durationSeconds = readInteger(
      errors,
      input.durationSeconds,
      'body.durationSeconds',
      0,
      CATALOG_LIMITS.lessonDurationMaxSeconds,
    );
  }
  if (input.isSample !== undefined) {
    fields.isSample = readBoolean(errors, input.isSample, 'body.isSample');
  }
  if (input.status !== undefined) {
    fields.status = readEnum(errors, input.status, 'body.status', PUBLICATION_STATUSES);
  }
  return fields;
}

/** URL do vídeo validada depois dos campos de formato (é `422`, não `400`). */
function readLessonVideo(fields: LessonFields, input: LessonFieldsInput): void {
  if (input.videoUrl === undefined) return;
  if (input.videoUrl === null) {
    fields.videoUrl = null;
    fields.videoProvider = null;
    return;
  }
  const parsed = parseVideoUrl(input.videoUrl, 'body.videoUrl');
  fields.videoUrl = parsed.videoUrl;
  fields.videoProvider = parsed.videoProvider;
}

function requireSampleChange(
  request: CatalogRequest,
  course: CatalogCourse,
  lessonId: string | null,
) {
  requireCatalogAction(
    request,
    'product.set_access',
    { action: 'lesson.update', target: { type: 'lesson', id: lessonId } },
    course.ownerId,
  );
}

/**
 * `POST /modules/{id}/lessons` (`course.edit`): aula nova no fim do módulo, `draft` por padrão.
 * Até 500 por curso. Nascer publicada segue a regra de publicação do curso; amostra grátis exige
 * `product.set_access` (o instrutor no próprio curso). Grava `lesson.create`.
 */
export async function createLesson(
  db: Database,
  request: CatalogRequest,
  moduleId: unknown,
  input: LessonFieldsInput & { title: unknown },
): Promise<CatalogLesson> {
  return catalogWrite(db, request, async (trx) => {
    const { course, module } = await loadModuleForWrite(trx, request, moduleId, 'lesson.create');
    const errors = new FieldErrors();
    const fields = readLessonFields(errors, { ...input, title: input.title ?? null });
    errors.throwIfAny();
    readLessonVideo(fields, input);
    if (fields.isSample) requireSampleChange(request, course, null);
    if (fields.status === 'published') {
      requireCoursePublication(request, course, 'lesson.create', { type: 'lesson', id: null });
    }
    const total = await trx
      .selectFrom('lessons')
      .innerJoin('modules', 'modules.id', 'lessons.moduleId')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('modules.courseId', '=', course.id)
      .executeTakeFirstOrThrow();
    if (total.count >= CATALOG_LIMITS.lessonsPerCourse) {
      throw catalogLimitExceeded(
        'lessonsPerCourse',
        `O curso já tem ${CATALOG_LIMITS.lessonsPerCourse} aulas.`,
      );
    }
    const next = await trx
      .selectFrom('lessons')
      .select(sql<number>`coalesce(max(position) + 1, 0)::int`.as('next'))
      .where('moduleId', '=', module.id)
      .executeTakeFirstOrThrow();
    const row = await trx
      .insertInto('lessons')
      .values({
        moduleId: module.id,
        title: fields.title as string,
        description: fields.description ?? null,
        videoUrl: fields.videoUrl ?? null,
        videoProvider: fields.videoProvider ?? null,
        durationSeconds: fields.durationSeconds ?? 0,
        isSample: fields.isSample ?? false,
        status: fields.status ?? 'draft',
        position: next.next,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await catalogAudit(trx, request, {
      action: 'lesson.create',
      targetType: 'lesson',
      targetId: row.id,
      details: {
        courseId: course.id,
        moduleId: module.id,
        status: fields.status ?? 'draft',
        isSample: fields.isSample ?? false,
        videoProvider: fields.videoProvider ?? null,
      },
    });
    return (await findLesson(trx, row.id)) as CatalogLesson;
  });
}

/**
 * `PATCH /lessons/{id}` (`course.edit`, com `version`). Amostra grátis: `product.set_access`
 * sobre o curso. `status`: a regra de publicação do curso (instrutor só em curso próprio
 * `open`); despublicar aula de curso publicado enfileira `course.completion_check`; publicar a
 * última aula `draft` limpa o pedido de publicação. URL de vídeo fora das regras: `422`
 * `content_url_invalid`. Grava `lesson.update` e, quando o estado muda, `lesson.publish` ou
 * `lesson.unpublish`.
 */
export async function updateLesson(
  db: Database,
  request: CatalogRequest,
  lessonId: unknown,
  input: LessonFieldsInput & { version: unknown },
): Promise<CatalogLesson> {
  return catalogWrite(db, request, async (trx) => {
    const { course, lesson } = await loadLessonForWrite(trx, request, lessonId, 'lesson.update');
    const version = readVersion(input.version);
    const errors = new FieldErrors();
    const fields = readLessonFields(errors, input);
    errors.throwIfAny();
    readLessonVideo(fields, input);
    assertVersion(lesson.version, version);
    const { status, ...rest } = fields;
    if (rest.isSample !== undefined && rest.isSample !== lesson.isSample) {
      requireSampleChange(request, course, lesson.id);
    }
    const statusChanged = status !== undefined && status !== lesson.status;
    if (statusChanged) {
      const action = status === 'published' ? 'lesson.publish' : 'lesson.unpublish';
      requireCoursePublication(request, course, action, { type: 'lesson', id: lesson.id });
    }
    const changes = diffFields(lesson as unknown as Record<string, unknown>, rest);
    if (Object.keys(changes).length === 0 && !statusChanged) return lesson;
    await trx
      .updateTable('lessons')
      .set({ ...rest, ...(statusChanged ? { status } : {}), version: sql<number>`version + 1` })
      .where('id', '=', lesson.id)
      .execute();
    if (Object.keys(changes).length > 0) {
      await catalogAudit(trx, request, {
        action: 'lesson.update',
        targetType: 'lesson',
        targetId: lesson.id,
        details: changes,
      });
    }
    if (statusChanged) {
      let reviewCleared = false;
      if (status === 'published') {
        reviewCleared = await clearReviewIfNoDraftLessons(trx, course);
      } else if (course.status === 'published') {
        await enqueueCompletionCheck(trx, course.id);
      }
      await catalogAudit(trx, request, {
        action: status === 'published' ? 'lesson.publish' : 'lesson.unpublish',
        targetType: 'lesson',
        targetId: lesson.id,
        details: { courseId: course.id, reviewCleared },
      });
    }
    return (await findLesson(trx, lesson.id)) as CatalogLesson;
  });
}

/**
 * `DELETE /lessons/{id}` (`course.edit`): apaga a aula e os links, tira os vínculos de ebook a
 * ela (recálculo do curso) e, se estava publicada num curso publicado, enfileira
 * `course.completion_check`. Grava `lesson.delete`.
 */
export async function deleteLesson(
  db: Database,
  request: CatalogRequest,
  lessonId: unknown,
): Promise<void> {
  await catalogWrite(db, request, async (trx) => {
    const { course, lesson } = await loadLessonForWrite(trx, request, lessonId, 'lesson.delete');
    await afterLessonsRemoved(trx, course, [lesson]);
    await trx.deleteFrom('lessons').where('id', '=', lesson.id).execute();
    await catalogAudit(trx, request, {
      action: 'lesson.delete',
      targetType: 'lesson',
      targetId: lesson.id,
      details: { courseId: course.id, moduleId: lesson.moduleId, title: lesson.title },
    });
  });
}

/**
 * `PUT /modules/{id}/lessons/order` (`course.edit`): a lista inteira das aulas do módulo na
 * ordem nova, numa transação. Lista diferente da atual: `422` `order_mismatch`. Grava
 * `lesson.reorder` (alvo: o módulo).
 */
export async function reorderLessons(
  db: Database,
  request: CatalogRequest,
  moduleId: unknown,
  input: { lessonIds: unknown },
): Promise<CatalogLesson[]> {
  return catalogWrite(db, request, async (trx) => {
    const { module } = await loadModuleForWrite(trx, request, moduleId, 'lesson.reorder');
    const current = await trx
      .selectFrom('lessons')
      .select('id')
      .where('moduleId', '=', module.id)
      .orderBy('position')
      .execute();
    const ids = readPermutation(
      input.lessonIds,
      current.map((row) => row.id),
      'body.lessonIds',
    );
    await writeOrder(trx, 'lessons', ids);
    await catalogAudit(trx, request, {
      action: 'lesson.reorder',
      targetType: 'module',
      targetId: module.id,
      details: { lessonIds: ids },
    });
    const rows = await trx
      .selectFrom('lessons')
      .select('id')
      .where('moduleId', '=', module.id)
      .orderBy('position')
      .execute();
    return Promise.all(rows.map(async (row) => (await findLesson(trx, row.id)) as CatalogLesson));
  });
}

export interface LessonLinkInput {
  label: unknown;
  url: unknown;
  kind: unknown;
}

/**
 * `PUT /lessons/{id}/links` (`course.edit`): troca a lista inteira de links de apoio, na ordem
 * dada. Até 20 por aula (`422` `catalog_limit_exceeded`); URL fora das regras: `422`
 * `content_url_invalid` com o índice. `version` opcional é o da aula, que avança. Grava
 * `lesson.set_links`.
 */
export async function setLessonLinks(
  db: Database,
  request: CatalogRequest,
  lessonId: unknown,
  input: { links: unknown; version?: unknown },
): Promise<CatalogLessonLink[]> {
  return catalogWrite(db, request, async (trx) => {
    const { lesson } = await loadLessonForWrite(trx, request, lessonId, 'lesson.set_links');
    const version = readOptionalVersion(input.version);
    const errors = new FieldErrors();
    const list = readArray(errors, input.links, 'body.links');
    const links = list.map((item, index) => {
      const path = `body.links[${index}]`;
      const link = readObject(errors, item, path);
      return {
        label: readTitle(
          errors,
          link.label ?? null,
          `${path}.label`,
          CATALOG_LIMITS.labelMaxLength,
        ),
        kind: readEnum(errors, link.kind, `${path}.kind`, LESSON_LINK_KINDS),
        url: link.url,
      };
    });
    errors.throwIfAny();
    if (links.length > CATALOG_LIMITS.linksPerLesson) {
      throw catalogLimitExceeded(
        'linksPerLesson',
        `A aula aceita até ${CATALOG_LIMITS.linksPerLesson} links de apoio.`,
      );
    }
    const values = links.map((link, index) => ({
      lessonId: lesson.id,
      label: link.label,
      kind: link.kind,
      url: assertContentUrl(link.url, `body.links[${index}].url`),
      position: index,
    }));
    assertVersion(lesson.version, version);
    await trx.deleteFrom('lessonLinks').where('lessonId', '=', lesson.id).execute();
    if (values.length > 0) await trx.insertInto('lessonLinks').values(values).execute();
    await trx
      .updateTable('lessons')
      .set({ version: sql<number>`version + 1` })
      .where('id', '=', lesson.id)
      .execute();
    await catalogAudit(trx, request, {
      action: 'lesson.set_links',
      targetType: 'lesson',
      targetId: lesson.id,
      details: { count: values.length },
    });
    return listCatalogLessonLinks(trx, lesson.id);
  });
}
