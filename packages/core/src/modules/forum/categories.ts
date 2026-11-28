import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { businessRule, permissionDenied } from '../../errors/domain-error.ts';
import { type AuditContext, recordAudit } from '../audit/record.ts';
import { getForumUser } from '../entitlements/forum-access.ts';
import { isForumStaff } from '../permissions/forum.ts';
import { readForumCategory, requireForumCategory } from './read.ts';
import { requireFreeForumCategory } from './write.ts';

interface ForumCategoryInput {
  name: string;
  description?: string | null | undefined;
  audience: 'all' | 'active';
  position?: number | undefined;
}
type ForumCategoryPatch = Partial<ForumCategoryInput> & { archived?: boolean | undefined };

function validName(name: string) {
  const value = name.trim();
  if (!value || [...value].length > 160)
    throw businessRule('forum_category_invalid', 'Informe o nome da categoria.');
  return value;
}

export async function createForumCategory(
  db: Database,
  userId: string,
  input: ForumCategoryInput,
  context: AuditContext = { origin: 'admin_panel' },
) {
  const id = await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    if (!isForumStaff(user) || user.suspended) throw permissionDenied();
    const category = await trx
      .insertInto('forumCategories')
      .values({
        kind: 'free',
        name: validName(input.name),
        audience: input.audience,
        description: input.description?.trim() || null,
        position: input.position ?? 0,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      context: { ...context, actorUserId: user.id, actorRole: user.role },
      action: 'forum.category.create',
      targetType: 'forum_category',
      targetId: category.id,
    });
    return category.id;
  });
  return readForumCategory(db, userId, id, true);
}

export async function updateForumCategory(
  db: Database,
  userId: string,
  id: string,
  input: ForumCategoryPatch,
  context: AuditContext = { origin: 'admin_panel' },
) {
  await db.transaction().execute(async (trx) => {
    const user = await getForumUser(trx, userId);
    if (!isForumStaff(user) || user.suspended) throw permissionDenied();
    const category = await requireForumCategory(trx, user, id, true);
    requireFreeForumCategory(category);
    const { name, description, position, audience, archived } = input;
    const fields = {
      ...(name === undefined ? {} : { name: validName(name) }),
      ...(description === undefined ? {} : { description: description?.trim() || null }),
      ...(position === undefined ? {} : { position }),
      ...(audience === undefined ? {} : { audience }),
      ...(archived === undefined
        ? {}
        : { archivedAt: archived ? sql<Date>`coalesce(archived_at, now())` : null }),
    };
    if (Object.keys(fields).length === 0)
      throw businessRule('forum_category_invalid', 'Informe o que deseja alterar.');
    await trx.updateTable('forumCategories').set(fields).where('id', '=', id).execute();
    await recordAudit(trx, {
      context: { ...context, actorUserId: user.id, actorRole: user.role },
      action: 'forum.category.update',
      targetType: 'forum_category',
      targetId: id,
      details: { archived, audience, position },
    });
  });
  return readForumCategory(db, userId, id, true);
}
