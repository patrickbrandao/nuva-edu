import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  conflict,
  type FieldError,
  notFound,
  permissionDenied,
  unauthenticated,
} from '../../errors/domain-error.ts';
import { type AuditContext, recordAudit } from '../audit/record.ts';
import {
  type CatalogPage,
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import {
  type Audience,
  type AudienceProduct,
  type AudienceProductRef,
  isAudience,
  readAudienceProducts,
  resolveAudienceProducts,
} from '../entitlements/audience.ts';
import {
  enqueueAnnouncementPublish,
  removeQueuedAnnouncementPublish,
} from '../jobs/announcements.ts';
import {
  type AnnouncementStaff,
  announcementManageScope,
  managesAllAnnouncements,
  mayPublishAnnouncements,
} from '../permissions/announcements.ts';
import { isRole } from '../permissions/roles.ts';
import { announcePublication, publishAnnouncementNow } from './publish.ts';
import {
  ANNOUNCEMENT_AUDIENCE_TABLE,
  ANNOUNCEMENT_PINNED_MAX,
  ANNOUNCEMENT_TARGET_TYPE,
  type AnnouncementRow,
  type AnnouncementStatus,
  announcementArchived,
  announcementBody,
  announcementId,
  announcementLinkLabel,
  announcementLinkUrl,
  announcementPinnedLimit,
  announcementTitle,
  isAnnouncementStatus,
  isPinnedLimitViolation,
  optionalAnnouncementUuid,
} from './rules.ts';

// Gestão das novidades (spec 025, RF-01; dono das escritas: admin-api). `manager` e `admin`
// gerem todas; o instrutor, só as restritas aos próprios cursos (fora disso, `404`), sem fixar.

const DEFAULT_CONTEXT: AuditContext = { origin: 'admin_panel' };
const LIST_SCOPE = 'announcements.admin';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getStaff(db: Database, actorId: string): Promise<AnnouncementStaff> {
  if (!UUID_PATTERN.test(actorId)) throw unauthenticated();
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'suspendedKind'])
    .where('id', '=', actorId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!user || user.suspendedKind === 'full') throw unauthenticated();
  if (!isRole(user.role) || !mayPublishAnnouncements(user.role) || user.suspendedKind !== null) {
    throw permissionDenied();
  }
  return { id: user.id, role: user.role };
}

function audit(context: AuditContext, staff: AnnouncementStaff): AuditContext {
  return { ...context, actorUserId: staff.id, actorRole: staff.role };
}

