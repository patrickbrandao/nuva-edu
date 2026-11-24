import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');

/** Roda um trecho num processo Node de verdade, como um app do workspace faria. */
function run(code: string, env: Record<string, string>) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: packageRoot,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });
}

describe('pacote no Node, sem build', () => {
  it('é importável pelo nome e expõe a API pública', () => {
    const result = run(
      `const core = await import('@nuva-edu/core');
       console.log(Object.keys(core).sort().join(','));`,
      {},
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    for (const name of [
      'loadConfig',
      'createDatabase',
      'createLogger',
      'DomainError',
      'toProblem',
    ]) {
      expect(result.stdout.split(',')).toContain(name);
    }
  });

  it('configuração inválida derruba o processo com mensagem que cita a variável', () => {
    const result = run(
      `const { loadConfigOrExit } = await import('@nuva-edu/core');
       loadConfigOrExit({ service: 'worker', required: ['SESSION_SECRET'] });
       console.log('não deveria chegar aqui');`,
      { NUVA_WORKER_CONCURRENCY: 'muitas' },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('não deveria chegar aqui');
    const line = JSON.parse(result.stdout);
    expect(line.level).toBe('fatal');
    expect(line.service).toBe('worker');
    expect(line.variables).toEqual(['DATABASE_URL', 'SESSION_SECRET', 'NUVA_WORKER_CONCURRENCY']);
    expect(line.msg).toContain('NUVA_WORKER_CONCURRENCY');
  });
});
