import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type Config,
  closeDatabase,
  createAccount,
  createDatabase,
  createLogger,
  type Database,
  loadConfig,
} from '@nuva-edu/core';
import {
  createTestDatabase,
  dropTestDatabase,
  parseDatabaseUrl,
  type TestDatabase,
} from '@nuva-edu/database';
import { type AdminAppOptions, buildAdminApp } from '../src/app.ts';

export interface TestApp {
  app: FastifyInstance;
  config: Config;
  db: Database;
  lines: Record<string, unknown>[];
  logText(): string;
  close(): Promise<void>;
}

/**
 * A admin-api como sobe de verdade, sobre o banco de teste da execução (`DATABASE_URL`, do
 * `globalSetup`). `env` acrescenta ou troca variáveis da instalação.
 */
export function createTestApp(
  env: Record<string, string> = {},
  overrides: Partial<AdminAppOptions> = {},
): TestApp {
  const databaseUrl = env.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL ausente: o globalSetup do Vitest não rodou.');
  }
  // Ambiente montado à mão: o teste não depende do `.env.local` de quem o roda.
  const config = loadConfig({ env: { NUVA_ENV: 'test', ...env, DATABASE_URL: databaseUrl } });
  const raw: string[] = [];
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: 'admin-api',
    level: 'debug',
    write: (line) => {
      raw.push(line);
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const db = createDatabase({ connectionString: config.databaseUrl, maxConnections: 2 });
  const app = buildAdminApp({ config, db, logger, ...overrides });
  return {
    app,
    config,
    db,
    lines,
    logText: () => raw.join(''),
    close: async () => {
      await app.close();
      await closeDatabase(db);
    },
  };
}

/** Senha de teste: a varredura procura este texto em respostas e logs (ADR 0002, RNF-05). */
export const TEST_PASSWORD = 'Senha-de-Teste-Admin-9Zk!q';

let ipSeq = 0;
/** Um IP público por chamada: as falhas de login contam por IP no banco compartilhado. */
export function nextIp(): string {
  ipSeq += 1;
  return `198.51.${(process.pid + ipSeq) % 256}.${ipSeq % 250}`;
}

export function uniqueEmail(prefix = 'pessoa'): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Conta com senha e e-mail confirmado. Papel padrão: `manager`. */
export async function createUser(
  db: Database,
  options: { role?: 'student' | 'instructor' | 'manager' | 'admin'; password?: string | null } = {},
): Promise<TestUser> {
  const email = uniqueEmail(options.role ?? 'manager');
  const password = options.password === undefined ? TEST_PASSWORD : options.password;
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: 'Pessoa de Teste',
      password,
      role: options.role ?? 'manager',
      emailVerified: true,
    }),
  );
  return { id, email, password: password ?? '' };
}

/** `nuva_admin_session=<valor>` do `Set-Cookie` de uma resposta, ou `null`. */
export function sessionCookieOf(setCookie: string | string[] | undefined): string | null {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const line = all.find((value) => value.startsWith('nuva_admin_session='));
  return line ? (line.split(';')[0]?.slice('nuva_admin_session='.length) ?? null) : null;
}

/** Banco próprio, copiado do modelo do mesmo servidor (para o que depende de "nenhum admin"). */
export async function createIsolatedDatabase(): Promise<TestDatabase> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL ausente: o globalSetup do Vitest não rodou.');
  }
  const config = parseDatabaseUrl(url);
  const baseName = config.database.slice(0, config.database.indexOf('_test_'));
  const created = await createTestDatabase({ config, baseName });
  return { ...created, drop: () => dropTestDatabase(created.name, { config, baseName }) };
}
