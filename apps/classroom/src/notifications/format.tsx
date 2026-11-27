import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import type { NotificationEntry } from '@nuva-edu/ui';
import type { ParseKeys, TFunction } from 'i18next';
import {
  BadgeCheck,
  CalendarDays,
  LifeBuoy,
  type LucideIcon,
  Mail,
  Megaphone,
  MessagesSquare,
  Receipt,
  ShieldAlert,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/*
 * Como um item da central vira linha na tela (spec 024, "Central"): ícone do grupo, título pelo
 * tipo, texto curto tirado de `data` e link para o alvo. O `data` vem do remetente e é sempre
 * exibido como texto: o React escapa o conteúdo e nada vira HTML.
 */

export type NotificationItem = ClassroomSchemas['NotificationItem'];
export type NotificationGroup = ClassroomSchemas['NotificationGroup'];
type NotificationData = ClassroomSchemas['NotificationData'];

const GROUP_ICONS: Record<NotificationGroup, LucideIcon> = {
  account: UserRound,
  purchase: Receipt,
  courses: BadgeCheck,
  forum: MessagesSquare,
  messages: Mail,
  community: Users,
  events: CalendarDays,
  support: LifeBuoy,
  announcements: Megaphone,
  moderation: ShieldAlert,
  staff: Wrench,
};

/** Título por tipo; tipo que este site ainda não conhece cai no genérico. */
const TYPE_TITLES = {
  'account.new_login': 'notifications.types.newLogin',
  'account.email_undeliverable': 'notifications.types.emailUndeliverable',
  'order.approved': 'notifications.types.orderApproved',
  'order.refunded': 'notifications.types.orderRefunded',
  'subscription.renewed': 'notifications.types.subscriptionRenewed',
  'subscription.payment_failed': 'notifications.types.subscriptionPaymentFailed',
  'subscription.canceled': 'notifications.types.subscriptionCanceled',
  'subscription.expired': 'notifications.types.subscriptionExpired',
  'access.granted': 'notifications.types.accessGranted',
  'access.revoked': 'notifications.types.accessRevoked',
  'lesson.published': 'notifications.types.lessonPublished',
  'course.published': 'notifications.types.coursePublished',
  'certificate.issued': 'notifications.types.certificateIssued',
  'forum.reply': 'notifications.types.forumReply',
  'forum.mention': 'notifications.types.forumMention',
  'forum.solution': 'notifications.types.forumSolution',
  'dm.received': 'notifications.types.dmReceived',
  'follow.created': 'notifications.types.followCreated',
  'case.liked': 'notifications.types.caseLiked',
  'case.commented': 'notifications.types.caseCommented',
  'badge.awarded': 'notifications.types.badgeAwarded',
  'level.up': 'notifications.types.levelUp',
  'event.created': 'notifications.types.eventCreated',
  'event.reminder': 'notifications.types.eventReminder',
  'event.canceled': 'notifications.types.eventCanceled',
  'ticket.reply': 'notifications.types.ticketReply',
  'ticket.status_changed': 'notifications.types.ticketStatusChanged',
  'ticket.opened': 'notifications.types.ticketOpened',
  'ticket.user_reply': 'notifications.types.ticketUserReply',
  'report.created': 'notifications.types.reportCreated',
  'announcement.published': 'notifications.types.announcementPublished',
  'moderation.content_hidden': 'notifications.types.moderationContentHidden',
  'moderation.warning': 'notifications.types.moderationWarning',
  'moderation.suspended': 'notifications.types.moderationSuspended',
  'ops.job_failed': 'notifications.types.jobFailed',
} as const satisfies Record<string, ParseKeys>;

/**
 * Campos de `data` que os tipos usam para o texto curto (título do tópico, nome do curso,
 * assunto do chamado…). O primeiro texto presente aparece; o resto é ignorado.
 */
const TEXT_FIELDS = [
  'title',
  'subject',
  'topicTitle',
  'courseTitle',
  'lessonTitle',
  'planTitle',
  'eventTitle',
  'announcementTitle',
  'ticketSubject',
  'name',
  'excerpt',
  'message',
] as const;

/** Texto curto do item, tirado de `data`; só strings valem, e o conteúdo é exibido como texto. */
export function notificationText(data: NotificationData): string | undefined {
  for (const field of TEXT_FIELDS) {
    const value = data[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/** Endereço do alvo no classroom; alvo desconhecido (ou sem id) fica sem link. */
export function notificationHref(item: NotificationItem): string | undefined {
  if (!item.targetId) return undefined;
  const id = encodeURIComponent(item.targetId);
  switch (item.targetType) {
    case 'topic':
      return `/forum/t/${id}`;
    case 'order':
      return `/pedidos/${id}`;
    case 'ticket':
      return `/suporte/${id}`;
    case 'certificate':
      return `/certificados/${id}`;
    case 'announcement':
      return '/novidades';
    case 'event':
      return '/calendario';
    case 'course':
    case 'lesson':
      return '/meus-cursos';
    case 'subscription':
      return '/conta/compras';
    case 'user':
      return `/membros/${id}`;
    default:
      return undefined;
  }
}

/** Título do item pelo tipo da notificação. */
export function notificationTitle(t: TFunction, item: NotificationItem): string {
  const key: ParseKeys | undefined =
    TYPE_TITLES[item.type as keyof typeof TYPE_TITLES] ?? undefined;
  return key ? t(key) : t('notifications.types.other');
}

/** Fuso do navegador não entra: o tempo é relativo, montado com o idioma da interface. */
export function useRelativeTime(): (iso: string) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (iso: string) => {
      const target = new Date(iso).getTime();
      if (Number.isNaN(target)) return '';
      const formatter = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
      const seconds = Math.round((target - Date.now()) / 1000);
      const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 365 * 24 * 60 * 60],
        ['month', 30 * 24 * 60 * 60],
        ['day', 24 * 60 * 60],
        ['hour', 60 * 60],
        ['minute', 60],
      ];
      for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
      }
      return formatter.format(0, 'second');
    },
    [i18n.language],
  );
}

/** Itens da central como linhas do `NotificationList` de @nuva-edu/ui. */
export function useNotificationEntries(items: readonly NotificationItem[]): NotificationEntry[] {
  const { t } = useTranslation();
  return items.map((item) => {
    const Icon = GROUP_ICONS[item.group] ?? UserRound;
    const text =
      item.type === 'account.email_undeliverable'
        ? t('notifications.types.emailUndeliverableText')
        : notificationText(item.data);
    const href = notificationHref(item);
    return {
      id: item.id,
      type: item.type,
      title: notificationTitle(t, item),
      ...(text ? { text } : {}),
      ...(href ? { href } : {}),
      createdAt: item.createdAt,
      read: item.readAt !== null,
      ...(item.actor
        ? {
            actor: {
              name: item.actor.name,
              avatarUrl: item.actor.avatarUrl,
            },
          }
        : { icon: <Icon size={18} aria-hidden="true" /> }),
      groupCount: item.count,
    };
  });
}
