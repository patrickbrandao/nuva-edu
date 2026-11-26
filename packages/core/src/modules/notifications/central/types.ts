import type { JsonObject } from '../../../db/generated/database.ts';

// Catálogo das notificações e dos grupos de preferência (spec 024, "Tipos e grupos"). A tabela
// `notification_prefs` guarda só o que o usuário mudou; o grupo de cada tipo e os padrões de
// canal vivem aqui, no código, porque a migration 0016 não tem coluna de grupo.
// Dono dos dados: o worker cria a notificação; as APIs leem e marcam como lidas.

export const NOTIFICATION_GROUPS = [
  'account',
  'purchase',
  'courses',
  'forum',
  'messages',
  'community',
  'events',
  'support',
  'announcements',
  'moderation',
  'staff',
] as const;

export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export interface NotificationGroupDefinition {
  /** Canal "plataforma" (central e sino). */
  inApp: boolean;
  /** E-mail ligado enquanto o usuário não mudar a preferência. */
  emailByDefault: boolean;
  /** E-mail obrigatório: não pode ser desligado (spec 024, RF-04). */
  emailRequired: boolean;
  /** Só a equipe recebe (`instructor`, `manager` e `admin`). */
  staffOnly: boolean;
}

export const NOTIFICATION_GROUP_DEFINITIONS: {
  readonly [G in NotificationGroup]: NotificationGroupDefinition;
} = {
  // O grupo `account` não tem canal "plataforma": sai por `enqueueEmail`, nunca por `notify`.
  account: { inApp: false, emailByDefault: true, emailRequired: true, staffOnly: false },
  purchase: { inApp: true, emailByDefault: true, emailRequired: true, staffOnly: false },
  courses: { inApp: true, emailByDefault: true, emailRequired: false, staffOnly: false },
  forum: { inApp: true, emailByDefault: true, emailRequired: false, staffOnly: false },
  messages: { inApp: true, emailByDefault: false, emailRequired: false, staffOnly: false },
  community: { inApp: true, emailByDefault: false, emailRequired: false, staffOnly: false },
  events: { inApp: true, emailByDefault: true, emailRequired: false, staffOnly: false },
  support: { inApp: true, emailByDefault: true, emailRequired: true, staffOnly: false },
  announcements: { inApp: true, emailByDefault: false, emailRequired: false, staffOnly: false },
  moderation: { inApp: true, emailByDefault: true, emailRequired: true, staffOnly: false },
  staff: { inApp: true, emailByDefault: true, emailRequired: false, staffOnly: true },
};

/** Grupo de cada tipo da spec 024. Tipos novos entram aqui junto da spec do recurso. */
const TYPE_GROUPS = {
  'account.verify_email': 'account',
  'account.password_reset': 'account',
  'account.exists': 'account',
  'account.new_login': 'account',
  'account.locked': 'account',
  'account.password_changed': 'account',
  'account.role_changed': 'account',
  'account.deleted': 'account',
  'account.email_undeliverable': 'account',
  'order.approved': 'purchase',
  'order.refunded': 'purchase',
  'subscription.renewed': 'purchase',
  'subscription.payment_failed': 'purchase',
  'subscription.canceled': 'purchase',
  'subscription.expired': 'purchase',
  'access.granted': 'purchase',
  'access.revoked': 'purchase',
  'lesson.published': 'courses',
  'course.published': 'courses',
  'certificate.issued': 'courses',
  'forum.reply': 'forum',
  'forum.mention': 'forum',
  'forum.solution': 'forum',
  'dm.received': 'messages',
  'follow.created': 'community',
  'case.liked': 'community',
  'case.commented': 'community',
  'badge.awarded': 'community',
  'level.up': 'community',
  'event.created': 'events',
  'event.reminder': 'events',
  'event.canceled': 'events',
  'ticket.reply': 'support',
  'ticket.status_changed': 'support',
  'announcement.published': 'announcements',
  'moderation.content_hidden': 'moderation',
  'moderation.warning': 'moderation',
  'moderation.suspended': 'moderation',
  'ticket.opened': 'staff',
  'ticket.user_reply': 'staff',
  'report.created': 'staff',
  'ops.job_failed': 'staff',
} as const satisfies Record<string, NotificationGroup>;

export type NotificationType = keyof typeof TYPE_GROUPS;

const TYPES = Object.keys(TYPE_GROUPS) as NotificationType[];

