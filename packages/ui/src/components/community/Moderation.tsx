import { Flag, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './community.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import {
  AdminAvatar as RawAdminAvatar,
  AdminBadge as RawAdminBadge,
  AdminEmpty as RawAdminEmpty,
} from '../admin/AdminData.jsx';
import { Markdown } from '../catalog/Markdown';
import { Dialog } from '../feedback/Dialog';

/*
 * Denúncia e moderação (specs 026 e 017).
 *
 * A denúncia é do aluno: motivo, descrição opcional (obrigatória em `other`) e o alvo, que
 * só é mostrado. A fila e as ações são da equipe: o componente recebe o conteúdo já
 * permitido pela API e as ações que o papel pode executar; ocultar, advertir, suspender e
 * excluir continuam sendo decisão da API, com auditoria.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminAvatar = RawAdminAvatar as Loose<typeof RawAdminAvatar>;
const AdminBadge = RawAdminBadge as Loose<typeof RawAdminBadge>;
const AdminEmpty = RawAdminEmpty as Loose<typeof RawAdminEmpty>;

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'inappropriate',
  'piracy',
  'personal_data',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportDialogLabels {
  /** Título do diálogo (ex.: "Denunciar conteúdo"). */
  title: string;
  description?: ReactNode;
  /** Legenda do grupo de motivos. */
  reasonLegend: string;
  /** Nome de cada motivo. */
  reasons: Record<ReportReason, string>;
  detailsLabel: string;
  detailsHint?: ReactNode;
  /** Aviso quando `other` é escolhido sem descrição. */
  detailsRequired: string;
  /** Aviso quando nenhum motivo foi escolhido. */
  chooseReason: string;
  submit: string;
  cancel: string;
  close?: string;
  sending?: string;
}

export interface ReportInput {
  reason: ReportReason;
  details: string;
}

export interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (report: ReportInput) => void;
  labels: ReportDialogLabels;
  /** O que está sendo denunciado (título do conteúdo, contexto). */
  target?: ReactNode;
  busy?: boolean;
  /** Erro devolvido pela API. */
  error?: ReactNode;
  container?: Element | null | undefined;
  className?: string | undefined;
}

