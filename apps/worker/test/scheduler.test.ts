import {
  createSettingsReader,
  type Database,
  getJobCounts,
  recurringKey,
  SETTING_DEFAULTS,
  setSetting,
} from '@nuva-edu/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from '../src/handlers.ts';
import {
  createScheduler,
  dueWindow,
  localClock,
  RECURRING_JOBS,
  type Schedule,
} from '../src/scheduler.ts';
import { createWorker } from '../src/worker.ts';
import {
  captureLogger,
  clearJobs,
  getJob,
  handlerDependencies,
  openDatabase,
  testDatabaseUrl,
  waitFor,
} from './helpers.ts';

let db: Database;
let other: Database;

const TIMEZONE_KEY = 'school.timezone';
const INVALID_SETTING = 'Configuração com valor inválido no banco; usando o padrão';

/** Grava direto na tabela, como quem escreve por fora da admin-api (sem a validação do núcleo). */
async function storeRawTimezone(value: unknown): Promise<void> {
  await db
    .insertInto('settings')
    .values({ key: TIMEZONE_KEY, value: JSON.stringify(value) })
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
  await db.deleteFrom('settings').where('key', '=', TIMEZONE_KEY).execute();
});

const PURGE: Schedule = { kind: 'daily', hour: 3, minute: 30 };
/** Só o expurgo: os testes de janela e de fuso olham uma recorrente diária só. */
const PURGE_ONLY = RECURRING_JOBS.filter((entry) => entry.type === 'retention.purge');

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

  it('a semanal só é devida no dia marcado, a partir do horário, com a data local desse dia', () => {
    const zone = 'America/Sao_Paulo';
    const weekly: Schedule = { kind: 'weekly', weekday: 1, hour: 0, minute: 0 };
    // 2026-11-23 é segunda-feira. Domingo 23:59 local ainda não; segunda 00:00 local já.
    expect(dueWindow(weekly, new Date('2026-11-23T02:59:00Z'), zone)).toBeNull();
    expect(dueWindow(weekly, new Date('2026-11-23T03:00:00Z'), zone)).toBe('2026-11-23');
    expect(dueWindow(weekly, new Date('2026-11-24T02:59:00Z'), zone)).toBe('2026-11-23');
    // Terça-feira local: a janela da semana não é recuperada.
    expect(dueWindow(weekly, new Date('2026-11-24T03:00:00Z'), zone)).toBeNull();
    // Segunda-feira antes do horário marcado.
    const morning: Schedule = { kind: 'weekly', weekday: 1, hour: 8, minute: 30 };
    expect(dueWindow(morning, new Date('2026-11-23T11:29:00Z'), zone)).toBeNull();
    expect(dueWindow(morning, new Date('2026-11-23T11:30:00Z'), zone)).toBe('2026-11-23');
  });

  it('a de intervalo usa o início do intervalo em UTC, sem depender do fuso', () => {
    const every15: Schedule = { kind: 'interval', everyMinutes: 15 };
    for (const zone of ['America/Sao_Paulo', 'Asia/Tokyo']) {
      expect(dueWindow(every15, new Date('2026-11-24T10:15:00Z'), zone)).toBe('2026-11-24T10:15');
      expect(dueWindow(every15, new Date('2026-11-24T10:29:59Z'), zone)).toBe('2026-11-24T10:15');
      expect(dueWindow(every15, new Date('2026-11-24T10:30:00Z'), zone)).toBe('2026-11-24T10:30');
    }
    const every6h: Schedule = { kind: 'interval', everyMinutes: 360 };
    expect(dueWindow(every6h, new Date('2026-11-24T05:59:00Z'), 'UTC')).toBe('2026-11-24T00:00');
    expect(dueWindow(every6h, new Date('2026-11-24T23:59:00Z'), 'UTC')).toBe('2026-11-24T18:00');
    expect(dueWindow(every6h, new Date('2026-11-25T00:00:00Z'), 'UTC')).toBe('2026-11-25T00:00');
  });

  it('intervalo que não divide o dia é recusado', () => {
    const now = new Date('2026-11-24T10:15:00Z');
    expect(() => dueWindow({ kind: 'interval', everyMinutes: 7 }, now, 'UTC')).toThrow(RangeError);
    expect(() => dueWindow({ kind: 'interval', everyMinutes: 0 }, now, 'UTC')).toThrow(RangeError);
  });

  it('o expurgo diário está agendado para 03:30', () => {
    expect(RECURRING_JOBS).toContainEqual({
      type: 'retention.purge',
      schedule: { kind: 'daily', hour: 3, minute: 30 },
      payload: {},
    });
  });

  it('a limpeza de imagens é diária às 03:45 e o fim de suspensão, a cada 15 min', () => {
    expect(RECURRING_JOBS).toContainEqual({
      type: 'image.cleanup',
      schedule: { kind: 'daily', hour: 3, minute: 45 },
      payload: {},
    });
    expect(RECURRING_JOBS).toContainEqual({
      type: 'suspension.expire',
      schedule: { kind: 'interval', everyMinutes: 15 },
      payload: {},
    });
  });
});