/** Todos os tipos do catálogo, em ordem estável (a da spec). */
export const NOTIFICATION_TYPES: readonly NotificationType[] = TYPES;

const GROUP_SET: ReadonlySet<string> = new Set(NOTIFICATION_GROUPS);
const TYPE_SET: ReadonlySet<string> = new Set(TYPES);

export function isNotificationGroup(value: string): value is NotificationGroup {
  return GROUP_SET.has(value);
}

export function isNotificationType(value: string): value is NotificationType {
  return TYPE_SET.has(value);
}

/** Grupo da preferência do tipo. Tipo fora do catálogo: `TypeError` (erro de quem chama). */
export function notificationTypeGroup(type: NotificationType): NotificationGroup {
  return TYPE_GROUPS[type];
}

/** Tipos de um grupo, na ordem da spec. */
export function notificationTypesForGroup(group: NotificationGroup): NotificationType[] {
  return TYPES.filter((type) => TYPE_GROUPS[type] === group);
}

/** Grupos cujo e-mail não pode ser desligado (`account`, `purchase`, `support`, `moderation`). */
export function isNotificationEmailRequired(group: NotificationGroup): boolean {
  return NOTIFICATION_GROUP_DEFINITIONS[group].emailRequired;
}

/** `false` só no grupo `account` (spec 024: não tem canal plataforma). */
export function notificationGroupHasInApp(group: NotificationGroup): boolean {
  return NOTIFICATION_GROUP_DEFINITIONS[group].inApp;
}

/** `true` para o grupo `staff`, que só a equipe recebe. */
export function isNotificationStaffGroup(group: NotificationGroup): boolean {
  return NOTIFICATION_GROUP_DEFINITIONS[group].staffOnly;
}

/** Formatos aceitos pelas restrições da migration 0016. */
export const NOTIFICATION_TARGET_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const NOTIFICATION_TARGET_TYPE_MAX_LENGTH = 40;
/** Mesmo formato do `CHECK notifications_type_format`. */
export const NOTIFICATION_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/**
 * Tamanho máximo do `data` serializado. O `data` vai para a coluna e para o payload da tarefa
 * `notify`; sem limite, um texto enorme incharia a fila e a central.
 */
export const NOTIFICATION_DATA_MAX_BYTES = 4_000;

/**
 * Chaves que nunca podem aparecer no `data` (nem aninhadas): o conteúdo vai para a central e
 * para a tarefa, e senha, token ou segredo não passam por nenhum canal de notificação (spec 024,
 * "E-mails do grupo account": `data` não leva senha, token nem motivo interno).
 */
const FORBIDDEN_DATA_KEYS: ReadonlySet<string> = new Set([
  'password',
  'senha',
  'token',
  'secret',
  'authorization',
  'cookie',
]);

const MAX_DATA_DEPTH = 8;

/** `data` fora do formato. Erro de programação: nunca chega ao cliente como está. */
export class NotificationDataError extends TypeError {
  constructor(problem: string) {
    super(`Dados inválidos para a notificação: ${problem}.`);
    this.name = 'NotificationDataError';
  }
}

/**
 * Confere o `data` de uma notificação: objeto JSON, sem chave proibida (em nenhum nível) e
 * dentro do limite de bytes. Devolve o mesmo objeto; não converte datas, então quem chama
 * passa texto ISO. Lança `NotificationDataError`.
 */
export function normalizeNotificationData(data: unknown): JsonObject {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new NotificationDataError('o data deve ser um objeto');
  }
  assertAllowedKeys(data, 0, new Set());
  const record = data as JsonObject;
  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    throw new NotificationDataError('o data precisa ser JSON');
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > NOTIFICATION_DATA_MAX_BYTES) {
    throw new NotificationDataError(
      `o data tem ${bytes} bytes; o limite é ${NOTIFICATION_DATA_MAX_BYTES}`,
    );
  }
  return record;
}

function assertAllowedKeys(value: unknown, depth: number, seen: Set<object>): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  if (seen.has(value)) {
    throw new NotificationDataError('o data tem referência circular');
  }
  if (depth > MAX_DATA_DEPTH) {
    throw new NotificationDataError(`o data passa de ${MAX_DATA_DEPTH} níveis`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertAllowedKeys(item, depth + 1, seen);
    }
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_DATA_KEYS.has(key.toLowerCase())) {
        throw new NotificationDataError(`a chave "${key}" nunca vai numa notificação`);
      }
      assertAllowedKeys(item, depth + 1, seen);
    }
  }
  seen.delete(value);
}
