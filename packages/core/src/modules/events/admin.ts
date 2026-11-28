import { randomUUID } from 'node:crypto';
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
import { enqueueEventReminder, removeQueuedEventReminders } from '../jobs/events.ts';
import { notify } from '../notifications/central/notify.ts';
import {
  type EventStaff,
  eventManageScope,
  managesAllEvents,
  mayManageEvents,
} from '../permissions/events.ts';
import { isRole } from '../permissions/roles.ts';
import { getSchoolTimezone } from '../settings/settings.ts';
import {
  assertEventWindow,
  EVENT_AUDIENCE_TABLE,
  EVENT_REPEAT_MAX_WEEKS,
  EVENT_TARGET_TYPE,
  type EventKind,
  type EventRow,
  type EventStatus,
  eventAudienceMembers,
  eventDate,
  eventDescription,
  eventId,
  eventInvalid,
  eventKind,
  eventStatus,
  eventStreamUrl,
  eventTitle,
  optionalEventUuid,
  serverNow,
} from './rules.ts';

// Gestão de eventos (spec 018, RF-01; dono das escritas: admin-api). `manager` e `admin` gerem
// todos; o instrutor, só os ligados aos próprios cursos (fora disso, `404`). O link de
// transmissão nunca vai para a auditoria nem para o `data` das notificações.

const DEFAULT_CONTEXT: AuditContext = { origin: 'admin_panel' };
const LIST_SCOPE = 'events.admin';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getEventStaff(db: Database, actorId: string): Promise<EventStaff> {
  if (!UUID_PATTERN.test(actorId)) throw unauthenticated();
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'suspendedKind'])
    .where('id', '=', actorId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!user || user.suspendedKind === 'full') throw unauthenticated();
  if (!isRole(user.role) || !mayManageEvents(user.role) || user.suspendedKind !== null) {
    throw permissionDenied();
  }
  return { id: user.id, role: user.role };
}

function audit(context: AuditContext, staff: EventStaff): AuditContext {
  return { ...context, actorUserId: staff.id, actorRole: staff.role };
}

