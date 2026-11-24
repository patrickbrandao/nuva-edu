import { hostname } from 'node:os';
import {
  claimJobs,
  completeJob,
  type Database,
  failJob,
  HEARTBEAT_INTERVAL_MS,
  heartbeatJobs,
  isKnownJob,
  type Job,
  type JobContext,
  type JobHandlers,
  type JobListener,
  type KnownJob,
  type Logger,
  listenForJobs,
  releaseJob,
  requeueStaleJobs,
  STALE_AFTER_MS,
  SWEEP_INTERVAL_MS,
} from '@nuva-edu/core';
import type { JobOutcome, WorkerMetrics } from './metrics.ts';

/** Prazo para as tarefas em execução terminarem no encerramento (spec 005). */
export const SHUTDOWN_TIMEOUT_MS = 30_000;
/** Teto da espera entre varreduras quando o banco está fora. */
const SWEEP_BACKOFF_MAX_MS = 60_000;
/** Rótulo de métrica para tipo fora do registro: o texto do banco não vira rótulo. */
const UNKNOWN_TYPE_LABEL = 'unknown';

export interface WorkerOptions {
  db: Database;
  /** `config.databaseUrl`, para a conexão dedicada do `LISTEN`. */
  databaseUrl: string;
  logger: Logger;
  handlers: JobHandlers;
  /** Tarefas simultâneas (`NUVA_WORKER_CONCURRENCY`). */
  concurrency: number;
  metrics?: WorkerMetrics;
  /** Padrão: `hostname:pid`. */
  workerId?: string;
  /** Padrões do núcleo; os testes encurtam. */
  sweepIntervalMs?: number;
  heartbeatIntervalMs?: number;
  staleAfterMs?: number;
}

export interface StopResult {
  /** Tarefas que não terminaram no prazo e voltaram à fila. */
  released: number;
}

export interface Worker {
  readonly workerId: string;
  /** Começa a escutar, varrer e consumir. Resolve depois da primeira varredura. */
  start(): Promise<void>;
  /** Para de pegar tarefas, espera as em execução até o prazo e devolve o resto à fila. */
  stop(options?: { timeoutMs?: number }): Promise<StopResult>;
  /** Pede uma rodada de consumo (o que o NOTIFY faz). */
  wake(): void;
  runningCount(): number;
  /** `true` enquanto o laço consome e a última rodada falou com o banco (`/readyz`). */
  isLoopActive(): boolean;
}

export function defaultWorkerId(): string {
  return `${hostname()}:${process.pid}`;
}

/**
 * Laço de consumo da fila (spec 005). Acorda pelo `NOTIFY` e pela varredura periódica, respeita
 * o limite de concorrência e renova o batimento das tarefas em execução. Toda escrita em `jobs`
 * passa pelas funções do núcleo.
 */
