#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { connect, defaultMigrationsDir, loadConfig, loadEnvFiles } from './config.ts';
import { MigrationError, migrateDown, migrateUp, migrationStatus } from './migrator.ts';
import { dropStaleTemplates, dropStaleTestDatabases, ensureTemplate } from './template.ts';

const USAGE = `Uso: pnpm db:migrate <comando> [opções]

Comandos:
  up [--to N]                 aplica as migrations pendentes (até a versão N)
  down [--steps N | --to N]   desfaz a última migration, as N últimas, ou até restar a versão N
  status                      mostra a situação de cada migration
  template                    cria o banco modelo dos testes do conjunto de migrations
                              (<db>_tpl_<hash>) e expurga os modelos sem uso

Conexão: DATABASE_URL, ou POSTGRES_* e NUVA_POSTGRES_PORT (lidos também de .env e .env.local).
Saída: 0 certo; 1 erro; 2 banco inacessível.`;

function toInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new MigrationError(`--${flag} espera um número inteiro; recebi "${value}".`);
  }
  return Number(value);
}

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === 'string' &&
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', '28P01', '3D000', '57P03'].includes(
      code,
    )
  );
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      to: { type: 'string' },
      steps: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (positionals.length > 1 || !['up', 'down', 'status', 'template'].includes(command)) {
    console.error(`Comando desconhecido: ${positionals.join(' ')}\n\n${USAGE}`);
    return 1;
  }
  const to = toInt(values.to, 'to');
  const steps = toInt(values.steps, 'steps');
  const dir = defaultMigrationsDir;
  const log = (message: string) => console.log(message);

  loadEnvFiles();
  const config = loadConfig();

  if (command === 'template') {
    const removed = await dropStaleTestDatabases({ config });
    for (const name of removed) {
      log(`Banco de teste antigo removido: ${name}`);
    }
    const result = await ensureTemplate({ config, dir, log });
    log(
      result.rebuilt
        ? `Banco modelo ${result.name} criado (${result.hash.slice(0, 12)}).`
        : `Banco modelo ${result.name} em dia (${result.hash.slice(0, 12)}).`,
    );
    if (!result.rebuilt) {
      // Com modelo novo, o ensureTemplate já expurgou.
      for (const name of await dropStaleTemplates({ config, dir })) {
        log(`Banco modelo sem uso removido: ${name}`);
      }
    }
    return 0;
  }

  const client = await connect(config);
  try {
    if (command === 'up') {
      const applied = await migrateUp(client, to === undefined ? { dir, log } : { dir, log, to });
      log(applied.length ? `${applied.length} migration(s) aplicada(s).` : 'Nada a aplicar.');
    } else if (command === 'down') {
      const reverted = await migrateDown(client, {
        dir,
        log,
        ...(to === undefined ? {} : { to }),
        ...(steps === undefined ? {} : { steps }),
      });
      log(reverted.length ? `${reverted.length} migration(s) desfeita(s).` : 'Nada a desfazer.');
    } else {
      const entries = await migrationStatus(client, { dir });
      if (entries.length === 0) {
        log('Nenhuma migration na pasta.');
      }
      for (const entry of entries) {
        const when = entry.appliedAt ? `  ${entry.appliedAt.toISOString()}` : '';
        log(`${entry.state.padEnd(11)}  ${entry.name}${when}`);
      }
      if (entries.some((entry) => entry.state === 'alterada' || entry.state === 'sem-arquivo')) {
        return 1;
      }
    }
    return 0;
  } finally {
    await client.end();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (isConnectionError(error)) {
    console.error(
      `Banco inacessível: ${error instanceof Error ? error.message : String(error)}\nSuba o Postgres: docker compose --env-file .env --env-file .env.local up -d postgres`,
    );
    process.exitCode = 2;
  } else if (
    error instanceof MigrationError ||
    (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
  ) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } else {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
