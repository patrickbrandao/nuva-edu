// Antes dos testes: reutiliza o ambiente do Compose se ele estiver saudável; se não estiver, sobe
// com `pnpm dev:up`. Não derruba nada ao final. Falha com a URL que não respondeu e o comando.
import { spawnSync } from 'node:child_process';
import { ROOT_DIR, UP_COMMAND, USES_LOCAL_COMPOSE } from './env.ts';
import { findFailures, formatFailures } from './environment.ts';

/** Sonda de novo até tudo responder ou o prazo acabar (o proxy leva alguns segundos para rotear). */
async function waitHealthy(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let failures = await findFailures();
  while (failures.length > 0 && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 2000));
    failures = await findFailures();
  }
  return failures;
}

export default async function globalSetup(): Promise<void> {
  const failures = await findFailures();
  if (failures.length === 0) {
    return;
  }
  if (!USES_LOCAL_COMPOSE) {
    throw new Error(formatFailures(failures, 'NUVA_E2E_COMPOSE=0: não tentei subir'));
  }

  console.log(`${formatFailures(failures)}\n\nSubindo com ${UP_COMMAND}…`);
  const [command = 'pnpm', ...args] = UP_COMMAND.split(' ');
  const up = spawnSync(command, args, { cwd: ROOT_DIR, stdio: 'inherit' });
  if (up.error || up.status !== 0) {
    const why = up.error ? up.error.message : `saiu com código ${up.status}`;
    throw new Error(formatFailures(failures, `${UP_COMMAND} falhou: ${why}`));
  }

  const remaining = await waitHealthy(60_000);
  if (remaining.length > 0) {
    throw new Error(formatFailures(remaining, `mesmo depois de ${UP_COMMAND}`));
  }
}
