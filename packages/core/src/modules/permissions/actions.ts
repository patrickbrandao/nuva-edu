// Identificadores das ações (spec 008, "Identificadores das ações"), na ordem das linhas das
// matrizes. São os valores de `x-permission` nos contratos e da lista `permissions` da sessão.

/** Ações da matriz de administração. */
export const ADMIN_ACTIONS = [
  // Acesso
  'admin.access',
  'dashboard.view',
  // Pessoas
  'users.list',
  'users.view_private',
  'users.edit',
  'users.suspend',
  'users.sessions.revoke',
  'users.password.view',
  'users.password.set',
  'staff.manage',
  'users.delete',
  // Conteúdo
  'course.create',
  'course.edit',
  'course.publish',
  'course.delete',
  'course.delete_with_students',
  'course.set_owner',
  'ebook_bundle.manage',
  'ebook.link',
  'product.set_access',
  'product.set_price',
  'event.manage',
  'announcement.publish',
  // Acessos e vendas
  'entitlement.manage',
  'sales.view',
  'order.refund',
  'subscription.cancel',
  'plan.manage',
  'coupon.manage',
  // Comunidade e suporte
  'forum.category.manage',
  'forum.moderate',
  'report.handle',
  'case.moderate',
  'badge.award',
  'gamification.configure',
  'ticket.handle',
  'progress.view',
  'certificate.revoke',
  // Sistema
  'mcp_key.own',
  'mcp_key.manage_all',
  'audit.view',
  'ops.manage',
  'settings.manage',
] as const;

/** Ações da matriz do classroom ("Criar categoria de fórum" é `forum.category.manage`). */
export const CLASSROOM_ACTIONS = [
  'catalog.view',
  'course.view_program',
  'lesson.watch_open',
  'lesson.watch_sample',
  'content.access_paid',
  'purchase.create',
  'learning.track',
  'forum.course.participate',
  'forum.free.participate',
  'members.view',
  'dm.send',
  'case.publish',
  'ticket.open',
  'report.create',
  'account.self_service',
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export type ClassroomAction = (typeof CLASSROOM_ACTIONS)[number];
export type PermissionAction = AdminAction | ClassroomAction;

/** Todas as ações: primeiro as do admin, depois as do classroom. */
export const PERMISSION_ACTIONS: readonly PermissionAction[] = [
  ...ADMIN_ACTIONS,
  ...CLASSROOM_ACTIONS,
];

const ACTION_SET: ReadonlySet<string> = new Set(PERMISSION_ACTIONS);

export function isPermissionAction(value: unknown): value is PermissionAction {
  return typeof value === 'string' && ACTION_SET.has(value);
}
