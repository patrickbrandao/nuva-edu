import { Check, Clock3, MessageSquare, Pin, TriangleAlert } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { useId } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './community.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import {
  AdminEmpty as RawAdminEmpty,
  AdminStatus as RawAdminStatus,
  AdminTag as RawAdminTag,
} from '../admin/AdminData.jsx';
import { Markdown } from '../catalog/Markdown';
import { ErrorState, LoadingState, TextLink } from '../flow/flow';
import type { LinkComponent } from '../link/link';
import { MarkdownEditor, type MarkdownEditorLabels } from './Editor';

/*
 * Fórum: tópico e resposta (specs 017 e 026).
 *
 * Nenhuma regra de negócio mora aqui. Quem pode ler, escrever, fixar, fechar, ocultar ou
 * marcar solução é decidido por `packages/core` e pela API; o site só monta as ações que
 * o papel permite (`actions`). O corpo passa pelo `Markdown` da 627, que higieniza de novo
 * o HTML salvo e nunca usa `dangerouslySetInnerHTML`.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminEmpty = RawAdminEmpty as Loose<typeof RawAdminEmpty>;
const AdminStatus = RawAdminStatus as Loose<typeof RawAdminStatus>;
const AdminTag = RawAdminTag as Loose<typeof RawAdminTag>;

export type ForumTopicStatus = 'open' | 'closed' | 'hidden';

export interface ForumAuthor {
  name: string;
  href?: string | undefined;
  avatarUrl?: string | null | undefined;
}

export interface ForumTopic {
  id: string;
  title: string;
  /** Endereço do tópico; sem ele, o título é texto. */
  href?: string | undefined;
  author?: ForumAuthor | undefined;
  createdAt?: string | undefined;
  lastActivityAt?: string | null | undefined;
  postsCount?: number | undefined;
  status: ForumTopicStatus;
  pinned?: boolean;
  solved?: boolean;
}

export interface TopicBadgesLabels {
  pinned: string;
  solved: string;
  statuses: Record<ForumTopicStatus, string>;
}

const TOPIC_TONES: Record<ForumTopicStatus, 'green' | 'gray' | 'red'> = {
  open: 'green',
  closed: 'gray',
  hidden: 'red',
};

/** Selos de estado do tópico: estado, fixado e resolvido. */
export function TopicBadges({
  topic,
  labels,
  className,
}: {
  topic: Pick<ForumTopic, 'status' | 'pinned' | 'solved'>;
  labels: TopicBadgesLabels;
  className?: string | undefined;
}) {
  return (
    <span className={['minui-topic__badges', className].filter(Boolean).join(' ')}>
      <AdminStatus dot tone={TOPIC_TONES[topic.status]}>
        {labels.statuses[topic.status]}
      </AdminStatus>
      {topic.pinned ? (
        <AdminTag className="minui-topic__pin">
          <Pin aria-hidden="true" size={11} /> {labels.pinned}
        </AdminTag>
      ) : null}
      {topic.solved ? (
        <AdminStatus tone="green" className="minui-topic__solved">
          <Check aria-hidden="true" size={12} /> {labels.solved}
        </AdminStatus>
      ) : null}
    </span>
  );
}

export interface TopicCardLabels extends TopicBadgesLabels {
  /** Contagem de respostas, ex.: (4) => "4 respostas". */
  posts: (count: number) => string;
  /** Última atividade, ex.: ("2026-03-12T10:00:00Z") => "há 2 horas". */
  lastActivity?: ((at: string) => string) | undefined;
  /** Autor, ex.: (name) => "por Ana". */
  author?: ((name: string) => string) | undefined;
}

