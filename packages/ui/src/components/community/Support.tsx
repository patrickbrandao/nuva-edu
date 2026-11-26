import { Clock3, Flag, Lock } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './community.css';
import type { Loose } from '../../index';
import {
  AdminButton as RawAdminButton,
  AdminCheckbox as RawAdminCheckbox,
} from '../admin/AdminControls.jsx';
import {
  AdminAvatar as RawAdminAvatar,
  AdminBadge as RawAdminBadge,
  AdminEmpty as RawAdminEmpty,
  AdminStatus as RawAdminStatus,
} from '../admin/AdminData.jsx';
import { Markdown } from '../catalog/Markdown';
import { Dialog } from '../feedback/Dialog';
import { ErrorState, LoadingState, TextLink } from '../flow/flow';
import type { LinkComponent } from '../link/link';
import { MarkdownEditor, type MarkdownEditorLabels } from './Editor';

/*
 * Chamados de suporte (spec 023).
 *
 * - A conversa mostra as mensagens na ordem em que a API devolveu; `internal` é a nota da
 *   equipe, que nunca sai pela classroom-api. Como defesa extra, a nota só aparece com
 *   `showInternal` (o admin passa; o classroom, não).
 * - O aluno e a equipe usam o mesmo formulário; o seletor de nota interna só aparece no
 *   admin. O estado, o responsável e o prazo continuam na API.
 * - "Reportar problema" do player e do ebook é um diálogo com produto, aula e link já
 *   preenchidos; o tipo `broken_link` é da API, não do componente.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminCheckbox = RawAdminCheckbox as Loose<typeof RawAdminCheckbox>;
const AdminAvatar = RawAdminAvatar as Loose<typeof RawAdminAvatar>;
const AdminBadge = RawAdminBadge as Loose<typeof RawAdminBadge>;
const AdminEmpty = RawAdminEmpty as Loose<typeof RawAdminEmpty>;
const AdminStatus = RawAdminStatus as Loose<typeof RawAdminStatus>;

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

const TICKET_TONES: Record<TicketStatus, 'amber' | 'blue' | 'green' | 'gray'> = {
  open: 'amber',
  pending: 'blue',
  resolved: 'green',
  closed: 'gray',
};

export interface TicketStatusBadgeProps {
  status: TicketStatus;
  label: ReactNode;
  className?: string | undefined;
}

/** Selo do estado do chamado. */
export function TicketStatusBadge({ status, label, className }: TicketStatusBadgeProps) {
  return (
    <AdminStatus dot tone={TICKET_TONES[status]} className={className}>
      {label}
    </AdminStatus>
  );
}

export interface TicketMessage {
  id: string;
  author: { name: string; href?: string | undefined; avatarUrl?: string | null | undefined };
  createdAt: string;
  bodyHtml?: string | null | undefined;
  bodyMarkdown?: string | null | undefined;
  /** Nota interna da equipe (spec 023, RF-02). */
  internal?: boolean;
  /** Nome da pessoa que escreveu, quando a API não manda o autor completo. */
  staff?: boolean;
}

export interface TicketConversationLabels {
  /** Nome da região (ex.: "Conversa do chamado"). */
  region: string;
  /** Marca da nota interna (ex.: "Nota interna"). */
  internal: string;
  /** Rótulo do autor da equipe, ex.: (name) => "Equipe · Ana". */
  staff?: ((name: string) => string) | undefined;
  /** Data da mensagem, ex.: ("2026-03-12T10:00:00Z") => "12/03 às 10h". */
  time: (at: string) => string;
  newTabLabel?: string | undefined;
  missingAltLabel?: string | undefined;
}