export function createWorker(options: WorkerOptions): Worker {
  const { db, logger, handlers, concurrency, metrics } = options;
  const workerId = options.workerId ?? defaultWorkerId();
  const sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;

  let state: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  const running = new Map<string, Promise<void>>();
  /** Um por tarefa em execução: é o `signal` que o manipulador recebe no contexto. */
  const controllers = new Map<string, AbortController>();
  /** Devolvidas à fila no encerramento: o resultado tardio do manipulador não é gravado. */
  const released = new Set<string>();
  /** Devolvidas à fila antes do prazo, por manipulador que parou ao ver o sinal. */
  let releasedEarly = 0;
  // Motivos do aborto: o manipulador que repassa o sinal (a `fetch`, a uma espera) os recebe
  // como o erro lançado.
  const shutdownReason = new DOMException('O worker está encerrando.', 'AbortError');
  const lostLockReason = new DOMException('A trava da tarefa foi perdida.', 'AbortError');
  let listener: JobListener | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let round: Promise<void> | null = null;
  let again = false;
  let sweepPending = false;
  let failures = 0;
  let lastRoundOkAt = 0;

  const dispatch = (job: KnownJob, context: JobContext): Promise<void> =>
    (handlers[job.type] as (job: KnownJob, context: JobContext) => Promise<void>)(job, context);

  const runJob = async (job: Job, signal: AbortSignal): Promise<void> => {
    const log = logger.child({ job_id: job.id, job_type: job.type, attempt: job.attempts });
    const lock = { jobId: job.id, workerId };
    const typeLabel = isKnownJob(job) ? job.type : UNKNOWN_TYPE_LABEL;
    const started = performance.now();
    let failure: { error: unknown } | null = null;
    try {
      if (!isKnownJob(job)) {
        throw new Error(`Tipo de tarefa desconhecido: ${job.type}`);
      }
      await dispatch(job, { signal });
    } catch (error) {
      failure = { error };
    }
    const seconds = (performance.now() - started) / 1000;
    const durationMs = Math.round(seconds * 1000);
    metrics?.jobDuration.observe(seconds, { type: typeLabel });

    if (released.has(job.id)) {
      // Já voltou à fila no encerramento; outro worker vai executá-la de novo (idempotente).
      return;
    }
    let outcome: JobOutcome;
    try {
      if (failure === null) {
        outcome = (await completeJob(db, lock)) ? 'done' : 'lost';
      } else if (signal.reason === shutdownReason) {
        // Parou porque o worker está encerrando: não é falha da tarefa (spec 005). Volta à
        // fila sem contar a tentativa, como as que não terminam no prazo.
        if (await releaseJob(db, lock)) {
          releasedEarly += 1;
          outcome = 'released';
        } else {
          outcome = 'lost';
        }
      } else {
        const updated = await failJob(db, { ...lock, error: failure.error });
        outcome = updated === null ? 'lost' : updated.status === 'failed' ? 'failed' : 'retry';
      }
    } catch (error) {
      // Sem gravar o desfecho, a tarefa fica `running` e volta à fila como presa.
      log.error({ err: error, duration_ms: durationMs }, 'Falha ao gravar o desfecho da tarefa');
      metrics?.jobsTotal.inc({ type: typeLabel, outcome: 'lost' });
      return;
    }
    metrics?.jobsTotal.inc({ type: typeLabel, outcome });
    if (outcome === 'done') {
      log.info({ duration_ms: durationMs }, 'Tarefa concluída');
    } else if (outcome === 'released') {
      log.info(
        { duration_ms: durationMs },
        'Tarefa interrompida pelo encerramento; devolvida à fila',
      );
    } else if (outcome === 'retry') {
      log.warn({ err: failure?.error, duration_ms: durationMs }, 'Tarefa falhou; nova tentativa');
    } else if (outcome === 'failed') {
      log.error(
        { err: failure?.error, duration_ms: durationMs },
        'Tarefa falhou e esgotou as tentativas',
      );
    } else {
      log.warn({ duration_ms: durationMs }, 'Tarefa terminou sem a trava deste worker');
    }
  };

  const startJob = (job: Job): void => {
    const controller = new AbortController();
    controllers.set(job.id, controller);
    const promise = runJob(job, controller.signal).finally(() => {
      running.delete(job.id);
      controllers.delete(job.id);
      // Vaga aberta: busca a próxima sem esperar a varredura.
      wake();
    });
    running.set(job.id, promise);
  };

  const consume = async (): Promise<void> => {
    do {
      again = false;
      if (sweepPending) {
        sweepPending = false;
        const stale = await requeueStaleJobs(db, { staleAfterMs });
        if (stale.length > 0) {
          logger.warn({ count: stale.length }, 'Tarefas presas devolvidas à fila');
        }
      }
      const free = concurrency - running.size;
      if (free > 0 && state === 'running') {
        const jobs = await claimJobs(db, { workerId, limit: free });
        for (const job of jobs) {
          if (state === 'running') {
            startJob(job);
          } else {
            // O encerramento começou durante o claim: devolve sem executar.
            await releaseJob(db, { jobId: job.id, workerId });
          }
        }
      }
    } while (again && state === 'running');
  };

  const runRound = (sweep: boolean): Promise<void> => {
    if (sweep) {
      sweepPending = true;
    }
    if (round) {
      again = true;
      return round;
    }
    if (state !== 'running') {
      return Promise.resolve();
    }
    round = consume()
      .then(() => {
        if (failures > 0) {
          logger.info('Consumo da fila restabelecido');
        }
        failures = 0;
        lastRoundOkAt = Date.now();
      })
      .catch((error: unknown) => {
        failures += 1;
        logger.error({ err: error, failures }, 'Falha ao consumir a fila');
      })
      .finally(() => {
        round = null;
      });
    return round;
  };

  function wake(): void {
    if (state === 'running') {
      void runRound(false);
    }
  }

  const scheduleSweep = (): void => {
    // Banco fora: a varredura espaça as tentativas (espera crescente, com teto).
    const delay =
      failures === 0
        ? sweepIntervalMs
        : Math.min(sweepIntervalMs * 2 ** Math.min(failures, 10), SWEEP_BACKOFF_MAX_MS);
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      void runRound(true).then(() => {
        if (state === 'running') {
          scheduleSweep();
        }
      });
    }, delay);
  };

  const heartbeat = async (): Promise<void> => {
    const jobIds = [...running.keys()];
    if (jobIds.length === 0) {
      return;
    }
    try {
      const alive = new Set(await heartbeatJobs(db, { workerId, jobIds }));
      for (const jobId of jobIds) {
        const controller = controllers.get(jobId);
        if (!alive.has(jobId) && controller && !controller.signal.aborted) {
          logger.warn({ job_id: jobId }, 'Trava da tarefa perdida; o resultado será descartado');
          // Outro worker já pode estar com a tarefa: avisa o manipulador para parar cedo.
          controller.abort(lostLockReason);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Falha ao renovar o batimento das tarefas');
    }
  };

  return {
    workerId,
    async start() {
      if (state !== 'idle') {
        throw new Error('O worker já foi iniciado.');
      }
      state = 'running';
      listener = listenForJobs({
        connectionString: options.databaseUrl,
        onNotify: wake,
        logger,
        applicationName: 'worker-listener',
      });
      heartbeatTimer = setInterval(() => void heartbeat(), heartbeatIntervalMs);
      await runRound(true);
      if (state === 'running') {
        scheduleSweep();
      }
    },
    async stop(stopOptions = {}) {
      if (state !== 'running') {
        return { released: 0 };
      }
      state = 'stopping';
      if (sweepTimer) {
        clearTimeout(sweepTimer);
        sweepTimer = null;
      }
      await listener?.close();
      listener = null;
      await round;

      // Avisa os manipuladores: o que acompanha o sinal para cedo e a tarefa volta à fila; os
      // demais têm até o prazo para terminar.
      for (const controller of controllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort(shutdownReason);
        }
      }

      const timeoutMs = stopOptions.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
      if (running.size > 0) {
        logger.info(
          { running: running.size, timeout_ms: timeoutMs },
          'Aguardando tarefas em execução',
        );
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          Promise.all(running.values()),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
          }),
        ]);
        clearTimeout(timer);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      let count = 0;
      for (const jobId of [...running.keys()]) {
        released.add(jobId);
        try {
          if (await releaseJob(db, { jobId, workerId })) {
            count += 1;
          }
        } catch (error) {
          logger.error({ err: error, job_id: jobId }, 'Falha ao devolver a tarefa à fila');
        }
      }
      if (count > 0) {
        logger.warn({ count }, 'Tarefas não concluídas no prazo devolvidas à fila');
      }
      state = 'stopped';
      // Conta também as que pararam pelo sinal e já tinham voltado à fila.
      return { released: count + releasedEarly };
    },
    wake,
    runningCount: () => running.size,
    isLoopActive: () =>
      state === 'running' && Date.now() - lastRoundOkAt < Math.max(sweepIntervalMs * 3, 1_000),
  };
}
