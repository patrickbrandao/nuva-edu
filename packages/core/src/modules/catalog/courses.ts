// Cursos: criar, alterar, excluir, publicar, despublicar, arquivar, desarquivar, enviar para
// publicação e trocar o dono (spec 009, "Estados de publicação", "Autoria"; 008, "Regra do
// instrutor"). Dono dos dados: admin-api. Toda escrita grava auditoria na mesma transação.

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { permissionScope } from '../permissions/matrix.ts';
import {
  applyCommercialChange,
  assertCatalogId,
  assertProductCover,
  assertPublishablePrice,
  assertVersion,
  auditCommercialChange,
  bundlesContaining,
  CatalogDenied,
  type CatalogRequest,
  type CommercialInput,
  type CommercialState,
  catalogAudit,
  catalogUnprocessable,
  catalogWrite,
  countActiveEntitlementHolders,
  diffFields,
  enqueueRecomputes,
  freeGeneratedSlug,
  INITIAL_COMMERCIAL,
  priceFromDb,
  productHasLinks,
  productHasLinksError,
  readCommercialInput,
  requireCatalogAction,
  requireCommercialPermissions,
  withSlugCheck,
} from './common.ts';
import {
  type AccessMode,
  CATALOG_LIMITS,
  COURSE_LEVELS,
  type CourseLevel,
  catalogRule,
  FieldErrors,
  type PublicationStatus,
  readBoolean,
  readEnum,
  readNullableId,
  readNullableInteger,
  readOptionalText,
  readSlug,
  readTitle,
  readVersion,
} from './fields.ts';

/** Um curso como a escrita o devolve (todas as colunas de `courses`). */
export interface CatalogCourse {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  level: CourseLevel | null;
  coverImageId: string | null;
  ownerId: string | null;
  accessMode: AccessMode;
  priceCents: number | null;
  accessDays: number | null;
  certificateEnabled: boolean;
  certificateHours: number | null;
  status: PublicationStatus;
  reviewRequestedAt: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Lê o curso (opcionalmente travado até o fim da transação). */
export async function findCatalogCourse(
  db: Database,
  courseId: string,
  options: { forUpdate?: boolean } = {},
): Promise<CatalogCourse | undefined> {
  let query = db.selectFrom('courses').selectAll().where('id', '=', courseId);
  if (options.forUpdate) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) return undefined;
  return {
    ...row,
    level: row.level as CourseLevel | null,
    accessMode: row.accessMode as AccessMode,
    priceCents: priceFromDb(row.priceCents),
    status: row.status as PublicationStatus,
  };
}

/**
 * Trava o curso e exige a ação: inexistente, ou de outro dono para o instrutor, é `404`; sem a
 * ação no papel, `403` auditado.
 */
export async function loadCourseForWrite(
  trx: Database,
  request: CatalogRequest,
  courseId: unknown,
  action: Parameters<typeof requireCatalogAction>[1],
  auditAction: string,
): Promise<CatalogCourse> {
  const id = assertCatalogId(courseId, 'Curso');
  const course = await findCatalogCourse(trx, id, { forUpdate: true });
  if (!course) throw notFound('Curso não encontrado.');
  requireCatalogAction(
    request,
    action,
    { action: auditAction, target: { type: 'course', id } },
    course.ownerId,
  );
  return course;
}

/**
 * Publicar e despublicar o curso, ou aula dele (spec 009, "Autoria"): `course.publish`; o
 * instrutor só no curso próprio `open` (o `paid` e o `private` são publicados por gerente ou
 * admin), e a recusa é `403` auditado.
 */
export function requireCoursePublication(
  request: CatalogRequest,
  course: Pick<CatalogCourse, 'id' | 'ownerId' | 'accessMode'>,
  auditAction: string,
  target: { type: 'course' | 'lesson'; id: string | null } = { type: 'course', id: course.id },
): void {
  requireCatalogAction(request, 'course.publish', { action: auditAction, target }, course.ownerId);
  if (permissionScope(request.actor, 'course.publish') === 'own' && course.accessMode !== 'open') {
    throw new CatalogDenied(
      'course.publish',
      auditAction,
      target,
      'Curso pago ou privado é publicado pela gerência; envie para publicação.',
    );
  }
}

