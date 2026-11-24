// Banco dos testes (specs/032). Serve de `globalSetup` do Vitest e de biblioteca para o
// `scripts/verify.mjs`.
//
// De onde vem o Postgres:
//   NUVA_TEST_PG_URL=<url>  servidor já preparado por quem orquestra (o `verify:full` passa o
//                           contêiner dele aqui);
//   NUVA_TEST_DB=local      o Postgres de desenvolvimento (`.env` e `.env.local` da raiz);
//   nenhum dos dois         um contêiner descartável, por Testcontainers.
//
// Nos três casos o banco dos testes é uma cópia nova do banco modelo (`<base>_tpl`), com nome
// único, apagada no fim. A URL dela fica em `DATABASE_URL`.
//
// Uso no Vitest (caminho relativo à pasta do pacote):
//   test: { globalSetup: ['../../scripts/test-db.mjs'] }

import { randomBytes } from 'node:crypto';
import {
  createTestDatabase,
  ensureTemplate,
  loadConfig,
  loadEnvFiles,
  parseDatabaseUrl,
} from '@nuva-edu/database';

/** Sobe um PostgreSQL descartável e devolve a URL de administração e a função que o remove. */
export async function startPostgresContainer(env = process.env) {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer(env.POSTGRES_IMAGE || 'postgres:18-alpine')
    .withDatabase('nuva_edu')
    .withUsername('nuva_edu')
    .withPassword(randomBytes(12).toString('hex'))
    // Dados em memória: mais rápido, e nada sobra no disco.
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
    .start();
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Cria o banco da execução a partir do modelo.
 * @returns `{ name, url, mode, stop }`; `stop` apaga o banco e, se foi este módulo que subiu o
 *          contêiner, remove-o também.
 */
export async function startTestDatabase(env = process.env) {
  let config;
  let mode;
  let stopServer = async () => {};

  if (env.NUVA_TEST_PG_URL) {
    mode = 'externo';
    config = parseDatabaseUrl(env.NUVA_TEST_PG_URL);
  } else if (env.NUVA_TEST_DB === 'local') {
    mode = 'local';
    if (env === process.env) {
      loadEnvFiles();
    }
    config = loadConfig(env);
  } else if (!env.NUVA_TEST_DB || env.NUVA_TEST_DB === 'container') {
    mode = 'container';
    const server = await startPostgresContainer(env);
    config = parseDatabaseUrl(server.url);
    stopServer = server.stop;
  } else {
    throw new Error(`NUVA_TEST_DB inválida: "${env.NUVA_TEST_DB}". Use "local" ou "container".`);
  }

  try {
    await ensureTemplate({ config });
    const database = await createTestDatabase({ config });
    return {
      name: database.name,
      url: database.url,
      mode,
      stop: async () => {
        try {
          await database.drop();
        } finally {
          await stopServer();
        }
      },
    };
  } catch (error) {
    await stopServer();
    throw error;
  }
}

let current = null;
let previousUrl;

/** `globalSetup` do Vitest: roda uma vez, antes de os testes começarem. */
export async function setup(project) {
  current = await startTestDatabase();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = current.url;
  project?.provide?.('databaseUrl', current.url);
}

export async function teardown() {
  const database = current;
  current = null;
  if (previousUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousUrl;
  }
  await database?.stop();
}
