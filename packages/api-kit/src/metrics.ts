/** Rótulos de uma série. Nunca use identificador de usuário como rótulo (spec 033). */
export type Labels = Readonly<Record<string, string | number>>;

export interface Counter {
  inc(labels?: Labels, value?: number): void;
  /** Valor atual da série (0 se nunca contou): para testes e para somar na coleta. */
  get(labels?: Labels): number;
}

export interface Gauge {
  /** Valor guardado da série (0 se não houver); não chama o `collect`. */
  get(labels?: Labels): number;
  set(value: number, labels?: Labels): void;
  inc(labels?: Labels, value?: number): void;
  dec(labels?: Labels, value?: number): void;
}

export interface Histogram {
  observe(value: number, labels?: Labels): void;
}

export interface MetricOptions {
  /** Nome no formato Prometheus: `http_requests_total`. */
  name: string;
  help: string;
}

export interface GaugeOptions extends MetricOptions {
  /**
   * Lido a cada coleta, no lugar dos valores guardados: devolve o valor ou uma lista de séries.
   * Serve para medidas que já existem em outro lugar (conexões do pool, tamanho da fila).
   */
  collect?: () => number | readonly { labels: Labels; value: number }[];
}

export interface HistogramOptions extends MetricOptions {
  /** Limites superiores dos baldes, em ordem crescente. */
  buckets?: readonly number[];
}

/** Tipo de mídia da exposição em texto do Prometheus. */
export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Baldes padrão para duração de requisição, em segundos. */
export const DEFAULT_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

export interface MetricsRegistry {
  counter(options: MetricOptions): Counter;
  gauge(options: GaugeOptions): Gauge;
  histogram(options: HistogramOptions): Histogram;
  /** Todas as métricas no formato de texto do Prometheus. */
  render(): string;
}

const NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Registro de métricas de um processo. Cada API cria as suas além das que a base HTTP já mantém
 * (`http_requests_total`, `http_request_duration_seconds` e as do processo).
 */
export function createMetricsRegistry(): MetricsRegistry {
  const renderers = new Map<string, () => string>();
  const register = (options: MetricOptions, type: string, body: () => string) => {
    if (!NAME_PATTERN.test(options.name)) {
      throw new TypeError(`Nome de métrica inválido: "${options.name}".`);
    }
    if (renderers.has(options.name)) {
      throw new TypeError(`Métrica "${options.name}" já registrada.`);
    }
    renderers.set(
      options.name,
      () =>
        `# HELP ${options.name} ${escapeHelp(options.help)}\n# TYPE ${options.name} ${type}\n${body()}`,
    );
  };

  return {
    counter(options) {
      const series = new Map<string, number>();
      register(options, 'counter', () => renderSeries(options.name, series));
      return {
        inc(labels = {}, value = 1) {
          if (value < 0) {
            throw new RangeError('Contador só cresce.');
          }
          const key = serializeLabels(labels);
          series.set(key, (series.get(key) ?? 0) + value);
        },
        get: (labels = {}) => series.get(serializeLabels(labels)) ?? 0,
      };
    },

    gauge(options) {
      const series = new Map<string, number>();
      register(options, 'gauge', () => {
        if (!options.collect) {
          return renderSeries(options.name, series);
        }
        const collected = options.collect();
        const live = new Map<string, number>();
        for (const entry of typeof collected === 'number'
          ? [{ labels: {}, value: collected }]
          : collected) {
          live.set(serializeLabels(entry.labels), entry.value);
        }
        return renderSeries(options.name, live);
      });
      const add = (labels: Labels, value: number) => {
        const key = serializeLabels(labels);
        series.set(key, (series.get(key) ?? 0) + value);
      };
      return {
        set(value, labels = {}) {
          series.set(serializeLabels(labels), value);
        },
        get: (labels = {}) => series.get(serializeLabels(labels)) ?? 0,
        inc: (labels = {}, value = 1) => add(labels, value),
        dec: (labels = {}, value = 1) => add(labels, -value),
      };
    },

    histogram(options) {
      const buckets = [...(options.buckets ?? DEFAULT_DURATION_BUCKETS)];
      if (buckets.some((limit, index) => index > 0 && limit <= (buckets[index - 1] ?? 0))) {
        throw new TypeError(`Baldes de "${options.name}" fora de ordem.`);
      }
      const series = new Map<string, { labels: Labels; counts: number[]; sum: number }>();
      register(options, 'histogram', () => {
        let text = '';
        for (const { labels, counts, sum } of series.values()) {
          let cumulative = 0;
          buckets.forEach((limit, index) => {
            cumulative += counts[index] ?? 0;
            text += `${options.name}_bucket${serializeLabels({ ...labels, le: String(limit) })} ${cumulative}\n`;
          });
          const total = cumulative + (counts[buckets.length] ?? 0);
          text += `${options.name}_bucket${serializeLabels({ ...labels, le: '+Inf' })} ${total}\n`;
          text += `${options.name}_sum${serializeLabels(labels)} ${formatValue(sum)}\n`;
          text += `${options.name}_count${serializeLabels(labels)} ${total}\n`;
        }
        return text;
      });
      return {
        observe(value, labels = {}) {
          const key = serializeLabels(labels);
          let entry = series.get(key);
          if (!entry) {
            entry = { labels, counts: new Array<number>(buckets.length + 1).fill(0), sum: 0 };
            series.set(key, entry);
          }
          const index = buckets.findIndex((limit) => value <= limit);
          const slot = index === -1 ? buckets.length : index;
          entry.counts[slot] = (entry.counts[slot] ?? 0) + 1;
          entry.sum += value;
        },
      };
    },

    render() {
      return [...renderers.values()].map((renderer) => renderer()).join('');
    },
  };
}

/** Métricas do processo, nos nomes usuais do Prometheus. */
export function registerProcessMetrics(registry: MetricsRegistry): void {
  const startedAt = Date.now() / 1000 - process.uptime();
  registry.gauge({
    name: 'process_start_time_seconds',
    help: 'Início do processo, em segundos desde a época Unix.',
    collect: () => startedAt,
  });
  registry.gauge({
    name: 'process_resident_memory_bytes',
    help: 'Memória residente do processo, em bytes.',
    collect: () => process.memoryUsage.rss(),
  });
  registry.gauge({
    name: 'nodejs_heap_size_used_bytes',
    help: 'Heap do V8 em uso, em bytes.',
    collect: () => process.memoryUsage().heapUsed,
  });
  registry.gauge({
    name: 'process_cpu_seconds_total',
    help: 'Tempo de CPU (usuário e sistema) consumido pelo processo, em segundos.',
    collect: () => {
      const usage = process.cpuUsage();
      return (usage.user + usage.system) / 1e6;
    },
  });
}

function renderSeries(name: string, series: ReadonlyMap<string, number>): string {
  let text = '';
  for (const [labels, value] of series) {
    text += `${name}${labels} ${formatValue(value)}\n`;
  }
  return text;
}

function serializeLabels(labels: Labels): string {
  const names = Object.keys(labels).sort();
  if (names.length === 0) {
    return '';
  }
  const pairs = names.map((name) => {
    if (!LABEL_PATTERN.test(name)) {
      throw new TypeError(`Nome de rótulo inválido: "${name}".`);
    }
    return `${name}="${escapeLabel(String(labels[name]))}"`;
  });
  return `{${pairs.join(',')}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function formatValue(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '+Inf' : '-Inf';
  }
  return String(value);
}
