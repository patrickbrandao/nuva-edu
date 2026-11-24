import {
  type Database,
  enqueueRecurring,
  type Job,
  type JobPayloads,
  type JobType,
  type Logger,
} from '@nuva-edu/core';

/** Fuso da escola quando `settings.timezone` não existe ou é inválido (spec 005). */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
/** Chave da tabela `settings` com o fuso da escola. */
export const TIMEZONE_SETTING_KEY = 'timezone';
/** O agendador confere as recorrentes a cada minuto (spec 005). */
export const SCHEDULER_INTERVAL_MS = 60_000;

/** Diária num horário fixo do fuso da escola. As de intervalo entram com as tarefas que as usam. */
export type Schedule = { kind: 'daily'; hour: number; minute: number };

export type RecurringJob = {
  [T in JobType]: { type: T; schedule: Schedule; payload: JobPayloads[T] };
}[JobType];

/** Recorrentes desta fase (tabela "Tarefas recorrentes" da spec 005). */
export const RECURRING_JOBS: readonly RecurringJob[] = [
  { type: 'retention.purge', schedule: { kind: 'daily', hour: 3, minute: 30 }, payload: {} },
];

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

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

/**
 * Janela devida agora, ou `null` se o horário do dia ainda não chegou. A diária usa a data
 * local: worker que sobe depois do horário ainda enfileira a janela do dia, uma única vez.
 */
export function dueWindow(schedule: Schedule, now: Date, timeZone: string): string | null {
  const clock = localClock(now, timeZone);
  return clock.minutes >= schedule.hour * 60 + schedule.minute ? clock.date : null;
}

/** Fuso de `settings.timezone`; o padrão quando a chave não existe ou não é um fuso válido. */
export async function resolveTimezone(db: Database, logger?: Logger): Promise<string> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', TIMEZONE_SETTING_KEY)
    .executeTakeFirst();
  if (!row) {
    return DEFAULT_TIMEZONE;
  }
  if (typeof row.value === 'string' && isValidTimezone(row.value)) {
    return row.value;
  }
  logger?.warn(
    { setting: TIMEZONE_SETTING_KEY, fallback: DEFAULT_TIMEZONE },
    'Fuso da escola inválido; usando o padrão',
  );
  return DEFAULT_TIMEZONE;
}

export interface SchedulerOptions {
  db: Database;
  logger: Logger;
  jobs?: readonly RecurringJob[];
  intervalMs?: number;
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
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<unknown> | null = null;

  const runOnce = async (): Promise<Job[]> => {
    const timeZone = await resolveTimezone(db, logger);
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
