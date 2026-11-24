import {
  type Config,
  closeDatabase,
  createDatabase,
  type Logger,
  pingDatabase,
} from '@nuva-edu/core';
import {
  connect,
  currentVersion,
  defaultMigrationsDir,
  latestVersion,
  parseDatabaseUrl,
} from '@nuva-edu/database';
import { createHandlers } from './handlers.ts';
import { createHttpServer } from './http.ts';
import { createWorkerMetrics } from './metrics.ts';
import { collectMetrics } from './queue-metrics.ts';
import { createScheduler } from './scheduler.ts';
import { createWorker, SHUTDOWN_TIMEOUT_MS } from './worker.ts';

export interface AppOptions {
  config: Config;
  logger: Logger;
  /** Porta do HTTP interno (saúde e métricas). */
  port: number;
  host?: string;
  shutdownTimeoutMs?: number;
}

export interface App {
  port: number;
  workerId: string;
  /** Encerramento ordenado; devolve quantas tarefas voltaram à fila sem terminar. */
  stop(): Promise<{ released: number }>;
}

/** `true` quando o banco está na versão de migration que este código espera (spec 033). */
async function migrationsUpToDate(connectionString: string): Promise<boolean> {
  const wanted = await latestVersion(defaultMigrationsDir);
  const client = await connect(parseDatabaseUrl(connectionString));
  try {
    return (await currentVersion(client)) === wanted;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Sobe o worker inteiro: banco, laço de consumo, agendador e HTTP interno. */
export async function startApp(options: AppOptions): Promise<App> {
  const { config, logger } = options;
  const concurrency = config.workerConcurrency;
  const db = createDatabase({
    connectionString: config.databaseUrl,
    applicationName: 'worker',
    // Uma conexão por tarefa em execução, mais folga para claim, batimento, agendador e saúde.
    maxConnections: concurrency + 5,
    logger,
  });
  const metrics = createWorkerMetrics();
  const worker = createWorker({
    db,
    databaseUrl: config.databaseUrl,
    logger,
    handlers: createHandlers({ logger }),
    concurrency,
    metrics,
  });
  const scheduler = createScheduler({ db, logger });
  const http = createHttpServer({
    logger,
    checks: {
      database: () => pingDatabase(db),
      migrations: () => migrationsUpToDate(config.databaseUrl),
      queue: () => worker.isLoopActive(),
    },
    metrics: () =>
      collectMetrics({ db, metrics, concurrency, runningCount: () => worker.runningCount() }),
  });

  // A saúde responde antes de o banco responder: `/healthz` não depende dele.
  const port = await http.listen(options.port, options.host);
  await worker.start();
  await scheduler.start();
  logger.info({ worker_id: worker.workerId, concurrency, port }, 'Worker iniciado');

  return {
    port,
    workerId: worker.workerId,
    async stop() {
      await scheduler.stop();
      const result = await worker.stop({
        timeoutMs: options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS,
      });
      await http.close();
      await closeDatabase(db);
      return result;
    },
  };
}
