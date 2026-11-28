import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  ErrorState,
  LoadingState,
  Markdown,
  PageTitle,
  TextLink,
} from '@nuva-edu/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApi } from '../../api/client';
import { useCan, useSession } from '../../session/session';
import { adminTopicPath, forumBody, forumKey, useForumAction } from './queries';

type Category = AdminSchemas['ForumCategory'];

export function AdminForumPage() {
  const { t } = useTranslation();
  const api = useApi();
  const can = useCan();
  const [search, setSearch] = useState('');
  const [q, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [categoryCursor, setCategoryCursor] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [editor, setEditor] = useState<Category | 'new' | null>(null);
  const categories = useQuery({
    queryKey: [...forumKey, 'categories', categoryCursor],
    queryFn: async ({ signal }) =>
      forumBody(
        (
          await api.GET('/api/v1/forum/categories', {
            params: { query: { ...(categoryCursor ? { cursor: categoryCursor } : {}) } },
            signal,
          })
        ).data,
      ),
  });
  const topics = useQuery({
    queryKey: [...forumKey, 'topics', q, categoryId, cursor],
    queryFn: async ({ signal }) =>
      forumBody(
        (
          await api.GET('/api/v1/forum/topics', {
            params: {
              query: {
                ...(q ? { q } : {}),
                ...(categoryId ? { categoryId } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
            signal,
          })
        ).data,
      ),
  });
  const edits = useForumAction();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>{t('forumAdmin.title')}</PageTitle>
        <TextLink href="/denuncias">{t('forumAdmin.queue')}</TextLink>
      </div>
      <AdminCard pad>
        <section className="flex flex-col gap-3">
          <h2>{t('forumAdmin.categories')}</h2>
          {can('forum.category.manage') ? (
            <AdminButton onClick={() => setEditor('new')}>
              {t('forumAdmin.newCategory')}
            </AdminButton>
          ) : null}
          {editor ? (
            <CategoryEditor
              key={editor === 'new' ? 'new' : editor.id}
              category={editor === 'new' ? null : editor}
              onClose={() => setEditor(null)}
            />
          ) : null}
          {categories.isLoading ? <LoadingState label={t('forumAdmin.loading')} /> : null}
          {categories.isError ? <ErrorState title={t('forumAdmin.error')} /> : null}
          <ul className="flex flex-col gap-2">
            {categories.data?.items.map((category) => (
              <li key={category.id} className="flex flex-wrap items-center gap-3">
                <strong>{category.name}</strong>
                {category.archivedAt ? <span>{t('forumAdmin.archived')}</span> : null}
                {category.kind === 'free' && can('forum.category.manage') ? (
                  <>
                    <AdminButton onClick={() => setEditor(category)}>
                      {t('forumAdmin.editCategory')}
                    </AdminButton>
                    <AdminButton
                      disabled={edits.isPending}
                      onClick={() =>
                        edits.mutate((client) =>
                          client.PATCH('/api/v1/forum/categories/{id}', {
                            params: { path: { id: category.id } },
                            body: { archived: category.archivedAt === null },
                          }),
                        )
                      }
                    >
                      {t(category.archivedAt ? 'forumAdmin.restore' : 'forumAdmin.archive')}
                    </AdminButton>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {categoryCursor ? (
            <AdminButton onClick={() => setCategoryCursor(null)}>
              {t('forumAdmin.first')}
            </AdminButton>
          ) : null}
          {categories.data?.nextCursor ? (
            <AdminButton onClick={() => setCategoryCursor(categories.data?.nextCursor ?? null)}>
              {t('forumAdmin.more')}
            </AdminButton>
          ) : null}
        </section>
      </AdminCard>
      <AdminCard pad>
        <section className="flex flex-col gap-3">
          <h2>{t('forumAdmin.list')}</h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
              setCursor(null);
            }}
          >
            <label className="flex flex-col gap-1">
              {t('forumAdmin.search')}
              <input
                className="rounded border border-line bg-surface p-2"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
                maxLength={200}
              />
            </label>
            <label className="flex flex-col gap-1">
              {t('forumAdmin.categories')}
              <select
                className="rounded border border-line bg-surface p-2"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setCursor(null);
                }}
              >
                <option value="">{t('forumAdmin.allCategories')}</option>
                {categories.data?.items.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <AdminButton type="submit">{t('forumAdmin.apply')}</AdminButton>
          </form>
          {topics.isLoading ? <LoadingState label={t('forumAdmin.loading')} /> : null}
          {topics.isError ? <ErrorState title={t('forumAdmin.error')} /> : null}
          {topics.data?.items.length === 0 ? <p>{t('forumAdmin.empty')}</p> : null}
          <ul>
            {topics.data?.items.map((topic) => (
              <li key={topic.id}>
                <TextLink href={adminTopicPath(topic.id)}>{topic.title}</TextLink> ·{' '}
                {topic.author.displayName}
              </li>
            ))}
          </ul>
          {cursor ? (
            <AdminButton onClick={() => setCursor(null)}>{t('forumAdmin.first')}</AdminButton>
          ) : null}
          {topics.data?.nextCursor ? (
            <AdminButton onClick={() => setCursor(topics.data?.nextCursor ?? null)}>
              {t('forumAdmin.more')}
            </AdminButton>
          ) : null}
        </section>
      </AdminCard>
    </div>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const { t } = useTranslation();
  const edits = useForumAction();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [audience, setAudience] = useState<'all' | 'active'>(category?.audience ?? 'all');
  const [position, setPosition] = useState(category?.position ?? 0);

  return (
    <form
      aria-label={t(category ? 'forumAdmin.editCategory' : 'forumAdmin.newCategory')}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const body = {
          name: name.trim(),
          description: description.trim() || null,
          audience,
          position,
        };
        edits.mutate(
          (api) =>
            category
              ? api.PATCH('/api/v1/forum/categories/{id}', {
                  params: { path: { id: category.id } },
                  body,
                })
              : api.POST('/api/v1/forum/categories', { body }),
          { onSuccess: onClose },
        );
      }}
    >
      <label className="flex flex-col gap-1">
        {t('forumAdmin.name')}
        <input
          required
          maxLength={160}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-line bg-surface p-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        {t('forumAdmin.description')}
        <textarea
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded border border-line bg-surface p-2"
        />
      </label>
      <label>
        {t('forumAdmin.audience')}{' '}
        <select
          value={audience}
          onChange={(event) => setAudience(event.target.value as 'all' | 'active')}
        >
          <option value="all">{t('forumAdmin.all')}</option>
          <option value="active">{t('forumAdmin.active')}</option>
        </select>
      </label>
      <label>
        {t('forumAdmin.position')}{' '}
        <input
          type="number"
          min={0}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
        />
      </label>
      {edits.isError ? <p role="alert">{t('forumAdmin.error')}</p> : null}
      <div className="flex gap-2">
        <AdminButton type="submit" disabled={edits.isPending || !name.trim()}>
          {t('forumAdmin.save')}
        </AdminButton>
        <AdminButton onClick={onClose}>{t('forumAdmin.cancel')}</AdminButton>
      </div>
    </form>
  );
}

export function AdminForumTopicPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const api = useApi();
  const actor = useSession();
  const edits = useForumAction();
  const [reason, setReason] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const topic = useQuery({
    queryKey: [...forumKey, 'topic', id],
    queryFn: async ({ signal }) =>
      forumBody(
        (
          await api.GET('/api/v1/forum/topics/{id}', {
            params: { path: { id } },
            signal,
          })
        ).data,
      ),
  });
  const posts = useQuery({
    queryKey: [...forumKey, 'topic-posts', id, cursor],
    queryFn: async ({ signal }) =>
      forumBody(
        (
          await api.GET('/api/v1/forum/topics/{id}/posts', {
            params: { path: { id }, query: { ...(cursor ? { cursor } : {}) } },
            signal,
          })
        ).data,
      ),
  });
  const categories = useQuery({
    queryKey: [...forumKey, 'categories', null],
    enabled: actor.user.role !== 'instructor',
    queryFn: async ({ signal }) =>
      forumBody((await api.GET('/api/v1/forum/categories', { signal })).data),
  });
  if (topic.isLoading) return <LoadingState label={t('forumAdmin.loading')} />;
  if (!topic.data) return <ErrorState title={t('forumAdmin.error')} />;
  const data = topic.data.topic;
  const patch = (body: AdminSchemas['ModerateForumTopic']) =>
    edits.mutate((client) =>
      client.PATCH('/api/v1/forum/topics/{id}', { params: { path: { id } }, body }),
    );
  return (
    <div className="flex flex-col gap-4">
      <TextLink href="/forum">{t('forumAdmin.title')}</TextLink>
      <PageTitle>{data.title}</PageTitle>
      <p>
        {t('forumAdmin.author')}: {data.author.displayName} · {t('forumAdmin.state')}:{' '}
        {t(`forumAdmin.${data.status}`)}
      </p>
      <Markdown html={topic.data.bodyHtml} />
      <div className="flex flex-wrap gap-2">
        <AdminButton onClick={() => patch({ pinned: !data.pinned })}>
          {t(data.pinned ? 'forumAdmin.unpin' : 'forumAdmin.pin')}
        </AdminButton>
        <AdminButton onClick={() => patch({ closed: data.status !== 'closed' })}>
          {t(data.status === 'closed' ? 'forumAdmin.reopen' : 'forumAdmin.close')}
        </AdminButton>
        <label>
          {t('forumAdmin.reason')}{' '}
          <input
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <AdminButton
          disabled={!reason.trim()}
          onClick={() => patch({ hidden: data.status !== 'hidden', reason: reason.trim() })}
        >
          {t(data.status === 'hidden' ? 'forumAdmin.unhide' : 'forumAdmin.hide')}
        </AdminButton>
      </div>
      {data.lessonId === null && actor.user.role !== 'instructor' ? (
        <div className="flex flex-wrap gap-2">
          <label>
            {t('forumAdmin.moved')}{' '}
            <select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
              <option value="">{t('forumAdmin.categories')}</option>
              {categories.data?.items
                .filter((category) => category.id !== data.categoryId && !category.archivedAt)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
          <AdminButton disabled={!moveTo} onClick={() => patch({ categoryId: moveTo })}>
            {t('forumAdmin.save')}
          </AdminButton>
        </div>
      ) : null}
      {edits.isError || posts.isError ? <ErrorState title={t('forumAdmin.error')} /> : null}
      {posts.data?.items.map((post) => (
        <AdminCard key={post.id} pad>
          <strong>{post.author.displayName}</strong>
          {post.hiddenAt ? <p>{t('forumAdmin.hidden')}</p> : null}
          <Markdown html={post.bodyHtml} />
          {post.deletedAt === null ? (
            <AdminButton
              disabled={!reason.trim() || edits.isPending}
              onClick={() =>
                edits.mutate((client) =>
                  client.POST('/api/v1/moderation/actions', {
                    body: {
                      action: post.hiddenAt ? 'unhide' : 'hide',
                      targetType: 'forum_post',
                      targetId: post.id,
                      reason: reason.trim(),
                    },
                  }),
                )
              }
            >
              {t(post.hiddenAt ? 'forumAdmin.unhidePost' : 'forumAdmin.hidePost')}
            </AdminButton>
          ) : null}
          {data.lessonId === null && post.deletedAt === null && post.hiddenAt === null ? (
            <AdminButton
              onClick={() =>
                patch({ solutionPostId: data.solutionPostId === post.id ? null : post.id })
              }
            >
              {t(
                data.solutionPostId === post.id
                  ? 'forumAdmin.clearSolution'
                  : 'forumAdmin.solution',
              )}
            </AdminButton>
          ) : null}
        </AdminCard>
      ))}
      {cursor ? (
        <AdminButton onClick={() => setCursor(null)}>{t('forumAdmin.first')}</AdminButton>
      ) : null}
      {posts.data?.nextCursor ? (
        <AdminButton onClick={() => setCursor(posts.data?.nextCursor ?? null)}>
          {t('forumAdmin.more')}
        </AdminButton>
      ) : null}
    </div>
  );
}
