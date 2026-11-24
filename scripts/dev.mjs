#!/usr/bin/env node
// Atalhos do Docker Compose com os arquivos de ambiente do projeto (spec 031).
//
//   pnpm compose <args>   docker compose --env-file .env --env-file .env.local <args>
//   pnpm dev:up           sobe o ambiente local (perfis traefik e mailpit) e espera a saúde
//   pnpm dev:down         derruba o ambiente local; os volumes ficam
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEV_PROFILES = ['traefik', 'mailpit'];

export const USAGE = `Uso: node scripts/dev.mjs <comando> [args]

Comandos:
  compose <args>   docker compose com --env-file .env e .env.local (ex.: pnpm compose ps)
  up [args]        sobe o ambiente local com os perfis ${DEV_PROFILES.join(' e ')} e espera a saúde
  down [args]      derruba o ambiente local sem remover os volumes`;

/** `--env-file` na ordem em que o Compose deve ler: `.env` e depois `.env.local`, se existir. */
export function envFileArgs(hasLocal) {
  return ['--env-file', '.env', ...(hasLocal ? ['--env-file', '.env.local'] : [])];
}

/**
 * Argumentos do `docker compose` para cada comando. Devolve `null` quando o comando não existe.
 * Sem `.env.local` o Compose ainda roda e falha citando a variável que falta (`${VAR:?}`).
 */
export function composeArgs(command, extra = [], { hasLocal = true } = {}) {
  const base = envFileArgs(hasLocal);
  const profiles = DEV_PROFILES.flatMap((profile) => ['--profile', profile]);
  switch (command) {
    case 'compose':
      return [...base, ...extra];
    case 'up':
      return [...base, ...profiles, 'up', '-d', '--build', '--wait', ...extra];
    case 'down':
      return [...base, ...profiles, 'down', ...extra];
    default:
      return null;
  }
}

function main(argv) {
  const root = resolve(import.meta.dirname, '..');
  // O pnpm repassa o `--` de `pnpm compose -- <args>`; o docker não o entende.
  const [command, ...rest] = argv;
  const extra = rest[0] === '--' ? rest.slice(1) : rest;
  const args = composeArgs(command, extra, { hasLocal: existsSync(join(root, '.env.local')) });
  if (args === null || (command === 'compose' && extra.length === 0)) {
    console.error(USAGE);
    return 1;
  }
  const result = spawnSync('docker', ['compose', ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(`Não foi possível executar o docker: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
