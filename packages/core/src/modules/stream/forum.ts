import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { forumRecipientCategoryAccess } from '../entitlements/forum-access.ts';
import { USER_EVENTS_CHANNEL, USER_EVENTS_SEQUENCE } from './user-events.ts';

/** Sessões válidas recebem só os IDs. A tela aberta relê o tópico pela API autorizada. */
export async function publishForumReply(
  trx: Database,
  authorId: string,
  categoryId: string,
  topicId: string,
  postId: string,
): Promise<void> {
  const recipients = trx
    .selectFrom('users')
    .crossJoin('forumCategories')
    .select('users.id')
    .where('forumCategories.id', '=', categoryId)
    .where('users.id', '!=', authorId)
    .where('users.deletedAt', 'is', null)
    .where((eb) =>
      eb.or([eb('users.suspendedKind', 'is', null), eb('users.suspendedKind', '=', 'posting')]),
    )
    .where(forumRecipientCategoryAccess())
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('sessions')
          .select('sessions.id')
          .whereRef('sessions.userId', '=', 'users.id')
          .where('sessions.site', '=', 'classroom')
          .where('sessions.expiresAt', '>', sql<Date>`now()`),
      ),
    );
  await sql`
    SELECT pg_notify(${USER_EVENTS_CHANNEL}, json_build_object(
      'userId', recipients.id,
      'kind', 'forum.post.created',
      'id', nextval(${USER_EVENTS_SEQUENCE}::regclass),
      'data', ${JSON.stringify({ topicId, postId })}::json
    )::text) FROM ${recipients.as('recipients')}
  `.execute(trx);
}
