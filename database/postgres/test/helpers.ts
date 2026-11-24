import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { connect, type DbConfig, loadConfig, loadEnvFiles, quoteIdent } from '../src/config.ts';

loadEnvFiles();

/** Conexão com o Postgres local de desenvolvimento. */
export const config: DbConfig = loadConfig();

/** Sufixo único, para que execuções simultâneas não disputem nomes. */
export function unique(): string {
  return randomBytes(4).toString('hex');
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect(config);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface Scratch {
  name: string;
  client: pg.Client;
  /** Abre outra conexão com o mesmo banco. */
  connect: () => Promise<pg.Client>;
  drop: () => Promise<void>;
}

/** Banco vazio e descartável, com o padrão de nome dos bancos de teste. */
export async function createScratchDatabase(): Promise<Scratch> {
  const name = `${config.database}_test_${Date.now().toString(36)}_${unique()}`;
  await admin((client) => client.query(`CREATE DATABASE ${quoteIdent(name)}`));
  const extra: pg.Client[] = [];
  const open = async () => {
    const client = await connect(config, name);
    extra.push(client);
    return client;
  };
  return {
    name,
    client: await open(),
    connect: open,
    drop: async () => {
      await Promise.all(extra.map((client) => client.end().catch(() => {})));
      await admin((client) =>
        client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`),
      );
    },
  };
}

export async function databaseExists(name: string): Promise<boolean> {
  return admin(async (client) => {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return result.rowCount === 1;
  });
}

export async function databaseComment(name: string): Promise<string | null> {
  return admin(async (client) => {
    const { rows } = await client.query<{ comment: string | null }>(
      `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1`,
      [name],
    );
    return rows[0]?.comment ?? null;
  });
}

/** Apaga qualquer banco cujo nome comece com `prefix` (inclusive modelos). */
export async function dropDatabasesWithPrefix(prefix: string): Promise<void> {
  await admin(async (client) => {
    const { rows } = await client.query<{ datname: string; datistemplate: boolean }>(
      'SELECT datname, datistemplate FROM pg_database WHERE starts_with(datname, $1)',
      [prefix],
    );
    for (const row of rows) {
      const name = quoteIdent(row.datname);
      if (row.datistemplate) {
        await client.query(`ALTER DATABASE ${name} WITH IS_TEMPLATE false`);
      }
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  });
}

export interface MigrationsDir {
  dir: string;
  write: (file: string, content: string) => Promise<void>;
  remove: () => Promise<void>;
}

/** Pasta temporária de migrations para os testes do mecanismo. */
export async function createMigrationsDir(
  files: Record<string, string> = {},
): Promise<MigrationsDir> {
  const dir = await mkdtemp(join(tmpdir(), 'nuva-migrations-'));
  const write = (file: string, content: string) => writeFile(join(dir, file), content);
  for (const [file, content] of Object.entries(files)) {
    await write(file, content);
  }
  return { dir, write, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** Monta o texto de uma migration. */
export function sql(up: string, down: string): string {
  return `-- migrate:up\n${up}\n-- migrate:down\n${down}\n`;
}

export async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [
    table,
  ]);
  return rows[0]?.oid != null;
}
