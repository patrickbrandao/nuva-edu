// Métricas no formato de texto do Prometheus (spec 033), sem dependência externa.
// Rótulos nunca levam identificador de usuário nem de tarefa.

export type Labels = Record<string, string>;

export interface Sample {
  /** Sufixo do nome (`_bucket`, `_sum`, `_count` nos histogramas). */
  suffix?: string;
  labels?: Labels;
  value: number;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  samples: Sample[];
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Faixas de duração de tarefa, em segundos: de tarefas vazias a relatórios demorados. */
export const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300,
];

function labelKey(labels: Labels): string {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
}

export class Counter {
  readonly name: string;
  readonly help: string;
  private readonly series = new Map<string, { labels: Labels; value: number }>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels);
    const entry = this.series.get(key);
    if (entry) {
      entry.value += amount;
    } else {
      this.series.set(key, { labels: { ...labels }, value: amount });
    }
  }

  get(labels: Labels = {}): number {
    return this.series.get(labelKey(labels))?.value ?? 0;
  }

  collect(): MetricFamily {
    return {
      name: this.name,
      help: this.help,
      type: 'counter',
      samples: [...this.series.values()].map(({ labels, value }) => ({ labels, value })),
    };
  }
}

export class Histogram {
  readonly name: string;
  readonly help: string;
  private readonly buckets: readonly number[];
  private readonly series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();

  constructor(name: string, help: string, buckets: readonly number[] = DURATION_BUCKETS) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(labels: Labels, value: number): void {
    const key = labelKey(labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = { labels: { ...labels }, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (const [index, limit] of this.buckets.entries()) {
      if (value <= limit) {
        entry.counts[index] = (entry.counts[index] ?? 0) + 1;
      }
    }
  }

  collect(): MetricFamily {
    const samples: Sample[] = [];
    for (const entry of this.series.values()) {
      for (const [index, limit] of this.buckets.entries()) {
        samples.push({
          suffix: '_bucket',
          labels: { ...entry.labels, le: String(limit) },
          value: entry.counts[index] ?? 0,
        });
      }
      samples.push({
        suffix: '_bucket',
        labels: { ...entry.labels, le: '+Inf' },
        value: entry.count,
      });
      samples.push({ suffix: '_sum', labels: entry.labels, value: entry.sum });
      samples.push({ suffix: '_count', labels: entry.labels, value: entry.count });
    }
    return { name: this.name, help: this.help, type: 'histogram', samples };
  }
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function escapeHelp(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n');
}

function formatLabels(labels: Labels | undefined): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) {
    return '';
  }
  return `{${entries.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`;
}

/** Texto de exposição do Prometheus (versão 0.0.4). */
export function renderMetrics(families: readonly MetricFamily[]): string {
  const lines: string[] = [];
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${escapeHelp(family.help)}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);
    for (const sample of family.samples) {
      lines.push(
        `${family.name}${sample.suffix ?? ''}${formatLabels(sample.labels)} ${sample.value}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Desfecho de uma execução: concluída, devolvida para nova tentativa, esgotada, ou trava perdida. */
export type JobOutcome = 'done' | 'retry' | 'failed' | 'lost';

/** Métricas que o laço de consumo alimenta. */
export interface WorkerMetrics {
  jobsTotal: Counter;
  jobDuration: Histogram;
}

export function createWorkerMetrics(): WorkerMetrics {
  return {
    jobsTotal: new Counter('jobs_total', 'Execuções de tarefa por tipo e desfecho.'),
    jobDuration: new Histogram(
      'jobs_duration_seconds',
      'Duração da execução do manipulador, em segundos, por tipo.',
    ),
  };
}
