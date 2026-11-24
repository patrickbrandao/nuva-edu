import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

/** Dados de conexão com o PostgreSQL. */
export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Raiz do repositório (este arquivo fica em database/postgres/src). */
export const repoRoot = resolve(import.meta.dirname, '../../..');

/** Pasta padrão das migrations. */
export const defaultMigrationsDir = resolve(import.meta.dirname, '../migrations');

/**
 * Carrega `.env.local` e `.env` da raiz, sem sobrescrever o que já está no ambiente.
 * Precedência: ambiente do processo, depois `.env.local`, depois `.env`.
 */
export function loadEnvFiles(root: string = repoRoot): void {
  for (const name of ['.env.local', '.env']) {
    const file = resolve(root, name);
    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }
}

/**
 * Monta a conexão a partir do ambiente: `DATABASE_URL` se existir; senão `POSTGRES_USER`,
 * `POSTGRES_PASSWORD` e `POSTGRES_DB`, com `POSTGRES_HOST` (padrão 127.0.0.1) e
 * `NUVA_POSTGRES_PORT` (padrão 5432).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  if (env.DATABASE_URL) {
    return parseDatabaseUrl(env.DATABASE_URL);
  }
  const password = env.POSTGRES_PASSWORD;
  if (!password) {
    throw new Error(
      'Conexão não configurada: defina DATABASE_URL, ou POSTGRES_PASSWORD em .env.local (veja .env.example).',
    );
  }
  const port = Number(env.NUVA_POSTGRES_PORT ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`NUVA_POSTGRES_PORT inválida: ${env.NUVA_POSTGRES_PORT}`);
  }
  return {
    host: env.POSTGRES_HOST || '127.0.0.1',
    port,
    user: env.POSTGRES_USER || 'nuva_edu',
    password,
    database: env.POSTGRES_DB || 'nuva_edu',
  };
}

export function parseDatabaseUrl(value: string): DbConfig {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL deve começar com postgres:// ou postgresql://.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL sem nome de banco.');
  }
  return {
    host: decodeURIComponent(url.hostname),
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

/** URL de conexão para as aplicações e os testes. */
export function toDatabaseUrl(config: DbConfig): string {
  const auth = `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}`;
  return `postgres://${auth}@${config.host}:${config.port}/${encodeURIComponent(config.database)}`;
}

/** Abre uma conexão. Quem chama é responsável por `end()`. */
export async function connect(config: DbConfig, database?: string): Promise<pg.Client> {
  const client = new pg.Client({ ...config, database: database ?? config.database });
  // Conexão ociosa derrubada pelo servidor (DROP DATABASE ... FORCE) não pode matar o processo;
  // a consulta seguinte nessa conexão falha normalmente.
  client.on('error', () => {});
  await client.connect();
  return client;
}

/** Aceita só identificadores simples em minúsculas e devolve o nome entre aspas. */
export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Identificador inválido: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}
