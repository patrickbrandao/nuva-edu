import { type Database, getJobCounts, recurringKey } from '@nuva-edu/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from '../src/handlers.ts';
import {
  createScheduler,
  DEFAULT_TIMEZONE,
  dueWindow,
  localClock,
  RECURRING_JOBS,
  resolveTimezone,
  type Schedule,
  TIMEZONE_SETTING_KEY,
} from '../src/scheduler.ts';
import { createWorker } from '../src/worker.ts';
import {
  captureLogger,
  clearJobs,
  getJob,
  openDatabase,
  testDatabaseUrl,
  waitFor,
} from './helpers.ts';

let db: Database;
let other: Database;

async function setTimezone(value: unknown): Promise<void> {
  await db
    .insertInto('settings')
    .values({ key: TIMEZONE_SETTING_KEY, value: JSON.stringify(value) })
    .execute();
}

beforeAll(() => {
  db = openDatabase();
  other = openDatabase();
});

afterAll(async () => {
  await db.destroy();
  await other.destroy();
});

beforeEach(async () => {
  await clearJobs(db);
});

afterEach(async () => {
  await db.deleteFrom('settings').where('key', '=', TIMEZONE_SETTING_KEY).execute();
});

const PURGE: Schedule = { kind: 'daily', hour: 3, minute: 30 };

describe('janela das recorrentes', () => {
  it('calcula data e hora no fuso pedido', () => {
    const now = new Date('2026-11-24T02:10:00Z');
    expect(localClock(now, 'America/Sao_Paulo')).toEqual({ date: '2026-11-23', minutes: 1390 });
    expect(localClock(now, 'UTC')).toEqual({ date: '2026-11-24', minutes: 130 });
    expect(localClock(now, 'Asia/Tokyo')).toEqual({ date: '2026-11-24', minutes: 670 });
  });

  it('a diária só é devida a partir do horário, com a data local na janela', () => {
    const zone = 'America/Sao_Paulo';
    expect(dueWindow(PURGE, new Date('2026-11-24T06:29:59Z'), zone)).toBeNull();
    expect(dueWindow(PURGE, new Date('2026-11-24T06:30:00Z'), zone)).toBe('2026-11-24');
    expect(dueWindow(PURGE, new Date('2026-11-25T02:59:00Z'), zone)).toBe('2026-11-24');
    expect(dueWindow(PURGE, new Date('2026-11-25T03:10:00Z'), zone)).toBeNull();
    // No mesmo instante, outro fuso já está no dia seguinte.
    expect(dueWindow(PURGE, new Date('2026-11-24T20:00:00Z'), 'Asia/Tokyo')).toBe('2026-11-25');
  });

  it('o expurgo diário está agendado para 03:30', () => {
    expect(RECURRING_JOBS).toContainEqual({
      type: 'retention.purge',
      schedule: { kind: 'daily', hour: 3, minute: 30 },
      payload: {},
    });
  });
});

describe('fuso da escola', () => {
  it('usa o padrão quando a chave não existe', async () => {
    expect(await resolveTimezone(db)).toBe(DEFAULT_TIMEZONE);
    expect(DEFAULT_TIMEZONE).toBe('America/Sao_Paulo');
  });

  it('usa settings.timezone quando é um fuso válido', async () => {
    await setTimezone('Europe/Lisbon');
    expect(await resolveTimezone(db)).toBe('Europe/Lisbon');
  });

  it('volta ao padrão, com aviso, quando o valor não é um fuso', async () => {
    await setTimezone('Marte/Olympus');
    const { logger, lines } = captureLogger();
    expect(await resolveTimezone(db, logger)).toBe(DEFAULT_TIMEZONE);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('warn');
  });
});

describe('agendador', () => {
  const at = (iso: string) => () => new Date(iso);

  it('não enfileira antes do horário', async () => {
    const scheduler = createScheduler({
      db,
      logger: captureLogger().logger,
      now: at('2026-11-24T06:00:00Z'),
    });
    expect(await scheduler.runOnce()).toEqual([]);
    expect((await getJobCounts(db)).queued).toBe(0);
  });

  it('enfileira a janela do dia uma única vez com dois workers no ar', async () => {
    const now = at('2026-11-24T06:31:00Z');
    const first = createScheduler({ db, logger: captureLogger().logger, now });
    const second = createScheduler({ db: other, logger: captureLogger().logger, now });

    const created = (await Promise.all([first.runOnce(), second.runOnce()])).flat();

    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('retention.purge');
    expect(created[0]?.uniqueKey).toBe(recurringKey('retention.purge', '2026-11-24'));
    expect(await first.runOnce()).toEqual([]);
    expect((await getJobCounts(db)).queued).toBe(1);
  });

  it('usa o fuso da escola para decidir a janela', async () => {
    await setTimezone('Asia/Tokyo');
    const scheduler = createScheduler({
      db,
      logger: captureLogger().logger,
      now: at('2026-11-24T20:00:00Z'),
    });
    const created = await scheduler.runOnce();
    expect(created[0]?.uniqueKey).toBe('retention.purge:2026-11-25');
  });

  it('o expurgo agendado roda no worker e não volta para a mesma janela', async () => {
    const { logger, lines } = captureLogger();
    const scheduler = createScheduler({
      db,
      logger,
      now: at('2026-11-24T12:00:00Z'),
      intervalMs: 20,
    });
    const worker = createWorker({
      db,
      databaseUrl: testDatabaseUrl(),
      logger,
      handlers: createHandlers({ logger }),
      concurrency: 2,
      sweepIntervalMs: 50,
    });
    await worker.start();
    await scheduler.start();
    try {
      await waitFor(async () => (await getJobCounts(db)).done === 1);
      // Vários ciclos do agendador depois, a janela concluída não é enfileirada de novo.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await getJobCounts(db)).toMatchObject({ queued: 0, running: 0, done: 1, failed: 0 });
    } finally {
      await scheduler.stop();
      await worker.stop({ timeoutMs: 1_000 });
    }
    const ran = lines.find((line) => String(line.msg).startsWith('Expurgo diário executado'));
    expect(ran?.unique_key).toBe('retention.purge:2026-11-24');
    const job = await getJob(db, String(ran?.job_id));
    expect(job.status).toBe('done');
  });
});
