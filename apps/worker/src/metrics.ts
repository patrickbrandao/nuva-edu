// Métricas do worker (spec 033) sobre o registro do `@nuva-edu/api-kit/metrics`, a entrada que
// não carrega o Fastify. Rótulos nunca levam identificador de usuário nem de tarefa.
import {
  type Counter,
  createMetricsRegistry,
  type Histogram,
  type MetricsRegistry,
} from '@nuva-edu/api-kit/metrics';

export { METRICS_CONTENT_TYPE } from '@nuva-edu/api-kit/metrics';

/** Faixas de duração de tarefa, em segundos: de tarefas vazias a relatórios demorados. */
export const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300,
];

/**
 * Desfecho de uma execução: concluída, devolvida para nova tentativa, esgotada, trava perdida,
 * ou interrompida pelo encerramento e devolvida à fila sem contar a tentativa.
 */
export type JobOutcome = 'done' | 'retry' | 'failed' | 'lost' | 'released';

/** Métricas que o laço de consumo alimenta, e o registro em que as demais entram. */
export interface WorkerMetrics {
  registry: MetricsRegistry;
  jobsTotal: Counter;
  jobDuration: Histogram;
}

export function createWorkerMetrics(
  registry: MetricsRegistry = createMetricsRegistry(),
): WorkerMetrics {
  return {
    registry,
    jobsTotal: registry.counter({
      name: 'jobs_total',
      help: 'Execuções de tarefa por tipo e desfecho.',
    }),
    jobDuration: registry.histogram({
      name: 'jobs_duration_seconds',
      help: 'Duração da execução do manipulador, em segundos, por tipo.',
      buckets: DURATION_BUCKETS,
    }),
  };
}