/** O evento como a equipe o vê: com o link de transmissão e os produtos do público. */
export interface AdminEvent {
  id: string;
  title: string;
  descriptionMd: string;
  descriptionHtml: string;
  kind: EventKind;
  startsAt: Date;
  endsAt: Date;
  /** Pelo relógio do servidor no momento da leitura. */
  status: EventStatus;
  streamUrl: string | null;
  audience: Audience;
  products: AudienceProductRef[];
  courseId: string | null;
  recordingLessonId: string | null;
  /** Agrupa os eventos criados pela mesma repetição semanal. */
  seriesId: string | null;
  coverImageId: string | null;
  canceledAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function shape(row: EventRow, products: AudienceProductRef[], now: Date): AdminEvent {
  return {
    id: row.id,
    title: row.title,
    descriptionMd: row.descriptionMd,
    descriptionHtml: row.descriptionHtml,
    kind: row.kind as EventKind,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: eventStatus(row, now),
    streamUrl: row.streamUrl,
    audience: row.audience as Audience,
    products,
    courseId: row.courseId,
    recordingLessonId: row.recordingLessonId,
    seriesId: row.seriesId,
    coverImageId: row.coverImageId,
    canceledAt: row.canceledAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function scoped(db: Database, staff: EventStaff) {
  return db.selectFrom('events as ev').selectAll('ev').where(eventManageScope(staff));
}

async function shapeAll(db: Database, rows: EventRow[]): Promise<AdminEvent[]> {
  const now = await serverNow(db);
  const products = await readAudienceProducts(
    db,
    EVENT_AUDIENCE_TABLE,
    rows.map(({ id }) => id),
  );
  return rows.map((row) => shape(row, products.get(row.id) ?? [], now));
}

async function requireEvent(
  db: Database,
  staff: EventStaff,
  id: string,
  lock = false,
): Promise<EventRow> {
  let select = scoped(db, staff).where('ev.id', '=', id);
  if (lock) select = select.forUpdate('ev');
  const row = await select.executeTakeFirst();
  if (!row) throw notFound('Evento não encontrado.');
  return row;
}

export interface AdminEventsQuery extends Pick<CatalogPageInput, 'limit' | 'cursor'> {
  /** Início a partir de (inclusive). */
  from?: unknown;
  /** Início antes de (exclusivo). */
  to?: unknown;
  courseId?: unknown;
}

export interface AdminEventsPage extends CatalogPage<AdminEvent> {
  /** Hora do servidor usada no `status` (RNF-02). */
  serverTime: Date;
}

/** `GET /events` do admin: do mais recente para o mais antigo, com filtro de período e curso. */
export async function listEvents(
  db: Database,
  actorId: string,
  query: AdminEventsQuery = {},
): Promise<AdminEventsPage> {
  const staff = await getEventStaff(db, actorId);
  const errors: FieldError[] = [];
  const date = (value: unknown, path: string): Date | undefined => {
    if (value === undefined) return undefined;
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ path, message: 'Data inválida.' });
      return undefined;
    }
    return parsed;
  };
  const from = date(query.from, 'query.from');
  const to = date(query.to, 'query.to');
  if (
    query.courseId !== undefined &&
    (typeof query.courseId !== 'string' || !UUID_PATTERN.test(query.courseId))
  ) {
    errors.push({ path: 'query.courseId', message: 'Curso inválido.' });
  }
  const params = readCatalogPageParams(
    { limit: query.limit, cursor: query.cursor },
    LIST_SCOPE,
    ['recent'] as const,
    'recent',
    errors,
  );
  let select = scoped(db, staff)
    .orderBy('ev.startsAt', 'desc')
    .orderBy('ev.id', 'desc')
    .limit(params.limit + 1);
  if (from) select = select.where('ev.startsAt', '>=', from);
  if (to) select = select.where('ev.startsAt', '<', to);
  if (query.courseId !== undefined) {
    select = select.where('ev.courseId', '=', query.courseId as string);
  }
  if (params.afterId !== undefined) {
    select = select.where(
      sql<boolean>`(ev.starts_at, ev.id) < (
        SELECT p.starts_at, p.id FROM events p WHERE p.id = ${params.afterId}
      )`,
    );
  }
  const rows = await select.execute();
  const shaped = await shapeAll(db, rows.slice(0, params.limit));
  const byId = new Map(shaped.map((event) => [event.id, event]));
  return {
    ...toCatalogPage(rows, params, LIST_SCOPE, (row) => byId.get(row.id) as AdminEvent),
    serverTime: await serverNow(db),
  };
}

/** `GET /events/{id}` do admin. Fora do escopo do instrutor: `404`. */
export async function readEvent(db: Database, actorId: string, id: unknown): Promise<AdminEvent> {
  const staff = await getEventStaff(db, actorId);
  const [event] = await shapeAll(db, [await requireEvent(db, staff, eventId(id))]);
  return event as AdminEvent;
}

export interface EventInput {
  title: unknown;
  descriptionMd: unknown;
  kind: unknown;
  /** `Date` ou ISO 8601 com fuso; guardado em UTC. */
  startsAt: unknown;
  endsAt: unknown;
  streamUrl?: unknown;
  audience?: unknown;
  /** Só com `audience = 'product'`: `{ productType, productId }[]`. */
  products?: unknown;
  courseId?: unknown;
  recordingLessonId?: unknown;
  coverImageId?: unknown;
}

export interface CreateEventInput extends EventInput {
  /** Repetição semanal: total de eventos criados, de 1 (padrão, sem repetição) a 26. */
  repeatWeeks?: unknown;
}

export type EventPatch = Partial<EventInput>;

function eventAudience(value: unknown): Audience {
  if (!isAudience(value)) throw eventInvalid('event_audience_invalid', 'Público inválido.');
  return value;
}

