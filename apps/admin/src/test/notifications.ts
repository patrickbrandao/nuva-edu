import type { AdminSchemas } from '@nuva-edu/api-client/admin';

/** Identificadores fixos dos testes da central. */
export const NOTIFICATION_ID = '0193a5b2-0000-7000-8000-0000000000c1';
export const NOTIFICATION_ID_2 = '0193a5b2-0000-7000-8000-0000000000c2';
export const NOTIFICATION_TARGET_ID = '0193a5b2-0000-7000-8000-0000000000c3';

/** Um item da central, como `GET /notifications` devolve (spec 024). */
export function notificationItem(
  overrides: Partial<AdminSchemas['NotificationItem']> = {},
): AdminSchemas['NotificationItem'] {
  return {
    id: NOTIFICATION_ID,
    type: 'forum.reply',
    group: 'forum',
    actor: {
      id: '0193a5b2-0000-7000-8000-0000000000c4',
      name: 'Aluno Exemplo',
      avatarUrl: null,
    },
    targetType: 'topic',
    targetId: NOTIFICATION_TARGET_ID,
    data: { topicTitle: 'Boas-vindas ao fórum' },
    count: 1,
    readAt: null,
    createdAt: '2026-11-25T12:00:00Z',
    ...overrides,
  };
}

/** Página da central, com o formato `Page` do contrato. */
export function notificationPage(
  items: AdminSchemas['NotificationItem'][],
  nextCursor: string | null = null,
): AdminSchemas['NotificationPage'] {
  return { items, nextCursor };
}

const PREF_GROUP = {
  inApp: true,
  email: true,
  emailRequired: false,
  inAppAvailable: true,
};

/** Preferências dos onze grupos, com os obrigatórios como a API devolve. */
export function notificationPrefs(
  overrides: Partial<AdminSchemas['NotificationPrefs']> = {},
): AdminSchemas['NotificationPrefs'] {
  return {
    account: { ...PREF_GROUP, inApp: false, inAppAvailable: false, emailRequired: true },
    purchase: { ...PREF_GROUP, emailRequired: true },
    courses: PREF_GROUP,
    forum: PREF_GROUP,
    messages: { ...PREF_GROUP, inApp: true, email: false },
    community: { ...PREF_GROUP, inApp: true, email: false },
    events: PREF_GROUP,
    support: { ...PREF_GROUP, emailRequired: true },
    announcements: { ...PREF_GROUP, email: false },
    moderation: { ...PREF_GROUP, emailRequired: true },
    staff: PREF_GROUP,
    ...overrides,
  };
}
