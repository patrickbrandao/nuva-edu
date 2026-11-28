import { type RawBuilder, type SqlBool, sql } from 'kysely';
import type { Role } from './roles.ts';

// Gestão de eventos por papel (`event.manage`; specs 008 e 018, RF-01): `manager` e `admin`
// gerem todos; o `instructor`, só os eventos ligados aos próprios cursos.

export interface EventStaff {
  id: string;
  role: Role;
}

export function mayManageEvents(role: Role): boolean {
  return role === 'instructor' || role === 'manager' || role === 'admin';
}

/** `manager` e `admin`: sem restrição de curso. */
export function managesAllEvents(role: Role): boolean {
  return role === 'manager' || role === 'admin';
}

/**
 * Condição SQL de alcance sobre a tabela `events` (apelido `ev`): o instrutor alcança o evento
 * cujo curso relacionado é dele.
 */
export function eventManageScope(staff: EventStaff): RawBuilder<SqlBool> {
  if (managesAllEvents(staff.role)) return sql<SqlBool>`TRUE`;
  if (staff.role !== 'instructor') return sql<SqlBool>`FALSE`;
  return sql<SqlBool>`EXISTS (
    SELECT 1 FROM courses c WHERE c.id = ev.course_id AND c.owner_id = ${staff.id}
  )`;
}