/** Confere curso (do próprio instrutor, quando é ele), aula de gravação e capa. */
async function assertLinks(
  trx: Database,
  staff: EventStaff,
  links: { courseId: string | null; recordingLessonId: string | null; coverImageId: string | null },
): Promise<void> {
  if (links.courseId === null) {
    if (!managesAllEvents(staff.role)) {
      throw permissionDenied('O instrutor só gere eventos ligados aos próprios cursos.');
    }
  } else {
    const course = await trx
      .selectFrom('courses')
      .select('ownerId')
      .where('id', '=', links.courseId)
      .executeTakeFirst();
    if (!course) throw eventInvalid('event_course_invalid', 'O curso informado não existe.');
    if (!managesAllEvents(staff.role) && course.ownerId !== staff.id) {
      throw permissionDenied('O instrutor só gere eventos ligados aos próprios cursos.');
    }
  }
  if (links.recordingLessonId !== null) {
    const lesson = await trx
      .selectFrom('lessons')
      .select('id')
      .where('id', '=', links.recordingLessonId)
      .executeTakeFirst();
    if (!lesson) throw eventInvalid('event_recording_invalid', 'A aula da gravação não existe.');
  }
  if (links.coverImageId !== null) {
    const image = await trx
      .selectFrom('images')
      .select('id')
      .where('id', '=', links.coverImageId)
      .where('purpose', '=', 'event_cover')
      .where('hiddenAt', 'is', null)
      .executeTakeFirst();
    if (!image) throw eventInvalid('cover_image_invalid', 'A capa não é uma imagem de evento.');
  }
}

async function replaceProducts(
  trx: Database,
  id: string,
  products: readonly AudienceProduct[],
): Promise<void> {
  await trx.deleteFrom('eventProducts').where('eventId', '=', id).execute();
  if (products.length > 0) {
    await trx
      .insertInto('eventProducts')
      .values(products.map((product) => ({ eventId: id, ...product })))
      .execute();
  }
}

/** Avisa o público (`event.created` ou `event.canceled`), sem o link no `data`. */
async function notifyAudience(
  trx: Database,
  type: 'event.created' | 'event.canceled',
  event: { id: string; title: string; startsAt: Date },
  actorId: string,
  extra: Record<string, number> = {},
): Promise<void> {
  await notify(trx, type, await eventAudienceMembers(trx, event.id), {
    actorId,
    targetType: EVENT_TARGET_TYPE,
    targetId: event.id,
    data: {
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      ...extra,
    },
  });
}

/**
 * `POST /events`: cria o evento e, com `repeatWeeks` de 2 a 26, um por semana no mesmo horário
 * local da escola, todos independentes e com o mesmo `seriesId`. Cada evento futuro ganha o
 * lembrete de 30 minutos antes; o público é avisado uma vez (`event.created`, do primeiro).
 * `ends_at` ≤ `starts_at` ou mais de 12 horas: `422 event_time_invalid`.
 */
