import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  conflict,
  type DomainError,
  notFound,
  rateLimited,
  unauthenticated,
} from '../../errors/domain-error.ts';
import { assertMarkdownWithinLimit, renderMarkdownToHtml } from '../markdown/render.ts';
import { notify } from '../notifications/central/notify.ts';
import { isRole, type Role } from '../permissions/roles.ts';
import { isTicketKind, type TicketKind } from '../permissions/tickets.ts';

// Regras comuns dos chamados (spec 023): estados, limites, texto e leitura das linhas. As
// escritas do aluno ficam em `classroom.ts`, as da equipe em `admin.ts` e a do worker em
// `autoclose.ts`, conforme o dono de cada escrita.

export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SUBJECT_MIN_LENGTH = 5;
export const TICKET_SUBJECT_MAX_LENGTH = 150;
export const TICKET_MESSAGE_MAX_LENGTH = 10_000;
/** RNF-01: chamados abertos (ou relatos somados) por usuário em 24 horas. */
export const TICKETS_PER_DAY = 5;
/** RNF-01: mensagens por autor, por chamado, em uma hora. */
export const TICKET_MESSAGES_PER_HOUR = 30;
/** RNF-03: dias até o `resolved` sem resposta ser fechado; ajustável em `settings`. */
export const TICKET_AUTOCLOSE_DEFAULT_DAYS = 7;
export const TICKET_AUTOCLOSE_SETTING_KEY = 'tickets.autoclose_days';
export const TICKET_TARGET_TYPE = 'ticket';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Transições manuais da equipe (spec 023, "Estados"). `closed` não sai do lugar. */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ['pending', 'resolved', 'closed'],
  pending: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: [],
};

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value);
}

/** `409 ticket_closed`: chamado encerrado não aceita resposta nem mudança. */
export function ticketClosed(): DomainError {
  return conflict('ticket_closed', 'Este chamado foi encerrado. Abra um novo citando o anterior.');
}

export function ticketId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw notFound('Chamado não encontrado.');
  }
  return value.toLowerCase();
}

export function optionalUuid(value: unknown, code: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw businessRule(code, 'O vínculo informado não existe.');
  }
  return value.toLowerCase();
}

export function ticketKind(value: unknown): TicketKind {
  if (!isTicketKind(value)) throw businessRule('ticket_kind_invalid', 'Tipo de chamado inválido.');
  return value;
}

export function ticketSubject(value: unknown): string {
  const subject = typeof value === 'string' ? value.trim() : '';
  const length = [...subject].length;
  if (length < TICKET_SUBJECT_MIN_LENGTH || length > TICKET_SUBJECT_MAX_LENGTH) {
    throw businessRule(
      'ticket_subject_invalid',
      `O assunto deve ter de ${TICKET_SUBJECT_MIN_LENGTH} a ${TICKET_SUBJECT_MAX_LENGTH} caracteres.`,
    );
  }
  return subject;
}

/** Markdown saneado da mensagem (ADR 0027), com o HTML gravado junto. */
export function ticketMarkdown(value: unknown): { bodyMd: string; bodyHtml: string } {
  const bodyMd = assertMarkdownWithinLimit(value, TICKET_MESSAGE_MAX_LENGTH).trim();
  const bodyHtml = renderMarkdownToHtml(bodyMd);
  if (!bodyMd || !bodyHtml.trim()) {
    throw businessRule('markdown_invalid', 'Escreva a mensagem do chamado.');
  }
  return { bodyMd, bodyHtml };
}

export interface TicketUser {
  id: string;
  role: Role;
}

/**
 * O usuário da sessão para o suporte. Conta inexistente, removida ou com suspensão `full`:
 * `401`, como toda rota privada (specs 007 e 023); não há exceção, link nem sessão de suporte.
 * Suspensão `posting` não impede chamados.
 */
export async function getTicketUser(
  db: Database,
  userId: string,
  lock = false,
): Promise<TicketUser> {
  if (!UUID_PATTERN.test(userId)) throw unauthenticated();
  let query = db
    .selectFrom('users')
    .select(['id', 'role', 'suspendedKind'])
    .where('id', '=', userId)
    .where('deletedAt', 'is', null);
  if (lock) query = query.forUpdate();
  const user = await query.executeTakeFirst();
  if (!user || user.suspendedKind === 'full' || !isRole(user.role)) throw unauthenticated();
  return { id: user.id, role: user.role };
}

/** Dias do fechamento automático: `settings` (`tickets.autoclose_days`) ou 7. */
export async function ticketAutocloseDays(db: Database): Promise<number> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', TICKET_AUTOCLOSE_SETTING_KEY)
    .executeTakeFirst();
  const value = row?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 365
    ? value
    : TICKET_AUTOCLOSE_DEFAULT_DAYS;
}

