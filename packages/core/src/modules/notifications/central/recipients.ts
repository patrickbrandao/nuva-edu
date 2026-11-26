import type { Database } from '../../../db/database.ts';
import { isRole, isStaffRole } from '../../permissions/roles.ts';
import {
  isNotificationStaffGroup,
  type NotificationGroup,
  type NotificationType,
  notificationTypeGroup,
} from './types.ts';

// Quem pode receber a notificação (spec 024, "Tipos e grupos" e "Central"). A regra de quem
// deve receber cada tipo é do recurso; aqui fica o transporte: ninguém é avisado das próprias
// ações, conta suspensa ou removida não recebe (salvo `moderation.suspended`) e o grupo `staff`
// só alcança a equipe.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Motivo de o destinatário ter ficado de fora, para o log e os testes. */
export const NOTIFICATION_SKIP_REASONS = [
  'recipient_not_found',
  'recipient_deleted',
  'recipient_suspended',
  'actor_self',
  'not_staff',
] as const;

export type NotificationSkipReason = (typeof NOTIFICATION_SKIP_REASONS)[number];

export interface NotificationSkip {
  userId: string;
  reason: NotificationSkipReason;
}

export interface EligibleNotificationRecipients {
  eligible: string[];
  skipped: NotificationSkip[];
}

export interface RecipientRuleInput {
  type: NotificationType;
  /** Quem gerou o fato; nunca recebe a própria notificação. */
  actorId?: string | null;
}

/** Tipos que uma conta suspensa ainda recebe (spec 024). */
const ALLOWED_WHILE_SUSPENDED = new Set<NotificationType>(['moderation.suspended']);

interface RecipientRow {
  id: string;
  role: string;
  deletedAt: Date | null;
  suspendedKind: string | null;
}

/**
 * Motivo para não notificar um usuário, ou `null` se ele pode receber. Faz uma consulta;
 * listas grandes usam `filterNotificationRecipients`, que consulta uma vez só.
 */
export async function notificationRecipientSkipReason(
  db: Database,
  input: RecipientRuleInput & { userId: string },
): Promise<NotificationSkipReason | null> {
  const { eligible, skipped } = await filterNotificationRecipients(
    db,
    input.type,
    [input.userId],
    input.actorId === undefined ? {} : { actorId: input.actorId },
  );
  if (eligible.length > 0) {
    return null;
  }
  return skipped[0]?.reason ?? 'recipient_not_found';
}

/**
 * Confere uma lista de destinatários numa consulta só: remove repetidos, aplica as regras e
 * devolve quem recebe e o motivo de cada um que ficou de fora. O autor entra na lista e sai
 * como `actor_self`; id fora do formato é erro de programação (`TypeError`).
 */
export async function filterNotificationRecipients(
  db: Database,
  type: NotificationType,
  recipients: readonly string[],
  options: { actorId?: string | null } = {},
): Promise<EligibleNotificationRecipients> {
  const group = notificationTypeGroup(type);
  const actorId = options.actorId?.toLowerCase() ?? null;
  const unique = new Map<string, string>();
  for (const recipient of recipients) {
    if (!UUID_PATTERN.test(recipient)) {
      throw new TypeError(`Destinatário de notificação inválido: ${String(recipient)}.`);
    }
    unique.set(recipient.toLowerCase(), recipient.toLowerCase());
  }
  const ids = [...unique.values()];
  if (ids.length === 0) {
    return { eligible: [], skipped: [] };
  }
  const rows = await db
    .selectFrom('users')
    .select(['id', 'role', 'deletedAt', 'suspendedKind'])
    .where('id', 'in', ids)
    .execute();
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  const eligible: string[] = [];
  const skipped: NotificationSkip[] = [];
  for (const userId of ids) {
    const reason = skipReason(byId.get(userId), type, group, actorId, userId);
    if (reason === null) {
      eligible.push(userId);
    } else {
      skipped.push({ userId, reason });
    }
  }
  return { eligible, skipped };
}

function skipReason(
  row: RecipientRow | undefined,
  type: NotificationType,
  group: NotificationGroup,
  actorId: string | null,
  userId: string,
): NotificationSkipReason | null {
  if (!row) {
    return 'recipient_not_found';
  }
  if (actorId !== null && userId === actorId) {
    return 'actor_self';
  }
  if (row.deletedAt !== null) {
    return 'recipient_deleted';
  }
  if (row.suspendedKind !== null && !ALLOWED_WHILE_SUSPENDED.has(type)) {
    return 'recipient_suspended';
  }
  if (isNotificationStaffGroup(group) && !(isRole(row.role) && isStaffRole(row.role))) {
    return 'not_staff';
  }
  return null;
}