export async function createEvent(
  db: Database,
  actorId: string,
  input: CreateEventInput,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminEvent[]> {
  const fields = {
    title: eventTitle(input.title),
    ...eventDescription(input.descriptionMd),
    kind: eventKind(input.kind),
    streamUrl: eventStreamUrl(input.streamUrl),
    audience: eventAudience(input.audience ?? 'all'),
  };
  const startsAt = eventDate(input.startsAt);
  const endsAt = eventDate(input.endsAt);
  assertEventWindow(startsAt, endsAt);
  const links = {
    courseId: optionalEventUuid(input.courseId, 'event_course_invalid'),
    recordingLessonId: optionalEventUuid(input.recordingLessonId, 'event_recording_invalid'),
    coverImageId: optionalEventUuid(input.coverImageId, 'cover_image_invalid'),
  };
  const weeks = input.repeatWeeks ?? 1;
  if (
    typeof weeks !== 'number' ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > EVENT_REPEAT_MAX_WEEKS
  ) {
    throw eventInvalid(
      'event_repeat_invalid',
      `A repetição semanal vai de 1 a ${EVENT_REPEAT_MAX_WEEKS} semanas.`,
    );
  }
  const duration = endsAt.getTime() - startsAt.getTime();

  const ids = await db.transaction().execute(async (trx) => {
    const staff = await getEventStaff(trx, actorId);
    await assertLinks(trx, staff, links);
    const products =
      fields.audience === 'product'
        ? await resolveAudienceProducts(trx, input.products, 'event_products_invalid')
        : [];
    const timezone = await getSchoolTimezone(trx);
    // Mesma hora local a cada semana, também na troca de horário de verão do fuso da escola.
    const starts = await sql<{ startsAt: Date }>`
      SELECT ((${startsAt}::timestamptz AT TIME ZONE ${timezone}) + make_interval(weeks => n))
        AT TIME ZONE ${timezone} AS starts_at
      FROM generate_series(0, ${weeks - 1}) AS n ORDER BY n
    `.execute(trx);
    const seriesId = weeks > 1 ? randomUUID() : null;
    const now = Date.now();
    const created: string[] = [];
    for (const [index, occurrence] of starts.rows.entries()) {
      const end = new Date(occurrence.startsAt.getTime() + duration);
      const row = await trx
        .insertInto('events')
        .values({
          ...fields,
          ...links,
          startsAt: occurrence.startsAt,
          endsAt: end,
          seriesId,
          createdBy: staff.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await replaceProducts(trx, row.id, products);
      await recordAudit(trx, {
        context: audit(context, staff),
        action: 'event.create',
        targetType: EVENT_TARGET_TYPE,
        targetId: row.id,
        details: {
          kind: fields.kind,
          audience: fields.audience,
          startsAt: occurrence.startsAt.toISOString(),
          seriesId,
        },
      });
      if (occurrence.startsAt.getTime() > now) {
        await enqueueEventReminder(trx, row.id, occurrence.startsAt);
      }
      if (index === 0 && end.getTime() > now) {
        await notifyAudience(
          trx,
          'event.created',
          { id: row.id, title: fields.title, startsAt: occurrence.startsAt },
          staff.id,
          weeks > 1 ? { occurrences: weeks } : {},
        );
      }
      created.push(row.id);
    }
    return created;
  });
  const rows = await db
    .selectFrom('events as ev')
    .selectAll('ev')
    .where('ev.id', 'in', ids)
    .orderBy('ev.startsAt')
    .execute();
  return shapeAll(db, rows);
}

/**
 * `PATCH /events/{id}`: edita só este evento (os da mesma série seguem independentes). Mudar
 * o início refaz o lembrete. Evento cancelado não é editado: `409 event_canceled`.
 */
export async function updateEvent(
  db: Database,
  actorId: string,
  id: unknown,
  patch: EventPatch,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminEvent> {
  const key = eventId(id);
  const changes: Record<string, unknown> = {};
  if (patch.title !== undefined) changes.title = eventTitle(patch.title);
  if (patch.descriptionMd !== undefined) {
    Object.assign(changes, eventDescription(patch.descriptionMd));
  }
  if (patch.kind !== undefined) changes.kind = eventKind(patch.kind);
  if (patch.streamUrl !== undefined) changes.streamUrl = eventStreamUrl(patch.streamUrl);
  if (patch.audience !== undefined) changes.audience = eventAudience(patch.audience);
  if (patch.startsAt !== undefined) changes.startsAt = eventDate(patch.startsAt);
  if (patch.endsAt !== undefined) changes.endsAt = eventDate(patch.endsAt);
  if (patch.courseId !== undefined) {
    changes.courseId = optionalEventUuid(patch.courseId, 'event_course_invalid');
  }
  if (patch.recordingLessonId !== undefined) {
    changes.recordingLessonId = optionalEventUuid(
      patch.recordingLessonId,
      'event_recording_invalid',
    );
  }
  if (patch.coverImageId !== undefined) {
    changes.coverImageId = optionalEventUuid(patch.coverImageId, 'cover_image_invalid');
  }
  if (Object.keys(changes).length === 0 && patch.products === undefined) {
    throw businessRule('event_patch_empty', 'Informe o que deseja alterar.');
  }

  await db.transaction().execute(async (trx) => {
    const staff = await getEventStaff(trx, actorId);
    const current = await requireEvent(trx, staff, key, true);
    if (current.canceledAt !== null) {
      throw conflict('event_canceled', 'Evento cancelado não pode ser editado.');
    }
    const next = { ...current, ...changes } as EventRow;
    assertEventWindow(next.startsAt, next.endsAt);
    await assertLinks(trx, staff, next);
    if (next.audience !== 'product') {
      if (current.audience === 'product') await replaceProducts(trx, key, []);
    } else if (patch.products !== undefined || current.audience !== 'product') {
      await replaceProducts(
        trx,
        key,
        await resolveAudienceProducts(trx, patch.products, 'event_products_invalid'),
      );
    }
    if (Object.keys(changes).length > 0) {
      await trx.updateTable('events').set(changes).where('id', '=', key).execute();
    } else {
      await trx
        .updateTable('events')
        .set({ updatedAt: sql<Date>`now()` })
        .where('id', '=', key)
        .execute();
    }
    if (next.startsAt.getTime() !== current.startsAt.getTime()) {
      await removeQueuedEventReminders(trx, key);
      if (next.startsAt.getTime() > Date.now()) {
        await enqueueEventReminder(trx, key, next.startsAt);
      }
    }
    await recordAudit(trx, {
      context: audit(context, staff),
      action: 'event.update',
      targetType: EVENT_TARGET_TYPE,
      targetId: key,
      // Só os nomes dos campos: o link de transmissão não entra na auditoria.
      details: {
        fields: [
          ...Object.keys(changes).filter((field) => field !== 'descriptionHtml'),
          ...(patch.products === undefined ? [] : ['products']),
        ],
      },
    });
  });
  return readEvent(db, actorId, key);
}

/**
 * `POST /events/{id}/cancel`: marca o cancelamento, tira o lembrete da fila e avisa o público
 * (`event.canceled`) se o evento ainda não terminou. Repetir não avisa de novo.
 */
export async function cancelEvent(
  db: Database,
  actorId: string,
  id: unknown,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminEvent> {
  const key = eventId(id);
  await db.transaction().execute(async (trx) => {
    const staff = await getEventStaff(trx, actorId);
    const event = await requireEvent(trx, staff, key, true);
    if (event.canceledAt !== null) return;
    await trx
      .updateTable('events')
      .set({ canceledAt: sql<Date>`now()` })
      .where('id', '=', key)
      .execute();
    await removeQueuedEventReminders(trx, key);
    await recordAudit(trx, {
      context: audit(context, staff),
      action: 'event.cancel',
      targetType: EVENT_TARGET_TYPE,
      targetId: key,
    });
    if (event.endsAt.getTime() > Date.now()) {
      await notifyAudience(trx, 'event.canceled', event, staff.id);
    }
  });
  return readEvent(db, actorId, key);
}

/** `DELETE /events/{id}`: apaga o evento e o lembrete pendente; não avisa o público. */
export async function deleteEvent(
  db: Database,
  actorId: string,
  id: unknown,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<void> {
  const key = eventId(id);
  await db.transaction().execute(async (trx) => {
    const staff = await getEventStaff(trx, actorId);
    const event = await requireEvent(trx, staff, key, true);
    await removeQueuedEventReminders(trx, key);
    await trx.deleteFrom('events').where('id', '=', key).execute();
    await recordAudit(trx, {
      context: audit(context, staff),
      action: 'event.delete',
      targetType: EVENT_TARGET_TYPE,
      targetId: key,
      details: { title: event.title, startsAt: event.startsAt.toISOString() },
    });
  });
}
