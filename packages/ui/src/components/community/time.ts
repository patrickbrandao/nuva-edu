/*
 * Contas de data e hora dos componentes da comunidade (specs 017, 018, 023, 024, 025 e 026).
 *
 * O fuso e o relógio são sempre injetados: o site passa `timeZone` (o do navegador, por
 * padrão) e `now` (a hora corrigida pela resposta da API, quando houver). Nada aqui lê
 * `new Date()` por conta própria, para o teste conseguir fixar o instante e o fuso.
 *
 * As datas de calendário (`AAAA-MM-DD`) são civis: o dia da semana de `2026-11-01` é o
 * mesmo em qualquer fuso. O fuso entra só em duas perguntas — que dia é hoje para quem
 * olha, e em que dia do calendário local cai um instante — respondidas por `Intl`.
 */

/** Janela em que o link de transmissão de um evento é exibido (spec 018, RF-04). */
export const EVENT_JOIN_WINDOW_MS = 15 * 60 * 1000;

export type EventStatus = 'upcoming' | 'live' | 'past' | 'canceled';

/** `early`: ainda antes da janela de 15 minutos; `open`: pode entrar; `ended`: já terminou. */
export type EventJoinState = 'early' | 'open' | 'ended';

const DAY_MS = 86_400_000;

/** Converte ISO, epoch ms ou `Date` em milissegundos; valor inválido vira `NaN`. */
export function toInstant(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NaN : time;
}

/**
 * Estado do evento a partir do horário, com o cancelamento mandando em tudo (spec 018,
 * "Status"). `now` é o relógio injetado; `canceledAt` existe quando a equipe cancelou.
 */
export function eventStatus(
  startsAt: string | number | Date,
  endsAt: string | number | Date,
  now: string | number | Date,
  canceledAt?: string | number | Date | null | undefined,
): EventStatus {
  if (canceledAt != null) return 'canceled';
  const nowTime = toInstant(now);
  const start = toInstant(startsAt);
  const end = toInstant(endsAt);
  if (Number.isNaN(nowTime) || Number.isNaN(start) || Number.isNaN(end)) return 'upcoming';
  if (nowTime < start) return 'upcoming';
  if (nowTime < end) return 'live';
  return 'past';
}

/**
 * Se o link de transmissão pode ser mostrado agora: de 15 minutos antes do início até o
 * fim do evento. Depois do fim, a gravação toma o lugar do link (spec 018, RF-04 e RF-05).
 */
export function eventJoinState(
  startsAt: string | number | Date,
  endsAt: string | number | Date,
  now: string | number | Date,
): EventJoinState {
  const nowTime = toInstant(now);
  const start = toInstant(startsAt);
  const end = toInstant(endsAt);
  if (Number.isNaN(nowTime) || Number.isNaN(start) || Number.isNaN(end)) return 'early';
  if (nowTime >= end) return 'ended';
  if (nowTime >= start - EVENT_JOIN_WINDOW_MS) return 'open';
  return 'early';
}

/** Partes civis de um instante no fuso pedido (`en-CA` dá `AAAA-MM-DD` na data). */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** Ano, mês, dia e hora de um instante no fuso informado (não depende do fuso do navegador). */
export function zonedParts(
  value: string | number | Date,
  timeZone: string | undefined,
): ZonedParts {
  const time = toInstant(value);
  if (Number.isNaN(time)) return { year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  const parts = zonedFormatter(timeZone ?? 'UTC').formatToParts(new Date(time));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((item) => item.type === type);
    return part ? Number(part.value) : 0;
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
  };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Dia do calendário local (`AAAA-MM-DD`) em que um instante cai. */
export function zonedDateKey(value: string | number | Date, timeZone: string | undefined): string {
  const parts = zonedParts(value, timeZone);
  if (parts.year === 0) return '';
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Mês (`AAAA-MM`) do calendário local em que um instante cai. */
export function zonedMonthKey(value: string | number | Date, timeZone: string | undefined): string {
  return zonedDateKey(value, timeZone).slice(0, 7);
}

/** Soma meses a um `AAAA-MM`, virando o ano quando precisa. */
export function addMonths(month: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  return `${year}-${pad((index % 12) + 1)}`;
}

/** Hoje (no fuso informado) como `AAAA-MM-DD`. */
export function todayKey(now: string | number | Date, timeZone: string | undefined): string {
  return zonedDateKey(now, timeZone);
}

export interface CalendarDay {
  /** `AAAA-MM-DD`. */
  date: string;
  /** Dia do mês (1 a 31). */
  day: number;
  /** Falso nos dias do mês anterior ou seguinte que completam a semana. */
  inMonth: boolean;
}

/** Índice do dia da semana de uma data civil: 0 = domingo, como `getUTCDay`. */
export function civilWeekday(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 0;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/**
 * Semanas do mês (`AAAA-MM`) para a agenda, com os dias vizinhos que completam a primeira e
 * a última semana. `weekStartsOn` 0 começa no domingo; 1, na segunda-feira.
 */
export function buildMonthGrid(month: string, weekStartsOn: 0 | 1 = 0): CalendarDay[][] {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return [];
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const first = Date.UTC(year, monthIndex, 1);
  const firstWeekday = new Date(first).getUTCDay();
  const offset = (firstWeekday - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const start = first - offset * DAY_MS;

  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < cells; index++) {
    const time = start + index * DAY_MS;
    const date = new Date(time);
    const weekIndex = Math.floor(index / 7);
    if (index % 7 === 0) weeks.push([]);
    const week = weeks[weekIndex];
    if (!week) continue;
    week.push({
      date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthIndex,
    });
  }
  return weeks;
}

/** Nome do mês e do ano para o cabeçalho do calendário (data civil, em UTC). */
export function formatMonthLabel(month: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** Data civil por extenso, para o nome acessível de um dia. */
export function formatCivilDate(date: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'full' }).format(time);
}

/** Rótulo curto de cada dia da semana (domingo primeiro), para o cabeçalho da agenda. */
export function weekdayLabels(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' });
  // 2023-01-01 foi um domingo
  return Array.from({ length: 7 }, (_, index) => format.format(Date.UTC(2023, 0, 1 + index)));
}
