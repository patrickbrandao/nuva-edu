import {
  AdminButton,
  ErrorState,
  LoadingState,
  PageTitle,
  TextLink,
  TopicCard,
} from '@nuva-edu/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useRelativeTime } from '../notifications/format';
import { RequireSession } from '../session/RequireSession';
import { Composer } from './Composer';
import {
  type Filter,
  forumError,
  type Kind,
  useCategories,
  useForumMutation,
  useMyReports,
  useTopics,
} from './queries';

export const topicPath = (id: string) => `/forum/t/${encodeURIComponent(id)}`;

export function ForumPage() {
  return (
    <RequireSession>
      {(session) => <ForumHome verified={session.user.emailVerified} />}
    </RequireSession>
  );
}

function ForumHome({ verified }: { verified: boolean }) {
  const { t } = useTranslation();
  const relative = useRelativeTime();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const selectedId = params.get('categoria') ?? '';
  const [draft, setDraft] = useState(search);
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [writing, setWriting] = useState(false);
  const categories = useCategories();
  const items = categories.data?.pages.flatMap((page) => page.items) ?? [];
  const categoryId = selectedId || (search ? '' : (items[0]?.id ?? ''));
  const topics = useTopics(categoryId, search, kind, filter);
  const mutation = useForumMutation<string>();

  const select = (id: string, q = search) => {
    const next = new URLSearchParams();
    if (id) next.set('categoria', id);
    if (q) next.set('q', q);
    setParams(next);
    setWriting(false);
    mutation.reset();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>{t('forum.title')}</PageTitle>
        <TextLink href="/forum/denuncias">{t('forum.reports')}</TextLink>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          select(selectedId, draft.trim());
        }}
      >
        <label className="flex flex-col gap-1">
          {t('forum.category')}
          <select
            value={categoryId}
            onChange={(event) => select(event.target.value)}
            className="rounded border border-line bg-surface p-2"
          >
            {search ? <option value="">{t('forum.allCategories')}</option> : null}
            {items.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {categories.hasNextPage ? (
          <AdminButton onClick={() => void categories.fetchNextPage()}>
            {t('forum.more')}
          </AdminButton>
        ) : null}
        <label className="flex flex-col gap-1">
          {t('forum.search')}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            type="search"
            maxLength={200}
            className="rounded border border-line bg-surface p-2"
          />
        </label>
        <AdminButton type="submit">{t('forum.searchButton')}</AdminButton>
      </form>
      {categoryId && !search ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            {t('forum.kind')}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as Kind)}
              className="rounded border border-line bg-surface p-2"
            >
              {(['all', 'lessons', 'discussions'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`forum.kinds.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t('forum.filter')}
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
              className="rounded border border-line bg-surface p-2"
            >
              {(['all', 'unanswered', 'solved', 'unsolved', 'following'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`forum.filters.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {verified && !writing ? (
            <AdminButton onClick={() => setWriting(true)}>{t('forum.newTopic')}</AdminButton>
          ) : null}
        </div>
      ) : null}
      {writing ? (
        <Composer
          key={categoryId}
          categoryId={categoryId}
          title=""
          label={t('forum.newTopic')}
          busy={mutation.isPending}
          error={mutation.error ? forumError(t, mutation.error) : undefined}
          onCancel={() => setWriting(false)}
          onSubmit={(bodyMd, title) =>
            mutation.mutate(
              async (api) => {
                const { data } = await api.POST('/api/v1/forum/categories/{id}/topics', {
                  params: { path: { id: categoryId } },
                  body: { title, bodyMd },
                });
                if (!data) throw new Error('O fórum não devolveu o tópico criado.');
                return data.topic.id;
              },
              { onSuccess: (id) => navigate(topicPath(id)) },
            )
          }
        />
      ) : null}
      {categories.isLoading || topics.isLoading ? (
        <LoadingState label={t('forum.loading')} />
      ) : categories.isError || topics.isError ? (
        <ErrorState title={t('forum.error')} />
      ) : (topics.data?.pages.flatMap((page) => page.items) ?? []).length === 0 ? (
        <p>{t('forum.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {topics.data?.pages
            .flatMap((page) => page.items)
            .map((topic) => (
              <TopicCard
                key={topic.id}
                topic={{
                  ...topic,
                  author: { name: topic.author.displayName },
                  href: topicPath(topic.id),
                  solved: topic.solutionPostId !== null,
                }}
                labels={{
                  pinned: t('forum.pinned'),
                  solved: t('forum.solved'),
                  statuses: {
                    open: t('forum.statuses.open'),
                    closed: t('forum.statuses.closed'),
                    hidden: t('forum.statuses.hidden'),
                  },
                  posts: (count) => t('forum.posts', { count }),
                  author: (author) => t('forum.by', { author }),
                  lastActivity: relative,
                }}
              />
            ))}
        </div>
      )}
      {topics.hasNextPage ? (
        <AdminButton onClick={() => void topics.fetchNextPage()}>{t('forum.more')}</AdminButton>
      ) : null}
    </div>
  );
}

export function ForumReportsPage() {
  return <RequireSession>{() => <ForumReports />}</RequireSession>;
}

function ForumReports() {
  const { t } = useTranslation();
  const reports = useMyReports();
  const items = reports.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{t('forum.reports')}</PageTitle>
      <TextLink href="/forum">{t('forum.title')}</TextLink>
      {reports.isLoading ? <LoadingState label={t('forum.loading')} /> : null}
      {reports.isError ? <ErrorState title={t('forum.error')} /> : null}
      {reports.isSuccess && items.length === 0 ? <p>{t('forum.noReports')}</p> : null}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              {t(`forum.reportReasons.${item.reason}`)} ·{' '}
              {t(item.status === 'open' ? 'forum.reportOpen' : 'forum.reportReviewed')}
            </li>
          ))}
        </ul>
      ) : null}
      {reports.hasNextPage ? (
        <AdminButton onClick={() => void reports.fetchNextPage()}>{t('forum.more')}</AdminButton>
      ) : null}
    </div>
  );
}