export interface TopicCardProps {
  topic: ForumTopic;
  labels: TopicCardLabels;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Um tópico na lista da categoria: título, autor, selos, respostas e última atividade. */
export function TopicCard({ topic, labels, linkComponent, className }: TopicCardProps) {
  return (
    <article
      className={['minui-topic', className].filter(Boolean).join(' ')}
      data-status={topic.status}
      data-pinned={topic.pinned ? 'true' : undefined}
    >
      <div className="minui-topic__head">
        <h3 className="minui-topic__title">
          {topic.href ? (
            <TextLink href={topic.href} linkComponent={linkComponent}>
              {topic.title}
            </TextLink>
          ) : (
            topic.title
          )}
        </h3>
        <TopicBadges topic={topic} labels={labels} />
      </div>
      <div className="minui-topic__meta">
        {topic.author && labels.author ? (
          <span className="minui-topic__author">
            {topic.author.href ? (
              <TextLink href={topic.author.href} linkComponent={linkComponent}>
                {labels.author(topic.author.name)}
              </TextLink>
            ) : (
              labels.author(topic.author.name)
            )}
          </span>
        ) : null}
        {topic.postsCount != null ? (
          <span className="minui-topic__posts">
            <MessageSquare aria-hidden="true" size={13} /> {labels.posts(topic.postsCount)}
          </span>
        ) : null}
        {topic.lastActivityAt && labels.lastActivity ? (
          <span className="minui-topic__activity">
            <Clock3 aria-hidden="true" size={13} />
            <time dateTime={topic.lastActivityAt}>{labels.lastActivity(topic.lastActivityAt)}</time>
          </span>
        ) : null}
      </div>
    </article>
  );
}

export interface TopicListLabels extends TopicCardLabels {
  /** Nome da lista (ex.: "Tópicos da categoria"). */
  region: string;
  emptyTitle: ReactNode;
  emptyText?: ReactNode;
  loading: string;
  errorTitle?: ReactNode;
  errorText?: ReactNode;
  retry?: string;
}

export interface TopicListProps {
  topics: readonly ForumTopic[];
  labels: TopicListLabels;
  loading?: boolean;
  error?: boolean;
  onRetry?: (() => void) | undefined;
  /** Ação sugerida no estado vazio (ex.: "Criar tópico"). */
  emptyAction?: ReactNode;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Lista de tópicos com os estados de carregando, vazio e erro (spec 006, RF-09). */
export function TopicList({
  topics,
  labels,
  loading = false,
  error = false,
  onRetry,
  emptyAction,
  linkComponent,
  className,
}: TopicListProps) {
  return (
    <section
      aria-label={labels.region}
      className={['minui-topics', className].filter(Boolean).join(' ')}
    >
      {loading ? (
        <LoadingState label={labels.loading} />
      ) : error ? (
        <ErrorState
          title={labels.errorTitle}
          text={labels.errorText}
          {...(onRetry ? { onRetry, retryLabel: labels.retry } : {})}
        />
      ) : topics.length === 0 ? (
        <AdminEmpty icon={null} title={labels.emptyTitle} text={labels.emptyText}>
          {emptyAction}
        </AdminEmpty>
      ) : (
        <ul className="minui-topics__list">
          {topics.map((topic) => (
            <li key={topic.id}>
              <TopicCard topic={topic} labels={labels} linkComponent={linkComponent} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface TopicHeaderProps {
  topic: ForumTopic;
  labels: TopicBadgesLabels & {
    posts?: ((count: number) => string) | undefined;
    author?: ((name: string) => string) | undefined;
  };
  /** Ações do tópico que o papel permite: seguir, fixar, fechar, denunciar, solução. */
  actions?: ReactNode;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Cabeçalho do tópico aberto: título, selos, autor e as ações permitidas. */
export function TopicHeader({
  topic,
  labels,
  actions,
  linkComponent,
  className,
}: TopicHeaderProps) {
  return (
    <header className={['minui-topic-head', className].filter(Boolean).join(' ')}>
      <div className="minui-topic-head__text">
        <h1 className="minui-topic-head__title">{topic.title}</h1>
        <div className="minui-topic-head__meta">
          <TopicBadges topic={topic} labels={labels} />
          {topic.author && labels.author ? (
            <span>
              {topic.author.href ? (
                <TextLink href={topic.author.href} linkComponent={linkComponent}>
                  {labels.author(topic.author.name)}
                </TextLink>
              ) : (
                labels.author(topic.author.name)
              )}
            </span>
          ) : null}
          {topic.postsCount != null && labels.posts ? (
            <span>{labels.posts(topic.postsCount)}</span>
          ) : null}
        </div>
      </div>
      {actions ? <div className="minui-topic-head__actions">{actions}</div> : null}
    </header>
  );
}

export interface ForumPost {
  id: string;
  author: ForumAuthor;
  createdAt: string;
  /** HTML saneado gravado pela API (ADR 0027). */
  bodyHtml?: string | null | undefined;
  /** Markdown anterior à ADR 0027, quando não há HTML. */
  bodyMarkdown?: string | null | undefined;
  editedAt?: string | null | undefined;
  /** O autor apagou a mensagem, que fica como registro por causa das respostas. */
  deleted?: boolean;
  /** Conteúdo ocultado pela moderação; o autor vê o aviso (spec 026). */
  hidden?: boolean;
  /** Resposta escolhida como solução. */
  solution?: boolean;
  /** Nome acessível do bloco (ex.: "Resposta de Ana"). */
  label?: string | undefined;
}

export interface PostCardLabels {
  /** Data da publicação, ex.: ("2026-03-12T10:00:00Z") => "12/03 às 10h". */
  time: (at: string) => string;
  /** Marca de edição, ex.: ("2026-03-12T10:00:00Z") => "editado em 12/03". */
  edited: (at: string) => string;
  solution: string;
  hidden: string;
  deleted: string;
  /** Nome acessível do bloco; sem ele, usa o nome do autor. */
  region?: ((author: string) => string) | undefined;
  /** Texto lido depois de um link (ex.: "abre em nova aba"). */
  newTabLabel?: string | undefined;
  missingAltLabel?: string | undefined;
}

export interface PostCardProps {
  post: ForumPost;
  labels: PostCardLabels;
  /** Ações permitidas (responder, denunciar, marcar solução). */
  actions?: ReactNode;
  /** Reações (componente Reactions), quando o recurso aceita. */
  reactions?: ReactNode;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Uma publicação do fórum: autor, data, corpo em Markdown, marcas e ações. */
export function PostCard({
  post,
  labels,
  actions,
  reactions,
  linkComponent,
  className,
}: PostCardProps) {
  const authorName = post.author.name;
  const region = labels.region ? labels.region(authorName) : authorName;
  return (
    <article
      id={`post-${post.id}`}
      aria-label={region}
      className={['minui-post', className].filter(Boolean).join(' ')}
      data-hidden={post.hidden ? 'true' : undefined}
      data-deleted={post.deleted ? 'true' : undefined}
      data-solution={post.solution ? 'true' : undefined}
    >
      <header className="minui-post__head">
        {post.author.avatarUrl ? (
          <img
            className="minui-post__avatar"
            src={post.author.avatarUrl}
            alt=""
            width={32}
            height={32}
          />
        ) : null}
        <div className="minui-post__who">
          <strong className="minui-post__author">
            {post.author.href ? (
              <TextLink href={post.author.href} linkComponent={linkComponent}>
                {authorName}
              </TextLink>
            ) : (
              authorName
            )}
          </strong>
          <span className="minui-post__when">
            <time dateTime={post.createdAt}>{labels.time(post.createdAt)}</time>
            {post.editedAt ? (
              <span className="minui-post__edited"> · {labels.edited(post.editedAt)}</span>
            ) : null}
          </span>
        </div>
        {post.solution ? (
          <AdminStatus tone="green" className="minui-post__solution">
            <Check aria-hidden="true" size={13} /> {labels.solution}
          </AdminStatus>
        ) : null}
      </header>

      {post.hidden ? (
        <p className="minui-post__notice" role="status">
          <TriangleAlert aria-hidden="true" size={14} /> {labels.hidden}
        </p>
      ) : null}

      {post.deleted ? (
        <p className="minui-post__deleted">{labels.deleted}</p>
      ) : (
        <div className="minui-post__body">
          <Markdown
            html={post.bodyHtml ?? undefined}
            newTabLabel={labels.newTabLabel}
            missingAltLabel={labels.missingAltLabel}
          >
            {post.bodyMarkdown ?? ''}
          </Markdown>
        </div>
      )}

      {!post.deleted && (actions || reactions) ? (
        <footer className="minui-post__foot">
          {reactions}
          {actions ? <div className="minui-post__actions">{actions}</div> : null}
        </footer>
      ) : null}
    </article>
  );
}

export interface PostComposerProps {
  /** Quando presente, o campo de título aparece (novo tópico). */
  title?:
    | {
        value: string;
        onChange: (value: string) => void;
        label: string;
        minLength?: number;
        maxLength?: number;
        hint?: ReactNode;
      }
    | undefined;
  value: string;
  onChange: (value: string) => void;
  labels: MarkdownEditorLabels & {
    /** Nome do formulário (ex.: "Responder ao tópico"). */
    region: string;
    submit: string;
    cancel?: string;
    /** Texto do botão enquanto envia. */
    sending?: string;
  };
  onSubmit: () => void;
  onCancel?: (() => void) | undefined;
  busy?: boolean;
  disabled?: boolean;
  /** Erro do envio, anunciado na hora. */
  error?: ReactNode;
  /** Lista de menções (MentionList) logo abaixo do campo. */
  mention?: ReactNode;
  className?: string | undefined;
}

/** Formulário de tópico ou resposta: título opcional, Markdown, menções e envio. */
export function PostComposer({
  title,
  value,
  onChange,
  labels,
  onSubmit,
  onCancel,
  busy = false,
  disabled = false,
  error,
  mention,
  className,
}: PostComposerProps) {
  const titleId = useId();
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || disabled) return;
    onSubmit();
  };
  return (
    <form
      aria-label={labels.region}
      className={['minui-post-composer', className].filter(Boolean).join(' ')}
      onSubmit={handleSubmit}
      noValidate
    >
      {title ? (
        <div className="minui-adm-field">
          <label className="minui-adm-field__label" htmlFor={titleId}>
            {title.label}
          </label>
          <span className="minui-adm-input">
            <input
              id={titleId}
              value={title.value}
              minLength={title.minLength}
              maxLength={title.maxLength}
              disabled={disabled || busy}
              aria-describedby={title.hint ? `${titleId}-hint` : undefined}
              onChange={(event) => title.onChange(event.target.value)}
            />
          </span>
          {title.hint ? (
            <span id={`${titleId}-hint`} className="minui-adm-field__hint">
              {title.hint}
            </span>
          ) : null}
        </div>
      ) : null}

      <MarkdownEditor
        value={value}
        onChange={onChange}
        labels={labels}
        disabled={disabled || busy}
        rows={6}
      />
      {mention}

      {error ? (
        <p className="minui-post-composer__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="minui-post-composer__foot">
        {onCancel && labels.cancel ? (
          <AdminButton type="button" disabled={busy} onClick={onCancel}>
            {labels.cancel}
          </AdminButton>
        ) : null}
        <AdminButton type="submit" variant="primary" disabled={busy || disabled}>
          {busy && labels.sending ? labels.sending : labels.submit}
        </AdminButton>
      </div>
    </form>
  );
}