describe('agendador', () => {
  const at = (iso: string) => () => new Date(iso);

  it('não enfileira antes do horário', async () => {
    const scheduler = createScheduler({
      db,
      logger: captureLogger().logger,
      jobs: PURGE_ONLY,
      now: at('2026-11-24T06:00:00Z'),
    });
    expect(await scheduler.runOnce()).toEqual([]);
    expect((await getJobCounts(db)).queued).toBe(0);
  });

  it('enfileira a janela do dia uma única vez com dois workers no ar', async () => {
    const now = at('2026-11-24T06:31:00Z');
    const first = createScheduler({ db, logger: captureLogger().logger, now, jobs: PURGE_ONLY });
    const second = createScheduler({
      db: other,
      logger: captureLogger().logger,
      now,
      jobs: PURGE_ONLY,
    });

    const created = (await Promise.all([first.runOnce(), second.runOnce()])).flat();

    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('retention.purge');
    expect(created[0]?.uniqueKey).toBe(recurringKey('retention.purge', '2026-11-24'));
    expect(await first.runOnce()).toEqual([]);
    expect((await getJobCounts(db)).queued).toBe(1);
  });

  it('enfileira as recorrentes da fase, cada uma com a sua janela', async () => {
    // 07:00 em São Paulo: as duas diárias já são devidas; a de 15 min, sempre.
    const scheduler = createScheduler({
      db,
      logger: captureLogger().logger,
      now: at('2026-11-24T10:07:00Z'),
    });
    const keys = (await scheduler.runOnce()).map((job) => job.uniqueKey).sort();
    expect(keys).toEqual([
      recurringKey('image.cleanup', '2026-11-24'),
      recurringKey('payment.reconcile_orders', '2026-11-24T10:05'),
      recurringKey('payment.reconcile_refunds', '2026-11-24T10:00'),
      recurringKey('payment.reconcile_subscriptions', '2026-11-24T06:00'),
      recurringKey('retention.purge', '2026-11-24'),
      recurringKey('suspension.expire', '2026-11-24T10:00'),
    ]);
    const jobs = await db.selectFrom('jobs').select(['type', 'maxAttempts']).execute();
    expect(Object.fromEntries(jobs.map((job) => [job.type, job.maxAttempts]))).toEqual({
      'image.cleanup': 5,
      'payment.reconcile_orders': 3,
      'payment.reconcile_refunds': 3,
      'payment.reconcile_subscriptions': 3,
      'retention.purge': 5,
      'suspension.expire': 3,
    });
    // Antes das 03:45 locais só a limpeza de imagens fica de fora.
    await clearJobs(db);
    const early = createScheduler({
      db,
      logger: captureLogger().logger,
      now: at('2026-11-24T06:40:00Z'),
    });
    expect((await early.runOnce()).map((job) => job.type).sort()).toEqual([
      'payment.reconcile_orders',
      'payment.reconcile_refunds',
      'payment.reconcile_subscriptions',
      'retention.purge',
      'suspension.expire',
    ]);
  });

  describe('fuso da escola (school.timezone)', () => {
    // 20:00 UTC: 17:00 do mesmo dia em São Paulo, 05:00 do dia seguinte em Tóquio.
    const now = at('2026-11-24T20:00:00Z');

    it('sem a chave gravada, a janela diária segue o padrão America/Sao_Paulo', async () => {
      expect(SETTING_DEFAULTS[TIMEZONE_KEY]).toBe('America/Sao_Paulo');
      const { logger, lines } = captureLogger();
      const created = await createScheduler({ db, logger, now, jobs: PURGE_ONLY }).runOnce();
      expect(created[0]?.uniqueKey).toBe('retention.purge:2026-11-24');
      expect(lines.find((line) => line.msg === 'Tarefa recorrente enfileirada')).toMatchObject({
        window: '2026-11-24',
        timezone: 'America/Sao_Paulo',
      });
      expect(lines.some((line) => line.level === 'warn')).toBe(false);
    });

    it('com a chave gravada, a janela diária segue o fuso da escola', async () => {
      await setSetting(db, TIMEZONE_KEY, 'Asia/Tokyo');
      const { logger, lines } = captureLogger();
      const created = await createScheduler({ db, logger, now, jobs: PURGE_ONLY }).runOnce();
      expect(created[0]?.uniqueKey).toBe('retention.purge:2026-11-25');
      expect(lines.find((line) => line.msg === 'Tarefa recorrente enfileirada')).toMatchObject({
        window: '2026-11-25',
        timezone: 'Asia/Tokyo',
      });
    });

    it('no fuso gravado, antes do horário local nada é enfileirado', async () => {
      // 10:00 UTC: 07:00 em São Paulo (devida no padrão), mas 02:00 em Los Angeles.
      await setSetting(db, TIMEZONE_KEY, 'America/Los_Angeles');
      const scheduler = createScheduler({
        db,
        logger: captureLogger().logger,
        jobs: PURGE_ONLY,
        now: at('2026-11-24T10:00:00Z'),
      });
      expect(await scheduler.runOnce()).toEqual([]);
    });

    it('valor inválido no banco cai no padrão, com aviso que leva só a chave', async () => {
      await storeRawTimezone('Marte/Olympus');
      const { logger, lines } = captureLogger();
      const created = await createScheduler({ db, logger, now, jobs: PURGE_ONLY }).runOnce();
      expect(created[0]?.uniqueKey).toBe('retention.purge:2026-11-24');
      const warnings = lines.filter((line) => line.msg === INVALID_SETTING);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ level: 'warn', setting_key: TIMEZONE_KEY });
      expect(JSON.stringify(lines)).not.toContain('Marte/Olympus');
    });

    it('valor que não é texto também cai no padrão', async () => {
      await storeRawTimezone(42);
      const { logger, lines } = captureLogger();
      const created = await createScheduler({ db, logger, now, jobs: PURGE_ONLY }).runOnce();
      expect(created[0]?.uniqueKey).toBe('retention.purge:2026-11-24');
      expect(lines.filter((line) => line.msg === INVALID_SETTING)).toHaveLength(1);
    });

    it('usa o leitor recebido: o fuso vem do cache até ele vencer', async () => {
      let clock = 0;
      const settings = createSettingsReader(db, { ttlMs: 30_000, now: () => clock });
      const scheduler = createScheduler({
        db,
        logger: captureLogger().logger,
        now,
        settings,
        jobs: PURGE_ONLY,
      });
      expect((await scheduler.runOnce())[0]?.uniqueKey).toBe('retention.purge:2026-11-24');
      await setSetting(db, TIMEZONE_KEY, 'Asia/Tokyo');
      // Dentro da validade do cache, a mesma janela (já enfileirada): nada novo.
      expect(await scheduler.runOnce()).toEqual([]);
      clock = 30_000;
      expect((await scheduler.runOnce())[0]?.uniqueKey).toBe('retention.purge:2026-11-25');
    });
  });

  it('o expurgo agendado roda no worker e não volta para a mesma janela', async () => {
    const { logger, lines } = captureLogger();
    const scheduler = createScheduler({
      db,
      logger,
      jobs: PURGE_ONLY,
      now: at('2026-11-24T12:00:00Z'),
      intervalMs: 20,
    });
    const worker = createWorker({
      db,
      databaseUrl: testDatabaseUrl(),
      logger,
      handlers: createHandlers(handlerDependencies(db, logger)),
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
