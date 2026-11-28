import { type RawBuilder, type SqlBool, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import type { Role } from '../permissions/roles.ts';

export interface ForumUser {
  id: string;
  role: Role;
  verified: boolean;
  suspended: boolean;
}

export async function getForumUser(db: Database, userId: string): Promise<ForumUser> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'emailVerifiedAt', 'suspendedKind'])
    .where('id', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!user || user.suspendedKind === 'full') throw notFound();
  return {
    id: user.id,
    role: user.role as Role,
    verified: user.emailVerifiedAt !== null,
    suspended: user.suspendedKind !== null,
  };
}

export function visibleForumCategory(
  user: ForumUser,
  category: {
    kind: RawBuilder<string>;
    audience: RawBuilder<string>;
    courseId: RawBuilder<string | null>;
    archivedAt: RawBuilder<Date | null>;
  },
  moderation = false,
): RawBuilder<SqlBool> {
  if (user.role === 'admin' || user.role === 'manager') return sql`TRUE`;
  if (moderation) {
    return user.role === 'instructor'
      ? sql`(${category.kind} = 'course' AND EXISTS (
      SELECT 1 FROM courses c WHERE c.id = ${category.courseId} AND c.owner_id = ${user.id}
    ))`
      : sql`FALSE`;
  }
  return readableBy(category, {
    id: sql`${user.id}`,
    role: sql`${user.role}`,
    verified: sql`${user.verified}`,
  });
}

type ForumCategoryColumns = Parameters<typeof visibleForumCategory>[1];
function readableBy(
  { kind, audience, courseId, archivedAt }: ForumCategoryColumns,
  user: { id: RawBuilder<string>; role: RawBuilder<string>; verified: RawBuilder<boolean> },
): RawBuilder<SqlBool> {
  const active = sql`EXISTS (
    SELECT 1 FROM entitlements e
      LEFT JOIN courses c ON e.product_type = 'course' AND c.id = e.product_id
      LEFT JOIN ebooks k ON e.product_type = 'ebook' AND k.id = e.product_id
      LEFT JOIN bundles b ON e.product_type = 'bundle' AND b.id = e.product_id
    WHERE e.user_id = ${user.id} AND e.revoked_at IS NULL AND e.starts_at <= now()
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND coalesce(c.access_mode, k.access_mode, b.access_mode) <> 'open'
  )`;
  const instructor = sql`${user.role} = 'instructor'`;
  const course = sql`EXISTS (
    SELECT 1 FROM courses c WHERE c.id = ${courseId}
      AND (
        (${instructor} AND c.owner_id = ${user.id})
        OR (c.status = 'published' AND c.archived_at IS NULL AND (
          c.access_mode = 'open' OR EXISTS (
            SELECT 1 FROM entitlements e WHERE e.user_id = ${user.id} AND e.product_type = 'course'
              AND e.product_id = c.id AND e.revoked_at IS NULL
              AND e.starts_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now())
          )
        ))
      )
  )`;
  return sql`(${user.role} IN ('admin', 'manager') OR (${archivedAt} IS NULL AND (
    (${kind} = 'free' AND (${instructor} OR (${audience} = 'all' AND ${user.verified}) OR
      (${audience} = 'active' AND ${active})))
    OR (${kind} = 'course' AND ${course})
  )))`;
}

/** A mesma regra parametrizada pelas colunas de uma busca de destinatários. */
export function forumRecipientCategoryAccess(): RawBuilder<SqlBool> {
  return readableBy(
    {
      kind: sql.ref('forumCategories.kind'),
      audience: sql.ref('forumCategories.audience'),
      courseId: sql.ref('forumCategories.courseId'),
      archivedAt: sql.ref('forumCategories.archivedAt'),
    },
    {
      id: sql.ref('users.id'),
      role: sql.ref('users.role'),
      verified: sql`${sql.ref('users.emailVerifiedAt')} IS NOT NULL`,
    },
  );
}
