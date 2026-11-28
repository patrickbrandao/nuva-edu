import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminSection,
  ErrorState,
  LoadingState,
  ModerationHistory,
} from '@nuva-edu/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../api/client';
import { formatDateTime } from '../../format';
import { forumBody, forumKey, useForumAction } from '../forum/queries';

export function HistoryItems({ items }: { items: AdminSchemas['ForumModerationRecord'][] }) {
  const { t } = useTranslation();
  return (
    <ModerationHistory
      items={items.map((row) => ({
        id: row.id,
        action: t(`forumAdmin.actions.${row.action}`),
        at: row.createdAt,
        reason: row.reason,
        moderator: row.moderator.displayName,
      }))}
      labels={{
        region: t('forumAdmin.history'),
        emptyTitle: t('forumAdmin.noHistory'),
        reasonLabel: t('forumAdmin.reason'),
        moderatorLabel: t('forumAdmin.moderator'),
        time: formatDateTime,
      }}
    />
  );
}

export function UserModeration({ id, warn }: { id: string; warn: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const [draft, setDraft] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const edits = useForumAction();
  const history = useQuery({
    queryKey: [...forumKey, 'history', id, cursor],
    queryFn: async ({ signal }) =>
      forumBody(
        (
          await api.GET('/api/v1/users/{id}/moderation-history', {
            params: { path: { id }, query: { ...(cursor ? { cursor } : {}) } },
            signal,
          })
        ).data,
      ),
  });
  return (
    <AdminSection title={t('forumAdmin.history')}>
      <AdminCard pad>
        {history.isLoading ? <LoadingState label={t('forumAdmin.loading')} /> : null}
        {history.isError ? <ErrorState title={t('forumAdmin.error')} /> : null}
        {history.data ? <HistoryItems items={history.data.items} /> : null}
        {cursor ? (
          <AdminButton onClick={() => setCursor(null)}>{t('forumAdmin.first')}</AdminButton>
        ) : null}
        {history.data?.nextCursor ? (
          <AdminButton onClick={() => setCursor(history.data?.nextCursor ?? null)}>
            {t('forumAdmin.more')}
          </AdminButton>
        ) : null}
        {warn && draft === null ? (
          <AdminButton onClick={() => setDraft('')}>{t('forumAdmin.warn')}</AdminButton>
        ) : null}
        {draft !== null ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim()) return;
              edits.mutate(
                (client) =>
                  client.POST('/api/v1/users/{id}/warn', {
                    params: { path: { id } },
                    body: { reason: draft.trim() },
                  }),
                { onSuccess: () => setDraft(null) },
              );
            }}
          >
            <label>
              {t('forumAdmin.reason')}{' '}
              <textarea
                required
                maxLength={500}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            {edits.isError ? <p role="alert">{t('forumAdmin.error')}</p> : null}
            <div className="flex gap-2">
              <AdminButton type="submit" disabled={edits.isPending || !draft.trim()}>
                {t('forumAdmin.save')}
              </AdminButton>
              <AdminButton onClick={() => setDraft(null)}>{t('forumAdmin.cancel')}</AdminButton>
            </div>
          </form>
        ) : null}
      </AdminCard>
    </AdminSection>
  );
}
