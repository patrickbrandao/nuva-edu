import { CalendarDays, ChevronLeft, ChevronRight, Radio, Video } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './community.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { AdminStatus as RawAdminStatus } from '../admin/AdminData.jsx';
import { Markdown } from '../catalog/Markdown';
import { TextLink } from '../flow/flow';
import type { LinkComponent } from '../link/link';
import {
  addMonths,
  buildMonthGrid,
  type CalendarDay,
  type EventJoinState,
  type EventStatus,
  eventJoinState,
  eventStatus,
  formatCivilDate,
  formatMonthLabel,
  todayKey,
  weekdayLabels,
  zonedDateKey,
} from './time';

/*
 * Calendário e eventos (spec 018).
 *
 * O status nunca vem do banco: `eventStatus` o recalcula a cada render a partir de
 * `starts_at`, `ends_at` e do relógio injetado (`now`). Quando o site atualiza `now` por um
 * temporizador, o selo passa de "em breve" a "ao vivo" e a "encerrado" sem recarregar.
 * O fuso do navegador entra por `timeZone`, e a data de cada evento no calendário é a do
 * calendário local (`zonedDateKey`), não a de UTC.
 *
 * A agenda é uma grade ARIA com foco móvel: só um dia entra na ordem do Tab, as setas
 * andam por dia/semana e Home/End vão ao começo e ao fim da semana.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminStatus = RawAdminStatus as Loose<typeof RawAdminStatus>;

export type EventKind = 'live' | 'meeting' | 'workshop' | 'other';

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Presente quando a equipe cancelou (spec 018, "Status"). */
  canceledAt?: string | null | undefined;
  kind?: EventKind | undefined;
  /** Tipo já traduzido; sem ele, o nome sai de `labels.kinds`. */
  kindLabel?: ReactNode;
  href?: string | undefined;
  /** Aula de gravação de um evento passado. */
  recordingHref?: string | undefined;
  /** Fora do público: mostra o bloqueio no lugar do link (spec 018, RF-04). */
  blocked?: boolean | undefined;
  descriptionHtml?: string | null | undefined;
  descriptionMarkdown?: string | null | undefined;
}

export interface EventStatusLabels {
  statuses: Record<EventStatus, string>;
}

const EVENT_TONES: Record<EventStatus, 'amber' | 'green' | 'gray' | 'red'> = {
  upcoming: 'amber',
  live: 'green',
  past: 'gray',
  canceled: 'red',
};

/** Selo do estado recalculado a partir do relógio injetado. */
export function EventStatusBadge({
  event,
  now,
  labels,
  className,
}: {
  event: Pick<CalendarEvent, 'startsAt' | 'endsAt' | 'canceledAt'>;
  now: string | number | Date;
  labels: EventStatusLabels;
  className?: string | undefined;
}) {
  const status = eventStatus(event.startsAt, event.endsAt, now, event.canceledAt);
  return (
    <AdminStatus dot tone={EVENT_TONES[status]} className={className}>
      {status === 'live' ? <Radio aria-hidden="true" size={12} /> : null}
      {labels.statuses[status]}
    </AdminStatus>
  );
}

export interface EventTimeProps {
  startsAt: string;
  endsAt: string;
  /** Idioma da data (padrão `pt-BR`). */
  locale?: string;
  /** Fuso em que a data é mostrada (padrão: o do navegador). */
  timeZone?: string | undefined;
  className?: string | undefined;
}

/** Data e hora do evento no fuso pedido; o intervalo de um dia é compactado. */
export function EventTime({
  startsAt,
  endsAt,
  locale = 'pt-BR',
  timeZone,
  className,
}: EventTimeProps) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());
  if (!valid) return <span className={className}>{startsAt}</span>;
  const dateFormat = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
  });
  const timeFormat = new Intl.DateTimeFormat(locale, {
    timeZone,
    timeStyle: 'short',
  });
  const sameDay = zonedDateKey(start, timeZone) === zonedDateKey(end, timeZone);
  const text = sameDay
    ? `${dateFormat.format(start)}, ${timeFormat.format(start)} – ${timeFormat.format(end)}`
    : `${dateFormat.format(start)}, ${timeFormat.format(start)} – ${dateFormat.format(end)}, ${timeFormat.format(end)}`;
  return (
    <span className={className}>
      <time dateTime={startsAt}>{text}</time>
    </span>
  );
}

