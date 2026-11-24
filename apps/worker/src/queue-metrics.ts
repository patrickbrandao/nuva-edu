import { registerProcessMetrics } from '@nuva-edu/api-kit/metrics';
import {
  type Database,
  databasePoolStats,
  getJobCounts,
  getJobCountsByType,
  getOldestPendingJobAgeSeconds,
  type JobTypeCounts,
} from '@nuva-edu/core';
import type { WorkerMetrics } from './metrics.ts';

export interface MetricsSources {
  db: Database;
  metrics: WorkerMetrics;
  concurrency: number;
  runningCount: () => number;
}

/** Retrato da fila lido do banco para uma coleta. */
interface QueueSnapshot {
  counts: Awaited<ReturnType<typeof getJobCounts>>;
  byType: JobTypeCounts[];
  oldestPendingSeconds: number;
}

const COUNT_STATUSES = ['queued', 'ready', 'running', 'done', 'failed'] as const;

/**
 * Registra os medidores do worker no registro de `sources.metrics` e devolve a função que monta
 * o texto do `/metrics`: lê a fila do banco e só então renderiza. Chame uma vez por processo
 * (registrar a mesma métrica duas vezes lança).
 *
 * Banco fora não derruba a coleta: `worker_database_up` vai a 0 e os medidores da fila saem só
 * com o cabeçalho, sem série.
 */
export function createMetricsCollector(sources: MetricsSources): () => Promise<string> {
  const { db } = sources;
  const { registry } = sources.metrics;
  let snapshot: QueueSnapshot | null = null;

  registry.gauge({
    name: 'worker_jobs_running',
    help: 'Tarefas em execução neste processo.',
    collect: () => sources.runningCount(),
  });
  registry.gauge({
    name: 'worker_concurrency',
    help: 'Limite de tarefas simultâneas deste processo.',
    collect: () => sources.concurrency,
  });
  registry.gauge({
    name: 'jobs_queue_depth',
    help: 'Tarefas aguardando na fila (queued), por tipo.',
    collect: () =>
      snapshot?.byType.map((entry) => ({ labels: { type: entry.type }, value: entry.queued })) ??
      [],
  });
  registry.gauge({
    name: 'jobs_failed',
    help: 'Tarefas que esgotaram as tentativas (failed), por tipo.',
    collect: () =>
      snapshot?.byType.map((entry) => ({ labels: { type: entry.type }, value: entry.failed })) ??
      [],
  });
  registry.gauge({
    name: 'jobs_count',
    help: 'Tarefas na tabela por estado; ready é a parte de queued que já pode executar.',
    collect: () => {
      const counts = snapshot?.counts;
      return counts
        ? COUNT_STATUSES.map((status) => ({ labels: { status }, value: counts[status] }))
        : [];
    },
  });
  registry.gauge({
    name: 'jobs_oldest_pending_seconds',
    help: 'Espera, em segundos, da tarefa pronta mais antiga; 0 sem pendentes.',
    collect: () => (snapshot ? [{ labels: {}, value: snapshot.oldestPendingSeconds }] : []),
  });
  registry.gauge({
    name: 'worker_database_up',
    help: '1 quando a leitura da fila para esta coleta funcionou.',
    collect: () => (snapshot ? 1 : 0),
  });
  registry.gauge({
    name: 'db_pool_connections',
    help: 'Conexões do pool do PostgreSQL neste processo, por estado.',
    collect: () => {
      const pool = databasePoolStats(db);
      return [
        { labels: { state: 'active' }, value: pool.active },
        { labels: { state: 'idle' }, value: pool.idle },
        { labels: { state: 'waiting' }, value: pool.waiting },
      ];
    },
  });
  registerProcessMetrics(registry);

  const readQueue = async (): Promise<QueueSnapshot | null> => {
    try {
      const [counts, byType, oldestPendingSeconds] = await Promise.all([
        getJobCounts(db),
        getJobCountsByType(db),
        getOldestPendingJobAgeSeconds(db),
      ]);
      return { counts, byType, oldestPendingSeconds };
    } catch {
      return null;
    }
  };

  return async () => {
    const read = await readQueue();
    // Sem `await` entre guardar o retrato e renderizar: coletas simultâneas não se misturam.
    snapshot = read;
    return registry.render();
  };
}
