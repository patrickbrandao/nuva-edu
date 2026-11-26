import {
  AdminCard,
  ErrorState,
  LoadingState,
  type NotificationGroupPreference,
  NotificationPreferences,
  PageTitle,
  useToast,
} from '@nuva-edu/ui';
import type { ParseKeys } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import {
  NOTIFICATION_GROUPS,
  type NotificationChannel,
  type NotificationGroup,
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from './queries';

const GROUP_TEXT: Record<NotificationGroup, { label: ParseKeys; description: ParseKeys }> = {
  account: {
    label: 'notifications.preferences.groups.account',
    description: 'notifications.preferences.groups.accountText',
  },
  purchase: {
    label: 'notifications.preferences.groups.purchase',
    description: 'notifications.preferences.groups.purchaseText',
  },
  courses: {
    label: 'notifications.preferences.groups.courses',
    description: 'notifications.preferences.groups.coursesText',
  },
  forum: {
    label: 'notifications.preferences.groups.forum',
    description: 'notifications.preferences.groups.forumText',
  },
  messages: {
    label: 'notifications.preferences.groups.messages',
    description: 'notifications.preferences.groups.messagesText',
  },
  community: {
    label: 'notifications.preferences.groups.community',
    description: 'notifications.preferences.groups.communityText',
  },
  events: {
    label: 'notifications.preferences.groups.events',
    description: 'notifications.preferences.groups.eventsText',
  },
  support: {
    label: 'notifications.preferences.groups.support',
    description: 'notifications.preferences.groups.supportText',
  },
  announcements: {
    label: 'notifications.preferences.groups.announcements',
    description: 'notifications.preferences.groups.announcementsText',
  },
  moderation: {
    label: 'notifications.preferences.groups.moderation',
    description: 'notifications.preferences.groups.moderationText',
  },
  staff: {
    label: 'notifications.preferences.groups.staff',
    description: 'notifications.preferences.groups.staffText',
  },
};

function PreferencesContent() {
  const { t } = useTranslation();
  const toast = useToast();
  const query = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const [saved, setSaved] = useState(false);

  if (query.isPending) {
    return (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('notifications.preferences.loading')} />
      </AdminCard>
    );
  }
  if (query.isError || !query.data) {
    const failure = describeError(t, query.error);
    return (
      <AdminCard pad>
        <ErrorState
          title={t('notifications.preferences.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  }

  const prefs = query.data;
  const groups: NotificationGroupPreference[] = NOTIFICATION_GROUPS.map((id) => {
    const group = prefs[id];
    return {
      id,
      label: t(GROUP_TEXT[id].label),
      description: t(GROUP_TEXT[id].description),
      // `account` não tem canal de plataforma; o resto tem.
      inApp: group.inAppAvailable ? group.inApp : null,
      email: group.email,
      emailLocked: group.emailRequired,
      ...(group.emailRequired
        ? { lockedReason: t('notifications.preferences.requiredReason') }
        : {}),
    };
  });

  const change = (groupId: string, channel: NotificationChannel, value: boolean) => {
    update.mutate(
      { group: groupId as NotificationGroup, channel, value },
      {
        onSuccess: () => setSaved(true),
        onError: (error) => {
          setSaved(false);
          toast.error(describeError(t, error).message, {
            title: t('notifications.preferences.errorSave'),
          });
        },
      },
    );
  };

  return (
    <AdminCard pad>
      <NotificationPreferences
        groups={groups}
        labels={{
          region: t('notifications.preferences.region'),
          title: t('notifications.preferences.title'),
          description: t('notifications.preferences.description'),
          inApp: t('notifications.preferences.inApp'),
          email: t('notifications.preferences.email'),
          required: t('notifications.preferences.required'),
          notAvailable: t('notifications.preferences.notAvailable'),
          saved: saved ? t('notifications.preferences.saved') : '',
        }}
        onChange={change}
      />
    </AdminCard>
  );
}

/**
 * `/conta/notificacoes`: preferências por grupo e canal (spec 024, RF-03 e RF-04; spec 006,
 * "Configurações"). Os grupos obrigatórios aparecem com o e-mail travado e o motivo disponível
 * ao leitor de tela.
 */
export function NotificationPreferencesPage() {
  const { t } = useTranslation();
  usePageMeta(t('notifications.preferences.title'), t('notifications.preferences.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
          <PageTitle>{t('notifications.preferences.title')}</PageTitle>
          <PreferencesContent />
        </div>
      )}
    </RequireSession>
  );
}
