import { describe, expect, it } from 'vitest';
import { createWorkerMetrics, DURATION_BUCKETS } from '../src/metrics.ts';

describe('métricas do laço de consumo', () => {
  it('soma jobs_total por conjunto de rótulos, sem depender da ordem deles', () => {
    const { registry, jobsTotal } = createWorkerMetrics();
    jobsTotal.inc({ type: 'example.echo', outcome: 'done' });
    jobsTotal.inc({ outcome: 'done', type: 'example.echo' });
    jobsTotal.inc({ type: 'example.echo', outcome: 'failed' });

    expect(jobsTotal.get({ type: 'example.echo', outcome: 'done' })).toBe(2);
    // Os rótulos saem em ordem alfabética.
    expect(registry.render()).toContain(
      [
        '# HELP jobs_total Execuções de tarefa por tipo e desfecho.',
        '# TYPE jobs_total counter',
        'jobs_total{outcome="done",type="example.echo"} 2',
        'jobs_total{outcome="failed",type="example.echo"} 1',
        '',
      ].join('\n'),
    );
  });

  it('acumula jobs_duration_seconds por faixa e fecha em +Inf, soma e contagem', () => {
    const { registry, jobDuration } = createWorkerMetrics();
    jobDuration.observe(0.05, { type: 'a' });
    jobDuration.observe(0.5, { type: 'a' });
    jobDuration.observe(400, { type: 'a' });

    const text = registry.render();
    expect(text).toContain('# TYPE jobs_duration_seconds histogram');
    expect(text).toContain('jobs_duration_seconds_bucket{le="0.025",type="a"} 0');
    expect(text).toContain('jobs_duration_seconds_bucket{le="0.05",type="a"} 1');
    expect(text).toContain('jobs_duration_seconds_bucket{le="0.5",type="a"} 2');
    // Faixas do worker, mais longas que as de requisição: vão até 5 min.
    expect(text).toContain('jobs_duration_seconds_bucket{le="300",type="a"} 2');
    expect(text).toContain('jobs_duration_seconds_bucket{le="+Inf",type="a"} 3');
    expect(text).toContain('jobs_duration_seconds_sum{type="a"} 400.55');
    expect(text).toContain('jobs_duration_seconds_count{type="a"} 3');
    expect(DURATION_BUCKETS.at(-1)).toBe(300);
  });
});
