import { claimJobs, type Database, enqueue, getJobCounts } from '@nuva-edu/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWorkerMetrics } from '../src/metrics.ts';
import { createWorker, defaultWorkerId, type Worker, type WorkerOptions } from '../src/worker.ts';
import {
  captureLogger,
  clearJobs,
  deferred,
  getJob,
  handlersWith,
  openDatabase,
  testDatabaseUrl,
  waitFor,
} from './helpers.ts';

let db: Database;
/** Pool do segundo worker: outro "processo" disputando a fila. */
let other: Database;
const workers: Worker[] = [];

function makeWorker(
  options: Partial<WorkerOptions> & Pick<WorkerOptions, 'handlers'>,
  database: Database = db,
): Worker {
  const worker = createWorker({
    db: database,
    databaseUrl: testDatabaseUrl(),
    logger: captureLogger().logger,
    concurrency: 5,
    sweepIntervalMs: 50,
    ...options,
  });
  workers.push(worker);
  return worker;
}

beforeAll(() => {
  db = openDatabase(12);
  other = openDatabase(12);
});

afterAll(async () => {
  await db.destroy();
  await other.destroy();
});

beforeEach(async () => {
  await clearJobs(db);
});

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop({ timeoutMs: 200 })));
});

describe('laço de consumo', () => {
  it('identifica o worker como hostname:pid', () => {
    expect(defaultWorkerId()).toMatch(new RegExp(`^.+:${process.pid}$`));
  });

  it('executa cada tarefa uma única vez com dois workers concorrentes (1.000 tarefas)', async () => {
    const total = 1_000;
    const executions = new Map<string, number>();
    const byWorker = { a: 0, b: 0 };
    const handlerFor = (name: 'a' | 'b') =>
      handlersWith({
        'example.echo': async (job) => {
          executions.set(job.id, (executions.get(job.id) ?? 0) + 1);
          byWorker[name] += 1;
          // Cede a vez: os dois workers se alternam de verdade.
          await new Promise((resolve) => setImmediate(resolve));
        },
      });
    const metrics = createWorkerMetrics();
    const first = makeWorker({ handlers: handlerFor('a'), workerId: 'teste:a', metrics });
    const second = makeWorker({ handlers: handlerFor('b'), workerId: 'teste:b', metrics }, other);
    await Promise.all([first.start(), second.start()]);

    const ids: string[] = [];
    await db.transaction().execute(async (trx) => {
      for (let index = 0; index < total; index += 1) {
        const job = await enqueue(trx, 'example.echo', { message: `tarefa ${index}` });
        ids.push(job?.id ?? '');
      }
    });

    await waitFor(async () => (await getJobCounts(db)).done === total, 30_000);

    expect(executions.size).toBe(total);
    expect([...executions.values()].every((count) => count === 1)).toBe(true);
    expect(ids.every((id) => executions.has(id))).toBe(true);
    expect(byWorker.a + byWorker.b).toBe(total);
    expect(byWorker.a).toBeGreaterThan(0);
    expect(byWorker.b).toBeGreaterThan(0);
    expect(metrics.jobsTotal.get({ type: 'example.echo', outcome: 'done' })).toBe(total);
    expect(await getJobCounts(db)).toMatchObject({ queued: 0, running: 0, failed: 0 });
  }, 40_000);

  it('repete a tarefa que falha e a marca como failed ao esgotar as tentativas', async () => {
    let calls = 0;
    const metrics = createWorkerMetrics();
    const { logger, lines } = captureLogger();
    const worker = makeWorker({
      logger,
      metrics,
      handlers: handlersWith({
        'example.echo': async () => {
          calls += 1;
          throw new Error('falha de propósito');
        },
      }),
    });
    await worker.start();
    const job = await enqueue(db, 'example.echo', { message: 'x' }, { maxAttempts: 3 });
    const id = job?.id ?? '';

    for (const attempt of [1, 2]) {
      await waitFor(async () => {
        const row = await getJob(db, id);
        return row.status === 'queued' && row.attempts === attempt;
      });
      const row = await getJob(db, id);
      // Espera crescente: 2^tentativa × 30 s, ±20%.
      const waitSeconds = (row.runAt.getTime() - Date.now()) / 1000;
      expect(waitSeconds).toBeGreaterThan(2 ** attempt * 30 * 0.75);
      expect(waitSeconds).toBeLessThan(2 ** attempt * 30 * 1.25);
      expect(row.lastError).toContain('falha de propósito');
      expect(row.lockedBy).toBeNull();
      expect(calls).toBe(attempt);
      // Adianta o relógio da tarefa: o teste não espera a espera.
      await db
        .updateTable('jobs')
        .set({ runAt: new Date(Date.now() - 60_000) })
        .where('id', '=', id)
        .execute();
    }

    await waitFor(async () => (await getJob(db, id)).status === 'failed');
    const failed = await getJob(db, id);
    expect(failed.attempts).toBe(3);
    expect(failed.finishedAt).not.toBeNull();
    expect(failed.lastError).toContain('falha de propósito');
    expect(calls).toBe(3);
    expect(metrics.jobsTotal.get({ type: 'example.echo', outcome: 'retry' })).toBe(2);
    expect(metrics.jobsTotal.get({ type: 'example.echo', outcome: 'failed' })).toBe(1);
    expect(lines.filter((line) => line.msg === 'Tarefa falhou; nova tentativa')).toHaveLength(2);
    expect(lines.some((line) => line.level === 'error' && line.job_id === id)).toBe(true);

    // `failed` não volta sozinha.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(3);
  });

  it('marca como falha a tarefa de tipo desconhecido, sem derrubar o laço', async () => {
    const metrics = createWorkerMetrics();
    let echoed = 0;
    const worker = makeWorker({
      metrics,
      handlers: handlersWith({
        'example.echo': async () => {
          echoed += 1;
        },
      }),
    });
    await worker.start();
    const unknown = await db
      .insertInto('jobs')
      .values({ type: 'tipo.inexistente', payload: '{}', maxAttempts: 1 })
      .returning('id')
      .executeTakeFirstOrThrow();
    await enqueue(db, 'example.echo', { message: 'segue o baile' });

    await waitFor(async () => (await getJob(db, unknown.id)).status === 'failed');
    expect((await getJob(db, unknown.id)).lastError).toContain('Tipo de tarefa desconhecido');
    await waitFor(() => echoed === 1);
    expect(metrics.jobsTotal.get({ type: 'unknown', outcome: 'failed' })).toBe(1);
  });

  it('respeita o limite de concorrência', async () => {
    let active = 0;
    let peak = 0;
    const worker = makeWorker({
      concurrency: 2,
      handlers: handlersWith({
        'example.echo': async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active -= 1;
        },
      }),
    });
    await worker.start();
    for (let index = 0; index < 8; index += 1) {
      await enqueue(db, 'example.echo', { message: String(index) });
    }
    await waitFor(async () => (await getJobCounts(db)).done === 8);
    expect(peak).toBe(2);
  });

  it('pega a tarefa agendada só depois do run_at', async () => {
    let calls = 0;
    const worker = makeWorker({
      handlers: handlersWith({
        'example.echo': async () => {
          calls += 1;
        },
      }),
    });
    await worker.start();
    const job = await enqueue(
      db,
      'example.echo',
      { message: 'depois' },
      { runAt: new Date(Date.now() + 600) },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(calls).toBe(0);
    // Sem NOTIFY para tarefa futura: quem a encontra é a varredura.
    await waitFor(async () => (await getJob(db, job?.id ?? '')).status === 'done');
    expect(calls).toBe(1);
  });

  it('renova o batimento das tarefas em execução', async () => {
    const gate = deferred();
    const worker = makeWorker({
      heartbeatIntervalMs: 30,
      handlers: handlersWith({ 'example.echo': () => gate.promise }),
    });
    await worker.start();
    const job = await enqueue(db, 'example.echo', { message: 'longa' });
    const id = job?.id ?? '';
    await waitFor(async () => {
      const row = await getJob(db, id);
      return (
        row.status === 'running' &&
        row.heartbeatAt !== null &&
        row.lockedAt !== null &&
        row.heartbeatAt.getTime() > row.lockedAt.getTime()
      );
    });
    expect((await getJob(db, id)).lockedBy).toBe(worker.workerId);
    gate.resolve();
    await waitFor(async () => (await getJob(db, id)).status === 'done');
  });

  it('devolve à fila e executa a tarefa presa de um worker morto', async () => {
    const job = await enqueue(db, 'example.echo', { message: 'órfã' });
    const id = job?.id ?? '';
    await claimJobs(db, { workerId: 'morto:1', limit: 1 });
    await db
      .updateTable('jobs')
      .set({ heartbeatAt: new Date(Date.now() - 6 * 60_000) })
      .where('id', '=', id)
      .execute();

    let calls = 0;
    const worker = makeWorker({
      handlers: handlersWith({
        'example.echo': async () => {
          calls += 1;
        },
      }),
    });
    await worker.start();
    await waitFor(async () => (await getJob(db, id)).status === 'done');
    expect(calls).toBe(1);
    expect((await getJob(db, id)).attempts).toBe(2);
  });
});

