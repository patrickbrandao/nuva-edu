import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './community.css';
import type { Loose } from '../../index';
import {
  AdminButton as RawAdminButton,
  AdminSwitch as RawAdminSwitch,
} from '../admin/AdminControls.jsx';
import { AdminAvatar as RawAdminAvatar, AdminEmpty as RawAdminEmpty } from '../admin/AdminData.jsx';
import { ErrorState, LoadingState, TextLink } from '../flow/flow';
import type { LinkComponent } from '../link/link';

/*
 * Central de notificações, sino e preferências (spec 024).
 *
 * O contador chega por SSE no site; o componente só mostra o número que recebeu, abre a
 * central e devolve as ações (abrir, marcar todas, limpar). Nada aqui abre conexão.
 *
 * O sino é um popover não modal: `aria-expanded` no botão, Esc fecha e devolve o foco ao
 * botão, clique fora fecha, e o foco entra no painel ao abrir para o leitor de tela
 * anunciar a lista. As preferências mostram os grupos fixos da spec; o grupo obrigatório
 * fica desabilitado com o motivo disponível ao leitor de tela.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminSwitch = RawAdminSwitch as Loose<typeof RawAdminSwitch>;
const AdminAvatar = RawAdminAvatar as Loose<typeof RawAdminAvatar>;
const AdminEmpty = RawAdminEmpty as Loose<typeof RawAdminEmpty>;

export interface NotificationBellLabels {
  /** Nome do botão, com a contagem, ex.: (3) => "Notificações, 3 não lidas". */
  button: (unread: number) => string;
  /** Nome do painel (ex.: "Notificações"). */
  title: string;
  /** Nome do botão de fechar o painel. */
  close: string;
}

export interface NotificationBellProps {
  unread: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: NotificationBellLabels;
  /** Conteúdo do painel (em geral um NotificationList). */
  children?: ReactNode;
  className?: string | undefined;
}

