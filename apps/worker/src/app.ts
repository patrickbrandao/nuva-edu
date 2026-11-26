import { databaseReadiness } from '@nuva-edu/api-kit/health';
import {
  type Config,
  closeDatabase,
  createDatabase,
  createPaymentProvider,
  type Logger,
  type PaymentProvider,
  paymentUnavailable,
} from '@nuva-edu/core';
import { createCertificateRenderer } from './certificates/renderer.ts';
import { createMailer, type Mailer } from './email/smtp.ts';
import { createHandlers } from './handlers.ts';
import { createHttpServer } from './http.ts';
import { createWorkerMetrics } from './metrics.ts';
import { createMetricsCollector } from './queue-metrics.ts';
import { createScheduler } from './scheduler.ts';
import { createWorker, SHUTDOWN_TIMEOUT_MS } from './worker.ts';

export interface AppOptions {
  config: Config;
  logger: Logger;
  /** Porta do HTTP interno (saúde e métricas). */
  port: number;
  host?: string;
  shutdownTimeoutMs?: number;
  /** Padrão: SMTP de `config.smtp`. Os testes trocam pelo servidor local. */
  mailer?: Mailer;
  paymentProvider?: PaymentProvider;
}

export interface App {
  port: number;
  workerId: string;
  /** Encerramento ordenado; devolve quantas tarefas voltaram à fila sem terminar. */
  stop(): Promise<{ released: number }>;
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
  const mailer = options.mailer ?? createMailer(config.smtp);
  const renderer = createCertificateRenderer({ logger, histogram: metrics.certificateRender });
  let paymentProvider = options.paymentProvider;
  const provider = () => {
    try {
      paymentProvider ??= createPaymentProvider(config);
      return paymentProvider;
    } catch {
      throw paymentUnavailable();
    }
  };
  const worker = createWorker({
    db,
    databaseUrl: config.databaseUrl,
    logger,
    handlers: createHandlers({
      db,
      logger,
      mailer,
      classroomUrl: config.classroomUrl,
      adminUrl: config.adminUrl,
      locale: config.locale,
      retention: config.retention,
      renderer,
      payment: {
        provider,
        boletoDays: config.payment.orderBoletoDays,
        graceDays: config.payment.subscriptionGraceDays,
        webhookDays: config.retention.webhookDays,
      },
    }),
    concurrency,
    metrics,
  });
  const scheduler = createScheduler({ db, logger });
  const http = createHttpServer({
    logger,
    checks: {
      // `database` e `migrations`, as mesmas verificações das APIs (spec 033).
      ...databaseReadiness({ db, connectionString: config.databaseUrl }),
      queue: () =>
        worker.isLoopActive() ? { ok: true } : { ok: false, reason: 'laço da fila parado' },
    },
    metrics: createMetricsCollector({
      db,
      metrics,
      concurrency,
      runningCount: () => worker.runningCount(),
    }),
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
      mailer.close();
      await renderer.close();
      await closeDatabase(db);
      return result;
    },
  };
}