export interface TicketConversationProps {
  messages: readonly TicketMessage[];
  labels: TicketConversationLabels;
  /** Só o admin recebe as notas internas; o padrão esconde. */
  showInternal?: boolean;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Conversa do chamado, com a nota interna visível só à equipe. */
export function TicketConversation({
  messages,
  labels,
  showInternal = false,
  linkComponent,
  className,
}: TicketConversationProps) {
  const visible = showInternal ? messages : messages.filter((message) => !message.internal);
  return (
    <section
      aria-label={labels.region}
      className={['minui-ticket-talk', className].filter(Boolean).join(' ')}
    >
      <ol className="minui-ticket-talk__list">
        {visible.map((message) => (
          <li
            key={message.id}
            className="minui-ticket-msg"
            data-internal={message.internal ? 'true' : undefined}
          >
            <header className="minui-ticket-msg__head">
              {message.author.avatarUrl ? (
                <AdminAvatar size={26} name={message.author.name} src={message.author.avatarUrl} />
              ) : null}
              <strong className="minui-ticket-msg__author">
                {message.author.href ? (
                  <TextLink href={message.author.href} linkComponent={linkComponent}>
                    {labels.staff && message.staff
                      ? labels.staff(message.author.name)
                      : message.author.name}
                  </TextLink>
                ) : labels.staff && message.staff ? (
                  labels.staff(message.author.name)
                ) : (
                  message.author.name
                )}
              </strong>
              <time className="minui-ticket-msg__time" dateTime={message.createdAt}>
                {labels.time(message.createdAt)}
              </time>
              {message.internal ? (
                <AdminBadge className="minui-ticket-msg__internal">
                  <Lock aria-hidden="true" size={11} /> {labels.internal}
                </AdminBadge>
              ) : null}
            </header>
            <div className="minui-ticket-msg__body">
              <Markdown
                html={message.bodyHtml ?? undefined}
                newTabLabel={labels.newTabLabel}
                missingAltLabel={labels.missingAltLabel}
              >
                {message.bodyMarkdown ?? ''}
              </Markdown>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface TicketComposerProps {
  value: string;
  onChange: (value: string) => void;
  labels: MarkdownEditorLabels & {
    /** Nome do formulário (ex.: "Responder ao chamado"). */
    region: string;
    submit: string;
    sending?: string;
    /** Nome do seletor de nota interna (só no admin). */
    internal?: string;
    /** Dica do seletor de nota interna. */
    internalHint?: ReactNode;
  };
  onSubmit: () => void;
  /** Mostra o seletor de nota interna (equipe). */
  showInternalToggle?: boolean;
  internal?: boolean;
  onInternalChange?: ((internal: boolean) => void) | undefined;
  busy?: boolean;
  disabled?: boolean;
  error?: ReactNode;
  className?: string | undefined;
}

/** Formulário de resposta do chamado, com nota interna opcional na equipe. */
export function TicketComposer({
  value,
  onChange,
  labels,
  onSubmit,
  showInternalToggle = false,
  internal = false,
  onInternalChange,
  busy = false,
  disabled = false,
  error,
  className,
}: TicketComposerProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || disabled) return;
    onSubmit();
  };
  return (
    <form
      aria-label={labels.region}
      className={['minui-ticket-composer', className].filter(Boolean).join(' ')}
      onSubmit={handleSubmit}
    >
      <MarkdownEditor
        value={value}
        onChange={onChange}
        labels={labels}
        disabled={disabled || busy}
        rows={5}
      />
      {showInternalToggle && labels.internal ? (
        <div className="minui-ticket-composer__internal">
          <AdminCheckbox
            checked={internal}
            disabled={busy}
            onChange={(checked: boolean) => onInternalChange?.(checked)}
          >
            <Lock aria-hidden="true" size={12} /> {labels.internal}
          </AdminCheckbox>
          {labels.internalHint ? (
            <p className="minui-ticket-composer__hint">{labels.internalHint}</p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="minui-ticket-composer__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="minui-ticket-composer__foot">
        <AdminButton type="submit" variant="primary" disabled={busy || disabled}>
          {busy && labels.sending ? labels.sending : labels.submit}
        </AdminButton>
      </div>
    </form>
  );
}

export interface TicketSummary {
  id: string;
  /** Número legível do chamado. */
  number: number | string;
  subject: string;
  href?: string | undefined;
  status: TicketStatus;
  /** Tipo já traduzido (ex.: "Pagamento"). */
  kindLabel?: ReactNode;
  assignee?: { name: string; avatarUrl?: string | null | undefined } | undefined;
  lastUserMessageAt?: string | null | undefined;
  reportsCount?: number | undefined;
}

export interface TicketListLabels {
  region: string;
  statuses: Record<TicketStatus, string>;
  emptyTitle: ReactNode;
  emptyText?: ReactNode;
  loading: string;
  errorTitle?: ReactNode;
  errorText?: ReactNode;
  retry?: string;
  /** Número na frente do assunto, ex.: (42) => "#42". */
  number: (number: number | string) => string;
  /** Tempo desde a última resposta do aluno. */
  lastUserReply?: ((at: string) => string) | undefined;
  /** Contador de relatos de link quebrado (spec 023). */
  reports?: ((count: number) => string) | undefined;
  /** Nome acessível do responsável. */
  assignee?: ((name: string) => string) | undefined;
}

export interface TicketListProps {
  tickets: readonly TicketSummary[];
  labels: TicketListLabels;
  loading?: boolean;
  error?: boolean;
  onRetry?: (() => void) | undefined;
  emptyAction?: ReactNode;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Lista de chamados: número, assunto, tipo, estado, responsável e tempo de espera. */
export function TicketList({
  tickets,
  labels,
  loading = false,
  error = false,
  onRetry,
  emptyAction,
  linkComponent,
  className,
}: TicketListProps) {
  return (
    <section
      aria-label={labels.region}
      className={['minui-tickets', className].filter(Boolean).join(' ')}
    >
      {loading ? (
        <LoadingState label={labels.loading} />
      ) : error ? (
        <ErrorState
          title={labels.errorTitle}
          text={labels.errorText}
          {...(onRetry ? { onRetry, retryLabel: labels.retry } : {})}
        />
      ) : tickets.length === 0 ? (
        <AdminEmpty icon={null} title={labels.emptyTitle} text={labels.emptyText}>
          {emptyAction}
        </AdminEmpty>
      ) : (
        <ul className="minui-tickets__list">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="minui-ticket-row" data-status={ticket.status}>
              <div className="minui-ticket-row__main">
                <span className="minui-ticket-row__number">{labels.number(ticket.number)}</span>
                <span className="minui-ticket-row__subject">
                  {ticket.href ? (
                    <TextLink href={ticket.href} linkComponent={linkComponent}>
                      {ticket.subject}
                    </TextLink>
                  ) : (
                    ticket.subject
                  )}
                </span>
                {ticket.kindLabel ? (
                  <span className="minui-ticket-row__kind">{ticket.kindLabel}</span>
                ) : null}
              </div>
              <div className="minui-ticket-row__meta">
                <TicketStatusBadge status={ticket.status} label={labels.statuses[ticket.status]} />
                {ticket.lastUserMessageAt && labels.lastUserReply ? (
                  <span className="minui-ticket-row__wait">
                    <Clock3 aria-hidden="true" size={12} />
                    <time dateTime={ticket.lastUserMessageAt}>
                      {labels.lastUserReply(ticket.lastUserMessageAt)}
                    </time>
                  </span>
                ) : null}
                {ticket.reportsCount != null && labels.reports ? (
                  <span className="minui-ticket-row__reports">
                    <Flag aria-hidden="true" size={12} /> {labels.reports(ticket.reportsCount)}
                  </span>
                ) : null}
                {ticket.assignee && labels.assignee ? (
                  <span className="minui-ticket-row__assignee">
                    <AdminAvatar
                      size={18}
                      name={ticket.assignee.name}
                      src={ticket.assignee.avatarUrl ?? undefined}
                    />
                    <span className="minui-sr-only">{labels.assignee(ticket.assignee.name)}</span>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface ReportLinkDialogLabels {
  title: string;
  description?: ReactNode;
  productLabel: string;
  lessonLabel: string;
  linkLabel: string;
  messageLabel: string;
  messageHint?: string;
  submit: string;
  cancel: string;
  close?: string;
  sending?: string;
}

export interface ReportLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (message: string) => void;
  labels: ReportLinkDialogLabels;
  /** Produto, aula e link já preenchidos pela tela do player ou do ebook. */
  product: string;
  lesson: string;
  link: string;
  busy?: boolean;
  error?: ReactNode;
  container?: Element | null | undefined;
  className?: string | undefined;
}

/** "Reportar problema": abre o chamado `broken_link` já preenchido (spec 023, RF-04). */
export function ReportLinkDialog({
  open,
  onClose,
  onSubmit,
  labels,
  product,
  lesson,
  link,
  busy = false,
  error,
  container,
  className,
}: ReportLinkDialogProps) {
  const baseId = useId();
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!open) setMessage('');
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={labels.title}
      description={labels.description}
      closeLabel={labels.close}
      dismissible={!busy}
      container={container}
      className={['minui-report-link', className].filter(Boolean).join(' ')}
      footer={
        <>
          <AdminButton type="button" disabled={busy} onClick={onClose}>
            {labels.cancel}
          </AdminButton>
          <AdminButton
            type="button"
            variant="primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => onSubmit(message.trim())}
          >
            {busy && labels.sending ? labels.sending : labels.submit}
          </AdminButton>
        </>
      }
    >
      <dl className="minui-report-link__summary">
        <div>
          <dt>{labels.productLabel}</dt>
          <dd>{product}</dd>
        </div>
        <div>
          <dt>{labels.lessonLabel}</dt>
          <dd>{lesson}</dd>
        </div>
        <div>
          <dt>{labels.linkLabel}</dt>
          <dd className="minui-report-link__url">{link}</dd>
        </div>
      </dl>
      <div className="minui-report-link__message">
        <label className="minui-adm-field__label" htmlFor={`${baseId}-message`}>
          {labels.messageLabel}
        </label>
        <textarea
          id={`${baseId}-message`}
          className="minui-md-editor__input"
          rows={3}
          value={message}
          disabled={busy}
          aria-describedby={labels.messageHint ? `${baseId}-hint` : undefined}
          onChange={(event) => setMessage(event.target.value)}
        />
        {labels.messageHint ? (
          <p id={`${baseId}-hint`} className="minui-report-link__hint">
            {labels.messageHint}
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="minui-report-link__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
