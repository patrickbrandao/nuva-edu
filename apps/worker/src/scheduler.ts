import {
  createSettingsReader,
  type Database,
  enqueueRecurring,
  type Job,
  type JobPayloads,
  type JobType,
  type Logger,
  type SettingsReader,
} from '@nuva-edu/core';

/** O agendador confere as recorrentes a cada minuto (spec 005). */
export const SCHEDULER_INTERVAL_MS = 60_000;

/**
 * Frequência de uma recorrente (spec 005, "Tarefas recorrentes"):
 * - `daily`: num horário fixo do fuso da escola, todos os dias;
 * - `weekly`: num dia da semana (`0` domingo ... `6` sábado) e horário do fuso da escola;
 * - `interval`: a cada `everyMinutes`, alinhado a múltiplos desde 00:00 UTC (divisor de 1440,
 *   para a grade não quebrar na virada do dia).
 */
export type Schedule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'interval'; everyMinutes: number };

export type RecurringJob = {
  [T in JobType]: { type: T; schedule: Schedule; payload: JobPayloads[T] };
}[JobType];

/**
 * Recorrentes desta fase (tabela "Tarefas recorrentes" da spec 005). O máximo de tentativas vem
 * do registro do núcleo (`JOB_DEFINITIONS`): 3 nas de intervalo, 5 nas diárias e na semanal.
 */
export const RECURRING_JOBS: readonly RecurringJob[] = [
  { type: 'retention.purge', schedule: { kind: 'daily', hour: 3, minute: 30 }, payload: {} },
  { type: 'image.cleanup', schedule: { kind: 'daily', hour: 3, minute: 45 }, payload: {} },
  { type: 'suspension.expire', schedule: { kind: 'interval', everyMinutes: 15 }, payload: {} },
];

/** Data (`AAAA-MM-DD`) e minutos desde a meia-noite de `now` no fuso dado. */
export function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

const MINUTES_PER_DAY = 1440;

/**
 * Janela devida agora, ou `null` se ainda não é hora (spec 005):
 * - diária: a data local, a partir do horário e até o fim do dia. Worker que sobe depois do
 *   horário ainda enfileira a janela do dia, uma única vez;
 * - semanal: a data local do dia marcado (a da segunda-feira, na semanal do catálogo), só nesse
 *   dia e a partir do horário;
 * - intervalo: o início do intervalo corrente em UTC (`AAAA-MM-DDTHH:MM`), sempre devida. O fuso
 *   da escola não entra.
 */
export function dueWindow(schedule: Schedule, now: Date, timeZone: string): string | null {
  if (schedule.kind === 'interval') {
    const every = schedule.everyMinutes;
    if (!Number.isInteger(every) || every < 1 || MINUTES_PER_DAY % every !== 0) {
      throw new RangeError(
        `Intervalo de recorrente inválido: ${every} min (use um divisor de 1440).`,
      );
    }
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const start = minutes - (minutes % every);
    const two = (value: number): string => String(value).padStart(2, '0');
    return `${now.toISOString().slice(0, 10)}T${two(Math.floor(start / 60))}:${two(start % 60)}`;
  }
  const clock = localClock(now, timeZone);
  if (clock.minutes < schedule.hour * 60 + schedule.minute) {
    return null;
  }
  if (schedule.kind === 'weekly') {
    // Dia da semana da data local (a data, lida como UTC, tem o mesmo dia da semana).
    const weekday = new Date(`${clock.date}T00:00:00Z`).getUTCDay();
    return weekday === schedule.weekday ? clock.date : null;
  }
  return clock.date;
}

export interface SchedulerOptions {
  db: Database;
  logger: Logger;
  jobs?: readonly RecurringJob[];
  intervalMs?: number;
  /**
   * Leitor das configurações da escola, de onde sai o fuso (`school.timezone`; padrão
   * `America/Sao_Paulo`). Padrão: um por agendador, com o cache do núcleo e o `logger`: valor
   * inválido no banco gera aviso e vale o padrão (spec 031).
   */
  settings?: SettingsReader;
  /** Relógio, para testes. */
  now?: () => Date;
}

export interface Scheduler {
  /** Confere agora e depois a cada intervalo. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Enfileira as recorrentes devidas; devolve as que este processo criou. */
  runOnce(): Promise<Job[]>;
}

/**
 * Agendador das recorrentes. Com vários workers no ar, todos tentam enfileirar a mesma janela e
 * `enqueueRecurring` deixa passar só o primeiro (`unique_key = tipo:janela`).
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const { db, logger } = options;
  const jobs = options.jobs ?? RECURRING_JOBS;
  const now = options.now ?? (() => new Date());
  // O cache do leitor (30 s) é menor que o intervalo do agendador: fuso trocado no admin vale
  // na conferência seguinte.
  const settings = options.settings ?? createSettingsReader(db, { logger });
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<unknown> | null = null;

  const runOnce = async (): Promise<Job[]> => {
    const timeZone = await settings.schoolTimezone();
    const moment = now();
    const created: Job[] = [];
    for (const entry of jobs) {
      const window = dueWindow(entry.schedule, moment, timeZone);
      if (window === null) {
        continue;
      }
      const job = await enqueueRecurring<JobType>(db, entry.type, entry.payload, { window });
      if (job) {
        created.push(job);
        logger.info(
          { job_id: job.id, job_type: job.type, window, timezone: timeZone },
          'Tarefa recorrente enfileirada',
        );
      }
    }
    return created;
  };

  const tick = (): Promise<unknown> => {
    current ??= runOnce()
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Falha ao agendar as tarefas recorrentes');
      })
      .finally(() => {
        current = null;
      });
    return current;
  };

  return {
    async start() {
      if (timer) {
        return;
      }
      timer = setInterval(() => void tick(), options.intervalMs ?? SCHEDULER_INTERVAL_MS);
      await tick();
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await current;
    },
    runOnce,
  };
}