describe('encerramento', () => {
  it('espera a tarefa em execução terminar dentro do prazo', async () => {
    const worker = makeWorker({
      handlers: handlersWith({
        'example.echo': () => new Promise((resolve) => setTimeout(resolve, 150)),
      }),
    });
    await worker.start();
    const job = await enqueue(db, 'example.echo', { message: 'quase' });
    const id = job?.id ?? '';
    await waitFor(() => worker.runningCount() === 1);

    const result = await worker.stop({ timeoutMs: 5_000 });

    expect(result.released).toBe(0);
    expect((await getJob(db, id)).status).toBe('done');
    expect(worker.isLoopActive()).toBe(false);
  });

  it('devolve à fila o que não terminou no prazo e para de pegar tarefas', async () => {
    const gate = deferred();
    let calls = 0;
    const worker = makeWorker({
      handlers: handlersWith({
        'example.echo': () => {
          calls += 1;
          return gate.promise;
        },
      }),
    });
    await worker.start();
    const job = await enqueue(db, 'example.echo', { message: 'demorada' });
    const id = job?.id ?? '';
    await waitFor(() => worker.runningCount() === 1);

    const result = await worker.stop({ timeoutMs: 50 });

    expect(result.released).toBe(1);
    const row = await getJob(db, id);
    expect(row.status).toBe('queued');
    // A tentativa interrompida não conta.
    expect(row.attempts).toBe(0);
    expect(row.lockedBy).toBeNull();

    // O manipulador termina tarde: o resultado não é gravado, e nada novo é pego.
    gate.resolve();
    await enqueue(db, 'example.echo', { message: 'depois do fim' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await getJob(db, id)).status).toBe('queued');
    expect(calls).toBe(1);
    expect((await getJobCounts(db)).queued).toBe(2);
  });
});
