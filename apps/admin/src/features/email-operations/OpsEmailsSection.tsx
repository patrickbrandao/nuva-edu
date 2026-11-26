import {
  AdminButton,
  AdminEmpty,
  AdminSection,
  AdminTable,
  AdminTabs,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useOpsError } from './format';
import {
  EMAIL_STATUSES,
  type OpsEmail,
  type OpsEmailStatus,
  opsKeys,
  retryOpsEmail,
  useOpsEmails,
} from './queries';

/**
 * E-mails pendentes e com falha (spec 024, "E-mail"; spec 033, "Tela Operação"): o destinatário
 * já vem mascarado da API, o assunto aparece quando o envio o montou e o último erro é o motivo
 * do SMTP. "Reenviar" devolve o e-mail com falha à fila; a API recusa `409 email_not_failed` se
 * ele não estiver nesse estado.
 */
export function OpsEmailsSection() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useOpsError();
  const [status, setStatus] = useState<OpsEmailStatus>('failed');
  const list = useOpsEmails(status);
  const emails = list.data?.pages.flatMap((page) => page.items) ?? [];

  const retry = useAction((id: string) => retryOpsEmail(api, id));

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: opsKeys.emails('failed') }),
      queryClient.invalidateQueries({ queryKey: opsKeys.emails('queued') }),
      queryClient.invalidateQueries({ queryKey: opsKeys.summary() }),
    ]);
  };

  const onRetry = async (email: OpsEmail) => {
    const result = await retry.run(email.id);
    if (!result.ok) {
      toast.error(message(result.error), { title: t('operations.emails.retryError') });
      return;
    }
    toast.success(t('operations.emails.retried'));
    await refresh();
  };

  const columns = [
    {
      id: 'type',
      label: t('operations.emails.columns.type'),
      render: (email: OpsEmail) => email.type,
    },
    {
      id: 'to',
      label: t('operations.emails.columns.to'),
      render: (email: OpsEmail) => <span className="font-mono text-xs">{email.to}</span>,
    },
    {
      id: 'subject',
      label: t('operations.emails.columns.subject'),
      render: (email: OpsEmail) =>
        email.subject ?? (
          <span className="text-ink-3">{t('operations.emails.columns.noSubject')}</span>
        ),
    },
    {
      id: 'attempts',
      label: t('operations.emails.columns.attempts'),
      render: (email: OpsEmail) => String(email.attempts),
    },
    {
      id: 'lastError',
      label: t('operations.emails.columns.lastError'),
      render: (email: OpsEmail) =>
        email.lastError ?? (
          <span className="text-ink-3">{t('operations.emails.columns.none')}</span>
        ),
    },
    {
      id: 'createdAt',
      label: t('operations.emails.columns.createdAt'),
      render: (email: OpsEmail) => formatDateTime(email.createdAt),
    },
    {
      id: 'actions',
      label: t('operations.emails.columns.actions'),
      render: (email: OpsEmail) =>
        email.status === 'failed' ? (
          <AdminButton
            size="sm"
            icon={<Send size={14} aria-hidden="true" />}
            disabled={retry.busy}
            onClick={() => void onRetry(email)}
          >
            {t('operations.emails.retry')}
          </AdminButton>
        ) : null,
    },
  ];

  return (
    <AdminSection title={t('operations.emails.title')}>
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">{t('operations.emails.text')}</p>
      <AdminTabs
        label={t('operations.emails.tabs')}
        value={status}
        onChange={(id: string) => setStatus(id as OpsEmailStatus)}
        tabs={EMAIL_STATUSES.map((id) => ({ id, label: t(`operations.emails.status.${id}`) }))}
      />
      {list.isPending ? (
        <LoadingState label={t('operations.emails.loading')} />
      ) : list.isError && emails.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('operations.emails.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={emails}
            empty={
              <AdminEmpty
                title={t('operations.emails.empty')}
                text={t('operations.emails.emptyText')}
              />
            }
          />
          {list.hasNextPage ? (
            <AdminButton
              className="mt-3"
              disabled={list.isFetchingNextPage}
              aria-busy={list.isFetchingNextPage || undefined}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
            </AdminButton>
          ) : null}
        </>
      )}
    </AdminSection>
  );
}
