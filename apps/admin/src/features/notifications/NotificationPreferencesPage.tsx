import {
  AdminCard,
  AdminPageHeader,
  LoadingState,
  NotificationPreferences,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { useNotificationError } from './errors';
import {
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationPrefsUpdate,
  notificationsKeys,
  updateNotificationPrefs,
  useNotificationPrefs,
} from './queries';

/**
 * Preferências da equipe por grupo e canal (spec 024, RF-03 e RF-04; `GET|PUT
 * /api/v1/me/notification-prefs`). Os grupos obrigatórios (`account`, `purchase`, `support` e
 * `moderation`) chegam com `emailRequired` e o e-mail fica travado; o grupo `account` não tem
 * canal de plataforma. A tela só manda o canal mudado; quem recusa o resto é a API.
 */
export function NotificationPreferencesPage() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useNotificationError();
  const prefs = useNotificationPrefs();
  const [saved, setSaved] = useState(false);

  const save = useAction(
    (groupId: NotificationGroup, channel: 'inApp' | 'email', value: boolean) => {
      const body = { [groupId]: { [channel]: value } } as NotificationPrefsUpdate;
      return updateNotificationPrefs(api, body);
    },
  );

  const onChange = async (groupId: string, channel: 'inApp' | 'email', value: boolean) => {
    setSaved(false);
    const result = await save.run(groupId as NotificationGroup, channel, value);
    if (!result.ok) {
      // O interruptor continua como está: quem recusou foi a API, e o estado salvo é dela.
      toast.error(message(result.error), { title: t('notifications.prefs.saveError') });
      return;
    }
    queryClient.setQueryData(notificationsKeys.prefs(), result.data);
    // O próprio componente de preferências anuncia o "salvo" ao leitor de tela.
    setSaved(true);
  };

  return (
    <>
      <AdminPageHeader
        title={t('notifications.prefs.title')}
        subtitle={t('notifications.prefs.subtitle')}
      />
      {prefs.isPending ? (
        <LoadingState label={t('notifications.prefs.loading')} />
      ) : prefs.isError ? (
        <QueryErrorState
          error={prefs.error}
          title={t('notifications.prefs.errorTitle')}
          onRetry={() => void prefs.refetch()}
          retrying={prefs.isFetching}
        />
      ) : (
        <AdminCard pad>
          <NotificationPreferences
            groups={NOTIFICATION_GROUPS.map((id) => {
              const channel = prefs.data[id];
              return {
                id,
                label: t(`notifications.groups.${id}`),
                description: t(`notifications.groupDescriptions.${id}`),
                inApp: channel.inAppAvailable ? channel.inApp : null,
                email: channel.email,
                emailLocked: channel.emailRequired,
                ...(channel.emailRequired
                  ? { lockedReason: t('notifications.prefs.required') }
                  : {}),
              };
            })}
            labels={{
              region: t('notifications.prefs.region'),
              title: t('notifications.prefs.heading'),
              description: t('notifications.prefs.description'),
              inApp: t('notifications.prefs.inApp'),
              email: t('notifications.prefs.email'),
              required: t('notifications.prefs.required'),
              notAvailable: t('notifications.prefs.notAvailable'),
              ...(saved ? { saved: t('notifications.prefs.saved') } : {}),
            }}
            onChange={(groupId, channel, value) => void onChange(groupId, channel, value)}
          />
        </AdminCard>
      )}
    </>
  );
}
