import { type RawBuilder, type SqlBool, sql } from 'kysely';
import type { Role } from './roles.ts';

// Escopo dos chamados por papel (specs 008 e 023). `manager` e `admin` atendem todos; o
// `instructor` só os de conteúdo ligados aos próprios cursos; resolver, fechar ou reclassificar
// `refund` e `privacy` é só do `admin`.

export const TICKET_KINDS = [
  'question',
  'access',
  'payment',
  'refund',
  'broken_link',
  'bug',
  'suggestion',
  'privacy',
] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

/**
 * Tipos de conteúdo, os únicos ao alcance do instrutor. `access`, `payment`, `refund` e
 * `privacy` tratam de conta, direito de acesso ou dinheiro e ficam com `manager` e `admin`.
 */
export const TICKET_CONTENT_KINDS = [
  'question',
  'broken_link',
  'bug',
  'suggestion',
] as const satisfies readonly TicketKind[];

/** Tipos que só o `admin` resolve, fecha ou reclassifica (spec 023, "Estados"). */
export const TICKET_ADMIN_ONLY_KINDS = [
  'refund',
  'privacy',
] as const satisfies readonly TicketKind[];

export interface TicketStaff {
  id: string;
  role: Role;
}

export function isTicketKind(value: unknown): value is TicketKind {
  return typeof value === 'string' && (TICKET_KINDS as readonly string[]).includes(value);
}

export function isTicketContentKind(kind: string): boolean {
  return (TICKET_CONTENT_KINDS as readonly string[]).includes(kind);
}

export function isTicketAdminOnlyKind(kind: string): boolean {
  return (TICKET_ADMIN_ONLY_KINDS as readonly string[]).includes(kind);
}

/** `manager` e `admin`: veem e atendem todos os chamados. */
export function isTicketManager(role: Role): boolean {
  return role === 'manager' || role === 'admin';
}

/** Quem pode atender algum chamado (`ticket.handle`): instrutor (com escopo), gerente e admin. */
export function mayHandleTickets(role: Role): boolean {
  return role === 'instructor' || isTicketManager(role);
}

/**
 * Resolver, fechar ou reclassificar chamado deste tipo: `refund` e `privacy` só o `admin`; o
 * instrutor, só os tipos de conteúdo (o alcance por curso é conferido por `ticketScope`).
 */
export function maySettleTicketKind(role: Role, kind: string): boolean {
  if (role === 'admin') return true;
  if (isTicketAdminOnlyKind(kind)) return false;
  if (role === 'manager') return true;
  return role === 'instructor' && isTicketContentKind(kind);
}

/**
 * Condição SQL de alcance sobre a tabela `tickets` (apelido `t`). O instrutor alcança o chamado
 * de conteúdo cujo curso é dele: pelo `course_id` (preenchido também a partir da aula) ou por
 * um ebook vinculado a um curso ou a uma aula dos próprios cursos.
 */
export function ticketScope(staff: TicketStaff): RawBuilder<SqlBool> {
  if (isTicketManager(staff.role)) return sql<SqlBool>`TRUE`;
  if (staff.role !== 'instructor') return sql<SqlBool>`FALSE`;
  return sql<SqlBool>`(t.kind IN (${sql.join(TICKET_CONTENT_KINDS)}) AND (
    EXISTS (SELECT 1 FROM courses c WHERE c.id = t.course_id AND c.owner_id = ${staff.id})
    OR EXISTS (
      SELECT 1 FROM product_ebooks pe
        LEFT JOIN lessons l ON pe.target_type = 'lesson' AND l.id = pe.target_id
        LEFT JOIN modules m ON m.id = l.module_id
        JOIN courses c ON c.id = CASE pe.target_type WHEN 'course' THEN pe.target_id ELSE m.course_id END
      WHERE pe.ebook_id = t.ebook_id AND c.owner_id = ${staff.id}
    )
  ))`;
}
