import { describe, expect, it } from 'vitest';
import { Counter, Histogram, renderMetrics } from '../src/metrics.ts';

describe('métricas no formato do Prometheus', () => {
  it('soma o contador por conjunto de rótulos, sem depender da ordem deles', () => {
    const counter = new Counter('jobs_total', 'Execuções.');
    counter.inc({ type: 'example.echo', outcome: 'done' });
    counter.inc({ outcome: 'done', type: 'example.echo' });
    counter.inc({ type: 'example.echo', outcome: 'failed' });

    expect(counter.get({ type: 'example.echo', outcome: 'done' })).toBe(2);
    expect(renderMetrics([counter.collect()])).toBe(
      [
        '# HELP jobs_total Execuções.',
        '# TYPE jobs_total counter',
        'jobs_total{type="example.echo",outcome="done"} 2',
        'jobs_total{type="example.echo",outcome="failed"} 1',
        '',
      ].join('\n'),
    );
  });

  it('acumula o histograma por faixa e fecha em +Inf, soma e contagem', () => {
    const histogram = new Histogram('jobs_duration_seconds', 'Duração.', [0.1, 1]);
    histogram.observe({ type: 'a' }, 0.05);
    histogram.observe({ type: 'a' }, 0.5);
    histogram.observe({ type: 'a' }, 3);

    const text = renderMetrics([histogram.collect()]);
    expect(text).toContain('# TYPE jobs_duration_seconds histogram');
    expect(text).toContain('jobs_duration_seconds_bucket{type="a",le="0.1"} 1');
    expect(text).toContain('jobs_duration_seconds_bucket{type="a",le="1"} 2');
    expect(text).toContain('jobs_duration_seconds_bucket{type="a",le="+Inf"} 3');
    expect(text).toContain('jobs_duration_seconds_sum{type="a"} 3.55');
    expect(text).toContain('jobs_duration_seconds_count{type="a"} 3');
  });

  it('escapa aspas, barra e quebra de linha no valor do rótulo', () => {
    const text = renderMetrics([
      {
        name: 'x',
        help: 'linha 1\nlinha 2',
        type: 'gauge',
        samples: [{ labels: { a: 'q"\\\n' }, value: 1 }, { value: 2 }],
      },
    ]);
    expect(text).toBe('# HELP x linha 1\\nlinha 2\n# TYPE x gauge\nx{a="q\\"\\\\\\n"} 1\nx 2\n');
  });
});
