import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  type FieldError,
  isDomainError,
  notFound,
  permissionDenied,
  unauthenticated,
} from '../../errors/domain-error.ts';
import { type AuditContext, recordAudit, recordDenied } from '../audit/record.ts';
import {
  type CatalogPage,
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import { notify } from '../notifications/central/notify.ts';
import { isRole } from '../permissions/roles.ts';
import {
  isTicketContentKind,
  isTicketKind,
  isTicketManager,
  mayHandleTickets,
  maySettleTicketKind,
  type TicketStaff,
  ticketScope,
} from '../permissions/tickets.ts';
import {
  assertTicketMessageRate,
  isTicketStatus,
  notifyTicketStatus,
  shapeTicket,
  shapeTicketMessage,
  TICKET_TARGET_TYPE,
  TICKET_TRANSITIONS,
  type Ticket,
  type TicketMessage,
  type TicketMessageRow,
  type TicketRow,
  type TicketStatus,
  ticketClosed,
  ticketId,
  ticketKind,
  ticketMarkdown,
} from './rules.ts';

// Atendimento pela equipe (spec 023; dono das escritas: admin-api). `manager` e `admin` veem
// tudo; o instrutor, só os chamados de conteúdo dos próprios cursos (fora disso, `404`). Toda
// mudança de estado, atribuição e tipo vai para a auditoria.

const DEFAULT_CONTEXT: AuditContext = { origin: 'admin_panel' };
const LIST_SCOPE = 'tickets.admin';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem atende, com o papel lido agora. Sem `ticket.handle` ou suspenso: `403`. */
async function getTicketStaff(db: Database, actorId: string): Promise<TicketStaff> {
  if (!UUID_PATTERN.test(actorId)) throw unauthenticated();
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'suspendedKind'])
    .where('id', '=', actorId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!user || user.suspendedKind === 'full') throw unauthenticated();
  if (!isRole(user.role) || !mayHandleTickets(user.role) || user.suspendedKind !== null) {
    throw permissionDenied();
  }
  return { id: user.id, role: user.role };
}

function audit(context: AuditContext, staff: TicketStaff): AuditContext {
  return { ...context, actorUserId: staff.id, actorRole: staff.role };
}

export interface AdminTicket extends Ticket {
  user: { id: string | null; displayName: string };
  assignee: { id: string; displayName: string } | null;
  course: { id: string; title: string } | null;
}

interface AdminTicketRow extends TicketRow {
  userName: string;
  userDeletedAt: Date | null;
  assigneeName: string | null;
  courseTitle: string | null;
}

function adminTickets(db: Database, staff: TicketStaff) {
  return db
    .selectFrom('tickets as t')
    .innerJoin('users as u', 'u.id', 't.userId')
    .leftJoin('users as a', 'a.id', 't.assigneeId')
    .leftJoin('courses as c', 'c.id', 't.courseId')
    .selectAll('t')
    .select([
      'u.name as userName',
      'u.deletedAt as userDeletedAt',
      'a.name as assigneeName',
      'c.title as courseTitle',
    ])
    .where(ticketScope(staff));
}

function shapeAdmin(row: AdminTicketRow): AdminTicket {
  return {
    ...shapeTicket(row),
    user:
      row.userDeletedAt === null
        ? { id: row.userId, displayName: row.userName }
        : { id: null, displayName: 'Usuário removido' },
    assignee:
      row.assigneeId !== null && row.assigneeName !== null
        ? { id: row.assigneeId, displayName: row.assigneeName }
        : null,
    course:
      row.courseId !== null && row.courseTitle !== null
        ? { id: row.courseId, title: row.courseTitle }
        : null,
  };
}

export interface TicketsQuery extends Pick<CatalogPageInput, 'limit' | 'cursor'> {
  status?: unknown;
  kind?: unknown;
  /** Id do responsável, ou `none` para os sem responsável. */
  assigneeId?: unknown;
  courseId?: unknown;
}

/**
 * `GET /tickets` do admin (RF-07): filtros por estado, tipo, responsável e curso, ordenados
 * pela resposta mais antiga do aluno (`lastUserMessageAt`, de onde a tela tira o tempo de
 * espera). O instrutor recebe só o que está no próprio escopo.
 */