/** RNF-01: 30 mensagens por hora por autor no chamado; acima disso, `429` com `Retry-After`. */
export async function assertTicketMessageRate(
  trx: Database,
  id: string,
  authorId: string,
): Promise<void> {
  const rate = await trx
    .selectFrom('ticketMessages')
    .select([
      sql<number>`count(*)::int`.as('count'),
      sql<number>`coalesce(ceil(extract(epoch from min(created_at) + interval '1 hour' - now())), 1)::int`.as(
        'retryAfter',
      ),
    ])
    .where('ticketId', '=', id)
    .where('authorId', '=', authorId)
    .where('createdAt', '>', sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirstOrThrow();
  if (rate.count >= TICKET_MESSAGES_PER_HOUR) {
    throw rateLimited(Math.max(rate.retryAfter, 1), 'Limite de mensagens por hora neste chamado.');
  }
}

export interface TicketRow {
  id: string;
  number: string | number | bigint;
  userId: string;
  kind: string;
  subject: string;
  status: string;
  assigneeId: string | null;
  orderId: string | null;
  courseId: string | null;
  lessonId: string | null;
  ebookId: string | null;
  reportsCount: number;
  lastUserMessageAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Ticket {
  id: string;
  number: number;
  kind: TicketKind;
  subject: string;
  status: TicketStatus;
  orderId: string | null;
  courseId: string | null;
  lessonId: string | null;
  ebookId: string | null;
  /** Quantos alunos relataram o mesmo `broken_link`. */
  reportsCount: number;
  lastUserMessageAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function shapeTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    number: Number(row.number),
    kind: row.kind as TicketKind,
    subject: row.subject,
    status: row.status as TicketStatus,
    orderId: row.orderId,
    courseId: row.courseId,
    lessonId: row.lessonId,
    ebookId: row.ebookId,
    reportsCount: row.reportsCount,
    lastUserMessageAt: row.lastUserMessageAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface TicketMessage {
  id: string;
  author: { id: string | null; displayName: string };
  /** Escrita por quem atende (não pelo aluno que abriu nem por quem somou relato). */
  fromStaff: boolean;
  bodyMd: string;
  bodyHtml: string;
  /** Nota interna da equipe; sempre `false` nas leituras do classroom. */
  internal: boolean;
  createdAt: Date;
}

export interface TicketMessageRow {
  id: string;
  authorId: string;
  authorName: string | null;
  authorDeletedAt: Date | null;
  fromStaff: boolean;
  bodyMd: string;
  bodyHtml: string;
  internal: boolean;
  createdAt: Date;
}

export function shapeTicketMessage(row: TicketMessageRow): TicketMessage {
  return {
    id: row.id,
    author:
      row.authorName !== null && row.authorDeletedAt === null
        ? { id: row.authorId, displayName: row.authorName }
        : { id: null, displayName: 'Usuário removido' },
    fromStaff: row.fromStaff,
    bodyMd: row.bodyMd,
    bodyHtml: row.bodyHtml,
    internal: row.internal,
    createdAt: row.createdAt,
  };
}

/** `manager` e `admin` ativos: quem recebe o aviso quando o chamado não tem responsável. */
export async function ticketManagers(db: Database): Promise<string[]> {
  const rows = await db
    .selectFrom('users')
    .select('id')
    .where('role', 'in', ['manager', 'admin'])
    .where('deletedAt', 'is', null)
    .execute();
  return rows.map(({ id }) => id);
}

/** Aviso à equipe: ao responsável, ou a todos os `manager` e `admin` se não houver (RF-06). */
export async function notifyTicketStaff(
  trx: Database,
  type: 'ticket.opened' | 'ticket.user_reply',
  ticket: { id: string; number: string | number | bigint; kind: string; assigneeId: string | null },
  actorId: string,
): Promise<void> {
  const recipients = ticket.assigneeId === null ? await ticketManagers(trx) : [ticket.assigneeId];
  await notify(trx, type, recipients, {
    actorId,
    targetType: TICKET_TARGET_TYPE,
    targetId: ticket.id,
    data: { ticketId: ticket.id, number: Number(ticket.number), kind: ticket.kind },
  });
}

/**
 * Aviso de mudança de estado ao aluno que abriu; quem somou relato de `broken_link` é avisado
 * quando o chamado é resolvido ou fechado (não vê as mensagens, só o desfecho).
 */
export async function notifyTicketStatus(
  trx: Database,
  ticket: { id: string; number: string | number | bigint; userId: string },
  status: TicketStatus,
  actorId: string | null,
): Promise<void> {
  const recipients = [ticket.userId];
  if (status === 'resolved' || status === 'closed') {
    const followers = await trx
      .selectFrom('ticketFollowers')
      .select('userId')
      .where('ticketId', '=', ticket.id)
      .execute();
    recipients.push(...followers.map(({ userId }) => userId));
  }
  await notify(trx, 'ticket.status_changed', recipients, {
    actorId,
    targetType: TICKET_TARGET_TYPE,
    targetId: ticket.id,
    data: { ticketId: ticket.id, number: Number(ticket.number), status },
  });
}
