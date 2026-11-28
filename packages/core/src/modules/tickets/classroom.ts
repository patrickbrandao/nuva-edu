import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  type FieldError,
  notFound,
  permissionDenied,
  rateLimited,
} from '../../errors/domain-error.ts';
import { type AuditContext, recordAudit } from '../audit/record.ts';
import { getEbookDownload, getLessonContent } from '../catalog/classroom.ts';
import {
  type CatalogPage,
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import {
  assertTicketMessageRate,
  getTicketUser,
  isTicketStatus,
  notifyTicketStaff,
  optionalUuid,
  shapeTicket,
  shapeTicketMessage,
  TICKET_SUBJECT_MAX_LENGTH,
  TICKET_TARGET_TYPE,
  TICKETS_PER_DAY,
  type Ticket,
  type TicketMessage,
  type TicketMessageRow,
  type TicketRow,
  type TicketUser,
  ticketAutocloseDays,
  ticketClosed,
  ticketId,
  ticketKind,
  ticketMarkdown,
  ticketSubject,
} from './rules.ts';

// Chamados pelo classroom (spec 023): o aluno abre, acompanha, responde e resolve os próprios
// chamados. Dono das escritas: classroom-api. Nota interna nunca sai por aqui, e quem somou um
// relato de `broken_link` acompanha o chamado sem ver as mensagens dos outros.

const DEFAULT_CONTEXT: AuditContext = { origin: 'classroom' };
const LIST_SCOPE = 'tickets.mine';

/** Como o usuário se relaciona com o chamado: abriu, ou somou relato de `broken_link`. */
export type TicketRelation = 'owner' | 'follower';

export interface MyTicket extends Ticket {
  relation: TicketRelation;
}

export interface MyTicketDetail extends MyTicket {
  messages: TicketMessage[];
}

export interface OpenTicketInput {
  kind: unknown;
  subject: unknown;
  bodyMd: unknown;
  orderId?: unknown;
  courseId?: unknown;
  lessonId?: unknown;
  ebookId?: unknown;
}

function audit(context: AuditContext, user: TicketUser): AuditContext {
  return { ...context, actorUserId: user.id, actorRole: user.role };
}

/** RNF-01: 5 chamados (ou relatos somados) em 24 horas; o sexto recebe `429` com `Retry-After`. */
async function assertDailyLimit(trx: Database, userId: string): Promise<void> {
  const result = await sql<{ count: number; retryAfter: number }>`
    SELECT count(*)::int AS count,
      coalesce(ceil(extract(epoch from min(created_at) + interval '1 day' - now())), 1)::int
        AS retry_after
    FROM (
      SELECT created_at FROM tickets
        WHERE user_id = ${userId} AND created_at > now() - interval '1 day'
      UNION ALL
      SELECT created_at FROM ticket_followers
        WHERE user_id = ${userId} AND created_at > now() - interval '1 day'
    ) recent
  `.execute(trx);
  const rate = result.rows[0];
  if (rate && rate.count >= TICKETS_PER_DAY) {
    throw rateLimited(Math.max(rate.retryAfter, 1), 'Limite de chamados por dia atingido.');
  }
}

interface TicketLinks {
  orderId: string | null;
  courseId: string | null;
  lessonId: string | null;
  ebookId: string | null;
}

/** Confere os vínculos (RF-05): o pedido é do próprio usuário e a aula define o curso. */
async function resolveLinks(
  trx: Database,
  user: TicketUser,
  input: OpenTicketInput,
): Promise<TicketLinks> {
  const links: TicketLinks = {
    orderId: optionalUuid(input.orderId, 'ticket_link_invalid'),
    courseId: optionalUuid(input.courseId, 'ticket_link_invalid'),
    lessonId: optionalUuid(input.lessonId, 'ticket_link_invalid'),
    ebookId: optionalUuid(input.ebookId, 'ticket_link_invalid'),
  };
  const invalid = () => businessRule('ticket_link_invalid', 'O vínculo informado não existe.');
  if (links.orderId !== null) {
    const order = await trx
      .selectFrom('orders')
      .select('id')
      .where('id', '=', links.orderId)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    if (!order) throw invalid();
  }
  if (links.lessonId !== null) {
    const lesson = await trx
      .selectFrom('lessons')
      .innerJoin('modules', 'modules.id', 'lessons.moduleId')
      .select('modules.courseId')
      .where('lessons.id', '=', links.lessonId)
      .executeTakeFirst();
    if (!lesson || (links.courseId !== null && links.courseId !== lesson.courseId)) {
      throw invalid();
    }
    links.courseId = lesson.courseId;
  } else if (links.courseId !== null) {
    const course = await trx
      .selectFrom('courses')
      .select('id')
      .where('id', '=', links.courseId)
      .executeTakeFirst();
    if (!course) throw invalid();
  }
  if (links.ebookId !== null) {
    const ebook = await trx
      .selectFrom('ebooks')
      .select('id')
      .where('id', '=', links.ebookId)
      .executeTakeFirst();
    if (!ebook) throw invalid();
  }
  return links;
}

async function insertTicket(
  trx: Database,
  user: TicketUser,
  fields: { kind: string; subject: string; bodyMd: string; bodyHtml: string } & TicketLinks,
  context: AuditContext,
): Promise<string> {
  const { bodyMd, bodyHtml, ...ticket } = fields;
  const row = await trx
    .insertInto('tickets')
    .values({ ...ticket, userId: user.id })
    .returning(['id', 'number', 'kind', 'assigneeId'])
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('ticketMessages')
    .values({ ticketId: row.id, authorId: user.id, bodyMd, bodyHtml })
    .execute();
  await recordAudit(trx, {
    context: audit(context, user),
    action: 'ticket.open',
    targetType: TICKET_TARGET_TYPE,
    targetId: row.id,
    details: { kind: row.kind },
  });
  await notifyTicketStaff(trx, 'ticket.opened', row, user.id);
  return row.id;
}

/**
 * Abre um chamado (RF-01): tipo, assunto e descrição (a primeira mensagem), com vínculo
 * opcional a pedido próprio, curso, aula ou ebook. Avisa o responsável ou, sem ele, os
 * `manager` e `admin`. Suspensão `full`: `401`. Sexto chamado em 24 horas: `429`.
 */
export async function openTicket(
  db: Database,
  userId: string,
  input: OpenTicketInput,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<MyTicketDetail> {
  const fields = {
    kind: ticketKind(input.kind),
    subject: ticketSubject(input.subject),
    ...ticketMarkdown(input.bodyMd),
  };
  const id = await db.transaction().execute(async (trx) => {
    const user = await getTicketUser(trx, userId, true);
    const links = await resolveLinks(trx, user, input);
    await assertDailyLimit(trx, user.id);
    return insertTicket(trx, user, { ...fields, ...links }, context);
  });
  return readMyTicket(db, userId, id);
}

export type BrokenLinkTarget = { lessonId: unknown } | { ebookId: unknown };

export interface BrokenLinkReport {
  ticket: MyTicket;
  /** `true` quando o relato foi somado a um chamado que já existia. */
  merged: boolean;
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * "Reportar problema" do player e da página do ebook (RF-04): abre um `broken_link` já
 * preenchido com o produto, a aula e o link, lidos do catálogo (o cliente só manda o alvo e uma
 * observação opcional). Exige o mesmo acesso da aula ou do download. Se já há chamado `open`
 * ou `pending` desse tipo para o alvo, o relato é somado: contador +1 e o usuário passa a
 * acompanhar, sem ver as mensagens dos outros. Repetir o próprio relato não conta de novo.
 */
export async function reportBrokenLink(
  db: Database,
  userId: string,
  target: BrokenLinkTarget,
  input: { note?: unknown } = {},
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<BrokenLinkReport> {
  const viewer = await getTicketUser(db, userId);
  const note =
    typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim() : null;
  let links: TicketLinks;
  let subject: string;
  let description: string;
  if ('lessonId' in target) {
    const lesson = await getLessonContent(db, viewer, target.lessonId);
    links = { orderId: null, courseId: lesson.course.id, lessonId: lesson.id, ebookId: null };
    subject = `Link quebrado: ${lesson.title}`;
    description = `Problema relatado na aula **${lesson.title}** do curso **${lesson.course.title}**.`;
    if (lesson.videoUrl) description += `\n\nLink: ${lesson.videoUrl}`;
  } else {
    const { url } = await getEbookDownload(db, viewer, target.ebookId);
    const id = (target.ebookId as string).toLowerCase();
    const ebook = await db
      .selectFrom('ebooks')
      .select('title')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    links = { orderId: null, courseId: null, lessonId: null, ebookId: id };
    subject = `Link quebrado: ${ebook.title}`;
    description = `Problema relatado no ebook **${ebook.title}**.\n\nLink: ${url}`;
  }
  const noteBody = note === null ? null : ticketMarkdown(note);
  const body = ticketMarkdown(note === null ? description : `${description}\n\n${note}`);
  const targetKey = links.lessonId ?? links.ebookId;

  const result = await db.transaction().execute(async (trx) => {
    const user = await getTicketUser(trx, userId, true);
    // Serializa a deduplicação por alvo: dois relatos simultâneos não abrem dois chamados.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ticket.broken_link:${targetKey}`}, 0))`.execute(
      trx,
    );
    let existing = trx
      .selectFrom('tickets')
      .select(['id', 'userId'])
      .where('kind', '=', 'broken_link')
      .where('status', 'in', ['open', 'pending'])
      .orderBy('createdAt')
      .limit(1)
      .forUpdate();
    existing =
      links.lessonId !== null
        ? existing.where('lessonId', '=', links.lessonId)
        : existing.where('ebookId', '=', links.ebookId);
    const open = await existing.executeTakeFirst();
    if (!open) {
      await assertDailyLimit(trx, user.id);
      const id = await insertTicket(
        trx,
        user,
        {
          kind: 'broken_link',
          subject: clip(subject, TICKET_SUBJECT_MAX_LENGTH),
          ...body,
          ...links,
        },
        context,
      );
      return { id, merged: false };
    }
    if (open.userId === user.id) return { id: open.id, merged: true };
    const follower = await trx
      .selectFrom('ticketFollowers')
      .select('userId')
      .where('ticketId', '=', open.id)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    if (follower) return { id: open.id, merged: true };
    await assertDailyLimit(trx, user.id);
    await trx
      .insertInto('ticketFollowers')
      .values({ ticketId: open.id, userId: user.id })
      .execute();
    await trx
      .updateTable('tickets')
      .set({ reportsCount: sql<number>`reports_count + 1` })
      .where('id', '=', open.id)
      .execute();
    if (noteBody !== null) {
      await trx
        .insertInto('ticketMessages')
        .values({ ticketId: open.id, authorId: user.id, ...noteBody })
        .execute();
    }
    return { id: open.id, merged: true };
  });
  const { messages: _messages, ...ticket } = await readMyTicket(db, userId, result.id);
  return { ticket, merged: result.merged };
}

interface MyTicketRow extends TicketRow {
  relation: TicketRelation;
}

function myTickets(db: Database, userId: string) {
  return db
    .selectFrom('tickets as t')
    .selectAll('t')
    .select(
      sql<TicketRelation>`CASE WHEN t.user_id = ${userId} THEN 'owner' ELSE 'follower' END`.as(
        'relation',
      ),
    )
    .where(
      sql<boolean>`(t.user_id = ${userId} OR EXISTS (
        SELECT 1 FROM ticket_followers f WHERE f.ticket_id = t.id AND f.user_id = ${userId}
      ))`,
    );
}

function shapeMine(row: MyTicketRow): MyTicket {
  return { ...shapeTicket(row), relation: row.relation };
}

export interface MyTicketsQuery extends Pick<CatalogPageInput, 'limit' | 'cursor'> {
  status?: unknown;
}

/** `GET /tickets`: os chamados que o usuário abriu ou acompanha, mais recentes primeiro. */
export async function listMyTickets(
  db: Database,
  userId: string,
  query: MyTicketsQuery = {},
): Promise<CatalogPage<MyTicket>> {
  const user = await getTicketUser(db, userId);
  const errors: FieldError[] = [];
  if (query.status !== undefined && !isTicketStatus(query.status)) {
    errors.push({ path: 'query.status', message: 'Estado desconhecido.' });
  }
  const params = readCatalogPageParams(
    { limit: query.limit, cursor: query.cursor },
    LIST_SCOPE,
    ['recent'] as const,
    'recent',
    errors,
  );
  let select = myTickets(db, user.id)
    .orderBy('t.id', 'desc')
    .limit(params.limit + 1);
  if (query.status !== undefined) select = select.where('t.status', '=', query.status as string);
  if (params.afterId !== undefined) select = select.where('t.id', '<', params.afterId);
  const rows = (await select.execute()) as MyTicketRow[];
  return toCatalogPage(rows, params, LIST_SCOPE, shapeMine);
}

/**
 * Mensagens visíveis ao usuário no classroom: nunca as internas; quem abriu vê a conversa com
 * a equipe, sem os relatos de quem acompanha; quem acompanha vê só o que ele mesmo escreveu.
 */
async function visibleMessages(
  db: Database,
  ticket: { id: string; userId: string },
  userId: string,
): Promise<TicketMessage[]> {
  const result = await sql<TicketMessageRow>`
    SELECT m.id, m.author_id, u.name AS author_name, u.deleted_at AS author_deleted_at,
      (m.author_id <> ${ticket.userId}
        AND NOT EXISTS (SELECT 1 FROM ticket_followers f
          WHERE f.ticket_id = m.ticket_id AND f.user_id = m.author_id)) AS from_staff,
      m.body_md, m.body_html, m.internal, m.created_at
    FROM ticket_messages m JOIN users u ON u.id = m.author_id
    WHERE m.ticket_id = ${ticket.id} AND NOT m.internal AND (
      m.author_id = ${userId}
      OR (${ticket.userId === userId} AND NOT EXISTS (SELECT 1 FROM ticket_followers f
        WHERE f.ticket_id = m.ticket_id AND f.user_id = m.author_id))
    )
    ORDER BY m.created_at, m.id
  `.execute(db);
  return result.rows.map(shapeTicketMessage);
}

/** `GET /tickets/{id}`: o chamado e a conversa visível. De terceiros ou inexistente: `404`. */
export async function readMyTicket(
  db: Database,
  userId: string,
  id: unknown,
): Promise<MyTicketDetail> {
  const user = await getTicketUser(db, userId);
  const row = (await myTickets(db, user.id).where('t.id', '=', ticketId(id)).executeTakeFirst()) as
    | MyTicketRow
    | undefined;
  if (!row) throw notFound('Chamado não encontrado.');
  return { ...shapeMine(row), messages: await visibleMessages(db, row, user.id) };
}

/** Trava o chamado para a escrita do dono. Quem só acompanha: `403`; terceiros: `404`. */
async function lockOwnTicket(trx: Database, user: TicketUser, id: string): Promise<MyTicketRow> {
  const row = (await myTickets(trx, user.id)
    .where('t.id', '=', id)
    .forUpdate('t')
    .executeTakeFirst()) as MyTicketRow | undefined;
  if (!row) throw notFound('Chamado não encontrado.');
  if (row.relation !== 'owner') {
    throw permissionDenied('Só quem abriu o chamado pode respondê-lo ou resolvê-lo.');
  }
  return row;
}

/**
 * `POST /tickets/{id}/messages`: resposta do aluno. Reabre `pending` e `resolved` (este, só
 * dentro do prazo do fechamento automático), atualiza `last_user_message_at` e avisa o
 * responsável ou a equipe. `closed`: `409 ticket_closed`.
 */
export async function replyToMyTicket(
  db: Database,
  userId: string,
  id: unknown,
  input: { bodyMd: unknown },
): Promise<TicketMessage> {
  const key = ticketId(id);
  const body = ticketMarkdown(input.bodyMd);
  return db.transaction().execute(async (trx) => {
    const user = await getTicketUser(trx, userId);
    const ticket = await lockOwnTicket(trx, user, key);
    if (ticket.status === 'closed') throw ticketClosed();
    if (ticket.status === 'resolved' && ticket.resolvedAt !== null) {
      const days = await ticketAutocloseDays(trx);
      const expired = await sql<{ expired: boolean }>`
        SELECT ${ticket.resolvedAt}::timestamptz <= now() - make_interval(days => ${days}) AS expired
      `.execute(trx);
      if (expired.rows[0]?.expired) throw ticketClosed();
    }
    await assertTicketMessageRate(trx, key, user.id);
    const message = await trx
      .insertInto('ticketMessages')
      .values({ ticketId: key, authorId: user.id, ...body })
      .returning(['id', 'createdAt'])
      .executeTakeFirstOrThrow();
    await trx
      .updateTable('tickets')
      .set({ status: 'open', resolvedAt: null, lastUserMessageAt: sql<Date>`now()` })
      .where('id', '=', key)
      .execute();
    await notifyTicketStaff(trx, 'ticket.user_reply', ticket, user.id);
    const author = await trx
      .selectFrom('users')
      .select('name')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    return {
      id: message.id,
      author: { id: user.id, displayName: author.name },
      fromStaff: false,
      ...body,
      internal: false,
      createdAt: message.createdAt,
    };
  });
}

/**
 * `POST /tickets/{id}/resolve`: o aluno marca o próprio chamado como resolvido, de qualquer
 * tipo (a restrição de `refund` e `privacy` ao admin vale para a equipe). Já resolvido: nada
 * muda. `closed`: `409 ticket_closed`.
 */
export async function resolveMyTicket(
  db: Database,
  userId: string,
  id: unknown,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<MyTicketDetail> {
  const key = ticketId(id);
  await db.transaction().execute(async (trx) => {
    const user = await getTicketUser(trx, userId);
    const ticket = await lockOwnTicket(trx, user, key);
    if (ticket.status === 'closed') throw ticketClosed();
    if (ticket.status === 'resolved') return;
    await trx
      .updateTable('tickets')
      .set({ status: 'resolved', resolvedAt: sql<Date>`now()` })
      .where('id', '=', key)
      .execute();
    await recordAudit(trx, {
      context: audit(context, user),
      action: 'ticket.set_status',
      targetType: TICKET_TARGET_TYPE,
      targetId: key,
      details: { from: ticket.status, to: 'resolved' },
    });
  });
  return readMyTicket(db, userId, key);
}