export async function listTickets(
  db: Database,
  actorId: string,
  query: TicketsQuery = {},
): Promise<CatalogPage<AdminTicket>> {
  const staff = await getTicketStaff(db, actorId);
  const errors: FieldError[] = [];
  if (query.status !== undefined && !isTicketStatus(query.status)) {
    errors.push({ path: 'query.status', message: 'Estado desconhecido.' });
  }
  if (query.kind !== undefined && !isTicketKind(query.kind)) {
    errors.push({ path: 'query.kind', message: 'Tipo desconhecido.' });
  }
  const isUuid = (value: unknown): value is string =>
    typeof value === 'string' && UUID_PATTERN.test(value);
  if (query.assigneeId !== undefined && query.assigneeId !== 'none' && !isUuid(query.assigneeId)) {
    errors.push({ path: 'query.assigneeId', message: 'Responsável inválido.' });
  }
  if (query.courseId !== undefined && !isUuid(query.courseId)) {
    errors.push({ path: 'query.courseId', message: 'Curso inválido.' });
  }
  const params = readCatalogPageParams(
    { limit: query.limit, cursor: query.cursor },
    LIST_SCOPE,
    ['waiting'] as const,
    'waiting',
    errors,
  );
  let select = adminTickets(db, staff)
    .orderBy('t.lastUserMessageAt')
    .orderBy('t.id')
    .limit(params.limit + 1);
  if (query.status !== undefined) select = select.where('t.status', '=', query.status as string);
  if (query.kind !== undefined) select = select.where('t.kind', '=', query.kind as string);
  if (query.assigneeId === 'none') select = select.where('t.assigneeId', 'is', null);
  else if (query.assigneeId !== undefined) {
    select = select.where('t.assigneeId', '=', query.assigneeId as string);
  }
  if (query.courseId !== undefined) {
    select = select.where('t.courseId', '=', query.courseId as string);
  }
  if (params.afterId !== undefined) {
    select = select.where(
      sql<boolean>`(t.last_user_message_at, t.id) > (
        SELECT p.last_user_message_at, p.id FROM tickets p WHERE p.id = ${params.afterId}
      )`,
    );
  }
  const rows = (await select.execute()) as AdminTicketRow[];
  return toCatalogPage(rows, params, LIST_SCOPE, shapeAdmin);
}

/** Contexto do aluno para quem atende (spec 023, "Regras"); nunca leva a senha. */
export interface TicketUserContext {
  /** Dados privados da conta: só para `manager` e `admin`. */
  account: {
    email: string;
    role: string;
    emailVerified: boolean;
    suspendedKind: string | null;
    createdAt: Date;
    lastLoginAt: Date | null;
  } | null;
  /** Produtos com direito ativo. */
  products: { productType: string; productId: string; title: string; expiresAt: Date | null }[];
  /** Pedidos recentes: só para `manager` e `admin`. */
  recentOrders: {
    id: string;
    number: number;
    status: string;
    totalCents: number;
    createdAt: Date;
  }[];
}

export interface AdminTicketDetail extends AdminTicket {
  messages: TicketMessage[];
  /** Quem somou relato de `broken_link`. */
  followers: { id: string; displayName: string }[];
  userContext: TicketUserContext;
}

