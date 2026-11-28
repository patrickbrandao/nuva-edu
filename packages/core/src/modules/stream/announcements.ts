import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { ANNOUNCEMENT_AUDIENCE_TABLE, unreadAnnouncementsCount } from '../announcements/rules.ts';
import { audienceAccess } from '../entitlements/audience.ts';
import { USER_EVENTS_CHANNEL, USER_EVENTS_SEQUENCE } from './user-events.ts';

// Evento `announcement.published` (specs 004 e 025): atualiza o contador do menu de quem está
// com o classroom aberto. Reaproveita o canal e a sequência dos eventos de usuário.

/**
 * Publica `announcement.published` para cada usuário com sessão válida no classroom que vê a
 * novidade (o público, ou a equipe), com o contador de não lidas de cada um. A carga leva só
 * o id e o número; a lista é lida pela rota normal. Chame na transação que publica: o `NOTIFY`
 * só sai no COMMIT. Devolve quantos usuários foram avisados.
 */
export async function publishAnnouncementPublished(
  trx: Database,
  announcementId: string,
): Promise<number> {
  const user = {
    id: sql.ref<string>('u.id'),
    role: sql.ref<string>('u.role'),
    createdAt: sql.ref<Date>('u.created_at'),
    seenAt: sql.ref<Date | null>('pr.announcements_seen_at'),
  };
  const current = {
    ...ANNOUNCEMENT_AUDIENCE_TABLE,
    audience: sql.ref<string>('cur.audience'),
    ownerId: sql.ref<string>('cur.id'),
  };
  const result = await sql<{ id: string }>`
    SELECT r.id, pg_notify(${USER_EVENTS_CHANNEL}, json_build_object(
      'userId', r.id,
      'kind', 'announcement.published',
      'id', nextval(${USER_EVENTS_SEQUENCE}::regclass),
      'data', json_build_object('announcementId', ${announcementId}::text, 'unreadCount', r.unread)
    )::text)
    FROM (
      SELECT u.id, ${unreadAnnouncementsCount(user)} AS unread
      FROM users u
        LEFT JOIN profiles pr ON pr.user_id = u.id
        CROSS JOIN announcements cur
      WHERE cur.id = ${announcementId} AND cur.status = 'published'
        AND u.deleted_at IS NULL
        AND (u.suspended_kind IS NULL OR u.suspended_kind = 'posting')
        AND ${audienceAccess(current, user)}
        AND EXISTS (
          SELECT 1 FROM sessions s
          WHERE s.user_id = u.id AND s.site = 'classroom' AND s.expires_at > now()
        )
    ) r
  `.execute(trx);
  return result.rows.length;
}
