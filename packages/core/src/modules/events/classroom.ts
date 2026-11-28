import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  DomainError,
  type FieldError,
  notFound,
  unauthenticated,
  validationFailed,
} from '../../errors/domain-error.ts';
import {
  type CatalogPage,
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import {
  type Audience,
  type AudienceProductRef,
  type AudienceViewer,
  audienceAccess,
  getAudienceViewer,
  readAudienceProducts,
} from '../entitlements/audience.ts';
import {
  EVENT_AUDIENCE,
  EVENT_AUDIENCE_TABLE,
  type EventKind,
  type EventRow,
  type EventStatus,
  eventId,
  eventJoinOpensAt,
  eventStatus,
  serverNow,
} from './rules.ts';

// Calendário do aluno (spec 018; leituras da classroom-api). Todo cadastrado vê título,
// descrição, data, tipo e público; o link de transmissão só sai de `joinEvent`, para quem
// pertence ao público (ou é da equipe), de 15 minutos antes do início até o fim.

const RECORDINGS_SCOPE = 'events.recordings';
/** Maior período de uma consulta de agenda: um mês com folga das semanas vizinhas. */
export const EVENT_AGENDA_MAX_DAYS = 62;

async function viewer(db: Database, userId: string): Promise<AudienceViewer> {
  const user = await getAudienceViewer(db, userId);
  if (!user) throw unauthenticated();
  return user;
}

/** O evento como o aluno o vê em listagens: nunca leva o link de transmissão. */
export interface EventSummary {
  id: string;
  title: string;
  descriptionHtml: string;
  kind: EventKind;
  startsAt: Date;
  endsAt: Date;
  /** Pelo relógio do servidor; o cliente recalcula com `serverTime` (RNF-02). */
  status: EventStatus;
  audience: Audience;
  /** O usuário pertence ao público (ou é da equipe): pode pedir o link na janela. */
  canJoin: boolean;
  courseId: string | null;
  seriesId: string | null;
  coverImageId: string | null;
  hasRecording: boolean;
}

interface ViewRow extends EventRow {
  canJoin: boolean;
}

function summary(row: ViewRow, now: Date): EventSummary {
  return {
    id: row.id,
    title: row.title,
    descriptionHtml: row.descriptionHtml,
    kind: row.kind as EventKind,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: eventStatus(row, now),
    audience: row.audience as Audience,
    canJoin: row.canJoin,
    courseId: row.courseId,
    seriesId: row.seriesId,
    coverImageId: row.coverImageId,
    hasRecording: row.recordingLessonId !== null && row.canceledAt === null,
  };
}

function visible(db: Database, user: AudienceViewer) {
  return db
    .selectFrom('events as ev')
    .selectAll('ev')
    .select(
      audienceAccess(EVENT_AUDIENCE, { id: sql`${user.id}`, role: sql`${user.role}` }).as(
        'canJoin',
      ),
    );
}

export interface EventAgenda {
  /** Hora do servidor usada nos status. */
  serverTime: Date;
  items: EventSummary[];
}

/**
 * `GET /events?from&to`: os eventos que começam no período (até 62 dias), em ordem de início.
 * O cancelado aparece (riscado) só até a data dele passar.
 */
export async function listEventAgenda(
  db: Database,
  userId: string,
  query: { from: unknown; to: unknown },
): Promise<EventAgenda> {
  const user = await viewer(db, userId);
  const errors: FieldError[] = [];
  const date = (value: unknown, path: string): Date => {
    const parsed =
      value instanceof Date ? value : new Date(typeof value === 'string' ? value : Number.NaN);
    if (Number.isNaN(parsed.getTime())) errors.push({ path, message: 'Data inválida.' });
    return parsed;
  };
  const from = date(query.from, 'query.from');
  const to = date(query.to, 'query.to');
  if (errors.length === 0) {
    const span = to.getTime() - from.getTime();
    if (span <= 0 || span > EVENT_AGENDA_MAX_DAYS * 86_400_000) {
      errors.push({
        path: 'query.to',
        message: `O período vai de 1 a ${EVENT_AGENDA_MAX_DAYS} dias.`,
      });
    }
  }
  if (errors.length > 0) throw validationFailed(errors);
  const now = await serverNow(db);
  const rows = (await visible(db, user)
    .where('ev.startsAt', '>=', from)
    .where('ev.startsAt', '<', to)
    .where((eb) => eb.or([eb('ev.canceledAt', 'is', null), eb('ev.endsAt', '>', now)]))
    .orderBy('ev.startsAt')
    .orderBy('ev.id')
    .execute()) as ViewRow[];
  return { serverTime: now, items: rows.map((row) => summary(row, now)) };
}

/**
 * Eventos ao vivo agora que o usuário pode acompanhar: o banner da página inicial (spec 018,
 * "Regras"). Fora do público, o evento não entra.
 */
export async function listLiveEvents(db: Database, userId: string): Promise<EventAgenda> {
  const user = await viewer(db, userId);
  const now = await serverNow(db);
  const rows = (await visible(db, user)
    .where('ev.startsAt', '<=', now)
    .where('ev.endsAt', '>', now)
    .where('ev.canceledAt', 'is', null)
    .orderBy('ev.startsAt')
    .execute()) as ViewRow[];
  return {
    serverTime: now,
    items: rows.filter((row) => row.canJoin).map((row) => summary(row, now)),
  };
}

export interface EventRecordingRef {
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTitle: string;
  /** Rota da aula no classroom; o acesso segue as regras da própria aula (spec 014). */
  url: string;
}

export interface EventView extends EventSummary {
  serverTime: Date;
  /** Quando o link passa a ser entregue (15 minutos antes do início). */
  joinOpensAt: Date;
  /** Produtos do público `product`: o caminho para obter acesso quando `canJoin` é falso. */
  products: AudienceProductRef[];
  recording: EventRecordingRef | null;
}

async function recordings(
  db: Database,
  lessonIds: readonly string[],
): Promise<Map<string, EventRecordingRef>> {
  const refs = new Map<string, EventRecordingRef>();
  if (lessonIds.length === 0) return refs;
  const rows = await db
    .selectFrom('lessons')
    .innerJoin('modules', 'modules.id', 'lessons.moduleId')
    .innerJoin('courses', 'courses.id', 'modules.courseId')
    .select([
      'lessons.id as lessonId',
      'lessons.title as lessonTitle',
      'courses.id as courseId',
      'courses.title as courseTitle',
      'courses.slug',
    ])
    .where('lessons.id', 'in', lessonIds)
    .where('lessons.status', '=', 'published')
    .where('courses.status', '=', 'published')
    .where('courses.archivedAt', 'is', null)
    .execute();
  for (const { slug, ...row } of rows) {
    refs.set(row.lessonId, { ...row, url: `/meus-cursos/${slug}/aulas/${row.lessonId}` });
  }
  return refs;
}

async function requireVisible(db: Database, user: AudienceViewer, id: string): Promise<ViewRow> {
  const row = (await visible(db, user).where('ev.id', '=', id).executeTakeFirst()) as
    | ViewRow
    | undefined;
  if (!row) throw notFound('Evento não encontrado.');
  return row;
}

/**
 * `GET /events/{id}`: os detalhes, sem o link. Quem está fora do público recebe `canJoin`
 * falso e os produtos do evento, para a tela mostrar o bloqueio "exclusivo para alunos".
 */
export async function getEventView(db: Database, userId: string, id: unknown): Promise<EventView> {
  const user = await viewer(db, userId);
  const row = await requireVisible(db, user, eventId(id));
  const now = await serverNow(db);
  const products = await readAudienceProducts(db, EVENT_AUDIENCE_TABLE, [row.id]);
  const recording =
    row.recordingLessonId === null || row.canceledAt !== null
      ? null
      : ((await recordings(db, [row.recordingLessonId])).get(row.recordingLessonId) ?? null);
  return {
    ...summary(row, now),
    hasRecording: recording !== null,
    serverTime: now,
    joinOpensAt: eventJoinOpensAt(row.startsAt),
    products: products.get(row.id) ?? [],
    recording,
  };
}

function joinRefused(
  status: number,
  code: string,
  title: string,
  extras?: Record<string, unknown>,
): DomainError {
  return new DomainError({ status, code, title, extras });
}

export interface EventJoin {
  streamUrl: string;
  /** Fim do evento: depois dele o link deixa de ser entregue. */
  endsAt: Date;
}

/**
 * `GET /events/{id}/join`: o link de transmissão (RF-04), pela hora do servidor. Fora do
 * público: `403 event_forbidden`. Antes de 15 minutos do início: `409 event_not_open`, com
 * `opensAt`. Depois do fim: `409 event_ended`. Cancelado: `404`. Na janela, mas sem link
 * cadastrado: `409 event_link_unavailable`.
 */
export async function joinEvent(db: Database, userId: string, id: unknown): Promise<EventJoin> {
  const user = await viewer(db, userId);
  const row = await requireVisible(db, user, eventId(id));
  if (row.canceledAt !== null) throw notFound('Evento não encontrado.');
  if (!row.canJoin) {
    throw joinRefused(403, 'event_forbidden', 'Evento exclusivo para alunos');
  }
  const now = await serverNow(db);
  const opensAt = eventJoinOpensAt(row.startsAt);
  if (now.getTime() < opensAt.getTime()) {
    throw joinRefused(409, 'event_not_open', 'O link ainda não está disponível', {
      opensAt: opensAt.toISOString(),
    });
  }
  if (now.getTime() >= row.endsAt.getTime()) {
    throw joinRefused(409, 'event_ended', 'O evento já terminou');
  }
  if (row.streamUrl === null) {
    throw joinRefused(409, 'event_link_unavailable', 'O link ainda não foi informado');
  }
  return { streamUrl: row.streamUrl, endsAt: row.endsAt };
}

export interface EventRecording extends EventSummary {
  recording: EventRecordingRef;
}

/**
 * `GET /events/recordings`: eventos passados com gravação, do mais recente para o mais
 * antigo. A aula precisa estar publicada; o acesso a ela é decidido ao abri-la.
 */
export async function listEventRecordings(
  db: Database,
  userId: string,
  query: Pick<CatalogPageInput, 'limit' | 'cursor'> = {},
): Promise<CatalogPage<EventRecording>> {
  const user = await viewer(db, userId);
  const params = readCatalogPageParams(query, RECORDINGS_SCOPE, ['recent'] as const, 'recent');
  const now = await serverNow(db);
  let select = visible(db, user)
    .where('ev.recordingLessonId', 'is not', null)
    .where('ev.canceledAt', 'is', null)
    .where('ev.endsAt', '<=', now)
    .where(
      sql<boolean>`EXISTS (
        SELECT 1 FROM lessons l JOIN modules m ON m.id = l.module_id
          JOIN courses c ON c.id = m.course_id
        WHERE l.id = ev.recording_lesson_id AND l.status = 'published'
          AND c.status = 'published' AND c.archived_at IS NULL
      )`,
    )
    .orderBy('ev.startsAt', 'desc')
    .orderBy('ev.id', 'desc')
    .limit(params.limit + 1);
  if (params.afterId !== undefined) {
    select = select.where(
      sql<boolean>`(ev.starts_at, ev.id) < (
        SELECT p.starts_at, p.id FROM events p WHERE p.id = ${params.afterId}
      )`,
    );
  }
  const rows = (await select.execute()) as ViewRow[];
  const refs = await recordings(
    db,
    rows.flatMap((row) => (row.recordingLessonId === null ? [] : [row.recordingLessonId])),
  );
  return toCatalogPage(rows, params, RECORDINGS_SCOPE, (row) => ({
    ...summary(row, now),
    recording: refs.get(row.recordingLessonId as string) as EventRecordingRef,
  }));
}
