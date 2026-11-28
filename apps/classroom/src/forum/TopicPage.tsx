import type { ClassroomClient, ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  Markdown,
  PostCard,
  type ReactionEmoji,
  Reactions,
  ReportDialog,
  TextLink,
  TopicHeader,
  useToast,
} from '@nuva-edu/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router';
import { productPath, useDateFormatter } from '../catalog/format';
import { RequireSession } from '../session/RequireSession';
import { useSession } from '../session/session';
import { Composer } from './Composer';
import { topicPath } from './ForumPage';
import {
  forumError,
  type Post,
  useForumMutation,
  useLessonTopic,
  usePosts,
  useTopic,
} from './queries';

type Target = { kind: 'forum_topic' | 'forum_post'; id: string };
type EditorState = { kind: 'reply' | 'topic' | 'post'; post?: Post };
type ReplyAction = (api: ClassroomClient) => Promise<unknown>;

function ReactionBar({
  reactions,
  disabled,
  onToggle,
}: {
  reactions: ClassroomSchemas['ForumReactions'];
  disabled: boolean;
  onToggle: (emoji: ReactionEmoji, reacted: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Reactions
      reactions={reactions.map((item) => ({
        emoji: item.emoji,
        count: item.count,
        mine: item.reacted,
      }))}
      disabled={disabled}
      onToggle={(emoji) =>
        onToggle(
          emoji,
          reactions.some((item) => item.emoji === emoji && item.reacted),
        )
      }
      labels={{
        region: t('forum.reactions'),
        names: {
          like: t('forum.reactionNames.like'),
          heart: t('forum.reactionNames.heart'),
          celebrate: t('forum.reactionNames.celebrate'),
          laugh: t('forum.reactionNames.laugh'),
          think: t('forum.reactionNames.think'),
          eyes: t('forum.reactionNames.eyes'),
        },
        button: (name, count) => t('forum.reactionCount', { name, count }),
      }}
    />
  );
}

function reactionAction(target: Target, emoji: ReactionEmoji, reacted: boolean): ReplyAction {
  const path =
    target.kind === 'forum_topic'
      ? '/api/v1/forum/topics/{id}/reactions/{emoji}'
      : '/api/v1/forum/posts/{id}/reactions/{emoji}';
  const options = { params: { path: { id: target.id, emoji } } };
  return (api) => (reacted ? api.DELETE(path, options) : api.PUT(path, options));
}

export function ForumTopicPage() {
  const { id = '' } = useParams();
  return <RequireSession>{() => <Discussion key={id} id={id} />}</RequireSession>;
}

export function LessonComments({ lessonId, courseSlug }: { lessonId: string; courseSlug: string }) {
  const { t } = useTranslation();
  const lesson = useLessonTopic(lessonId);
  if (lesson.isLoading) return <LoadingState label={t('forum.loading')} />;
  if (!lesson.data) return <p>{t('forum.noComments')}</p>;
  const { topicId, canRead, postsCount } = lesson.data;
  if (!canRead || topicId === null) {
    return (
      <div className="flex flex-col gap-2">
        <strong>{t('forum.posts', { count: postsCount })}</strong>
        <p>{t('forum.sample')}</p>
        <TextLink href={productPath('course', courseSlug)}>{t('forum.getCourse')}</TextLink>
      </div>
    );
  }
  return <Discussion key={topicId} id={topicId} embedded />;
}

export function Discussion({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const { t } = useTranslation();
  const date = useDateFormatter();
  const { session } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [report, setReport] = useState<Target | null>(null);
  const [removing, setRemoving] = useState<Target | null>(null);
  const detail = useTopic(id);
  const posts = usePosts(id, detail.isSuccess);
  const changes = useForumMutation();
  const { hash } = useLocation();
  const loadedPosts = posts.data?.pages.length ?? 0;

  // Link de notificação (`#post-<id>`): as respostas chegam depois da página, então a rolagem
  // até a resposta citada acontece quando elas carregam.
  useEffect(() => {
    if (embedded || loadedPosts === 0 || !hash.startsWith('#post-')) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [embedded, hash, loadedPosts]);

  if (detail.isLoading) return <LoadingState label={t('forum.loading')} />;
  if (!detail.data || detail.isError) return <ErrorState title={t('forum.error')} />;
  const { topic, bodyHtml, bodyMd, canWrite } = detail.data;
  const replies = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const userId = session?.user.id;
  const topicOwner = topic.author.id === userId;
  const staff = session?.user.role === 'admin' || session?.user.role === 'manager';
  const canSolve = Boolean(
    (topicOwner || staff) && topic.lessonId === null && topic.status !== 'hidden',
  );
  const topicTarget = { kind: 'forum_topic', id } as const;
  const error = changes.error ? forumError(t, changes.error) : undefined;
  const setMode = (value: EditorState | null) => {
    changes.reset();
    setEditor(value);
  };

  const send = (body: string, title: string) => {
    if (!editor) return;
    changes.mutate(
      (api) => {
        const path = { id };
        if (editor.kind === 'topic')
          return api.PATCH('/api/v1/forum/topics/{id}', {
            params: { path },
            body: { title, bodyMd: body },
          });
        if (editor.kind === 'post' && editor.post)
          return api.PATCH('/api/v1/forum/posts/{id}', {
            params: { path: { id: editor.post.id } },
            body: { bodyMd: body },
          });
        return api.POST('/api/v1/forum/topics/{id}/posts', {
          params: { path },
          body: { bodyMd: body, ...(editor.post ? { parentPostId: editor.post.id } : {}) },
        });
      },
      { onSuccess: () => setEditor(null) },
    );
  };

  const reportOn = (target: Target) => {
    changes.reset();
    setReport(target);
  };
  const deleteTarget = () => {
    if (!removing) return;
    const url =
      removing.kind === 'forum_topic' ? '/api/v1/forum/topics/{id}' : '/api/v1/forum/posts/{id}';
    changes.mutate((api) => api.DELETE(url, { params: { path: { id: removing.id } } }), {
      onSuccess: () => {
        setRemoving(null);
        if (removing.kind === 'forum_topic') navigate('/forum');
      },
    });
  };

  const oneReply = (post: Post) => {
    const own = post.author.id === userId;
    const available = post.hiddenAt === null && post.deletedAt === null;
    const target = { kind: 'forum_post', id: post.id } as const;
    return (
      <div key={post.id} className={post.parentPostId ? 'ms-4' : ''}>
        <PostCard
          post={{
            id: post.id,
            author: { name: post.author.displayName },
            createdAt: post.createdAt,
            bodyHtml: post.bodyHtml,
            editedAt: post.editedAt,
            deleted: post.deletedAt !== null,
            hidden: post.hiddenAt !== null,
            solution: topic.solutionPostId === post.id,
          }}
          labels={{
            time: (at) => date(at),
            edited: (at) =>
              post.moderatedAt ? t('forum.moderated') : t('forum.edited', { date: date(at) }),
            solution: t('forum.solved'),
            hidden: t('forum.hidden'),
            deleted: t('forum.deleted'),
            newTabLabel: t('common.newTab'),
          }}
          actions={
            available ? (
              <>
                {canWrite && post.parentPostId === null ? (
                  <AdminButton onClick={() => setMode({ kind: 'reply', post })}>
                    {t('forum.reply')}
                  </AdminButton>
                ) : null}
                {own && post.bodyMd !== undefined ? (
                  <>
                    <AdminButton onClick={() => setMode({ kind: 'post', post })}>
                      {t('forum.edit')}
                    </AdminButton>
                    <AdminButton onClick={() => setRemoving(target)}>
                      {t('forum.remove')}
                    </AdminButton>
                  </>
                ) : !own ? (
                  <AdminButton onClick={() => reportOn(target)}>{t('forum.report')}</AdminButton>
                ) : null}
                {canSolve ? (
                  <AdminButton
                    onClick={() =>
                      changes.mutate((api) =>
                        api.PUT('/api/v1/forum/topics/{id}/solution', {
                          params: { path: { id } },
                          body: { postId: topic.solutionPostId === post.id ? null : post.id },
                        }),
                      )
                    }
                  >
                    {t(topic.solutionPostId === post.id ? 'forum.undoSolution' : 'forum.solution')}
                  </AdminButton>
                ) : null}
              </>
            ) : undefined
          }
          reactions={
            available ? (
              <ReactionBar
                reactions={post.reactions}
                disabled={!canWrite || changes.isPending}
                onToggle={(emoji, reacted) =>
                  changes.mutate(reactionAction(target, emoji, reacted))
                }
              />
            ) : undefined
          }
        />
      </div>
    );
  };

  const solution = replies.find((post) => post.id === topic.solutionPostId);
  const regular = replies.filter((post) => post.id !== solution?.id);
  const ids = new Set(regular.filter((post) => post.parentPostId === null).map(({ id }) => id));
  const children = new Map<string, Post[]>();
  for (const post of regular) {
    if (!post.parentPostId || !ids.has(post.parentPostId)) continue;
    const group = children.get(post.parentPostId) ?? [];
    group.push(post);
    children.set(post.parentPostId, group);
  }
  const topLevel = regular.filter((post) => !post.parentPostId || !ids.has(post.parentPostId));

  return (
    <section className="flex flex-col gap-4">
      {embedded ? (
        <TextLink href={topicPath(id)}>{t('forum.topic')}</TextLink>
      ) : (
        <>
          <TextLink href="/forum">{t('forum.title')}</TextLink>
          <TopicHeader
            topic={{
              ...topic,
              author: { name: topic.author.displayName },
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
            }}
          />
          {topic.status === 'hidden' ? <p role="status">{t('forum.hidden')}</p> : null}
          <Markdown html={bodyHtml} newTabLabel={t('common.newTab')} />
          {detail.data.lessonUrl ? (
            <TextLink href={detail.data.lessonUrl}>{t('forum.playLesson')}</TextLink>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <AdminButton onClick={() => setMode({ kind: 'reply' })}>{t('forum.reply')}</AdminButton>
        ) : null}
        {topic.following || canWrite ? (
          <AdminButton
            onClick={() =>
              changes.mutate((api) => {
                const options = { params: { path: { id } } };
                return topic.following
                  ? api.DELETE('/api/v1/forum/topics/{id}/follow', options)
                  : api.PUT('/api/v1/forum/topics/{id}/follow', options);
              })
            }
          >
            {t(topic.following ? 'forum.unfollow' : 'forum.follow')}
          </AdminButton>
        ) : null}
        {topicOwner && bodyMd !== undefined ? (
          <>
            <AdminButton onClick={() => setMode({ kind: 'topic' })}>{t('forum.edit')}</AdminButton>
            <AdminButton onClick={() => setRemoving(topicTarget)}>{t('forum.remove')}</AdminButton>
          </>
        ) : !topicOwner ? (
          <AdminButton onClick={() => reportOn(topicTarget)}>{t('forum.report')}</AdminButton>
        ) : null}
      </div>
      {!embedded ? (
        <ReactionBar
          reactions={detail.data.reactions}
          disabled={!canWrite || changes.isPending}
          onToggle={(emoji, reacted) => changes.mutate(reactionAction(topicTarget, emoji, reacted))}
        />
      ) : null}
      {editor ? (
        <Composer
          key={`${editor.kind}:${editor.post?.id ?? id}`}
          title={editor.kind === 'topic' ? topic.title : undefined}
          initialBody={
            editor.kind === 'topic'
              ? bodyMd
              : editor.kind === 'post'
                ? editor.post?.bodyMd
                : undefined
          }
          categoryId={topic.categoryId}
          label={
            editor.kind !== 'reply'
              ? t('forum.save')
              : editor.post
                ? t('forum.replyTo', { author: editor.post.author.displayName })
                : t('forum.reply')
          }
          error={error}
          busy={changes.isPending}
          onCancel={() => setMode(null)}
          onSubmit={send}
        />
      ) : null}
      {error && !editor && !report ? <p role="alert">{error}</p> : null}
      {posts.isLoading ? <LoadingState label={t('forum.loading')} /> : null}
      {posts.isError ? <ErrorState title={t('forum.error')} /> : null}
      {solution ? oneReply(solution) : null}
      {topLevel.map((post) => (
        <div key={post.id} className="flex flex-col gap-3">
          {oneReply(post)}
          {children.get(post.id)?.map(oneReply)}
        </div>
      ))}
      {posts.hasNextPage ? (
        <AdminButton onClick={() => void posts.fetchNextPage()}>{t('forum.more')}</AdminButton>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        title={t('forum.removeConfirm')}
        itemName={removing?.kind === 'forum_topic' ? topic.title : ''}
        onCancel={() => setRemoving(null)}
        onConfirm={deleteTarget}
        confirmLabel={t('forum.remove')}
        cancelLabel={t('forum.cancel')}
        busy={changes.isPending}
      />
      <ReportDialog
        open={report !== null}
        onClose={() => setReport(null)}
        busy={changes.isPending}
        error={error}
        labels={{
          title: t('forum.report'),
          reasonLegend: t('forum.reportSelect'),
          reasons: {
            spam: t('forum.reportReasons.spam'),
            harassment: t('forum.reportReasons.harassment'),
            inappropriate: t('forum.reportReasons.inappropriate'),
            piracy: t('forum.reportReasons.piracy'),
            personal_data: t('forum.reportReasons.personal_data'),
            other: t('forum.reportReasons.other'),
          },
          detailsLabel: t('forum.reportDetails'),
          detailsRequired: t('forum.reportRequired'),
          chooseReason: t('forum.reportSelect'),
          submit: t('forum.reportSend'),
          cancel: t('forum.cancel'),
        }}
        onSubmit={({ reason, details }) => {
          if (!report) return;
          changes.mutate(
            (api) =>
              api.POST('/api/v1/reports', {
                body: {
                  targetType: report.kind,
                  targetId: report.id,
                  reason,
                  ...(details.trim() ? { details: details.trim() } : {}),
                },
              }),
            {
              onSuccess: () => {
                setReport(null);
                toast.success(t('forum.reportSent'));
              },
            },
          );
        }}
      />
    </section>
  );
}
