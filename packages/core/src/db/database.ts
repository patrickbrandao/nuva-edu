import { CamelCasePlugin, Kysely, type LogEvent, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Logger } from '../logging/logger.ts';
import type { DB } from './generated/database.ts';

/** Conexão tipada com o banco. Os tipos vêm de `pnpm --filter @nuva-edu/core db:types`. */
export type Database = Kysely<DB>;

export interface DatabaseOptions {
  /** `config.databaseUrl`. */
  connectionString: string;
  /** Conexões do pool deste processo. Padrão: 10. */
  maxConnections?: number;
  /** Aparece em `pg_stat_activity`; use o nome do serviço. */
  applicationName?: string;
  /** Recebe consultas (nível `debug`, só o SQL) e falhas (nível `error`). */
  logger?: Logger;
}

/**
 * Abre o pool e devolve o Kysely. As colunas `snake_case` do banco aparecem em `camelCase` no
 * código (`CamelCasePlugin`); o conteúdo de colunas JSON não é convertido.
 * Quem chama encerra com `closeDatabase`.
 */
export function createDatabase(options: DatabaseOptions): Database {
  const { logger } = options;
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName ?? 'nuva-edu',
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // Conexão ociosa derrubada pelo servidor emite `error` no pool; sem ouvinte, mata o processo.
  pool.on('error', (error) => {
    logger?.error({ err: summarizeDatabaseError(error) }, 'Conexão ociosa com o banco caiu');
  });

  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
    ...(logger ? { log: (event: LogEvent) => logQuery(logger, event) } : {}),
  });
}

/** `true` quando o banco responde; usado por `/readyz`. Nunca lança. */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.destroy();
}

/**
 * Resumo de um erro do PostgreSQL seguro para log. Os parâmetros da consulta e os campos
 * `detail` e `where` ficam de fora: eles reproduzem valores das linhas ("Failing row
 * contains (...)"), e a senha do usuário é guardada em texto legível.
 */
export function summarizeDatabaseError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: 'UnknownError' };
  }
  const source = error as Error & Record<string, unknown>;
  const summary: Record<string, unknown> = { type: error.name, message: error.message };
  for (const field of ['code', 'severity', 'schema', 'table', 'column', 'constraint', 'routine']) {
    if (typeof source[field] === 'string') {
      summary[field] = source[field];
    }
  }
  return summary;
}

function logQuery(logger: Logger, event: LogEvent): void {
  const fields = {
    sql: event.query.sql,
    duration_ms: Math.round(event.queryDurationMillis),
  };
  if (event.level === 'error') {
    logger.error({ ...fields, err: summarizeDatabaseError(event.error) }, 'Consulta falhou');
  } else {
    logger.debug(fields, 'Consulta executada');
  }
}
