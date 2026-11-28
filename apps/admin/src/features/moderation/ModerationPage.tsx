import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  ErrorState,
  LoadingState,
  PageTitle,
  ReportedContent,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApi } from '../../api/client';
import { formatDateTime } from '../../format';
import { useCan, useSession } from '../../session/session';
import { adminTopicPath, forumBody, forumKey, reportPath, useForumAction } from '../forum/queries';
import { HistoryItems } from './UserModeration';

const reasons = [
  'spam',
  'harassment',
  'inappropriate',
  'piracy',
  'personal_data',
  'other',
] as const;
type Reason = AdminSchemas['ReportReason'];
type State = AdminSchemas['ReportState'];
type Target = AdminSchemas['ReportTargetType'];
type Action = AdminSchemas['ForumModerationActionRequest']['action'] | 'warn' | 'suspend';

export function ModerationPage() {
  const { t } = useTranslation();
  const api = useApi();
  const [status, setStatus] = useState<State>('open');
  const [reason, setReason] = useState<Reason | ''>('');
  const [targetType, setTarget] = useState<Target | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const queue = useQuery({
    queryKey: [...forumKey, 'queue', status, reason, targetType, cursor],
    queryFn: async ({ signal }) =>
      forumBody(
        (
          await api.GET('/api/v1/moderation/queue', {
            params: {
              query: {
                status,
                ...(reason ? { reason } : {}),
                ...(targetType ? { targetType } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
            signal,
          })
        ).data,
      ),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{t('forumAdmin.queue')}</PageTitle>
      <div className="flex flex-wrap gap-3">
        <label>
          {t('forumAdmin.state')}{' '}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as State);
              setCursor(null);
            }}
          >
            {(['open', 'resolved', 'dismissed'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`forumAdmin.states.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('forumAdmin.reason')}{' '}
          <select
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as Reason | '');
              setCursor(null);
            }}
          >
            <option value="">{t('forumAdmin.anyReason')}</option>
            {reasons.map((value) => (
              <option key={value} value={value}>
                {t(`forumAdmin.reasons.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('forumAdmin.type')}{' '}
          <select
            value={targetType}
            onChange={(event) => {
              setTarget(event.target.value as Target | '');
              setCursor(null);
            }}
          >
            <option value="">{t('forumAdmin.anyType')}</option>
            <option value="forum_topic">{t('forumAdmin.topic')}</option>
            <option value="forum_post">{t('forumAdmin.post')}</option>
          </select>
        </label>
      </div>
      {queue.isLoading ? <LoadingState label={t('forumAdmin.loading')} /> : null}
      {queue.isError ? <ErrorState title={t('forumAdmin.error')} /> : null}
      {queue.data?.items.length === 0 ? <p>{t('forumAdmin.emptyQueue')}</p> : null}
      {queue.data?.items.map((item) => (
        <AdminCard key={item.targetId} pad>
          <TextLink href={reportPath(item.targetType, item.targetId)}>{item.title}</TextLink>
          <p>
            {item.author.displayName} · {t('forumAdmin.reporters', { count: item.reporterCount })}
            {item.hidden ? ` · ${t('forumAdmin.hidden')}` : ''}
          </p>
        </AdminCard>
      ))}
      {cursor ? (
        <AdminButton onClick={() => setCursor(null)}>{t('forumAdmin.first')}</AdminButton>
      ) : null}
      {queue.data?.nextCursor ? (
        <AdminButton onClick={() => setCursor(queue.data?.nextCursor ?? null)}>
          {t('forumAdmin.more')}
        </AdminButton>
      ) : null}
    </div>
  );
}

export function ModerationDetailPage() {
  const { targetType = '', targetId = '' } = useParams();
  if (targetType !== 'forum_topic' && targetType !== 'forum_post') return <ModerationMissing />;
  return <ModerationTarget key={targetId} targetType={targetType} targetId={targetId} />;
}

function ModerationMissing() {
  const { t } = useTranslation();
  return <ErrorState title={t('forumAdmin.error')} />;
}

function ModerationTarget({ targetType, targetId }: { targetType: Target; targetId: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const can = useCan();
  const actor = useSession();
  const toast = useToast();
  const edits = useForumAction();
  const [action, setAction] = useState<Action | ''>('');
  const [reason, setReason] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'posting' | 'full'>('posting');
  const [duration, setDuration] = useState<1 | 7 | 30 | null>(7);
  const target = useQuery({
    queryKey: [...forumKey, 'report', targetType, targetId],
    queryFn: async ({ signal }) =>
      forumBody(
        (
          await api.GET('/api/v1/moderation/queue/{targetType}/{targetId}', {
            params: { path: { targetType, targetId } },
            signal,
          })
        ).data,
      ),
  });
  if (target.isLoading) return <LoadingState label={t('forumAdmin.loading')} />;
  if (!target.data) return <ModerationMissing />;
  const { item, reports, bodyHtml, history } = target.data;
  const instructor = actor.user.role === 'instructor';
  const userId = item.author.id;
  const restricted = !userId || userId === actor.user.id || !can('users.suspend');
  const options: Action[] = [item.hidden ? 'unhide' : 'hide'];
  if (targetType === 'forum_topic') options.push('close');
  if (!instructor) options.push('dismiss', 'edit');
  if (!restricted) options.push('warn', 'suspend');

  const actionName = (act: Action) => {
    if (act === 'dismiss') return t('forumAdmin.discard');
    return t(`forumAdmin.${act}`);
  };

  const submit = () => {
    if (!action || !reason.trim()) return;
    const cleaned = reason.trim();
    edits.mutate(
      async (client) => {
        if (action === 'warn' && userId) {
          return client.POST('/api/v1/users/{id}/warn', {
            params: { path: { id: userId } },
            body: { reason: cleaned },
          });
        }
        if (action === 'suspend' && userId) {
          return client.POST('/api/v1/users/{id}/suspend', {
            params: { path: { id: userId } },
            body: { reason: cleaned, kind, durationDays: duration },
          });
        }
        if (action === 'warn' || action === 'suspend') return;
        return client.POST('/api/v1/moderation/actions', {
          body: {
            action,
            targetType,
            targetId,
            reason: cleaned,
            ...(action === 'edit' ? { bodyMd: body.trim() } : {}),
          },
        });
      },
      {
        onSuccess: () => {
          setAction('');
          setReason('');
          setBody('');
          toast.success(t('forumAdmin.success'));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <TextLink href="/denuncias">{t('forumAdmin.queue')}</TextLink>
      <PageTitle>{t('forumAdmin.reportedContent')}</PageTitle>
      <ReportedContent
        target={{
          id: targetId,
          title: item.title,
          kindLabel: t(targetType === 'forum_topic' ? 'forumAdmin.topic' : 'forumAdmin.post'),
          bodyHtml,
          author: { name: item.author.displayName },
          context: <TextLink href={adminTopicPath(item.topicId)}>{item.title}</TextLink>,
          reportsCount: item.reporterCount,
          reporters: reports.flatMap((report) =>
            report.reporter ? [{ name: report.reporter.displayName }] : [],
          ),
          reasons: reasons.flatMap((value) => {
            const count = reports.filter((report) => report.reason === value).length;
            return count ? [{ label: t(`forumAdmin.reasons.${value}`), count }] : [];
          }),
        }}
        labels={{
          region: t('forumAdmin.reportedContent'),
          reports: (count) => t('forumAdmin.reporters', { count }),
          authorLabel: t('forumAdmin.author'),
          reporterList: t('forumAdmin.reporterList'),
          reasonsLabel: t('forumAdmin.reason'),
          contextLabel: t('forumAdmin.context'),
        }}
      />
      <AdminCard pad>
        <section className="flex flex-col gap-2" aria-label={t('forumAdmin.reporterList')}>
          <h2>{t('forumAdmin.reporterList')}</h2>
          <ul className="flex flex-col gap-1">
            {reports.map((report) => (
              <li key={report.id}>
                <strong>{report.reporter?.displayName ?? t('forumAdmin.removedReporter')}</strong>
                {' · '}
                {t(`forumAdmin.reasons.${report.reason}`)}
                {' · '}
                <time dateTime={report.createdAt}>{formatDateTime(report.createdAt)}</time>
                {report.details ? <p>{report.details}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      </AdminCard>
      <AdminCard pad>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
              <AdminButton
                key={option}
                type="button"
                onClick={() => {
                  setAction(option);
                  edits.reset();
                }}
              >
                {actionName(option)}
              </AdminButton>
            ))}
          </div>
          {action ? (
            <>
              <h2>{actionName(action)}</h2>
              <label className="flex flex-col gap-1">
                {t('forumAdmin.reason')}
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  maxLength={action === 'warn' || action === 'suspend' ? 500 : 2000}
                />
              </label>
              {action === 'edit' ? (
                <label className="flex flex-col gap-1">
                  {t('forumAdmin.body')}
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={20000}
                    required
                  />
                </label>
              ) : null}
              {action === 'suspend' ? (
                <div className="flex gap-3">
                  <label>
                    {t('forumAdmin.type')}{' '}
                    <select
                      value={kind}
                      onChange={(event) => setKind(event.target.value as 'posting' | 'full')}
                    >
                      <option value="posting">{t('forumAdmin.posting')}</option>
                      <option value="full">{t('forumAdmin.full')}</option>
                    </select>
                  </label>
                  <label>
                    {t('forumAdmin.days')}{' '}
                    <select
                      value={duration ?? ''}
                      onChange={(event) => {
                        setDuration(
                          event.target.value ? (Number(event.target.value) as 1 | 7 | 30) : null,
                        );
                      }}
                    >
                      {([1, 7, 30] as const).map((days) => (
                        <option key={days} value={days}>
                          {t('forumAdmin.dayCount', { count: days })}
                        </option>
                      ))}
                      <option value="">{t('forumAdmin.forever')}</option>
                    </select>
                  </label>
                </div>
              ) : null}
              <div className="flex gap-2">
                <AdminButton
                  type="submit"
                  disabled={
                    edits.isPending || !reason.trim() || (action === 'edit' && !body.trim())
                  }
                >
                  {t('forumAdmin.save')}
                </AdminButton>
                <AdminButton onClick={() => setAction('')}>{t('forumAdmin.cancel')}</AdminButton>
              </div>
            </>
          ) : null}
          {edits.isError ? <p role="alert">{t('forumAdmin.error')}</p> : null}
        </form>
      </AdminCard>
      <HistoryItems items={history} />
    </div>
  );
}