async function userContext(
  db: Database,
  staff: TicketStaff,
  userId: string,
): Promise<TicketUserContext> {
  const full = isTicketManager(staff.role);
  const products = await sql<TicketUserContext['products'][number]>`
    SELECT e.product_type, e.product_id, coalesce(c.title, k.title, b.title, '') AS title,
      max(e.expires_at) AS expires_at
    FROM entitlements e
      LEFT JOIN courses c ON e.product_type = 'course' AND c.id = e.product_id
      LEFT JOIN ebooks k ON e.product_type = 'ebook' AND k.id = e.product_id
      LEFT JOIN bundles b ON e.product_type = 'bundle' AND b.id = e.product_id
    WHERE e.user_id = ${userId} AND e.revoked_at IS NULL AND e.starts_at <= now()
      AND (e.expires_at IS NULL OR e.expires_at > now())
    GROUP BY e.product_type, e.product_id, c.title, k.title, b.title
    ORDER BY title
    LIMIT 100
  `.execute(db);
  if (!full) return { account: null, products: products.rows, recentOrders: [] };
  const account = await db
    .selectFrom('users')
    .select(['email', 'role', 'emailVerifiedAt', 'suspendedKind', 'createdAt', 'lastLoginAt'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const orders = await db
    .selectFrom('orders')
    .select(['id', 'number', 'status', 'totalCents', 'createdAt'])
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .limit(5)
    .execute();
  return {
    account: {
      email: account.email,
      role: account.role,
      emailVerified: account.emailVerifiedAt !== null,
      suspendedKind: account.suspendedKind,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
    },
    products: products.rows,
    recentOrders: orders.map((order) => ({
      id: order.id,
      number: Number(order.number),
      status: order.status,
      totalCents: Number(order.totalCents),
      createdAt: order.createdAt,
    })),
  };
}

async function requireTicket(
  db: Database,
  staff: TicketStaff,
  id: string,
  lock = false,
): Promise<AdminTicketRow> {
  let select = adminTickets(db, staff).where('t.id', '=', id);
  if (lock) select = select.forUpdate('t');
  const row = (await select.executeTakeFirst()) as AdminTicketRow | undefined;
  if (!row) throw notFound('Chamado não encontrado.');
  return row;
}

/**
 * `GET /tickets/{id}` do admin: a conversa inteira (com as notas internas e os relatos
 * somados), quem acompanha e o contexto do aluno. Fora do escopo do instrutor: `404`.
 */
export async function readTicket(
  db: Database,
  actorId: string,
  id: unknown,
): Promise<AdminTicketDetail> {
  const staff = await getTicketStaff(db, actorId);
  const row = await requireTicket(db, staff, ticketId(id));
  const messages = await sql<TicketMessageRow>`
    SELECT m.id, m.author_id, u.name AS author_name, u.deleted_at AS author_deleted_at,
      (m.author_id <> ${row.userId}
        AND NOT EXISTS (SELECT 1 FROM ticket_followers f
          WHERE f.ticket_id = m.ticket_id AND f.user_id = m.author_id)) AS from_staff,
      m.body_md, m.body_html, m.internal, m.created_at
    FROM ticket_messages m JOIN users u ON u.id = m.author_id
    WHERE m.ticket_id = ${row.id}
    ORDER BY m.created_at, m.id
  `.execute(db);
  const followers = await db
    .selectFrom('ticketFollowers as f')
    .innerJoin('users as u', 'u.id', 'f.userId')
    .select(['u.id', 'u.name as displayName'])
    .where('f.ticketId', '=', row.id)
    .where('u.deletedAt', 'is', null)
    .orderBy('f.createdAt')
    .execute();
  return {
    ...shapeAdmin(row),
    messages: messages.rows.map(shapeTicketMessage),
    followers,
    userContext: await userContext(db, staff, row.userId),
  };
}

/** Registra a recusa por permissão fora da transação desfeita e repassa o erro. */
async function auditingDenial<T>(
  db: Database,
  context: AuditContext,
  actorId: string,
  action: string,
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isDomainError(error) && error.code === 'permission_denied') {
      const actor = await db
        .selectFrom('users')
        .select('role')
        .where('id', '=', actorId)
        .executeTakeFirst();
      await recordDenied(db, {
        context: {
          ...context,
          actorUserId: actorId,
          actorRole: actor && isRole(actor.role) ? actor.role : null,
        },
        permission: 'ticket.handle',
        action,
        targetType: TICKET_TARGET_TYPE,
        targetId: id,
      });
    }
    throw error;
  }
}

/**
 * `POST /tickets/{id}/messages` do admin: resposta da equipe ou nota interna (`internal`). A
 * resposta muda `open` para `pending` e avisa o aluno na plataforma e por e-mail
 * (`ticket.reply`); a nota interna não muda o estado, não avisa ninguém e nunca sai pelo
 * classroom. Resposta em `closed`: `409 ticket_closed` (a nota interna ainda é aceita).
 */
