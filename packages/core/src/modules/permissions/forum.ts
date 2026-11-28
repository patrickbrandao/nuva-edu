import type { Database } from '../../db/database.ts';
import { permissionDenied } from '../../errors/domain-error.ts';
import type { ForumUser } from '../entitlements/forum-access.ts';

export function isForumStaff(user: ForumUser): boolean {
  return user.role === 'manager' || user.role === 'admin';
}

export async function mayModerateForum(
  db: Database,
  user: ForumUser,
  categoryId: string,
): Promise<boolean> {
  if (user.suspended) return false;
  if (isForumStaff(user)) return true;
  if (user.role !== 'instructor') return false;
  const match = await db
    .selectFrom('forumCategories')
    .innerJoin('courses', 'courses.id', 'forumCategories.courseId')
    .select('forumCategories.id')
    .where('forumCategories.id', '=', categoryId)
    .where('courses.ownerId', '=', user.id)
    .executeTakeFirst();
  return match !== undefined;
}

export async function requireForumModerator(db: Database, user: ForumUser, categoryId: string) {
  if (!(await mayModerateForum(db, user, categoryId))) throw permissionDenied();
}
