import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { loadMigrations, type Migration } from './migrations.ts';

/** Tabela de controle: uma linha por migration aplicada. */
export const CONTROL_TABLE = 'schema_migrations';

/** Chave da trava consultiva (vale por banco). */
const MIGRATION_LOCK_KEY = '7741003001';

export interface MigratorOptions {
  /** Pasta das migrations. */
  dir: string;
  /** Recebe uma linha por passo. Padrão: silencioso. */
  log?: (message: string) => void;
  /** Tempo máximo de espera pela trava, em ms. Padrão: 60 s. */
  lockTimeoutMs?: number;
}

export interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
  appliedAt: Date;
}

export type MigrationState = 'aplicada' | 'pendente' | 'alterada' | 'sem-arquivo';

export interface StatusEntry {
  version: number;
  name: string;
  state: MigrationState;
  appliedAt: Date | null;
}

/** Erro de uso ou de consistência do mecanismo (não é falha do SQL da migration). */
export class MigrationError extends Error {
  override name = 'MigrationError';
}

function label(version: number): string {
  return String(version).padStart(4, '0');
}

/**
 * Executa `fn` com a trava de migrations do banco. Uma segunda execução espera a primeira
 * terminar (até `lockTimeoutMs`) e então vê o banco já atualizado.
 */
export async function withMigrationLock<T>(
  client: pg.Client,
  options: Pick<MigratorOptions, 'log' | 'lockTimeoutMs'>,
  fn: () => Promise<T>,
): Promise<T> {
  const timeout = options.lockTimeoutMs ?? 60_000;
  const deadline = Date.now() + timeout;
  let warned = false;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked',
      [MIGRATION_LOCK_KEY],
    );
    if (rows[0]?.locked) {
      break;
    }
    if (Date.now() >= deadline) {
      throw new MigrationError(
        `Outra execução de migrations segura a trava deste banco há mais de ${timeout} ms.`,
      );
    }
    if (!warned) {
      options.log?.('Outra execução de migrations está em andamento; aguardando a trava...');
      warned = true;
    }
    await sleep(Math.min(200, Math.max(10, deadline - Date.now())));
  }
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
  }
}