function commercialOf(course: CatalogCourse): CommercialState {
  return {
    accessMode: course.accessMode,
    priceCents: course.priceCents,
    accessDays: course.accessDays,
  };
}

async function assertInstructorOwner(trx: Database, ownerId: string | null): Promise<void> {
  if (ownerId === null) return;
  const user = await trx
    .selectFrom('users')
    .select('id')
    .where('id', '=', ownerId)
    .where('role', '=', 'instructor')
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!user) {
    throw catalogUnprocessable('owner_invalid', 'O dono do curso precisa ser um instrutor.', [
      { path: 'body.ownerId', message: 'Escolha um instrutor ativo.' },
    ]);
  }
}

interface CourseFields {
  slug?: string;
  title?: string;
  summary?: string | null;
  description?: string | null;
  level?: CourseLevel | null;
  coverImageId?: string | null;
  certificateEnabled?: boolean;
  certificateHours?: number | null;
}

export interface CourseFieldsInput extends CommercialInput {
  slug?: unknown;
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  level?: unknown;
  coverImageId?: unknown;
  certificateEnabled?: unknown;
  certificateHours?: unknown;
}

function readCourseFields(errors: FieldErrors, input: CourseFieldsInput): CourseFields {
  const fields: CourseFields = {};
  if (input.slug !== undefined) fields.slug = readSlug(errors, input.slug, 'body.slug');
  if (input.title !== undefined) fields.title = readTitle(errors, input.title, 'body.title');
  if (input.summary !== undefined) {
    fields.summary = readOptionalText(
      errors,
      input.summary,
      'body.summary',
      CATALOG_LIMITS.summaryMaxLength,
    );
  }
  if (input.description !== undefined) {
    fields.description = readOptionalText(
      errors,
      input.description,
      'body.description',
      CATALOG_LIMITS.descriptionMaxLength,
      { trim: false },
    );
  }
  if (input.level !== undefined) {
    fields.level =
      input.level === null ? null : readEnum(errors, input.level, 'body.level', COURSE_LEVELS);
  }
  if (input.coverImageId !== undefined) {
    fields.coverImageId = readNullableId(errors, input.coverImageId, 'body.coverImageId');
  }
  if (input.certificateEnabled !== undefined) {
    fields.certificateEnabled = readBoolean(
      errors,
      input.certificateEnabled,
      'body.certificateEnabled',
    );
  }
  if (input.certificateHours !== undefined) {
    fields.certificateHours = readNullableInteger(
      errors,
      input.certificateHours,
      'body.certificateHours',
      1,
      CATALOG_LIMITS.certificateHoursMax,
    );
  }
  return fields;
}

export interface CreateCourseInput extends CourseFieldsInput {
  /** Ausente (ou `null`): gerado do título, com sufixo `-2` a `-99` se repetido. */
  slug?: unknown;
  title: unknown;
  /** Só gerente e admin (`course.set_owner`); o instrutor que cria vira o dono. */
  ownerId?: unknown;
}

/**
 * `POST /courses` (`course.create`). O instrutor vira o dono; gerente e admin podem indicar o
 * dono (um instrutor ativo) ou deixar sem dono. Nasce `draft` e `private`, sem preço (spec 009,
 * "Modo de acesso inicial"). Outro modo e validade exigem `product.set_access`; preço,
 * `product.set_price`, conferidos antes das regras do valor. Sem `slug`, ele é gerado do título;
 * slug informado repetido, ou gerado sem sufixo livre: `409` `slug_taken`. Grava `course.create`
 * (e `product.set_access`/`product.set_price` se definidos).
 */
