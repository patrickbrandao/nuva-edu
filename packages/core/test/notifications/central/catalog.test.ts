import { describe, expect, it } from 'vitest';
import {
  isNotificationEmailRequired,
  isNotificationGroup,
  isNotificationStaffGroup,
  isNotificationType,
  NOTIFICATION_DATA_MAX_BYTES,
  NOTIFICATION_GROUP_DEFINITIONS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_TARGET_TYPE_MAX_LENGTH,
  NOTIFICATION_TYPES,
  NotificationDataError,
  normalizeNotificationData,
  normalizeNotificationPayload,
  notificationGroupHasInApp,
  notificationTypeGroup,
  notificationTypesForGroup,
} from '../../../src/index.ts';

describe('catálogo de tipos e grupos (spec 024)', () => {
  it('tem os onze grupos, do `account` ao `staff`', () => {
    expect(NOTIFICATION_GROUPS).toEqual([
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
    ]);
    for (const group of NOTIFICATION_GROUPS) {
      expect(isNotificationGroup(group)).toBe(true);
      expect(notificationTypesForGroup(group).length).toBeGreaterThan(0);
    }
    expect(isNotificationGroup('other')).toBe(false);
    expect(isNotificationGroup('account ')).toBe(false);
  });

  it('mapeia os tipos da tabela e a exceção de endereço indisponível', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(42);
    expect(NOTIFICATION_TYPES).toContain('forum.reply');
    expect(NOTIFICATION_TYPES).toContain('ops.job_failed');
    expect(isNotificationType('forum.reply')).toBe(true);
    expect(isNotificationType('forum.unknown')).toBe(false);
    expect(isNotificationType('toString')).toBe(false);
    expect(notificationTypeGroup('forum.mention')).toBe('forum');
    expect(notificationTypeGroup('ticket.opened')).toBe('staff');
    expect(notificationTypeGroup('account.email_undeliverable')).toBe('account');
    expect(notificationTypesForGroup('support')).toEqual(['ticket.reply', 'ticket.status_changed']);
    expect(notificationTypesForGroup('messages')).toEqual(['dm.received']);
  });

  it('marca os grupos obrigatórios, sem plataforma e só da equipe', () => {
    expect(NOTIFICATION_GROUPS.filter((group) => isNotificationEmailRequired(group))).toEqual([
      'account',
      'purchase',
      'support',
      'moderation',
    ]);
    expect(NOTIFICATION_GROUPS.filter((group) => !notificationGroupHasInApp(group))).toEqual([
      'account',
    ]);
    expect(NOTIFICATION_GROUPS.filter((group) => isNotificationStaffGroup(group))).toEqual([
      'staff',
    ]);
    expect(NOTIFICATION_GROUP_DEFINITIONS.forum).toEqual({
      inApp: true,
      emailByDefault: true,
      emailRequired: false,
      staffOnly: false,
    });
  });

  it('normaliza o `data` e recusa o que não pode ir para a central', () => {
    expect(normalizeNotificationData({ title: 'Oi', n: 1, ok: true, list: [1] })).toEqual({
      title: 'Oi',
      n: 1,
      ok: true,
      list: [1],
    });
    expect(() => normalizeNotificationData(null)).toThrow(NotificationDataError);
    expect(() => normalizeNotificationData([])).toThrow(NotificationDataError);
    expect(() => normalizeNotificationData('texto')).toThrow(NotificationDataError);
    expect(() => normalizeNotificationData({ password: 'x' })).toThrow(/password/);
    expect(() => normalizeNotificationData({ nested: { TOKEN: 'x' } })).toThrow(/TOKEN/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => normalizeNotificationData(circular)).toThrow(/circular/);
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let level = 0; level < 10; level += 1) {
      const next: Record<string, unknown> = {};
      deep.next = next;
      deep = next;
    }
    expect(() => normalizeNotificationData(root)).toThrow(/níveis/);
    expect(() =>
      normalizeNotificationData({ text: 'x'.repeat(NOTIFICATION_DATA_MAX_BYTES) }),
    ).toThrow(/limite/);
  });

  it('confere e normaliza autor, alvo e dados', () => {
    expect(normalizeNotificationPayload()).toEqual({
      actorId: null,
      targetType: null,
      targetId: null,
      data: {},
    });
    const targetId = crypto.randomUUID().toUpperCase();
    expect(
      normalizeNotificationPayload({
        actorId: targetId,
        targetType: 'forum_topic',
        targetId,
        data: { title: 'Oi' },
      }),
    ).toEqual({
      actorId: targetId.toLowerCase(),
      targetType: 'forum_topic',
      targetId: targetId.toLowerCase(),
      data: { title: 'Oi' },
    });
    expect(() => normalizeNotificationPayload({ targetType: 'topic' })).toThrow(/existem juntos/);
    expect(() => normalizeNotificationPayload({ targetId })).toThrow(/existem juntos/);
    expect(() => normalizeNotificationPayload({ targetType: 'Topic', targetId })).toThrow(
      /targetType inválido/,
    );
    expect(() =>
      normalizeNotificationPayload({
        targetType: 't'.repeat(NOTIFICATION_TARGET_TYPE_MAX_LENGTH + 1),
        targetId,
      }),
    ).toThrow(/targetType inválido/);
    expect(() => normalizeNotificationPayload({ actorId: 'nope' })).toThrow(/actorId/);
    expect(() => normalizeNotificationPayload({ targetId: 'nope', targetType: 'topic' })).toThrow(
      /targetId/,
    );
  });
});
