import { Pin } from 'lucide-react';
import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './community.css';
import type { Loose } from '../../index';
import { AdminEmpty as RawAdminEmpty, AdminTag as RawAdminTag } from '../admin/AdminData.jsx';
import { Markdown } from '../catalog/Markdown';
import { ErrorState, LoadingState, TextLink } from '../flow/flow';
import type { LinkComponent } from '../link/link';

/*
 * Novidades da escola (spec 025).
 *
 * O mural é de mão única: a equipe publica, o aluno lê. Cada item tem título, corpo em
 * Markdown saneado (o mesmo `Markdown` da 627), capa opcional, um "fixado" e o destino.
 * O estado de leitura é por mural (`announcements_seen_at`), não por item: o cartão só
 * mostra o marcador de não lida que o site tiver calculado, sem regra própria.
 */

const AdminEmpty = RawAdminEmpty as Loose<typeof RawAdminEmpty>;
const AdminTag = RawAdminTag as Loose<typeof RawAdminTag>;

export interface AnnouncementLink {
  href: string;
  label: ReactNode;
  /** URL `https` externa (spec 025, "Conteúdo"). */
  external?: boolean | undefined;
}

export interface Announcement {
  id: string;
  title: string;
  /** Endereço do detalhe da novidade. */
  href?: string | undefined;
  publishedAt?: string | null | undefined;
  pinned?: boolean;
  /** Publicada depois da última abertura do mural. */
  unread?: boolean;
  coverUrl?: string | null | undefined;
  coverAlt?: string | undefined;
  bodyHtml?: string | null | undefined;
  bodyMarkdown?: string | null | undefined;
  link?: AnnouncementLink | undefined;
}

export interface AnnouncementCardLabels {
  /** Nome do cartão (ex.: "Novidade"). */
  region: string;
  pinned: string;
  unread: string;
  /** Data de publicação, ex.: ("2026-03-12T10:00:00Z") => "12/03/2026". */
  date: (at: string) => string;
  newTabLabel?: string | undefined;
  missingAltLabel?: string | undefined;
}

export interface AnnouncementCardProps {
  announcement: Announcement;
  labels: AnnouncementCardLabels;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Uma novidade do mural: fixada, título, capa, corpo e destino. */
export function AnnouncementCard({
  announcement,
  labels,
  linkComponent,
  className,
}: AnnouncementCardProps) {
  const heading = announcement.href ? (
    <TextLink href={announcement.href} linkComponent={linkComponent}>
      {announcement.title}
    </TextLink>
  ) : (
    announcement.title
  );

  return (
    <article
      aria-label={`${labels.region}: ${announcement.title}`}
      className={['minui-announcement', className].filter(Boolean).join(' ')}
      data-pinned={announcement.pinned ? 'true' : undefined}
      data-unread={announcement.unread ? 'true' : undefined}
    >
      {announcement.coverUrl ? (
        <img
          className="minui-announcement__cover"
          src={announcement.coverUrl}
          alt={announcement.coverAlt ?? ''}
          loading="lazy"
          width={1200}
          height={630}
        />
      ) : null}
      <div className="minui-announcement__text">
        <div className="minui-announcement__meta">
          {announcement.pinned ? (
            <AdminTag className="minui-announcement__pin">
              <Pin aria-hidden="true" size={11} /> {labels.pinned}
            </AdminTag>
          ) : null}
          {announcement.unread ? (
            <>
              <span className="minui-announcement__dot" aria-hidden="true" />
              <span className="minui-sr-only">{labels.unread}</span>
            </>
          ) : null}
          {announcement.publishedAt ? (
            <time className="minui-announcement__date" dateTime={announcement.publishedAt}>
              {labels.date(announcement.publishedAt)}
            </time>
          ) : null}
        </div>
        <h3 className="minui-announcement__title">{heading}</h3>
        {announcement.bodyHtml || announcement.bodyMarkdown ? (
          <div className="minui-announcement__body">
            <Markdown
              html={announcement.bodyHtml ?? undefined}
              newTabLabel={labels.newTabLabel}
              missingAltLabel={labels.missingAltLabel}
            >
              {announcement.bodyMarkdown ?? ''}
            </Markdown>
          </div>
        ) : null}
        {announcement.link ? (
          <p className="minui-announcement__link">
            <TextLink
              href={announcement.link.href}
              external={announcement.link.external ?? false}
              newTabLabel={labels.newTabLabel}
              linkComponent={linkComponent}
            >
              {announcement.link.label}
            </TextLink>
          </p>
        ) : null}
      </div>
    </article>
  );
}

export interface AnnouncementListLabels extends AnnouncementCardLabels {
  emptyTitle: ReactNode;
  emptyText?: ReactNode;
  loading: string;
  errorTitle?: ReactNode;
  errorText?: ReactNode;
  retry?: string;
}

export interface AnnouncementListProps {
  announcements: readonly Announcement[];
  labels: AnnouncementListLabels;
  loading?: boolean;
  error?: boolean;
  onRetry?: (() => void) | undefined;
  emptyAction?: ReactNode;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Lista de novidades com os estados de carregando, vazio e erro (spec 006, RF-09). */
export function AnnouncementList({
  announcements,
  labels,
  loading = false,
  error = false,
  onRetry,
  emptyAction,
  linkComponent,
  className,
}: AnnouncementListProps) {
  return (
    <section
      aria-label={labels.region}
      className={['minui-announcements', className].filter(Boolean).join(' ')}
    >
      {loading ? (
        <LoadingState label={labels.loading} />
      ) : error ? (
        <ErrorState
          title={labels.errorTitle}
          text={labels.errorText}
          {...(onRetry ? { onRetry, retryLabel: labels.retry } : {})}
        />
      ) : announcements.length === 0 ? (
        <AdminEmpty icon={null} title={labels.emptyTitle} text={labels.emptyText}>
          {emptyAction}
        </AdminEmpty>
      ) : (
        <ul className="minui-announcements__list">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <AnnouncementCard
                announcement={announcement}
                labels={labels}
                linkComponent={linkComponent}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
