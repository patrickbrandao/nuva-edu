#!/usr/bin/env node
// Atalhos do Docker Compose com os arquivos de ambiente do projeto (spec 031).
//
//   pnpm compose <args>   docker compose --env-file .env --env-file .env.local <args>
//   pnpm dev:up           migra o volume do banco, se preciso, e sobe o ambiente local
//                         (perfis traefik, mailpit e oauth-mock), esperando a saúde
//   pnpm dev:down         derruba o ambiente local; os volumes ficam
//
// Os três incluem o `docker-compose.dev.yml` (porta do Postgres em 127.0.0.1) conforme
// NUVA_POSTGRES_PUBLISH: `true` publica, `false` não; vazio publica só com NUVA_DOMAIN=localhost.
// Na máquina de desenvolvimento (NUVA_DOMAIN=localhost) os três também ligam o provedor OAuth
// simulado nas APIs (NUVA_OAUTH_MOCK_URL e NUVA_OAUTH_MOCK_INTERNAL_URL), que nunca ficam no
// `.env` versionado: ele vai ao servidor.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const DEV_PROFILES = ['traefik', 'mailpit', 'oauth-mock'];

export const USAGE = `Uso: node scripts/dev.mjs <comando> [args]

Comandos:
  compose <args>   docker compose com --env-file .env e .env.local (ex.: pnpm compose ps)
  up [args]        migra o volume do banco, se preciso (scripts/volume-migrate.sh), e sobe o
                   ambiente local com os perfis ${DEV_PROFILES.join(', ')}, esperando a saúde
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

/** Endereço do simulador na rede interna do Compose (serviço `oauth-mock`, porta 8080). */
export const OAUTH_MOCK_INTERNAL_URL = 'http://oauth-mock:8080';

/**
 * Variáveis que ligam o provedor OAuth simulado nas APIs (ADR 0024; spec 031, "Ambientes"), a
 * acrescentar ao ambiente do `docker compose`. Só na máquina de desenvolvimento, reconhecida por
 * NUVA_DOMAIN=localhost: com outro domínio (servidor, instalação da escola) devolve `{}`.
 * Variável já presente em `defined` (ambiente do processo ou `.env.local`, mesmo vazia) é de quem
 * a definiu e não é tocada: `NUVA_OAUTH_MOCK_URL=` no `.env.local` desliga o simulador (e aí o
 * endereço interno também não é preenchido).
 * `env` segue a precedência de `mergeEnv`.
 */
export function oauthMockEnv(env = {}, defined = {}) {
  if ((env.NUVA_DOMAIN || 'localhost').trim().toLowerCase() !== 'localhost') return {};
  const extra = {};
  if (!('NUVA_OAUTH_MOCK_URL' in defined)) {
    extra.NUVA_OAUTH_MOCK_URL = `http://oauth-mock.localhost:${env.TRAEFIK_HTTP_PORT || '8080'}`;
  } else if (!defined.NUVA_OAUTH_MOCK_URL?.trim()) {
    // Desligado: o endereço interno sozinho impediria a subida das APIs.
    return {};
  }
  // As APIs, de dentro dos contêineres, só alcançam o simulador pela rede interna.
  if (!('NUVA_OAUTH_MOCK_INTERNAL_URL' in defined)) {
    extra.NUVA_OAUTH_MOCK_INTERNAL_URL = OAUTH_MOCK_INTERNAL_URL;
  }
  return extra;
}

export const PAYMENT_FAKE_INTERNAL_URL = 'http://payment-fake:8092';

export function paymentFakeEnv(env = {}, defined = {}) {
  if (
    (env.NUVA_DOMAIN || 'localhost').trim().toLowerCase() !== 'localhost' ||
    env.NUVA_ENV === 'production' ||
    (env.NUVA_PAYMENT_PROVIDER && env.NUVA_PAYMENT_PROVIDER !== 'fake')
  ) {
    return {};
  }
  return {
    NUVA_PAYMENT_PROVIDER: 'fake',
    NUVA_PAYMENT_FAKE_URL: defined.NUVA_PAYMENT_FAKE_URL ?? PAYMENT_FAKE_INTERNAL_URL,
  };
}

function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

/**
 * Argumentos do `docker compose` para cada comando. Devolve `null` quando o comando não existe.
 * Sem `.env.local` o Compose ainda roda e falha citando a variável que falta (`${VAR:?}`).
 */
export function composeArgs(
  command,
  extra = [],
  { hasLocal = true, publish = false, paymentFake = false } = {},
) {
  // Quem passa `-f` por conta própria escolhe os arquivos; aí o de desenvolvimento não entra.
  const ownFiles = extra.some((arg) => /^(-f|--file)(=|$)/.test(arg));
  const files = publish && !ownFiles ? DEV_COMPOSE_FILES.flatMap((file) => ['-f', file]) : [];
  const base = [...envFileArgs(hasLocal), ...files];
  const enabledProfiles = paymentFake ? [...DEV_PROFILES, 'payment-fake'] : DEV_PROFILES;
  const profiles = enabledProfiles.flatMap((profile) => ['--profile', profile]);
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

/**
 * Argumentos do `bash` que roda a migração de volume (spec 031, "Volumes") antes do `up`, com
 * os mesmos arquivos de ambiente e de Compose do `up`. O script só para o `postgres` do projeto
 * quando há cópia a fazer; nos outros casos não muda nada.
 */
export function volumeMigrateArgs({ hasLocal = true, publish = false } = {}) {
  const files = publish ? DEV_COMPOSE_FILES.flatMap((file) => ['-f', file]) : [];
  return ['scripts/volume-migrate.sh', '--', ...envFileArgs(hasLocal), ...files];
}

function main(argv) {
  const root = resolve(import.meta.dirname, '..');
  // O pnpm repassa o `--` de `pnpm compose -- <args>`; o docker não o entende.
  const [command, ...rest] = argv;
  const extra = rest[0] === '--' ? rest.slice(1) : rest;
  const local = readEnvFile(join(root, '.env.local'));
  const merged = mergeEnv(readEnvFile(join(root, '.env')), local, process.env);
  let publish;
  try {
    publish = publishPostgres(merged);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const defined = { ...local, ...process.env };
  const payment = paymentFakeEnv(merged, defined);
  const env = { ...process.env, ...oauthMockEnv(merged, defined), ...payment };
  const args = composeArgs(command, extra, {
    hasLocal: existsSync(join(root, '.env.local')),
    publish,
    paymentFake: payment.NUVA_PAYMENT_FAKE_URL === PAYMENT_FAKE_INTERNAL_URL,
  });
  if (args === null || (command === 'compose' && extra.length === 0)) {
    console.error(USAGE);
    return 1;
  }
  if (command === 'up') {
    const migrate = spawnSync(
      'bash',
      volumeMigrateArgs({ hasLocal: existsSync(join(root, '.env.local')), publish }),
      { cwd: root, stdio: 'inherit', env },
    );
    if (migrate.error || migrate.status !== 0) {
      console.error(
        migrate.error
          ? `Não foi possível executar a migração de volume: ${migrate.error.message}`
          : 'A migração de volume falhou; nada foi subido. Veja docs/ambiente-local.md.',
      );
      return migrate.status || 1;
    }
  }
  const result = spawnSync('docker', ['compose', ...args], { cwd: root, stdio: 'inherit', env });
  if (result.error) {
    console.error(`Não foi possível executar o docker: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
