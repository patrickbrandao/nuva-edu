import { createDatabase, type Database, enqueue } from '@nuva-edu/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHttpServer, type HttpServer, type HttpServerOptions } from '../src/http.ts';
import { createWorkerMetrics, METRICS_CONTENT_TYPE } from '../src/metrics.ts';
import { collectMetrics } from '../src/queue-metrics.ts';
import { captureLogger, clearJobs, openDatabase } from './helpers.ts';

let db: Database;
let server: HttpServer | undefined;

async function serve(options: Partial<HttpServerOptions> = {}): Promise<string> {
  server = createHttpServer({
    logger: captureLogger().logger,
    checks: { database: () => true },
    metrics: async () => '',
    ...options,
  });
  const port = await server.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${port}`;
}

beforeAll(() => {
  db = openDatabase();
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await clearJobs(db);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('HTTP interno do worker', () => {
  it('/healthz responde 200 sem depender das verificações', async () => {
    const base = await serve({
      checks: {
        database: () => {
          throw new Error('banco fora');
        },
      },
    });
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('/readyz responde 200 com todas as verificações em ordem', async () => {
    const base = await serve({
      checks: { database: async () => true, migrations: () => true, queue: () => true },
    });
    const response = await fetch(`${base}/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      checks: { database: 'ok', migrations: 'ok', queue: 'ok' },
    });
  });

  it('/readyz responde 503 e registra o motivo quando uma verificação falha ou lança', async () => {
    const { logger, lines } = captureLogger();
    const base = await serve({
      logger,
      checks: {
        database: async () => {
          throw new Error('banco fora');
        },
        queue: () => false,
        migrations: () => true,
      },
    });
    const response = await fetch(`${base}/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'not_ready',
      checks: { database: 'fail', queue: 'fail', migrations: 'ok' },
    });
    await fetch(`${base}/readyz`);
    // Só a mudança de estado é registrada, não cada sondagem.
    expect(lines.filter((line) => line.level === 'warn')).toHaveLength(1);
  });

  it('/metrics traz a fila por estado, executadas, falhas e duração', async () => {
    await enqueue(db, 'example.echo', { message: 'na fila' });
    await enqueue(
      db,
      'example.echo',
      { message: 'agendada' },
      { runAt: new Date(Date.now() + 3_600_000) },
    );
    const metrics = createWorkerMetrics();
    metrics.jobsTotal.inc({ type: 'example.echo', outcome: 'done' }, 3);
    metrics.jobsTotal.inc({ type: 'example.echo', outcome: 'failed' });
    metrics.jobDuration.observe({ type: 'example.echo' }, 0.02);
    const base = await serve({
      metrics: () => collectMetrics({ db, metrics, concurrency: 10, runningCount: () => 4 }),
    });

    const response = await fetch(`${base}/metrics`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(METRICS_CONTENT_TYPE);
    expect(text).toContain('jobs_total{type="example.echo",outcome="done"} 3');
    expect(text).toContain('jobs_total{type="example.echo",outcome="failed"} 1');
    expect(text).toContain('jobs_duration_seconds_count{type="example.echo"} 1');
    expect(text).toContain('jobs_queue_depth{type="example.echo"} 2');
    expect(text).toContain('jobs_failed{type="example.echo"} 0');
    expect(text).toContain('jobs_count{status="queued"} 2');
    expect(text).toContain('jobs_count{status="ready"} 1');
    expect(text).toContain('jobs_count{status="failed"} 0');
    expect(text).toContain('worker_jobs_running 4');
    expect(text).toContain('worker_concurrency 10');
    expect(text).toContain('worker_database_up 1');
  });

  it('/metrics continua respondendo com o banco fora', async () => {
    // Porta sem ninguém escutando: a conexão é recusada na hora.
    const closed = createDatabase({ connectionString: 'postgres://u:p@127.0.0.1:1/x' });
    const metrics = createWorkerMetrics();
    metrics.jobsTotal.inc({ type: 'example.echo', outcome: 'done' });
    const text = await collectMetrics({
      db: closed,
      metrics,
      concurrency: 1,
      runningCount: () => 0,
    });
    expect(text).toContain('worker_database_up 0');
    expect(text).toContain('jobs_total{type="example.echo",outcome="done"} 1');
    expect(text).not.toContain('jobs_queue_depth');
    await closed.destroy();
  });

  it('responde 404 a rota desconhecida e 405 a método que não é leitura', async () => {
    const base = await serve();
    expect((await fetch(`${base}/api/v1/qualquer`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(405);
  });
});
