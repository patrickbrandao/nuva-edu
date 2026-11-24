import { type Database, getJobCounts, getJobCountsByType } from '@nuva-edu/core';
import { type MetricFamily, renderMetrics, type WorkerMetrics } from './metrics.ts';

export interface MetricsSources {
  db: Database;
  metrics: WorkerMetrics;
  concurrency: number;
  runningCount: () => number;
}

/**
 * Monta o texto do `/metrics`: contadores do processo mais o tamanho da fila, lido do banco a
 * cada coleta. Banco fora não derruba a coleta: `worker_database_up` vai a 0 e os medidores da
 * fila ficam de fora.
 */
export async function collectMetrics(sources: MetricsSources): Promise<string> {
  const families: MetricFamily[] = [
    sources.metrics.jobsTotal.collect(),
    sources.metrics.jobDuration.collect(),
    {
      name: 'worker_jobs_running',
      help: 'Tarefas em execução neste processo.',
      type: 'gauge',
      samples: [{ value: sources.runningCount() }],
    },
    {
      name: 'worker_concurrency',
      help: 'Limite de tarefas simultâneas deste processo.',
      type: 'gauge',
      samples: [{ value: sources.concurrency }],
    },
  ];

  let databaseUp = 1;
  try {
    const [counts, byType] = await Promise.all([
      getJobCounts(sources.db),
      getJobCountsByType(sources.db),
    ]);
    families.push(
      {
        name: 'jobs_queue_depth',
        help: 'Tarefas aguardando na fila (queued), por tipo.',
        type: 'gauge',
        samples: byType.map((entry) => ({ labels: { type: entry.type }, value: entry.queued })),
      },
      {
        name: 'jobs_failed',
        help: 'Tarefas que esgotaram as tentativas (failed), por tipo.',
        type: 'gauge',
        samples: byType.map((entry) => ({ labels: { type: entry.type }, value: entry.failed })),
      },
      {
        name: 'jobs_count',
        help: 'Tarefas na tabela por estado; ready é a parte de queued que já pode executar.',
        type: 'gauge',
        samples: (['queued', 'ready', 'running', 'done', 'failed'] as const).map((status) => ({
          labels: { status },
          value: counts[status],
        })),
      },
    );
  } catch {
    databaseUp = 0;
  }
  families.push({
    name: 'worker_database_up',
    help: '1 quando a leitura da fila para esta coleta funcionou.',
    type: 'gauge',
    samples: [{ value: databaseUp }],
  });
  return renderMetrics(families);
}