export async function replyToTicket(
  db: Database,
  actorId: string,
  id: unknown,
  input: { bodyMd: unknown; internal?: boolean | undefined },
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<TicketMessage> {
  const key = ticketId(id);
  const body = ticketMarkdown(input.bodyMd);
  const internal = input.internal === true;
  return db.transaction().execute(async (trx) => {
    const staff = await getTicketStaff(trx, actorId);
    const ticket = await requireTicket(trx, staff, key, true);
    if (ticket.status === 'closed' && !internal) throw ticketClosed();
    await assertTicketMessageRate(trx, key, staff.id);
    const message = await trx
      .insertInto('ticketMessages')
      .values({ ticketId: key, authorId: staff.id, ...body, internal })
      .returning(['id', 'createdAt'])
      .executeTakeFirstOrThrow();
    if (!internal) {
      if (ticket.status === 'open') {
        await trx.updateTable('tickets').set({ status: 'pending' }).where('id', '=', key).execute();
      }
      await notify(trx, 'ticket.reply', ticket.userId, {
        actorId: staff.id,
        targetType: TICKET_TARGET_TYPE,
        targetId: key,
        data: { ticketId: key, number: Number(ticket.number), messageId: message.id },
      });
    }
    await recordAudit(trx, {
      context: audit(context, staff),
      action: 'ticket.reply',
      targetType: TICKET_TARGET_TYPE,
      targetId: key,
      details: { messageId: message.id, internal },
    });
    const author = await trx
      .selectFrom('users')
      .select('name')
      .where('id', '=', staff.id)
      .executeTakeFirstOrThrow();
    return {
      id: message.id,
      author: { id: staff.id, displayName: author.name },
      fromStaff: staff.id !== ticket.userId,
      ...body,
      internal,
      createdAt: message.createdAt,
    };
  });
}

export interface TicketPatch {
  status?: unknown;
  /** `null` retira o responsável. */
  assigneeId?: unknown;
  kind?: unknown;
}

async function assertAssignee(
  trx: Database,
  staff: TicketStaff,
  id: string,
  assigneeId: string,
): Promise<void> {
  const invalid = () =>
    businessRule(
      'ticket_assignee_invalid',
      'O responsável precisa ser da equipe que atende o chamado.',
    );
  if (!UUID_PATTERN.test(assigneeId)) throw invalid();
  if (staff.role === 'instructor' && assigneeId.toLowerCase() !== staff.id) {
    throw permissionDenied('O instrutor só atribui o chamado a si mesmo.');
  }
  const assignee = await trx
    .selectFrom('users')
    .select(['id', 'role', 'suspendedKind'])
    .where('id', '=', assigneeId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (
    !assignee ||
    !isRole(assignee.role) ||
    !mayHandleTickets(assignee.role) ||
    assignee.suspendedKind !== null
  ) {
    throw invalid();
  }
  if (assignee.role === 'instructor') {
    const reachable = await trx
      .selectFrom('tickets as t')
      .select('t.id')
      .where('t.id', '=', id)
      .where(ticketScope({ id: assignee.id, role: assignee.role }))
      .executeTakeFirst();
    if (!reachable) throw invalid();
  }
}

/**
 * `PATCH /tickets/{id}`: estado, responsável e tipo, cada mudança com o seu registro de
 * auditoria (`ticket.set_status`, `ticket.assign`, `ticket.set_kind`). Transições conforme a
 * tabela da spec; `closed` é final (`409 ticket_closed`). Resolver, fechar ou reclassificar
 * `refund` e `privacy` é só do `admin` (`403`, com a recusa auditada). A mudança de estado
 * avisa o aluno (`ticket.status_changed`); o novo responsável recebe `ticket.opened`.
 */
export async function updateTicket(
  db: Database,
  actorId: string,
  id: unknown,
  patch: TicketPatch,
  context: AuditContext = DEFAULT_CONTEXT,
): Promise<AdminTicketDetail> {
  const key = ticketId(id);
  if (patch.status === undefined && patch.assigneeId === undefined && patch.kind === undefined) {
    throw businessRule('ticket_patch_empty', 'Informe o que deseja alterar.');
  }
  if (patch.status !== undefined && !isTicketStatus(patch.status)) {
    throw businessRule('ticket_status_invalid', 'Estado de chamado inválido.');
  }
  const nextKind = patch.kind === undefined ? undefined : ticketKind(patch.kind);
  const nextStatus = patch.status as TicketStatus | undefined;
  if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
    if (typeof patch.assigneeId !== 'string') {
      throw businessRule('ticket_assignee_invalid', 'Responsável inválido.');
    }
  }
  const nextAssignee = patch.assigneeId as string | null | undefined;

  await auditingDenial(db, context, actorId, 'ticket.set_status', key, () =>
    db.transaction().execute(async (trx) => {
      const staff = await getTicketStaff(trx, actorId);
      const ticket = await requireTicket(trx, staff, key, true);
      if (ticket.status === 'closed') throw ticketClosed();
      const trail = audit(context, staff);
      const changes: { kind?: string; status?: TicketStatus; assigneeId?: string | null } = {};

      if (nextKind !== undefined && nextKind !== ticket.kind) {
        if (
          !maySettleTicketKind(staff.role, ticket.kind) ||
          !maySettleTicketKind(staff.role, nextKind) ||
          (staff.role === 'instructor' && !isTicketContentKind(nextKind))
        ) {
          throw permissionDenied('Você não pode reclassificar este chamado.');
        }
        changes.kind = nextKind;
      }
      const kind = changes.kind ?? ticket.kind;

      if (nextStatus !== undefined && nextStatus !== ticket.status) {
        if (!TICKET_TRANSITIONS[ticket.status as TicketStatus].includes(nextStatus)) {
          throw businessRule('ticket_transition_invalid', 'Mudança de estado não permitida.');
        }
        if (
          (nextStatus === 'resolved' || nextStatus === 'closed') &&
          !maySettleTicketKind(staff.role, kind)
        ) {
          throw permissionDenied(
            'Só o admin resolve ou fecha chamados de reembolso e privacidade.',
          );
        }
        changes.status = nextStatus;
      }

      if (nextAssignee !== undefined) {
        const normalized = nextAssignee === null ? null : nextAssignee.toLowerCase();
        if (normalized !== ticket.assigneeId) {
          if (normalized !== null) await assertAssignee(trx, staff, key, normalized);
          else if (staff.role === 'instructor' && ticket.assigneeId !== staff.id) {
            throw permissionDenied('O instrutor só retira a própria atribuição.');
          }
          changes.assigneeId = normalized;
        }
      }
      if (Object.keys(changes).length === 0) return;

      await trx
        .updateTable('tickets')
        .set({
          ...changes,
          ...(changes.status === undefined
            ? {}
            : changes.status === 'resolved'
              ? { resolvedAt: sql<Date>`now()` }
              : changes.status === 'closed'
                ? { closedAt: sql<Date>`now()` }
                : { resolvedAt: null }),
        })
        .where('id', '=', key)
        .execute();

      const record = (action: string, details: Record<string, unknown>) =>
        recordAudit(trx, {
          context: trail,
          action,
          targetType: TICKET_TARGET_TYPE,
          targetId: key,
          details,
        });
      if (changes.kind !== undefined) {
        await record('ticket.set_kind', { from: ticket.kind, to: changes.kind });
      }
      if (changes.status !== undefined) {
        await record('ticket.set_status', { from: ticket.status, to: changes.status });
        await notifyTicketStatus(trx, ticket, changes.status, staff.id);
      }
      if (changes.assigneeId !== undefined) {
        await record('ticket.assign', { from: ticket.assigneeId, to: changes.assigneeId });
        if (changes.assigneeId !== null) {
          await notify(trx, 'ticket.opened', changes.assigneeId, {
            actorId: staff.id,
            targetType: TICKET_TARGET_TYPE,
            targetId: key,
            data: { ticketId: key, number: Number(ticket.number), kind, assigned: true },
          });
        }
      }
    }),
  );
  return readTicket(db, actorId, key);
}