export async function createCourse(
  db: Database,
  request: CatalogRequest,
  input: CreateCourseInput,
): Promise<CatalogCourse> {
  return catalogWrite(db, request, async (trx) => {
    const target = { type: 'course' as const, id: null };
    requireCatalogAction(request, 'course.create', { action: 'course.create', target });
    const errors = new FieldErrors();
    requireCommercialPermissions(request, INITIAL_COMMERCIAL, input, target);
    const fields = readCourseFields(errors, {
      ...input,
      slug: input.slug ?? undefined,
      title: input.title ?? null,
    });
    const commercial = readCommercialInput(errors, input);
    let ownerId: string | null = request.actor.role === 'instructor' ? request.actor.id : null;
    if (input.ownerId !== undefined) {
      const wanted = readNullableId(errors, input.ownerId, 'body.ownerId');
      if (wanted !== ownerId) {
        requireCatalogAction(request, 'course.set_owner', { action: 'course.create', target });
        ownerId = wanted;
      }
    }
    errors.throwIfAny();
    const change = applyCommercialChange(INITIAL_COMMERCIAL, commercial);
    await assertInstructorOwner(trx, ownerId);
    await assertProductCover(trx, fields.coverImageId ?? null);
    const slug = fields.slug ?? (await freeGeneratedSlug(trx, 'course', fields.title as string));
    const row = await withSlugCheck('courses_slug_unique', () =>
      trx
        .insertInto('courses')
        .values({
          slug,
          title: fields.title as string,
          summary: fields.summary ?? null,
          description: fields.description ?? null,
          level: fields.level ?? null,
          coverImageId: fields.coverImageId ?? null,
          ownerId,
          accessMode: change.next.accessMode,
          priceCents: change.next.priceCents,
          accessDays: change.next.accessDays,
          ...(fields.certificateEnabled === undefined
            ? {}
            : { certificateEnabled: fields.certificateEnabled }),
          certificateHours: fields.certificateHours ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await catalogAudit(trx, request, {
      action: 'course.create',
      targetType: 'course',
      targetId: row.id,
      details: { slug, ownerId, accessMode: change.next.accessMode },
    });
    await auditCommercialChange(trx, request, INITIAL_COMMERCIAL, change, {
      type: 'course',
      id: row.id,
    });
    return (await findCatalogCourse(trx, row.id)) as CatalogCourse;
  });
}

export interface UpdateCourseInput extends CourseFieldsInput {
  /** O `version` lido. */
  version: unknown;
}

/**
 * `PATCH /courses/{id}` (`course.edit`; instrutor só no próprio, alheio é `404`). Campo omitido
 * não muda. Modo de acesso e validade: `product.set_access` com alcance total; preço:
 * `product.set_price`; sem a permissão é `403` antes de qualquer regra do valor, e campo
 * reenviado com o valor atual não é alteração. Curso publicado `paid` precisa continuar com preço (`422`
 * `price_required`). `version` diferente: `409` `version_conflict`. Grava `course.update` com
 * o antes e o depois, e `product.set_access`/`product.set_price` à parte; sem mudança, só
 * devolve o curso.
 */
export async function updateCourse(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
  input: UpdateCourseInput,
): Promise<CatalogCourse> {
  return catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(trx, request, courseId, 'course.edit', 'course.update');
    const target = { type: 'course' as const, id: course.id };
    requireCommercialPermissions(request, commercialOf(course), input, target);
    const version = readVersion(input.version);
    const errors = new FieldErrors();
    const fields = readCourseFields(errors, input);
    const commercial = readCommercialInput(errors, input);
    errors.throwIfAny();
    assertVersion(course.version, version);
    const change = applyCommercialChange(commercialOf(course), commercial);
    if (course.status === 'published') assertPublishablePrice(change.next);
    if (fields.coverImageId !== undefined && fields.coverImageId !== course.coverImageId) {
      await assertProductCover(trx, fields.coverImageId);
    }
    const changes = diffFields(course as unknown as Record<string, unknown>, {
      ...fields,
    });
    const commercialChanged =
      change.accessChanged || change.priceChanged || change.priceClearedByMode;
    if (Object.keys(changes).length === 0 && !commercialChanged) return course;
    await withSlugCheck('courses_slug_unique', () =>
      trx
        .updateTable('courses')
        .set({
          ...fields,
          accessMode: change.next.accessMode,
          priceCents: change.next.priceCents,
          accessDays: change.next.accessDays,
          version: sql<number>`version + 1`,
        })
        .where('id', '=', course.id)
        .execute(),
    );
    if (Object.keys(changes).length > 0) {
      await catalogAudit(trx, request, {
        action: 'course.update',
        targetType: 'course',
        targetId: course.id,
        details: changes,
      });
    }
    await auditCommercialChange(trx, request, commercialOf(course), change, target);
    return (await findCatalogCourse(trx, course.id)) as CatalogCourse;
  });
}

/**
 * `DELETE /courses/{id}` (`course.delete`; instrutor só o próprio). Com direito ou progresso
 * de aula associado (e, na Fase 3, pedido): `409` `product_has_links` para todos, inclusive o
 * admin (P2). Apaga módulos, aulas e links (cascata), os vínculos de ebook ao curso e às aulas e
 * o curso nos pacotes, com o recálculo dos pacotes. Grava `course.delete`.
 */
export async function deleteCourse(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<void> {
  await catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(
      trx,
      request,
      courseId,
      'course.delete',
      'course.delete',
    );
    if (await productHasLinks(trx, 'course', course.id)) throw productHasLinksError();
    const bundles = await bundlesContaining(trx, 'course', course.id);
    await trx
      .deleteFrom('bundleItems')
      .where('productType', '=', 'course')
      .where('productId', '=', course.id)
      .execute();
    await trx
      .deleteFrom('productEbooks')
      .where((eb) =>
        eb.or([
          eb.and([eb('targetType', '=', 'course'), eb('targetId', '=', course.id)]),
          eb.and([
            eb('targetType', '=', 'lesson'),
            eb(
              'targetId',
              'in',
              eb
                .selectFrom('lessons')
                .innerJoin('modules', 'modules.id', 'lessons.moduleId')
                .select('lessons.id')
                .where('modules.courseId', '=', course.id),
            ),
          ]),
        ]),
      )
      .execute();
    await trx.deleteFrom('courses').where('id', '=', course.id).execute();
    await enqueueRecomputes(
      trx,
      bundles.map((productId) => ({ productType: 'bundle' as const, productId })),
    );
    await catalogAudit(trx, request, {
      action: 'course.delete',
      targetType: 'course',
      targetId: course.id,
      details: { slug: course.slug, title: course.title, bundles: bundles.length },
    });
  });
}

