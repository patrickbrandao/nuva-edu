import { useId, useMemo } from 'react';
import '../../styles/tokens.css';
import './learning.css';

/*
 * Mapa de atividade de "Meu progresso" (spec 014, RF-08): 53 semanas × 7 dias, um quadrado
 * por dia, 5 intensidades. Recebe `{ day, total }[]` e o dia de hoje como `AAAA-MM-DD`, já no
 * fuso do aluno (resolvido pela API): todas as contas de data aqui são em UTC sobre essas
 * strings, para o fuso do navegador não deslocar nenhum dia.
 * Acessível como tabela: uma linha por dia da semana (`th scope="row"`), cada célula com o
 * texto do dia para o leitor de tela; o resumo do período fica ligado por `aria-describedby`.
 */

export const HEATMAP_WEEKS = 53;
export const HEATMAP_LEVELS = 5;
const DAY_MS = 86_400_000;
const LEVELS = Array.from({ length: HEATMAP_LEVELS }, (_, level) => level);

export interface ActivityDay {
  /** `AAAA-MM-DD`. */
  day: string;
  total: number;
}

export interface ActivityHeatmapLabels {
  /** Nome do mapa (legenda da tabela), ex.: "Atividade nos últimos 12 meses". */
  title: string;
  /** Texto de um dia, ex.: (`"12 de março de 2026"`, 3) → "3 atividades em 12 de março de 2026". */
  day: (date: string, total: number) => string;
  /** Resumo do período, ex.: (40, 12) → "40 atividades em 12 dias". */
  summary: (total: number, activeDays: number) => string;
  /** Extremos da legenda de cores, ex.: "Menos" e "Mais". */
  less: string;
  more: string;
}

export interface ActivityHeatmapProps {
  days: readonly ActivityDay[];
  /** Hoje, `AAAA-MM-DD`, no fuso do aluno. */
  today: string;
  labels: ActivityHeatmapLabels;
  /** Idioma dos nomes de mês, de dia da semana e das datas (padrão `pt-BR`). */
  locale?: string;
  className?: string | undefined;
}

export interface HeatmapCell {
  date: string;
  total: number;
  level: number;
  /** Depois de hoje: quadrado vazio, fora da contagem. */
  future: boolean;
}

function parseDay(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : time;
}

function formatDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Intensidade de 0 a 4: 0 sem atividade; 1 a 4 em quartos do maior total do período. */
export function activityLevel(total: number, max: number): number {
  if (!(total > 0) || !(max > 0)) return 0;
  return Math.min(HEATMAP_LEVELS - 1, Math.max(1, Math.ceil((total / max) * (HEATMAP_LEVELS - 1))));
}

/** Monta as 53 colunas (semanas, domingo a sábado); a última contém hoje. */
export function buildActivityGrid(days: readonly ActivityDay[], today: string): HeatmapCell[][] {
  const end = parseDay(today);
  if (end === null) return [];
  const weekday = new Date(end).getUTCDay();
  const start = end - (weekday + (HEATMAP_WEEKS - 1) * 7) * DAY_MS;
  const totals = new Map<string, number>();
  for (const { day, total } of days) {
    if (Number.isFinite(total) && total > 0) totals.set(day, (totals.get(day) ?? 0) + total);
  }
  let max = 0;
  for (const [day, total] of totals) {
    const time = parseDay(day);
    if (time !== null && time >= start && time <= end) max = Math.max(max, total);
  }
  const weeks: HeatmapCell[][] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const week: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const time = start + (w * 7 + d) * DAY_MS;
      const date = formatDay(time);
      const future = time > end;
      const total = future ? 0 : (totals.get(date) ?? 0);
      week.push({ date, total, level: activityLevel(total, max), future });
    }
    weeks.push(week);
  }
  return weeks;
}

/** Mapa de atividade acessível. */
export function ActivityHeatmap({
  days,
  today,
  labels,
  locale = 'pt-BR',
  className,
}: ActivityHeatmapProps) {
  const summaryId = useId();
  const weeks = useMemo(() => buildActivityGrid(days, today), [days, today]);
  const text = useMemo(() => {
    const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'long' });
    const monthFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short' });
    const weekdayFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' });
    // 2023-01-01 foi um domingo
    const weekdays = Array.from({ length: 7 }, (_, i) =>
      weekdayFormat.format(Date.UTC(2023, 0, 1 + i)),
    );
    return { dateFormat, monthFormat, weekdays };
  }, [locale]);

  let total = 0;
  let activeDays = 0;
  for (const week of weeks) {
    for (const cell of week) {
      total += cell.total;
      if (cell.total > 0) activeDays++;
    }
  }

  const months = weeks.map((week, index) => {
    const first = week[0]?.date ?? '';
    const previous = index > 0 ? (weeks[index - 1]?.[0]?.date ?? '') : '';
    const time = parseDay(first);
    if (time === null || (index > 0 && first.slice(0, 7) === previous.slice(0, 7))) return '';
    return text.monthFormat.format(time);
  });

  return (
    <div className={['minui-heatmap', className].filter(Boolean).join(' ')}>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a área rola na horizontal em tela estreita e precisa de foco pelo teclado */}
      <div className="minui-heatmap__scroll" tabIndex={0}>
        <table className="minui-heatmap__grid" aria-describedby={summaryId}>
          <caption className="minui-sr-only">{labels.title}</caption>
          <thead aria-hidden="true">
            <tr>
              <td className="minui-heatmap__corner" />
              {months.map((month, index) => (
                <td key={weeks[index]?.[0]?.date ?? index} className="minui-heatmap__month">
                  {month}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {text.weekdays.map((weekday, row) => (
              <tr key={weekday}>
                <th scope="row" className="minui-heatmap__weekday" data-row={row}>
                  {weekday}
                </th>
                {weeks.map((week) => {
                  const cell = week[row];
                  if (!cell) return null;
                  if (cell.future) {
                    return <td key={cell.date} className="minui-heatmap__day" data-future="" />;
                  }
                  const time = parseDay(cell.date) ?? 0;
                  const label = labels.day(text.dateFormat.format(time), cell.total);
                  return (
                    <td
                      key={cell.date}
                      className="minui-heatmap__day"
                      data-level={cell.level}
                      data-date={cell.date}
                      title={label}
                    >
                      <span className="minui-sr-only">{label}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="minui-heatmap__foot">
        <p id={summaryId} className="minui-heatmap__summary">
          {labels.summary(total, activeDays)}
        </p>
        <div className="minui-heatmap__legend" aria-hidden="true">
          <span>{labels.less}</span>
          {LEVELS.map((level) => (
            <span key={level} className="minui-heatmap__swatch" data-level={level} />
          ))}
          <span>{labels.more}</span>
        </div>
      </div>
    </div>
  );
}
