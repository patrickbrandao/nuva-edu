import { describe, expect, it } from 'vitest';
import { createMetricsRegistry, registerProcessMetrics } from '../src/index.ts';

describe('createMetricsRegistry', () => {
  it('expõe contador com rótulos no formato de texto do Prometheus', () => {
    const registry = createMetricsRegistry();
    const counter = registry.counter({ name: 'http_requests_total', help: 'Requisições.' });
    counter.inc({ route: '/api/v1/meta', method: 'GET', status: 200 });
    counter.inc({ status: 200, method: 'GET', route: '/api/v1/meta' });
    counter.inc({ route: '/api/v1/meta', method: 'GET', status: 500 }, 3);
    expect(registry.render()).toBe(
      [
        '# HELP http_requests_total Requisições.',
        '# TYPE http_requests_total counter',
        'http_requests_total{method="GET",route="/api/v1/meta",status="200"} 2',
        'http_requests_total{method="GET",route="/api/v1/meta",status="500"} 3',
        '',
      ].join('\n'),
    );
    expect(() => counter.inc({}, -1)).toThrow(RangeError);
  });

  it('expõe histograma com baldes cumulativos, soma e contagem', () => {
    const registry = createMetricsRegistry();
    const histogram = registry.histogram({
      name: 'duration_seconds',
      help: 'Duração.',
      buckets: [0.1, 0.5, 1],
    });
    for (const value of [0.05, 0.1, 0.3, 2]) {
      histogram.observe(value, { route: '/a' });
    }
    expect(registry.render().split('\n').slice(2)).toEqual([
      'duration_seconds_bucket{le="0.1",route="/a"} 2',
      'duration_seconds_bucket{le="0.5",route="/a"} 3',
      'duration_seconds_bucket{le="1",route="/a"} 3',
      'duration_seconds_bucket{le="+Inf",route="/a"} 4',
      'duration_seconds_sum{route="/a"} 2.45',
      'duration_seconds_count{route="/a"} 4',
      '',
    ]);
  });

  it('expõe medidor guardado e medidor lido na coleta', () => {
    const registry = createMetricsRegistry();
    const gauge = registry.gauge({ name: 'sse_connections', help: 'Conexões SSE abertas.' });
    gauge.inc();
    gauge.inc();
    gauge.dec();
    gauge.set(7, { kind: 'x' });
    let pool = { idle: 2, used: 1 };
    registry.gauge({
      name: 'db_pool_connections',
      help: 'Conexões do pool.',
      collect: () => Object.entries(pool).map(([state, value]) => ({ labels: { state }, value })),
    });
    registry.gauge({ name: 'answer', help: 'Valor único.', collect: () => 42 });
    expect(registry.render()).toContain('sse_connections 1\nsse_connections{kind="x"} 7\n');
    expect(registry.render()).toContain(
      'db_pool_connections{state="idle"} 2\ndb_pool_connections{state="used"} 1\n',
    );
    pool = { idle: 0, used: 3 };
    expect(registry.render()).toContain('db_pool_connections{state="used"} 3\n');
    expect(registry.render()).toContain('# TYPE answer gauge\nanswer 42\n');
  });

  it('lê o valor atual de contador e de medidor', () => {
    const registry = createMetricsRegistry();
    const jobs = registry.counter({ name: 'jobs_total', help: 'Tarefas.' });
    jobs.inc({ type: 'email', outcome: 'done' });
    jobs.inc({ outcome: 'done', type: 'email' }, 2);
    expect(jobs.get({ type: 'email', outcome: 'done' })).toBe(3);
    expect(jobs.get({ type: 'email', outcome: 'failed' })).toBe(0);
    expect(jobs.get()).toBe(0);
    const running = registry.gauge({ name: 'jobs_running', help: 'Em execução.' });
    running.set(4);
    running.dec();
    expect(running.get()).toBe(3);
  });

  it('escapa valores de rótulo e texto de ajuda', () => {
    const registry = createMetricsRegistry();
    registry.counter({ name: 'c_total', help: 'Linha 1\nlinha 2 \\ fim' }).inc({ v: 'a"b\\c\nd' });
    expect(registry.render()).toBe(
      '# HELP c_total Linha 1\\nlinha 2 \\\\ fim\n# TYPE c_total counter\nc_total{v="a\\"b\\\\c\\nd"} 1\n',
    );
  });

  it('recusa nome inválido, repetido e baldes fora de ordem', () => {
    const registry = createMetricsRegistry();
    registry.counter({ name: 'a_total', help: 'A.' });
    expect(() => registry.counter({ name: 'a_total', help: 'A.' })).toThrow(/já registrada/);
    expect(() => registry.gauge({ name: '1-invalido', help: 'X.' })).toThrow(/inválido/);
    expect(() => registry.histogram({ name: 'h', help: 'H.', buckets: [1, 0.5] })).toThrow(
      /fora de ordem/,
    );
    expect(() =>
      registry.counter({ name: 'b_total', help: 'B.' }).inc({ 'rótulo ruim': 1 }),
    ).toThrow(/rótulo inválido/);
  });

  it('registra as métricas do processo', () => {
    const registry = createMetricsRegistry();
    registerProcessMetrics(registry);
    const text = registry.render();
    expect(text).toMatch(/^process_start_time_seconds \d+(\.\d+)?$/m);
    expect(text).toMatch(/^process_resident_memory_bytes \d+$/m);
    expect(text).toMatch(/^nodejs_heap_size_used_bytes \d+$/m);
    expect(text).toMatch(/^process_cpu_seconds_total \d+(\.\d+)?$/m);
  });
});