/** Quantas aulas publicadas o curso tem. */
async function countPublishedLessons(trx: Database, courseId: string): Promise<number> {
  const row = await trx
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('modules.courseId', '=', courseId)
    .where('lessons.status', '=', 'published')
    .executeTakeFirstOrThrow();
  return row.count;
}

function assertNotArchived(product: { archivedAt: Date | null }): void {
  if (product.archivedAt !== null) {
    throw catalogRule('product_archived', 'Produto arquivado; desarquive antes.');
  }
}

/**
 * `POST /courses/{id}/publish`. Exige ao menos um módulo com uma aula publicada (`422`
 * `course_has_no_published_lesson`), preço se `paid` (`422` `price_required`) e não arquivado
 * (`422` `product_archived`). Instrutor: só curso próprio `open`. Limpa o pedido de publicação.
 * Já publicado: devolve sem gravar.
 */
export async function publishCourse(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<CatalogCourse> {
  return catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(
      trx,
      request,
      courseId,
      'course.edit',
      'course.publish',
    );
    requireCoursePublication(request, course, 'course.publish');
    if (course.status === 'published') return course;
    assertNotArchived(course);
    assertPublishablePrice(commercialOf(course));
    if ((await countPublishedLessons(trx, course.id)) === 0) {
      throw catalogRule(
        'course_has_no_published_lesson',
        'Publique ao menos uma aula antes de publicar o curso.',
      );
    }
    await trx
      .updateTable('courses')
      .set({
        status: 'published',
        publishedAt: sql<Date>`now()`,
        reviewRequestedAt: null,
        version: sql<number>`version + 1`,
      })
      .where('id', '=', course.id)
      .execute();
    await catalogAudit(trx, request, {
      action: 'course.publish',
      targetType: 'course',
      targetId: course.id,
      details: { reviewCleared: course.reviewRequestedAt !== null },
    });
    return (await findCatalogCourse(trx, course.id)) as CatalogCourse;
  });
}