/** Diálogo de denúncia: motivo obrigatório, descrição obrigatória em `other`. */
export function ReportDialog({
  open,
  onClose,
  onSubmit,
  labels,
  target,
  busy = false,
  error,
  container,
  className,
}: ReportDialogProps) {
  const baseId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [ownError, setOwnError] = useState<ReactNode>(null);
  const firstReasonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setReason(null);
      setDetails('');
      setOwnError(null);
    }
  }, [open]);

  const submit = () => {
    if (!reason) {
      setOwnError(labels.chooseReason);
      return;
    }
    if (reason === 'other' && details.trim() === '') {
      setOwnError(labels.detailsRequired);
      return;
    }
    setOwnError(null);
    onSubmit({ reason, details: details.trim() });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={labels.title}
      description={labels.description}
      closeLabel={labels.close}
      initialFocus={firstReasonRef}
      dismissible={!busy}
      container={container}
      className={['minui-report-dialog', className].filter(Boolean).join(' ')}
      footer={
        <>
          <AdminButton type="button" disabled={busy} onClick={onClose}>
            {labels.cancel}
          </AdminButton>
          <AdminButton
            type="button"
            variant="primary"
            className="minui-adm-btn--danger"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={submit}
          >
            {busy && labels.sending ? labels.sending : labels.submit}
          </AdminButton>
        </>
      }
    >
      {target ? <div className="minui-report-dialog__target">{target}</div> : null}
      <fieldset className="minui-report-dialog__reasons">
        <legend className="minui-report-dialog__legend">{labels.reasonLegend}</legend>
        {REPORT_REASONS.map((value, index) => {
          const id = `${baseId}-${value}`;
          return (
            <label key={value} className="minui-report-dialog__reason" htmlFor={id}>
              <input
                ref={index === 0 ? firstReasonRef : undefined}
                id={id}
                type="radio"
                name={`${baseId}-reason`}
                value={value}
                checked={reason === value}
                disabled={busy}
                onChange={() => {
                  setReason(value);
                  setOwnError(null);
                }}
              />
              <span>{labels.reasons[value]}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="minui-report-dialog__details">
        <label className="minui-adm-field__label" htmlFor={`${baseId}-details`}>
          {labels.detailsLabel}
        </label>
        <textarea
          id={`${baseId}-details`}
          className="minui-md-editor__input"
          rows={3}
          value={details}
          disabled={busy}
          aria-required={reason === 'other' || undefined}
          aria-describedby={labels.detailsHint ? `${baseId}-hint` : undefined}
          onChange={(event) => {
            setDetails(event.target.value);
            if (ownError) setOwnError(null);
          }}
        />
        {labels.detailsHint ? (
          <p id={`${baseId}-hint`} className="minui-report-dialog__hint">
            {labels.detailsHint}
          </p>
        ) : null}
      </div>

      {ownError ? (
        <p className="minui-report-dialog__error" role="alert">
          {ownError}
        </p>
      ) : null}
      {error ? (
        <p className="minui-report-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

export interface ReportedTarget {
  id: string;
  /** Tipo já traduzido (ex.: "Resposta do fórum"). */
  kindLabel: ReactNode;
  title?: ReactNode;
  bodyHtml?: string | null | undefined;
  bodyMarkdown?: string | null | undefined;
  author?:
    | { name: string; href?: string | undefined; avatarUrl?: string | null | undefined }
    | undefined;
  /** Contexto do conteúdo (tópico, case, conversa). */
  context?: ReactNode;
  reporters?: readonly { name: string; avatarUrl?: string | null | undefined }[] | undefined;
  reportsCount?: number | undefined;
  /** Motivos com a contagem de denúncias. */
  reasons?: readonly { label: string; count: number }[] | undefined;
}

export interface ReportedContentLabels {
  /** Nome da região (ex.: "Conteúdo denunciado"). */
  region: string;
  /** Contagem de denunciantes, ex.: (5) => "5 denúncias". */
  reports: (count: number) => string;
  reporterList: string;
  reasonsLabel: string;
  contextLabel: string;
  authorLabel: string;
  newTabLabel?: string | undefined;
  missingAltLabel?: string | undefined;
}

export interface ReportedContentProps {
  target: ReportedTarget;
  labels: ReportedContentLabels;
  /** Ações de moderação permitidas ao papel, fornecidas pela página. */
  actions?: ReactNode;
  className?: string | undefined;
}

/** Item da fila de moderação: o conteúdo, o contexto, o autor e quem denunciou. */
export function ReportedContent({ target, labels, actions, className }: ReportedContentProps) {
  return (
    <article
      aria-label={`${labels.region}: ${target.kindLabel}`}
      className={['minui-reported', className].filter(Boolean).join(' ')}
    >
      <header className="minui-reported__head">
        <div className="minui-reported__kind">
          <Flag aria-hidden="true" size={14} />
          <span>{target.kindLabel}</span>
          {target.reportsCount != null ? (
            <AdminBadge>{labels.reports(target.reportsCount)}</AdminBadge>
          ) : null}
        </div>
        {target.title ? <h3 className="minui-reported__title">{target.title}</h3> : null}
      </header>

      <div className="minui-reported__body">
        <Markdown
          html={target.bodyHtml ?? undefined}
          newTabLabel={labels.newTabLabel}
          missingAltLabel={labels.missingAltLabel}
        >
          {target.bodyMarkdown ?? ''}
        </Markdown>
      </div>

      {target.context ? (
        <div className="minui-reported__context">
          <span className="minui-reported__caption">{labels.contextLabel}</span>
          {target.context}
        </div>
      ) : null}

      <div className="minui-reported__meta">
        {target.author ? (
          <span className="minui-reported__author">
            <span className="minui-reported__caption">{labels.authorLabel}</span>
            <AdminAvatar
              size={20}
              name={target.author.name}
              src={target.author.avatarUrl ?? undefined}
            />
            {target.author.name}
          </span>
        ) : null}
        {target.reporters?.length ? (
          <span className="minui-reported__reporters">
            <span className="minui-reported__caption">{labels.reporterList}</span>
            <span className="minui-reported__faces">
              {target.reporters.map((person) => (
                <AdminAvatar
                  key={person.name}
                  size={20}
                  name={person.name}
                  src={person.avatarUrl ?? undefined}
                />
              ))}
            </span>
          </span>
        ) : null}
      </div>

      {target.reasons?.length ? (
        <div className="minui-reported__reasons">
          <span className="minui-reported__caption">{labels.reasonsLabel}</span>
          <ul>
            {target.reasons.map((entry) => (
              <li key={entry.label}>
                {entry.label} <span className="minui-reported__count">×{entry.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actions ? <footer className="minui-reported__actions">{actions}</footer> : null}
    </article>
  );
}

export interface ModerationHistoryItem {
  id: string;
  /** Ação já traduzida (ex.: "Advertência"). */
  action: ReactNode;
  at: string;
  reason?: ReactNode;
  /** Quem aplicou. */
  moderator?: ReactNode;
}

export interface ModerationHistoryLabels {
  region: string;
  emptyTitle: ReactNode;
  emptyText?: ReactNode;
  reasonLabel: string;
  moderatorLabel: string;
  /** Data da ação, ex.: ("2026-03-12T10:00:00Z") => "12/03/2026". */
  time: (at: string) => string;
}

export interface ModerationHistoryProps {
  items: readonly ModerationHistoryItem[];
  labels: ModerationHistoryLabels;
  className?: string | undefined;
}

/** Histórico de advertências e suspensões de uma pessoa (spec 026). */
export function ModerationHistory({ items, labels, className }: ModerationHistoryProps) {
  return (
    <section
      aria-label={labels.region}
      className={['minui-mod-history', className].filter(Boolean).join(' ')}
    >
      {items.length === 0 ? (
        <AdminEmpty
          icon={<ShieldAlert aria-hidden="true" />}
          title={labels.emptyTitle}
          text={labels.emptyText}
        />
      ) : (
        <ol className="minui-mod-history__list">
          {items.map((item) => (
            <li key={item.id} className="minui-mod-history__item">
              <span className="minui-mod-history__icon" aria-hidden="true">
                <TriangleAlert size={14} />
              </span>
              <div className="minui-mod-history__text">
                <strong>{item.action}</strong>
                <time dateTime={item.at}>{labels.time(item.at)}</time>
                {item.reason ? (
                  <span className="minui-mod-history__detail">
                    {labels.reasonLabel}: {item.reason}
                  </span>
                ) : null}
                {item.moderator ? (
                  <span className="minui-mod-history__detail">
                    {labels.moderatorLabel}: {item.moderator}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