/** Sino com contador e painel não modal da central. */
export function NotificationBell({
  unread,
  open,
  onOpenChange,
  labels,
  children,
  className,
}: NotificationBellProps) {
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onOpenChangeRef.current(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onOpenChangeRef.current(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      buttonRef.current?.focus();
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={['minui-bell', className].filter(Boolean).join(' ')}>
      <button
        ref={buttonRef}
        type="button"
        className="minui-bell__button"
        aria-label={labels.button(unread)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <Bell aria-hidden="true" size={18} />
        {unread > 0 ? (
          <span className="minui-bell__count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={labels.title}
          tabIndex={-1}
          className="minui-bell__panel"
        >
          <header className="minui-bell__head">
            <h2 className="minui-bell__title">{labels.title}</h2>
            <AdminButton
              variant="ghost"
              size="sm"
              aria-label={labels.close}
              icon={<span aria-hidden="true">×</span>}
              onClick={() => onOpenChange(false)}
            />
          </header>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface NotificationEntry {
  id: string;
  /** Tipo do catálogo (`forum.reply`, `ticket.reply`…), só para o ícone. */
  type?: string | undefined;
  title: ReactNode;
  text?: ReactNode;
  href?: string | undefined;
  createdAt: string;
  read?: boolean;
  actor?: { name: string; avatarUrl?: string | null | undefined } | undefined;
  /** Quantas notificações foram agrupadas (`count` da API); 1 é uma só. */
  groupCount?: number | undefined;
  /** Ícone do tipo, montado pelo site. */
  icon?: ReactNode;
}

export interface NotificationListLabels {
  region: string;
  emptyTitle: ReactNode;
  emptyText?: ReactNode;
  loading: string;
  errorTitle?: ReactNode;
  errorText?: ReactNode;
  retry?: string;
  markAll: string;
  clearAll: string;
  /** Texto da não lida, para o leitor de tela. */
  unread: string;
  /** Agrupamento, ex.: (4) => "e mais 3". */
  grouped?: ((count: number) => string) | undefined;
  /** Tempo relativo, ex.: ("2026-03-12T10:00:00Z") => "há 2 horas". */
  time: (at: string) => string;
  newTabLabel?: string | undefined;
}

export interface NotificationListProps {
  items: readonly NotificationEntry[];
  labels: NotificationListLabels;
  onOpen?: ((id: string) => void) | undefined;
  onMarkAll?: (() => void) | undefined;
  onClearAll?: (() => void) | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry?: (() => void) | undefined;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Central: itens com agrupamento, lidas/não lidas, marcar todas e limpar. */
export function NotificationList({
  items,
  labels,
  onOpen,
  onMarkAll,
  onClearAll,
  loading = false,
  error = false,
  onRetry,
  linkComponent,
  className,
}: NotificationListProps) {
  const body = loading ? (
    <LoadingState label={labels.loading} />
  ) : error ? (
    <ErrorState
      title={labels.errorTitle}
      text={labels.errorText}
      {...(onRetry ? { onRetry, retryLabel: labels.retry } : {})}
    />
  ) : items.length === 0 ? (
    <AdminEmpty
      icon={<Bell aria-hidden="true" />}
      title={labels.emptyTitle}
      text={labels.emptyText}
    />
  ) : (
    <ul className="minui-notifications">
      {items.map((item) => {
        const grouped =
          item.groupCount != null && item.groupCount > 1 && labels.grouped
            ? labels.grouped(item.groupCount)
            : null;
        const content = (
          <>
            {item.icon ? (
              <span className="minui-notification__icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : item.actor ? (
              <AdminAvatar
                size={26}
                name={item.actor.name}
                src={item.actor.avatarUrl ?? undefined}
              />
            ) : null}
            <span className="minui-notification__text">
              <strong className="minui-notification__title">{item.title}</strong>
              {item.text ? <span className="minui-notification__body">{item.text}</span> : null}
              {grouped ? <span className="minui-notification__grouped">{grouped}</span> : null}
              <time className="minui-notification__time" dateTime={item.createdAt}>
                {labels.time(item.createdAt)}
              </time>
            </span>
          </>
        );
        return (
          <li
            key={item.id}
            className="minui-notification"
            data-unread={item.read === false ? 'true' : undefined}
          >
            {item.href ? (
              <TextLink
                href={item.href}
                linkComponent={linkComponent}
                className="minui-notification__link"
                onClick={onOpen ? () => onOpen(item.id) : undefined}
              >
                {content}
              </TextLink>
            ) : (
              <button
                type="button"
                className="minui-notification__link"
                onClick={onOpen ? () => onOpen(item.id) : undefined}
              >
                {content}
              </button>
            )}
            {item.read === false ? <span className="minui-sr-only">{labels.unread}</span> : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <section
      aria-label={labels.region}
      className={['minui-notification-list', className].filter(Boolean).join(' ')}
    >
      <div className="minui-notification-list__actions">
        <AdminButton size="sm" icon={<CheckCheck aria-hidden="true" />} onClick={onMarkAll}>
          {labels.markAll}
        </AdminButton>
        <AdminButton size="sm" icon={<Trash2 aria-hidden="true" />} onClick={onClearAll}>
          {labels.clearAll}
        </AdminButton>
      </div>
      {body}
    </section>
  );
}

export type NotificationChannel = 'inApp' | 'email';

export interface NotificationGroupPreference {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  /** `null`/ausente: o grupo não tem canal de plataforma (conta). */
  inApp?: boolean | null | undefined;
  email?: boolean | null | undefined;
  /** Canal obrigatório: desabilitado, com `lockedReason` para o leitor de tela. */
  inAppLocked?: boolean;
  emailLocked?: boolean;
  lockedReason?: ReactNode;
}

export interface NotificationPreferencesLabels {
  region: string;
  title: ReactNode;
  description?: ReactNode;
  inApp: string;
  email: string;
  /** Texto do canal obrigatório, ex.: "Sempre ativo". */
  required: string;
  /** Texto no lugar do canal que o grupo não tem. */
  notAvailable?: string;
  /** Confirmação anunciada após salvar. */
  saved?: ReactNode;
}

export interface NotificationPreferencesProps {
  groups: readonly NotificationGroupPreference[];
  labels: NotificationPreferencesLabels;
  onChange: (groupId: string, channel: NotificationChannel, value: boolean) => void;
  className?: string | undefined;
}

/** Preferências por grupo e canal, com os obrigatórios travados (spec 024, RF-03 e RF-04). */
export function NotificationPreferences({
  groups,
  labels,
  onChange,
  className,
}: NotificationPreferencesProps) {
  const titleId = useId();
  const channel = (
    group: NotificationGroupPreference,
    key: NotificationChannel,
    label: string,
    locked: boolean,
  ) => {
    const value = group[key];
    if (value == null) {
      return <span className="minui-notprefs__none">{labels.notAvailable ?? '—'}</span>;
    }
    return (
      <>
        <AdminSwitch
          checked={value}
          disabled={locked}
          aria-label={`${typeof group.label === 'string' ? group.label : group.id}: ${label}`}
          onChange={(checked: boolean) => {
            if (!locked) onChange(group.id, key, checked);
          }}
        />
        {locked ? <span className="minui-notprefs__locked">{labels.required}</span> : null}
      </>
    );
  };

  return (
    <section
      aria-labelledby={titleId}
      aria-label={labels.region}
      className={['minui-notprefs', className].filter(Boolean).join(' ')}
    >
      <h2 id={titleId} className="minui-notprefs__title">
        {labels.title}
      </h2>
      {labels.description ? (
        <p className="minui-notprefs__description">{labels.description}</p>
      ) : null}
      <ul className="minui-notprefs__groups">
        {groups.map((group) => (
          <li key={group.id} className="minui-notprefs__group">
            <div className="minui-notprefs__text">
              <strong>{group.label}</strong>
              {group.description ? <span>{group.description}</span> : null}
            </div>
            <div className="minui-notprefs__channels">
              <div className="minui-notprefs__channel" data-channel="inApp">
                <span className="minui-notprefs__channel-label">{labels.inApp}</span>
                {channel(group, 'inApp', labels.inApp, group.inAppLocked === true)}
              </div>
              <div className="minui-notprefs__channel" data-channel="email">
                <span className="minui-notprefs__channel-label">{labels.email}</span>
                {channel(group, 'email', labels.email, group.emailLocked === true)}
              </div>
            </div>
            {group.lockedReason ? (
              <span className="minui-sr-only">{group.lockedReason}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="minui-notprefs__saved" role="status" aria-live="polite">
        {labels.saved ?? ''}
      </p>
    </section>
  );
}