export interface EventCardLabels extends EventStatusLabels {
  /** Nome do bloco (ex.: "Evento"). */
  region: string;
  /** Tipo de cada evento. */
  kinds?: Record<EventKind, string> | undefined;
  /** Texto do link de transmissão (ex.: "Entrar na transmissão"). */
  join: string;
  details?: string | undefined;
  /** Link da gravação. */
  recording: string;
  /** Aviso de público, com o caminho para obter acesso. */
  blockedTitle: string;
  blockedText?: ReactNode;
  newTabLabel?: string | undefined;
  missingAltLabel?: string | undefined;
}

export interface EventCardProps {
  event: CalendarEvent;
  /** Relógio injetado (deve ser atualizado pelo site para o status acompanhar o horário). */
  now: string | number | Date;
  labels: EventCardLabels;
  /** Ação de entrar, quando a janela de 15 minutos está aberta e a pessoa não está bloqueada. */
  joinAction?: ReactNode;
  /** Caminho para obter acesso, no bloqueio. */
  blockedAction?: ReactNode;
  locale?: string;
  timeZone?: string | undefined;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Cartão de um evento: tipo, título, data no fuso, descrição, estado e ações. */
export function EventCard({
  event,
  now,
  labels,
  joinAction,
  blockedAction,
  locale = 'pt-BR',
  timeZone,
  linkComponent,
  className,
}: EventCardProps) {
  const status = eventStatus(event.startsAt, event.endsAt, now, event.canceledAt);
  const join = eventJoinState(event.startsAt, event.endsAt, now);
  const kind = event.kindLabel ?? (event.kind && labels.kinds ? labels.kinds[event.kind] : null);
  const recordingHref = event.recordingHref;
  return (
    <article
      className={['minui-event', className].filter(Boolean).join(' ')}
      data-status={status}
      aria-label={`${labels.region}: ${event.title}`}
    >
      <header className="minui-event__head">
        <div className="minui-event__type">
          {status === 'live' ? (
            <Radio aria-hidden="true" size={14} />
          ) : (
            <CalendarDays aria-hidden="true" size={14} />
          )}
          {kind ? <span>{kind}</span> : null}
        </div>
        <EventStatusBadge event={event} now={now} labels={labels} />
      </header>
      <h3 className="minui-event__title">
        {event.href ? (
          <TextLink href={event.href} linkComponent={linkComponent}>
            {event.title}
          </TextLink>
        ) : (
          event.title
        )}
      </h3>
      <p className="minui-event__when">
        <EventTime
          startsAt={event.startsAt}
          endsAt={event.endsAt}
          locale={locale}
          timeZone={timeZone}
        />
      </p>

      {event.descriptionHtml || event.descriptionMarkdown ? (
        <div className="minui-event__body">
          <Markdown
            html={event.descriptionHtml ?? undefined}
            newTabLabel={labels.newTabLabel}
            missingAltLabel={labels.missingAltLabel}
          >
            {event.descriptionMarkdown ?? ''}
          </Markdown>
        </div>
      ) : null}

      {event.blocked ? (
        <div className="minui-event__blocked">
          <strong>{labels.blockedTitle}</strong>
          {labels.blockedText ? <p>{labels.blockedText}</p> : null}
          {blockedAction}
        </div>
      ) : (
        <div className="minui-event__actions">
          {join === 'open' && status !== 'canceled' && joinAction ? joinAction : null}
          {status === 'past' && recordingHref ? (
            <TextLink href={recordingHref} linkComponent={linkComponent}>
              <Video aria-hidden="true" size={13} /> {labels.recording}
            </TextLink>
          ) : null}
          {event.href && labels.details ? (
            <TextLink href={event.href} linkComponent={linkComponent}>
              {labels.details}
            </TextLink>
          ) : null}
        </div>
      )}
    </article>
  );
}

export interface EventBannerLabels extends EventStatusLabels {
  region: string;
  /** Chamada do banner (ex.: "Acontecendo agora"). */
  liveTitle: string;
  join: string;
  timeZoneNote?: string | undefined;
}

export interface EventBannerProps {
  event: CalendarEvent;
  now: string | number | Date;
  labels: EventBannerLabels;
  joinAction?: ReactNode;
  locale?: string;
  timeZone?: string | undefined;
  className?: string | undefined;
}

/**
 * Faixa da página inicial enquanto há evento ao vivo (spec 018, "Regras"). A região viva
 * fica montada sempre; o conteúdo só entra quando o status passa a `live`, e a troca é
 * anunciada sem tirar o foco de onde a pessoa está.
 */
export function EventBanner({
  event,
  now,
  labels,
  joinAction,
  locale = 'pt-BR',
  timeZone,
  className,
}: EventBannerProps) {
  const status = eventStatus(event.startsAt, event.endsAt, now, event.canceledAt);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={labels.region}
      className={['minui-event-banner', className].filter(Boolean).join(' ')}
    >
      {status === 'live' ? (
        <div className="minui-event-banner__inner">
          <span className="minui-event-banner__live">
            <Radio aria-hidden="true" size={14} /> {labels.liveTitle}
          </span>
          <strong className="minui-event-banner__title">{event.title}</strong>
          <EventTime
            startsAt={event.startsAt}
            endsAt={event.endsAt}
            locale={locale}
            timeZone={timeZone}
          />
          {joinAction}
        </div>
      ) : null}
    </div>
  );
}

