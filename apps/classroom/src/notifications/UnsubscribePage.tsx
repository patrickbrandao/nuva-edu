import { AdminButton, ErrorState, LoadingState, PageTitle } from '@nuva-edu/ui';
import type { ParseKeys } from 'i18next';
import { CheckCircle2, Link2Off } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { describeError } from '../api/errors';
import { usePageMeta } from '../lib/usePageMeta';
import { HOME_PATH } from '../shell/navigation';
import { type NotificationGroup, useUnsubscribe } from './queries';

/** O token do link de descadastro: 64 caracteres hexadecimais (contrato da classroom-api). */
const TOKEN = /^[0-9a-f]{64}$/i;

/** Nome legível do grupo; os mesmos nomes da tela de preferências. */
const GROUP_KEYS = {
  account: 'notifications.preferences.groups.account',
  purchase: 'notifications.preferences.groups.purchase',
  courses: 'notifications.preferences.groups.courses',
  forum: 'notifications.preferences.groups.forum',
  messages: 'notifications.preferences.groups.messages',
  community: 'notifications.preferences.groups.community',
  events: 'notifications.preferences.groups.events',
  support: 'notifications.preferences.groups.support',
  announcements: 'notifications.preferences.groups.announcements',
  moderation: 'notifications.preferences.groups.moderation',
  staff: 'notifications.preferences.groups.staff',
} as const satisfies Record<NotificationGroup, ParseKeys>;

function UnsubscribeContent({ token }: { token: string }) {
  const { t } = useTranslation();
  const unsubscribe = useUnsubscribe();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (TOKEN.test(token)) unsubscribe.mutate(token);
  }, [token, unsubscribe]);

  if (!TOKEN.test(token)) {
    return (
      <ErrorState
        icon={<Link2Off aria-hidden="true" />}
        title={t('notifications.unsubscribe.invalidTitle')}
        text={t('notifications.unsubscribe.invalidText')}
      >
        <AdminButton href={HOME_PATH}>{t('notifications.unsubscribe.backHome')}</AdminButton>
      </ErrorState>
    );
  }
  if (unsubscribe.isError) {
    const failure = describeError(t, unsubscribe.error, {
      not_found: t('notifications.unsubscribe.invalidText'),
    });
    return (
      <ErrorState
        icon={<Link2Off aria-hidden="true" />}
        title={t('notifications.unsubscribe.invalidTitle')}
        text={failure.message}
        {...(failure.detail ? { detail: failure.detail } : {})}
      >
        <AdminButton href={HOME_PATH}>{t('notifications.unsubscribe.backHome')}</AdminButton>
      </ErrorState>
    );
  }
  if (!unsubscribe.isSuccess) {
    return <LoadingState label={t('notifications.unsubscribe.loading')} />;
  }

  const group = unsubscribe.data.group;
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="m-0 flex items-center gap-2 text-base font-medium text-ink">
        <CheckCircle2 aria-hidden="true" />
        {t('notifications.unsubscribe.doneTitle')}
      </p>
      <p className="m-0 text-sm text-ink-2">
        {t('notifications.unsubscribe.doneText', { group: t(GROUP_KEYS[group]) })}
      </p>
      <p className="m-0 text-sm text-ink-3">
        {t('notifications.unsubscribe.inAppNote', { group: t(GROUP_KEYS[group]) })}
      </p>
      <AdminButton href={HOME_PATH}>{t('notifications.unsubscribe.backHome')}</AdminButton>
    </div>
  );
}

/**
 * `/descadastro/:token`: o link de um clique dos e-mails não obrigatórios (spec 024, RF-07).
 * Público e sem login; consome o token uma vez e desliga só o e-mail do grupo indicado. Token
 * fora do formato ou desconhecido responde como link inválido, sem quebrar a página.
 */
export function UnsubscribePage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  usePageMeta(t('notifications.unsubscribe.title'), t('notifications.unsubscribe.description'));
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10 sm:px-6">
      <PageTitle>{t('notifications.unsubscribe.title')}</PageTitle>
      <UnsubscribeContent token={token} />
    </div>
  );
}