/**
 * `POST /courses/{id}/unpublish`. Não revoga direitos (spec 009); o aviso com os alunos afetados
 * vem de `countCourseAffectedStudents`. Instrutor: só curso próprio `open`. Já em rascunho:
 * devolve sem gravar.
 */
export async function unpublishCourse(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<CatalogCourse> {
  return catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(
      trx,
      request,
      courseId,
      'course.edit',
      'course.unpublish',
    );
    requireCoursePublication(request, course, 'course.unpublish');
    if (course.status === 'draft') return course;
    const affected = await countActiveEntitlementHolders(trx, 'course', course.id);
    await trx
      .updateTable('courses')
      .set({ status: 'draft', version: sql<number>`version + 1` })
      .where('id', '=', course.id)
      .execute();
    await catalogAudit(trx, request, {
      action: 'course.unpublish',
      targetType: 'course',
      targetId: course.id,
      details: { affectedStudents: affected },
    });
    return (await findCatalogCourse(trx, course.id)) as CatalogCourse;
  });
}

/**
 * Alunos com direito vigente ao curso, para o aviso antes de despublicar (spec 009). Exige
 * `course.publish` sobre o curso (instrutor: o próprio).
 */
export async function countCourseAffectedStudents(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<number> {
  return catalogWrite(db, request, async (trx) => {
    const id = assertCatalogId(courseId, 'Curso');
    const course = await findCatalogCourse(trx, id);
    if (!course) throw notFound('Curso não encontrado.');
    requireCatalogAction(
      request,
      'course.publish',
      { action: 'course.unpublish', target: { type: 'course', id } },
      course.ownerId,
    );
    return countActiveEntitlementHolders(trx, 'course', id);
  });
}

/**
 * `POST /courses/{id}/archive` (`product.archive`, só admin; P2). Arquivar despublica em
 * definitivo: `archived_at` e `status = draft`. Já arquivado: devolve sem gravar.
 */
export async function archiveCourse(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<CatalogCourse> {
  return setCourseArchived(db, request, courseId, true);
}

/** `POST /courses/{id}/unarchive` (`product.archive`): volta como rascunho. */
export async function unarchiveCourse(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<CatalogCourse> {
  return setCourseArchived(db, request, courseId, false);
}

async function setCourseArchived(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
  archived: boolean,
): Promise<CatalogCourse> {
  const action = archived ? 'course.archive' : 'course.unarchive';
  return catalogWrite(db, request, async (trx) => {
    const id = assertCatalogId(courseId, 'Curso');
    requireCatalogAction(request, 'product.archive', { action, target: { type: 'course', id } });
    const course = await findCatalogCourse(trx, id, { forUpdate: true });
    if (!course) throw notFound('Curso não encontrado.');
    if ((course.archivedAt !== null) === archived) return course;
    await trx
      .updateTable('courses')
      .set(
        archived
          ? { archivedAt: sql<Date>`now()`, status: 'draft', version: sql<number>`version + 1` }
          : { archivedAt: null, version: sql<number>`version + 1` },
      )
      .where('id', '=', id)
      .execute();
    await catalogAudit(trx, request, {
      action,
      targetType: 'course',
      targetId: id,
      details: { wasPublished: course.status === 'published' },
    });
    return (await findCatalogCourse(trx, id)) as CatalogCourse;
  });
}

/**
 * `POST /courses/{id}/request-review` (`course.edit`; o instrutor no próprio curso): grava
 * `review_requested_at`, que vale para o curso e para as aulas `draft` dele. Arquivado: `422`
 * `product_archived`. Já pedido: devolve sem gravar. Grava `course.request_review`.
 */
export async function requestCourseReview(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<CatalogCourse> {
  return catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(
      trx,
      request,
      courseId,
      'course.edit',
      'course.request_review',
    );
    assertNotArchived(course);
    if (course.reviewRequestedAt !== null) return course;
    await trx
      .updateTable('courses')
      .set({ reviewRequestedAt: sql<Date>`now()`, version: sql<number>`version + 1` })
      .where('id', '=', course.id)
      .execute();
    await catalogAudit(trx, request, {
      action: 'course.request_review',
      targetType: 'course',
      targetId: course.id,
    });
    return (await findCatalogCourse(trx, course.id)) as CatalogCourse;
  });
}

/**
 * `DELETE /courses/{id}/request-review`: cancela o pedido. Sem pedido: devolve sem gravar. Grava
 * `course.request_review_cancel`.
 */
export async function cancelCourseReview(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
): Promise<CatalogCourse> {
  return catalogWrite(db, request, async (trx) => {
    const course = await loadCourseForWrite(
      trx,
      request,
      courseId,
      'course.edit',
      'course.request_review_cancel',
    );
    if (course.reviewRequestedAt === null) return course;
    await trx
      .updateTable('courses')
      .set({ reviewRequestedAt: null, version: sql<number>`version + 1` })
      .where('id', '=', course.id)
      .execute();
    await catalogAudit(trx, request, {
      action: 'course.request_review_cancel',
      targetType: 'course',
      targetId: course.id,
    });
    return (await findCatalogCourse(trx, course.id)) as CatalogCourse;
  });
}

/** Limpa o pedido de publicação quando a última aula `draft` do curso foi publicada (009). */
export async function clearReviewIfNoDraftLessons(
  trx: Database,
  course: Pick<CatalogCourse, 'id' | 'reviewRequestedAt'>,
): Promise<boolean> {
  if (course.reviewRequestedAt === null) return false;
  const draft = await trx
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .select('lessons.id')
    .where('modules.courseId', '=', course.id)
    .where('lessons.status', '=', 'draft')
    .limit(1)
    .executeTakeFirst();
  if (draft) return false;
  await trx
    .updateTable('courses')
    .set({ reviewRequestedAt: null, version: sql<number>`version + 1` })
    .where('id', '=', course.id)
    .execute();
  return true;
}

export interface SetCourseOwnerInput {
  /** Um instrutor ativo, ou `null` para deixar o curso só com gerente e admin. */
  ownerId: unknown;
  version?: unknown;
}

/**
 * `PATCH /courses/{id}/owner` (`course.set_owner`: gerente e admin). O dono precisa ser um
 * instrutor ativo (`422` `owner_invalid`). Grava `course.set_owner` com o antes e o depois.
 */
export async function setCourseOwner(
  db: Database,
  request: CatalogRequest,
  courseId: unknown,
  input: SetCourseOwnerInput,
): Promise<CatalogCourse> {
  return catalogWrite(db, request, async (trx) => {
    const id = assertCatalogId(courseId, 'Curso');
    requireCatalogAction(request, 'course.set_owner', {
      action: 'course.set_owner',
      target: { type: 'course', id },
    });
    const errors = new FieldErrors();
    const ownerId = readNullableId(errors, input.ownerId ?? null, 'body.ownerId');
    errors.throwIfAny();
    const course = await findCatalogCourse(trx, id, { forUpdate: true });
    if (!course) throw notFound('Curso não encontrado.');
    if (input.version !== undefined) assertVersion(course.version, readVersion(input.version));
    if (course.ownerId === ownerId) return course;
    await assertInstructorOwner(trx, ownerId);
    await trx
      .updateTable('courses')
      .set({ ownerId, version: sql<number>`version + 1` })
      .where('id', '=', id)
      .execute();
    await catalogAudit(trx, request, {
      action: 'course.set_owner',
      targetType: 'course',
      targetId: id,
      details: { ownerId: { from: course.ownerId, to: ownerId } },
    });
    return (await findCatalogCourse(trx, id)) as CatalogCourse;
  });
}