export interface MonthCalendarLabels {
  /** Nome da grade (ex.: "Agenda de novembro de 2026"). */
  region: string;
  previousMonth: string;
  nextMonth: string;
  /** Nome acessível de um dia, ex.: (date, count) => `${date}, 2 eventos`. */
  day: (date: string, events: number) => string;
  /** Nome acessível do evento dentro do dia, quando o dia tem eventos. */
  dayEvent?: ((title: string) => string) | undefined;
  /** Texto quando o mês não tem eventos. */
  empty?: ReactNode;
}

export interface MonthCalendarProps {
  /** Mês exibido, `AAAA-MM`. */
  month: string;
  events: readonly CalendarEvent[];
  /** Relógio injetado; define "hoje" no fuso pedido. */
  now: string | number | Date;
  labels: MonthCalendarLabels;
  timeZone?: string | undefined;
  locale?: string;
  /** 0 começa no domingo; 1, na segunda-feira. */
  weekStartsOn?: 0 | 1;
  selectedDay?: string | null | undefined;
  onSelectDay?: ((day: string) => void) | undefined;
  onMonthChange?: ((month: string) => void) | undefined;
  className?: string | undefined;
}

/** Agenda mensal navegável por teclado, com os eventos marcados por dia. */
export function MonthCalendar({
  month,
  events,
  now,
  labels,
  timeZone,
  locale = 'pt-BR',
  weekStartsOn = 0,
  selectedDay,
  onSelectDay,
  onMonthChange,
  className,
}: MonthCalendarProps) {
  const titleId = useId();
  const weeks = buildMonthGrid(month, weekStartsOn);
  const cells = weeks.flat();
  const today = todayKey(now, timeZone);

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = zonedDateKey(event.startsAt, timeZone);
    if (!key) continue;
    const list = byDay.get(key);
    if (list) list.push(event);
    else byDay.set(key, [event]);
  }

  const firstInMonth = cells.find((cell) => cell.inMonth)?.date ?? '';
  const defaultDate = cells.some((cell) => cell.date === today) ? today : firstInMonth;
  const [active, setActive] = useState(selectedDay ?? defaultDate);

  useEffect(() => {
    if (selectedDay) setActive(selectedDay);
  }, [selectedDay]);

  const inGrid = (date: string) => cells.some((cell) => cell.date === date);
  const focusDate = inGrid(active) ? active : defaultDate;

  const refs = useRef(new Map<string, HTMLButtonElement>());
  const focusDay = (date: string) => {
    setActive(date);
    refs.current.get(date)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const index = cells.findIndex((cell) => cell.date === date);
    if (index < 0) return;
    const move = (target: number) => {
      const cell = cells[target];
      if (!cell) return;
      event.preventDefault();
      focusDay(cell.date);
    };
    switch (event.key) {
      case 'ArrowLeft':
        move(index - 1);
        break;
      case 'ArrowRight':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 7);
        break;
      case 'ArrowDown':
        move(index + 7);
        break;
      case 'Home':
        move(index - (index % 7));
        break;
      case 'End':
        move(index + (6 - (index % 7)));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelectDay?.(date);
        break;
      default:
        break;
    }
  };

  const weekdays = weekdayLabels(locale);
  const ordered = Array.from(
    { length: 7 },
    (_, offset) => weekdays[(offset + weekStartsOn) % 7] ?? '',
  );
  const selectDay = (date: string) => {
    setActive(date);
    onSelectDay?.(date);
  };

  return (
    <section
      aria-label={labels.region}
      className={['minui-calendar', className].filter(Boolean).join(' ')}
    >
      <div className="minui-calendar__head">
        <h2 id={titleId} className="minui-calendar__title">
          {formatMonthLabel(month, locale)}
        </h2>
        {onMonthChange ? (
          <div className="minui-calendar__nav">
            <AdminButton
              variant="ghost"
              size="sm"
              aria-label={labels.previousMonth}
              icon={<ChevronLeft aria-hidden="true" />}
              onClick={() => onMonthChange(addMonths(month, -1))}
            />
            <AdminButton
              variant="ghost"
              size="sm"
              aria-label={labels.nextMonth}
              icon={<ChevronRight aria-hidden="true" />}
              onClick={() => onMonthChange(addMonths(month, 1))}
            />
          </div>
        ) : null}
      </div>

      <table aria-labelledby={titleId} className="minui-calendar__grid">
        <thead>
          <tr>
            {ordered.map((weekday) => (
              <th key={weekday} scope="col" className="minui-calendar__weekday">
                <span aria-hidden="true">{weekday}</span>
                <span className="minui-sr-only">{weekday}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]?.date ?? ''}>
              {week.map((cell: CalendarDay) => {
                const dayEvents = byDay.get(cell.date) ?? [];
                const selected = selectedDay === cell.date;
                const isToday = cell.date === today;
                const label = labels.day(formatCivilDate(cell.date, locale), dayEvents.length);
                return (
                  <td
                    key={cell.date}
                    className="minui-calendar__cell"
                    data-outside={cell.inMonth ? undefined : 'true'}
                    data-selected={selected ? 'true' : undefined}
                    data-today={isToday ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) refs.current.set(cell.date, node);
                        else refs.current.delete(cell.date);
                      }}
                      tabIndex={cell.date === focusDate ? 0 : -1}
                      aria-label={label}
                      aria-current={isToday ? 'date' : undefined}
                      aria-pressed={selected}
                      className="minui-calendar__day"
                      data-date={cell.date}
                      data-events={dayEvents.length > 0 ? String(dayEvents.length) : undefined}
                      onClick={() => selectDay(cell.date)}
                      onKeyDown={(event) => onKeyDown(event, cell.date)}
                    >
                      <span aria-hidden="true">{cell.day}</span>
                      {dayEvents.length > 0 ? (
                        <span className="minui-calendar__dots" aria-hidden="true">
                          {dayEvents.slice(0, 3).map((entry) => (
                            <span key={entry.id} className="minui-calendar__dot" />
                          ))}
                        </span>
                      ) : null}
                      {dayEvents.length > 0 && labels.dayEvent ? (
                        <span className="minui-sr-only">
                          {dayEvents.map((entry) => labels.dayEvent?.(entry.title)).join(', ')}
                        </span>
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && labels.empty ? (
        <p className="minui-calendar__empty">{labels.empty}</p>
      ) : null}
    </section>
  );
}

/** Reexporta os estados de entrada e de janela usados pelos sites (spec 018, RF-04). */
export type { EventJoinState, EventStatus };
export { eventJoinState, eventStatus };