async function ensureControlTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_TABLE} (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

async function readApplied(client: pg.Client): Promise<AppliedRow[]> {
  const exists = await client.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [
    CONTROL_TABLE,
  ]);
  if (!exists.rows[0]?.oid) {
    return [];
  }
  const { rows } = await client.query<{
    version: number;
    name: string;
    checksum: string;
    applied_at: Date;
  }>(`SELECT version, name, checksum, applied_at FROM ${CONTROL_TABLE} ORDER BY version`);
  return rows.map((row) => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}

/**
 * Confere o histórico do banco contra a pasta: toda linha aplicada tem arquivo e o `up` do
 * arquivo não mudou. Como a numeração é contínua, o aplicado é sempre um prefixo da pasta.
 */
function checkHistory(applied: AppliedRow[], migrations: Migration[]): void {
  for (const row of applied) {
    const migration = migrations[row.version - 1];
    if (!migration) {
      throw new MigrationError(
        `O banco tem a migration ${label(row.version)} (${row.name}) aplicada, mas o arquivo não existe na pasta. O código está mais antigo que o banco?`,
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        `A migration ${migration.name} foi alterada depois de aplicada. Migration aplicada não se edita: crie uma nova.`,
      );
    }
  }
  applied.forEach((row, index) => {
    if (row.version !== index + 1) {
      throw new MigrationError(
        `Histórico com salto: falta a migration ${label(index + 1)} na tabela ${CONTROL_TABLE}.`,
      );
    }
  });
}

async function runInTransaction(
  client: pg.Client,
  migration: Migration,
  direction: 'up' | 'down',
  sql: string,
  record: () => Promise<unknown>,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await record();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha no ${direction} da migration ${migration.name}: ${reason}`, {
      cause: error,
    });
  }
}

function parseTarget(to: number | undefined, max: number, min: number): number | undefined {
  if (to === undefined) {
    return undefined;
  }
  if (!Number.isInteger(to) || to < min || to > max) {
    throw new MigrationError(`Versão de destino inválida: ${to} (aceito de ${min} a ${max}).`);
  }
  return to;
}

/** Aplica as migrations pendentes, em ordem, cada uma na própria transação. */
export async function migrateUp(
  client: pg.Client,
  options: MigratorOptions & { to?: number },
): Promise<Migration[]> {
  const migrations = await loadMigrations(options.dir);
  const target = parseTarget(options.to, migrations.length, 1) ?? migrations.length;
  return withMigrationLock(client, options, async () => {
    await ensureControlTable(client);
    const applied = await readApplied(client);
    checkHistory(applied, migrations);
    const pending = migrations.slice(applied.length, target);
    for (const migration of pending) {
      const started = performance.now();
      await runInTransaction(client, migration, 'up', migration.up, () =>
        client.query(`INSERT INTO ${CONTROL_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`, [
          migration.version,
          migration.name,
          migration.checksum,
        ]),
      );
      options.log?.(`up   ${migration.name} (${Math.round(performance.now() - started)} ms)`);
    }
    return pending;
  });
}

/**
 * Desfaz migrations, da mais recente para trás: `steps` (padrão 1) ou até restar a versão `to`
 * (`to: 0` desfaz tudo). Para na primeira migration irreversível, sem desfazê-la.
 */
export async function migrateDown(
  client: pg.Client,
  options: MigratorOptions & { steps?: number; to?: number },
): Promise<Migration[]> {
  if (options.steps !== undefined && options.to !== undefined) {
    throw new MigrationError('Use steps ou to, não os dois.');
  }
  const steps = options.steps ?? 1;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new MigrationError(`Quantidade de passos inválida: ${steps}.`);
  }
  const migrations = await loadMigrations(options.dir);
  return withMigrationLock(client, options, async () => {
    const applied = await readApplied(client);
    checkHistory(applied, migrations);
    const target =
      parseTarget(options.to, applied.length, 0) ?? Math.max(0, applied.length - steps);
    const reverted: Migration[] = [];
    for (const migration of migrations.slice(target, applied.length).reverse()) {
      if (migration.down === null) {
        throw new MigrationError(
          `A migration ${migration.name} é irreversível: não há down. Restaure um backup ou escreva uma migration nova.`,
        );
      }
      const started = performance.now();
      await runInTransaction(client, migration, 'down', migration.down, () =>
        client.query(`DELETE FROM ${CONTROL_TABLE} WHERE version = $1`, [migration.version]),
      );
      options.log?.(`down ${migration.name} (${Math.round(performance.now() - started)} ms)`);
      reverted.push(migration);
    }
    return reverted;
  });
}

/** Situação de cada migration, sem alterar o banco. */
export async function migrationStatus(
  client: pg.Client,
  options: Pick<MigratorOptions, 'dir'>,
): Promise<StatusEntry[]> {
  const migrations = await loadMigrations(options.dir);
  const applied = new Map((await readApplied(client)).map((row) => [row.version, row]));
  const entries: StatusEntry[] = migrations.map((migration) => {
    const row = applied.get(migration.version);
    applied.delete(migration.version);
    if (!row) {
      return {
        version: migration.version,
        name: migration.name,
        state: 'pendente',
        appliedAt: null,
      };
    }
    return {
      version: migration.version,
      name: migration.name,
      state: row.checksum === migration.checksum ? 'aplicada' : 'alterada',
      appliedAt: row.appliedAt,
    };
  });
  for (const row of applied.values()) {
    entries.push({
      version: row.version,
      name: row.name,
      state: 'sem-arquivo',
      appliedAt: row.appliedAt,
    });
  }
  return entries.sort((a, b) => a.version - b.version);
}

/** Versão aplicada mais alta (0 com o banco vazio). As APIs comparam com `latestVersion`. */
export async function currentVersion(client: pg.Client): Promise<number> {
  const applied = await readApplied(client);
  return applied.at(-1)?.version ?? 0;
}

/** Versão mais alta da pasta: a que o código espera encontrar no banco. */
export async function latestVersion(dir: string): Promise<number> {
  return (await loadMigrations(dir)).length;
}