/** A novidade como a equipe a vê, em qualquer estado. */
export interface AdminAnnouncement {
  id: string;
  title: string;
  bodyMd: string;
  bodyHtml: string;
  coverImageId: string | null;
  audience: Audience;
  products: AudienceProductRef[];
  linkUrl: string | null;
  linkLabel: string | null;
  status: AnnouncementStatus;
  pinned: boolean;
  /** Horário do agendamento (estado `scheduled`). */
  publishAt: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  /** Avisar por notificação ao publicar (RF-05). */
  notify: boolean;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

function shape(row: AnnouncementRow, products: AudienceProductRef[]): AdminAnnouncement {
  return {
    id: row.id,
    title: row.title,
    bodyMd: row.bodyMd,
    bodyHtml: row.bodyHtml,
    coverImageId: row.coverImageId,
    audience: row.audience as Audience,
    products,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    status: row.status as AnnouncementStatus,
    pinned: row.pinned,
    publishAt: row.publishAt,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    notify: row.notify,
    authorId: row.authorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function shapeAll(db: Database, rows: AnnouncementRow[]): Promise<AdminAnnouncement[]> {
  const products = await readAudienceProducts(
    db,
    ANNOUNCEMENT_AUDIENCE_TABLE,
    rows.map(({ id }) => id),
  );
  return rows.map((row) => shape(row, products.get(row.id) ?? []));
}

function scoped(db: Database, staff: AnnouncementStaff) {
  return db.selectFrom('announcements as an').selectAll('an').where(announcementManageScope(staff));
}

async function requireAnnouncement(
  db: Database,
  staff: AnnouncementStaff,
  id: string,
  lock = false,
): Promise<AnnouncementRow> {
  let select = scoped(db, staff).where('an.id', '=', id);
  if (lock) select = select.forUpdate('an');
  const row = await select.executeTakeFirst();
  if (!row) throw notFound('Novidade não encontrada.');
  return row;
}

export interface AdminAnnouncementsQuery extends Pick<CatalogPageInput, 'limit' | 'cursor'> {
  status?: unknown;
}

/** `GET /announcements` do admin: da mais nova para a mais antiga, com filtro de estado. */
export async function listAnnouncements(
  db: Database,
  actorId: string,
  query: AdminAnnouncementsQuery = {},
): Promise<CatalogPage<AdminAnnouncement>> {
  const staff = await getStaff(db, actorId);
  const errors: FieldError[] = [];
  if (query.status !== undefined && !isAnnouncementStatus(query.status)) {
    errors.push({ path: 'query.status', message: 'Estado desconhecido.' });
  }
  const params = readCatalogPageParams(
    { limit: query.limit, cursor: query.cursor },
    LIST_SCOPE,
    ['recent'] as const,
    'recent',
    errors,
  );
  let select = scoped(db, staff)
    .orderBy('an.id', 'desc')
    .limit(params.limit + 1);
  if (query.status !== undefined) select = select.where('an.status', '=', query.status as string);
  if (params.afterId !== undefined) select = select.where('an.id', '<', params.afterId);
  const rows = await select.execute();
  const shaped = await shapeAll(db, rows.slice(0, params.limit));
  const byId = new Map(shaped.map((item) => [item.id, item]));
  return toCatalogPage(rows, params, LIST_SCOPE, (row) => byId.get(row.id) as AdminAnnouncement);
}

/** `GET /announcements/{id}` do admin. Fora do escopo do instrutor: `404`. */
export async function readAnnouncement(
  db: Database,
  actorId: string,
  id: unknown,
): Promise<AdminAnnouncement> {
  const staff = await getStaff(db, actorId);
  const [item] = await shapeAll(db, [await requireAnnouncement(db, staff, announcementId(id))]);
  return item as AdminAnnouncement;
}

export interface AnnouncementInput {
  title: unknown;
  bodyMd: unknown;
  audience?: unknown;
  /** Só com `audience = 'product'`: `{ productType, productId }[]`. */
  products?: unknown;
  linkUrl?: unknown;
  linkLabel?: unknown;
  coverImageId?: unknown;
  pinned?: unknown;
  /** Avisar por notificação ao publicar (RF-05); padrão `false`. */
  notify?: unknown;
}

export interface AnnouncementPatch extends Partial<AnnouncementInput> {
  /**
   * Só em novidade publicada: `true` a torna "não lida" de novo (o `published_at` vai para
   * agora) e reenvia o aviso (a notificação, se `notify` estiver ligado, e o SSE do contador).
   */
  notifyAgain?: unknown;
}

function audience(value: unknown): Audience {
  if (!isAudience(value)) throw businessRule('announcement_audience_invalid', 'Público inválido.');
  return value;
}

function flag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw businessRule(
      'announcement_field_invalid',
      `O campo ${field} deve ser verdadeiro ou falso.`,
    );
  }
  return value;
}

/** O instrutor só publica para os próprios cursos: público `product`, só cursos dele. */
async function assertInstructorAudience(
  trx: Database,
  staff: AnnouncementStaff,
  target: Audience,
  products: readonly AudienceProduct[],
): Promise<void> {
  if (managesAllAnnouncements(staff.role)) return;
  const denied = () =>
    permissionDenied('O instrutor só publica novidades restritas aos próprios cursos.');
  if (
    target !== 'product' ||
    products.length === 0 ||
    products.some((product) => product.productType !== 'course')
  ) {
    throw denied();
  }
  const owned = await trx
    .selectFrom('courses')
    .select('id')
    .where(
      'id',
      'in',
      products.map((product) => product.productId),
    )
    .where('ownerId', '=', staff.id)
    .execute();
  if (owned.length !== products.length) throw denied();
}

async function assertCover(trx: Database, imageId: string | null): Promise<void> {
  if (imageId === null) return;
  const image = await trx
    .selectFrom('images')
    .select('id')
    .where('id', '=', imageId)
    .where('purpose', '=', 'content_image')
    .where('hiddenAt', 'is', null)
    .executeTakeFirst();
  if (!image) throw businessRule('cover_image_invalid', 'A capa não é uma imagem de conteúdo.');
}

/** RNF-02: recusa a quarta fixada antes de o gatilho do banco precisar agir. */
async function assertPinnedSlot(trx: Database, exceptId: string | null): Promise<void> {
  let query = trx
    .selectFrom('announcements')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('pinned', '=', true);
  if (exceptId !== null) query = query.where('id', '!=', exceptId);
  const { count } = await query.executeTakeFirstOrThrow();
  if (count >= ANNOUNCEMENT_PINNED_MAX) throw announcementPinnedLimit();
}

async function replaceProducts(
  trx: Database,
  id: string,
  products: readonly AudienceProduct[],
): Promise<void> {
  await trx.deleteFrom('announcementProducts').where('announcementId', '=', id).execute();
  if (products.length > 0) {
    await trx
      .insertInto('announcementProducts')
      .values(products.map((product) => ({ announcementId: id, ...product })))
      .execute();
  }
}

async function currentProducts(trx: Database, id: string): Promise<AudienceProduct[]> {
  const rows = await trx
    .selectFrom('announcementProducts')
    .select(['productType', 'productId'])
    .where('announcementId', '=', id)
    .execute();
  return rows as AudienceProduct[];
}

async function pinnedGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isPinnedLimitViolation(error)) throw announcementPinnedLimit();
    throw error;
  }
}

