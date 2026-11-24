import {
  createDatabase,
  createLogger,
  type Database,
  type Job,
  type JobHandlers,
  type Logger,
} from '@nuva-edu/core';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Banco descartável da execução, clonado do modelo (`scripts/test-db.mjs`). */
    databaseUrl: string;
  }
}

export function testDatabaseUrl(): string {
  return inject('databaseUrl');
}

export function openDatabase(maxConnections = 8): Database {
  return createDatabase({ connectionString: testDatabaseUrl(), maxConnections });
}

export interface CapturedLogger {
  logger: Logger;
  lines: Record<string, unknown>[];
}

/** Logger que guarda as linhas em memória, para conferir o que foi (e o que não foi) escrito. */
export function captureLogger(): CapturedLogger {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: 'worker',
    level: 'debug',
    write: (line) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, lines };
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('condição não atendida no prazo');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function getJob(db: Database, id: string): Promise<Job> {
  const row = await db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) {
    throw new Error(`tarefa ${id} não existe`);
  }
  return row as unknown as Job;
}

export async function clearJobs(db: Database): Promise<void> {
  await db.deleteFrom('jobs').execute();
}

/** Manipuladores que não fazem nada, com os que o teste quiser trocar. */
export function handlersWith(overrides: Partial<JobHandlers> = {}): JobHandlers {
  return {
    'example.echo': async () => {},
    'retention.purge': async () => {},
    ...overrides,
  };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
