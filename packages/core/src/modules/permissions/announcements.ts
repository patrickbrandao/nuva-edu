import { type RawBuilder, type SqlBool, sql } from 'kysely';
import type { Role } from './roles.ts';

// Novidades por papel (`announcement.publish`; specs 008 e 025, RF-01): `manager` e `admin`
// criam, agendam, publicam, fixam e arquivam qualquer novidade; o `instructor`, só as
// restritas aos próprios cursos (público `product` com cursos dele), sem fixar.

export interface AnnouncementStaff {
  id: string;
  role: Role;
}

export function mayPublishAnnouncements(role: Role): boolean {
  return role === 'instructor' || role === 'manager' || role === 'admin';
}

/** `manager` e `admin`: qualquer público, e os únicos que fixam. */
export function managesAllAnnouncements(role: Role): boolean {
  return role === 'manager' || role === 'admin';
}

/**
 * Condição SQL de alcance sobre a tabela `announcements` (apelido `an`): o instrutor alcança a
 * novidade de público `product` cujos produtos são todos cursos dele.
 */
export function announcementManageScope(staff: AnnouncementStaff): RawBuilder<SqlBool> {
  if (managesAllAnnouncements(staff.role)) return sql<SqlBool>`TRUE`;
  if (staff.role !== 'instructor') return sql<SqlBool>`FALSE`;
  return sql<SqlBool>`(an.audience = 'product'
    AND EXISTS (SELECT 1 FROM announcement_products ap WHERE ap.announcement_id = an.id)
    AND NOT EXISTS (
      SELECT 1 FROM announcement_products ap
        LEFT JOIN courses c ON ap.product_type = 'course' AND c.id = ap.product_id
      WHERE ap.announcement_id = an.id AND c.owner_id IS DISTINCT FROM ${staff.id}
    ))`;
}
