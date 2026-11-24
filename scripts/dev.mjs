#!/usr/bin/env node
// Atalhos do Docker Compose com os arquivos de ambiente do projeto (spec 031).
//
//   pnpm compose <args>   docker compose --env-file .env --env-file .env.local <args>
//   pnpm dev:up           sobe o ambiente local (perfis traefik e mailpit) e espera a saúde
//   pnpm dev:down         derruba o ambiente local; os volumes ficam
//
// Os três incluem o `docker-compose.dev.yml` (porta do Postgres em 127.0.0.1) conforme
// NUVA_POSTGRES_PUBLISH: `true` publica, `false` não; vazio publica só com NUVA_DOMAIN=localhost.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

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

/** Arquivos do Compose quando a porta do Postgres é publicada no hospedeiro. */
export const DEV_COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.dev.yml'];

/**
 * Decide se a porta do Postgres é publicada em 127.0.0.1. `env` já vem na precedência do Compose
 * (ambiente do processo, depois `.env.local`, depois `.env`). Sem NUVA_POSTGRES_PUBLISH, publica
 * só na máquina de desenvolvimento, reconhecida por NUVA_DOMAIN=localhost (padrão do `.env`).
 */
export function publishPostgres(env = {}) {
  const value = (env.NUVA_POSTGRES_PUBLISH ?? '').trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '') {
    throw new Error(`NUVA_POSTGRES_PUBLISH inválida: "${value}" (use true, false ou deixe vazia)`);
  }
  return (env.NUVA_DOMAIN || 'localhost').trim().toLowerCase() === 'localhost';
}

/** Junta `.env`, `.env.local` e o ambiente do processo; o último ganha, e vazio vale como ausente. */
export function mergeEnv(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      if (value !== undefined && value !== '') merged[name] = value;
    }
  }
  return merged;
}

function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

/**
 * Argumentos do `docker compose` para cada comando. Devolve `null` quando o comando não existe.
 * Sem `.env.local` o Compose ainda roda e falha citando a variável que falta (`${VAR:?}`).
 */
export function composeArgs(command, extra = [], { hasLocal = true, publish = false } = {}) {
  // Quem passa `-f` por conta própria escolhe os arquivos; aí o de desenvolvimento não entra.
  const ownFiles = extra.some((arg) => /^(-f|--file)(=|$)/.test(arg));
  const files = publish && !ownFiles ? DEV_COMPOSE_FILES.flatMap((file) => ['-f', file]) : [];
  const base = [...envFileArgs(hasLocal), ...files];
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
  let publish;
  try {
    publish = publishPostgres(
      mergeEnv(readEnvFile(join(root, '.env')), readEnvFile(join(root, '.env.local')), process.env),
    );
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const args = composeArgs(command, extra, {
    hasLocal: existsSync(join(root, '.env.local')),
    publish,
  });
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
