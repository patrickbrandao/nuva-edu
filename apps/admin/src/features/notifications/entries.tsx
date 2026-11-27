import type { NotificationEntry } from '@nuva-edu/ui';
import {
  Activity,
  CalendarDays,
  GraduationCap,
  LifeBuoy,
  Mail,
  Megaphone,
  MessagesSquare,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { COURSES_PATH } from '../../api/courses';
import { OPERATIONS_PATH } from '../payments/queries';
import type { NotificationGroup, NotificationItem } from './queries';

/*
 * O item da central como a lista do `@nuva-edu/ui` espera (spec 024, "Central"): ícone do tipo,
 * título, texto curto, tempo relativo e link para o alvo. O contrato traz `type`, `actor`, `data`
 * e o alvo; os textos saem das traduções do site. Tipo que o site ainda não conhece (worker mais
 * novo) não some nem quebra a lista: cai no rótulo genérico.
 */

const GROUP_ICONS: Record<NotificationGroup, ReactNode> = {
  account: <ShieldCheck size={16} />,
  purchase: <ShoppingCart size={16} />,
  courses: <GraduationCap size={16} />,
  forum: <MessagesSquare size={16} />,
  messages: <Mail size={16} />,
  community: <Users size={16} />,
  events: <CalendarDays size={16} />,
  support: <LifeBuoy size={16} />,
  announcements: <Megaphone size={16} />,
  moderation: <ShieldAlert size={16} />,
  staff: <Activity size={16} />,
};

/**
 * Campos de `data` que valem um texto curto, na ordem de preferência. Cada tipo da spec usa um
 * ou dois deles; o que não existir fica de fora, sem inventar frase.
 */
const TEXT_FIELDS = [
  'title',
  'productTitle',
  'courseTitle',
  'topicTitle',
  'planTitle',
  'protocol',
  'jobType',
  'code',
] as const;

/** Texto curto do `data`, quando houver. */
function shortText(data: Record<string, unknown>): string | undefined {
  for (const field of TEXT_FIELDS) {
    const value = data[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/**
 * Link do alvo nas telas que já existem hoje. Alvo de tela ainda não construída (chamado,
 * denúncia, tópico) fica sem link: o item continua legível e marcável como lido.
 */
function targetHref(item: NotificationItem): string | undefined {
  if (!item.targetId) return undefined;
  switch (item.targetType) {
    case 'job':
      return OPERATIONS_PATH;
    case 'course':
      return `${COURSES_PATH}/${item.targetId}`;
    default:
      return undefined;
  }
}

/** Tempo relativo curto ("há 2 minutos"); menos de um minuto vira "agora". */
export function useRelativeTime() {
  const { t, i18n } = useTranslation();
  const format = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }),
    [i18n.language],
  );
  return useCallback(
    (at: string): string => {
      const seconds = Math.round((new Date(at).getTime() - Date.now()) / 1000);
      if (Math.abs(seconds) < 60) return t('notifications.time.now');
      const minutes = Math.round(seconds / 60);
      if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
      const hours = Math.round(minutes / 60);
      if (Math.abs(hours) < 24) return format.format(hours, 'hour');
      return format.format(Math.round(hours / 24), 'day');
    },
    [format, t],
  );
}

/** Converte os itens da API nos itens da lista, com os textos do site. */
export function useNotificationEntries() {
  const { t } = useTranslation();
  return useCallback(
    (items: readonly NotificationItem[]): NotificationEntry[] =>
      items.map((item) => {
        const text =
          item.type === 'account.email_undeliverable'
            ? t('notifications.types.account.email_undeliverable_text')
            : shortText(item.data);
        return {
          id: item.id,
          type: item.type,
          title: t(`notifications.types.${item.type}`, {
            defaultValue: t('notifications.types.unknown'),
          }),
          ...(text ? { text } : {}),
          ...(targetHref(item) ? { href: targetHref(item) } : {}),
          createdAt: item.createdAt,
          read: item.readAt !== null,
          // A foto de quem gerou vale mais que o ícone do grupo; sem autor (aviso do sistema),
          // o grupo dá o ícone (spec 024, "Central").
          ...(item.actor
            ? { actor: { name: item.actor.name, avatarUrl: item.actor.avatarUrl } }
            : { icon: GROUP_ICONS[item.group] }),
          groupCount: item.count,
        };
      }),
    [t],
  );
}