/**
 * `POST /announcements`: cria a novidade como rascunho. Publicar ou agendar é
 * `publishAnnouncement`. A quarta fixada: `422 announcement_pinned_limit`.
 */
export async function createAnnouncement(
  db: Database,
  actorId: string,
  input: AnnouncementInput,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminAnnouncement> {
  const linkUrl = announcementLinkUrl(input.linkUrl);
  const linkLabel = announcementLinkLabel(input.linkLabel);
  if (linkLabel !== null && linkUrl === null) {
    throw businessRule('announcement_link_invalid', 'O texto do botão exige o link.');
  }
  const fields = {
    title: announcementTitle(input.title),
    ...announcementBody(input.bodyMd),
    audience: audience(input.audience ?? 'all'),
    linkUrl,
    linkLabel,
    coverImageId: optionalAnnouncementUuid(input.coverImageId, 'cover_image_invalid'),
    pinned: input.pinned === undefined ? false : flag(input.pinned, 'pinned'),
    notify: input.notify === undefined ? false : flag(input.notify, 'notify'),
  };
  const id = await pinnedGuard(() =>
    db.transaction().execute(async (trx) => {
      const staff = await getStaff(trx, actorId);
      const products =
        fields.audience === 'product'
          ? await resolveAudienceProducts(trx, input.products, 'announcement_products_invalid')
          : [];
      await assertInstructorAudience(trx, staff, fields.audience, products);
      if (fields.pinned) {
        if (!managesAllAnnouncements(staff.role)) {
          throw permissionDenied('Só gerente e admin fixam novidades.');
        }
        await assertPinnedSlot(trx, null);
      }
      await assertCover(trx, fields.coverImageId);
      const row = await trx
        .insertInto('announcements')
        .values({ ...fields, authorId: staff.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      await replaceProducts(trx, row.id, products);
      await recordAudit(trx, {
        context: audit(context, staff),
        action: 'announcement.create',
        targetType: ANNOUNCEMENT_TARGET_TYPE,
        targetId: row.id,
        details: { audience: fields.audience, pinned: fields.pinned },
      });
      return row.id;
    }),
  );
  return readAnnouncement(db, actorId, id);
}

/**
 * `PATCH /announcements/{id}`: edita em qualquer estado, menos `archived`
 * (`409 announcement_archived`). Editar uma publicada não a torna "não lida"; com
 * `notifyAgain`, sim.
 */
export async function updateAnnouncement(
  db: Database,
  actorId: string,
  id: unknown,
  patch: AnnouncementPatch,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminAnnouncement> {
  const key = announcementId(id);
  const changes: Record<string, unknown> = {};
  if (patch.title !== undefined) changes.title = announcementTitle(patch.title);
  if (patch.bodyMd !== undefined) Object.assign(changes, announcementBody(patch.bodyMd));
  if (patch.audience !== undefined) changes.audience = audience(patch.audience);
  if (patch.linkUrl !== undefined) changes.linkUrl = announcementLinkUrl(patch.linkUrl);
  if (patch.linkLabel !== undefined) changes.linkLabel = announcementLinkLabel(patch.linkLabel);
  if (patch.coverImageId !== undefined) {
    changes.coverImageId = optionalAnnouncementUuid(patch.coverImageId, 'cover_image_invalid');
  }
  if (patch.pinned !== undefined) changes.pinned = flag(patch.pinned, 'pinned');
  if (patch.notify !== undefined) changes.notify = flag(patch.notify, 'notify');
  const notifyAgain =
    patch.notifyAgain === undefined ? false : flag(patch.notifyAgain, 'notifyAgain');
  if (Object.keys(changes).length === 0 && patch.products === undefined && !notifyAgain) {
    throw businessRule('announcement_patch_empty', 'Informe o que deseja alterar.');
  }

  await pinnedGuard(() =>
    db.transaction().execute(async (trx) => {
      const staff = await getStaff(trx, actorId);
      const current = await requireAnnouncement(trx, staff, key, true);
      if (current.status === 'archived') throw announcementArchived();
      const next = { ...current, ...changes } as AnnouncementRow;
      if (next.linkUrl === null) {
        if (patch.linkLabel !== undefined && next.linkLabel !== null) {
          throw businessRule('announcement_link_invalid', 'O texto do botão exige o link.');
        }
        if (next.linkLabel !== null) {
          next.linkLabel = null;
          changes.linkLabel = null;
        }
      }
      const target = next.audience as Audience;
      let products: AudienceProduct[];
      if (target !== 'product') {
        products = [];
        if (current.audience === 'product') await replaceProducts(trx, key, []);
      } else if (patch.products !== undefined || current.audience !== 'product') {
        products = await resolveAudienceProducts(
          trx,
          patch.products,
          'announcement_products_invalid',
        );
        await replaceProducts(trx, key, products);
      } else {
        products = await currentProducts(trx, key);
      }
      await assertInstructorAudience(trx, staff, target, products);
      if (next.pinned && !current.pinned) {
        if (!managesAllAnnouncements(staff.role)) {
          throw permissionDenied('Só gerente e admin fixam novidades.');
        }
        await assertPinnedSlot(trx, key);
      }
      if (changes.coverImageId !== undefined) await assertCover(trx, next.coverImageId);
      const again = notifyAgain && current.status === 'published';
      if (notifyAgain && !again) {
        throw businessRule(
          'announcement_not_published',
          'Só uma novidade publicada pode ser avisada de novo.',
        );
      }
      await trx
        .updateTable('announcements')
        .set({
          ...changes,
          ...(again ? { publishedAt: sql<Date>`now()` } : {}),
          updatedAt: sql<Date>`now()`,
        })
        .where('id', '=', key)
        .execute();
      await recordAudit(trx, {
        context: audit(context, staff),
        action: 'announcement.update',
        targetType: ANNOUNCEMENT_TARGET_TYPE,
        targetId: key,
        details: {
          fields: [
            ...Object.keys(changes).filter((field) => field !== 'bodyHtml'),
            ...(patch.products === undefined ? [] : ['products']),
          ],
          notifyAgain: again,
        },
      });
      if (again) {
        await announcePublication(trx, next, { notify: next.notify, actorId: staff.id });
      }
    }),
  );
  return readAnnouncement(db, actorId, key);
}

export interface PublishAnnouncementInput {
  /** Futuro: agenda (`scheduled`). Ausente, nulo ou já passado: publica agora. */
  publishAt?: unknown;
}

/**
 * `POST /announcements/{id}/publish`: publica agora ou agenda. Vale para `draft` e
 * `scheduled` (reagendar troca a tarefa da fila). Já publicada: nada muda. Arquivada:
 * `409 announcement_archived`. Ao publicar, o contador de quem vê sobe (SSE) e, com `notify`
 * ligado na novidade, o público recebe `announcement.published`.
 */
export async function publishAnnouncement(
  db: Database,
  actorId: string,
  id: unknown,
  input: PublishAnnouncementInput = {},
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminAnnouncement> {
  const key = announcementId(id);
  let publishAt: Date | null = null;
  if (input.publishAt !== undefined && input.publishAt !== null) {
    publishAt =
      input.publishAt instanceof Date ? input.publishAt : new Date(String(input.publishAt));
    if (Number.isNaN(publishAt.getTime())) {
      throw businessRule('announcement_publish_at_invalid', 'Data de publicação inválida.');
    }
  }
  await db.transaction().execute(async (trx) => {
    const staff = await getStaff(trx, actorId);
    const current = await requireAnnouncement(trx, staff, key, true);
    if (current.status === 'archived') throw announcementArchived();
    if (current.status === 'published') return;
    await assertInstructorAudience(
      trx,
      staff,
      current.audience as Audience,
      await currentProducts(trx, key),
    );
    await removeQueuedAnnouncementPublish(trx, key);
    if (publishAt !== null && publishAt.getTime() > Date.now()) {
      await trx
        .updateTable('announcements')
        .set({ status: 'scheduled', publishAt })
        .where('id', '=', key)
        .execute();
      await enqueueAnnouncementPublish(trx, key, publishAt);
      await recordAudit(trx, {
        context: audit(context, staff),
        action: 'announcement.schedule',
        targetType: ANNOUNCEMENT_TARGET_TYPE,
        targetId: key,
        details: { publishAt: publishAt.toISOString() },
      });
      return;
    }
    await publishAnnouncementNow(trx, current, audit(context, staff));
  });
  return readAnnouncement(db, actorId, key);
}

/** Cancela o agendamento: a novidade volta a rascunho e a tarefa sai da fila. */
export async function unscheduleAnnouncement(
  db: Database,
  actorId: string,
  id: unknown,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminAnnouncement> {
  const key = announcementId(id);
  await db.transaction().execute(async (trx) => {
    const staff = await getStaff(trx, actorId);
    const current = await requireAnnouncement(trx, staff, key, true);
    if (current.status === 'draft') return;
    if (current.status !== 'scheduled') {
      throw conflict('announcement_not_scheduled', 'Esta novidade não está agendada.');
    }
    await removeQueuedAnnouncementPublish(trx, key);
    await trx
      .updateTable('announcements')
      .set({ status: 'draft', publishAt: null })
      .where('id', '=', key)
      .execute();
    await recordAudit(trx, {
      context: audit(context, staff),
      action: 'announcement.unschedule',
      targetType: ANNOUNCEMENT_TARGET_TYPE,
      targetId: key,
    });
  });
  return readAnnouncement(db, actorId, key);
}

/**
 * `POST /announcements/{id}/archive`: tira a publicada da lista do aluno sem apagar e libera
 * a fixação. Já arquivada: nada muda. Rascunho ou agendada: `409 announcement_not_published`.
 */
export async function archiveAnnouncement(
  db: Database,
  actorId: string,
  id: unknown,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminAnnouncement> {
  const key = announcementId(id);
  await db.transaction().execute(async (trx) => {
    const staff = await getStaff(trx, actorId);
    const current = await requireAnnouncement(trx, staff, key, true);
    if (current.status === 'archived') return;
    if (current.status !== 'published') {
      throw conflict('announcement_not_published', 'Só uma novidade publicada é arquivada.');
    }
    await trx
      .updateTable('announcements')
      .set({ status: 'archived', pinned: false, archivedAt: sql<Date>`now()` })
      .where('id', '=', key)
      .execute();
    await recordAudit(trx, {
      context: audit(context, staff),
      action: 'announcement.archive',
      targetType: ANNOUNCEMENT_TARGET_TYPE,
      targetId: key,
    });
  });
  return readAnnouncement(db, actorId, key);
}

/** `DELETE /announcements/{id}`: apaga em qualquer estado, com a tarefa agendada. */
export async function deleteAnnouncement(
  db: Database,
  actorId: string,
  id: unknown,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<void> {
  const key = announcementId(id);
  await db.transaction().execute(async (trx) => {
    const staff = await getStaff(trx, actorId);
    const current = await requireAnnouncement(trx, staff, key, true);
    await removeQueuedAnnouncementPublish(trx, key);
    await trx.deleteFrom('announcements').where('id', '=', key).execute();
    await recordAudit(trx, {
      context: audit(context, staff),
      action: 'announcement.delete',
      targetType: ANNOUNCEMENT_TARGET_TYPE,
      targetId: key,
      details: { title: current.title, status: current.status },
    });
  });
}
