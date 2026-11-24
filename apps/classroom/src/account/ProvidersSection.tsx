import { type ClassroomAuthProvider, classroomOAuthStartUrl } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminCard,
  AdminSection,
  ConfirmDialog,
  ErrorState,
  LoadingState,
} from '@nuva-edu/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError, type ErrorText } from '../api/errors';
import { useMeta } from '../api/meta';
import { ErrorAlert } from '../auth/ErrorAlert';
import { browser } from '../lib/browser';
import { useRefreshSession } from '../session/session';
import { IDENTITIES_KEY, useIdentities } from './queries';

const PROVIDERS: readonly ClassroomAuthProvider[] = ['google', 'facebook', 'apple'];

/** Volta do vínculo: o provedor devolve o navegador a esta tela. */
export const ACCESS_PATH = '/conta/acesso';

/**
 * Provedores vinculados (spec 007, "Vínculo manual"): vincular (`intent=link`, navegação de
 * página inteira) só os que a instalação oferece; remover qualquer vinculado, menos o último
 * método de acesso (`422` `last_login_method`).
 */
export function ProvidersSection() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const client = useQueryClient();
  const refreshSession = useRefreshSession();
  const { data: meta } = useMeta();
  const identities = useIdentities();
  const [removing, setRemoving] = useState<ClassroomAuthProvider | null>(null);
  const [failure, setFailure] = useState<ErrorText | null>(null);

  const unlink = useMutation({
    mutationFn: async (provider: ClassroomAuthProvider) => {
      await api.DELETE('/api/v1/account/identities/{provider}', {
        params: { path: { provider } },
      });
    },
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      setRemoving(null);
      await Promise.all([client.invalidateQueries({ queryKey: IDENTITIES_KEY }), refreshSession()]);
    },
    onError: (error) => {
      setRemoving(null);
      setFailure(describeError(t, error, { last_login_method: t('access.providers.lastMethod') }));
    },
  });

  const name = (provider: ClassroomAuthProvider) => t(`auth.providers.${provider}`);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  let body: ReactNode;
  if (identities.isPending) body = <LoadingState label={t('access.providers.loading')} />;
  else if (identities.isError) {
    const error = describeError(t, identities.error);
    body = (
      <ErrorState
        title={t('access.providers.errorTitle')}
        text={error.message}
        detail={error.detail}
        retryLabel={t('common.retry')}
        onRetry={() => void identities.refetch()}
        retrying={identities.isFetching}
      />
    );
  } else {
    const linked = new Map(identities.data.items.map((item) => [item.provider, item]));
    const offered = new Set(meta?.authProviders ?? []);
    const shown = PROVIDERS.filter((provider) => linked.has(provider) || offered.has(provider));
    body = shown.length ? (
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((provider) => {
          const identity = linked.get(provider);
          return (
            <li
              key={provider}
              className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-line py-3 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">{name(provider)}</span>
                <span className="text-[13px] text-ink-3 [overflow-wrap:anywhere]">
                  {identity
                    ? t('access.providers.linkedSince', {
                        email: identity.email ?? t('access.providers.noEmail'),
                        date: dateFormat.format(new Date(identity.createdAt)),
                      })
                    : t('access.providers.notLinked')}
                </span>
              </span>
              {identity ? (
                <AdminButton
                  size="sm"
                  onClick={() => setRemoving(provider)}
                  aria-label={t('access.providers.unlinkNamed', { provider: name(provider) })}
                >
                  {t('access.providers.unlink')}
                </AdminButton>
              ) : (
                <AdminButton
                  size="sm"
                  onClick={() =>
                    browser.assign(
                      classroomOAuthStartUrl(provider, { intent: 'link', returnTo: ACCESS_PATH }),
                    )
                  }
                  aria-label={t('access.providers.linkNamed', { provider: name(provider) })}
                >
                  {t('access.providers.link')}
                </AdminButton>
              )}
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="m-0 text-[13px] text-ink-3">{t('access.providers.none')}</p>
    );
  }

  return (
    <AdminSection title={t('access.providers.title')}>
      <AdminCard pad>
        <div className="flex flex-col gap-3">
          <ErrorAlert error={failure} />
          {body}
        </div>
      </AdminCard>
      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && unlink.mutate(removing)}
        title={t('access.providers.confirmTitle')}
        itemName={removing ? name(removing) : ''}
        message={t('access.providers.confirmText')}
        confirmLabel={t('access.providers.unlink')}
        cancelLabel={t('common.cancel')}
        busy={unlink.isPending}
        busyLabel={t('access.providers.unlinking')}
      />
    </AdminSection>
  );
}

/** Mensagem do `?erro=` da volta do vínculo (spec 007, "Fluxo do provedor"). */
export function linkErrorKey(code: string) {
  switch (code) {
    case 'identity_in_use':
    case 'oauth_denied':
    case 'oauth_state_invalid':
    case 'oauth_provider_error':
    case 'account_suspended':
      return `login.oauth.codes.${code}` as const;
    default:
      return 'login.oauth.codes.unknown' as const;
  }
}
