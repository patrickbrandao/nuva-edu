import type { FastifyInstance } from '@nuva-edu/api-kit';
import type { AuthenticatedSession } from '@nuva-edu/core';
import {
  type Config,
  closeDatabase,
  createDatabase,
  createLogger,
  type Database,
  loadConfig,
} from '@nuva-edu/core';
import { buildClassroomApp, type ClassroomAppOptions } from '../src/app.ts';

export interface TestApp {
  app: FastifyInstance;
  config: Config;
  db: Database;
  lines: Record<string, unknown>[];
  logText(): string;
  close(): Promise<void>;
}

/**
 * A classroom-api como sobe de verdade, sobre o banco de teste da execução (`DATABASE_URL`, do
 * `globalSetup`). `env` acrescenta ou troca variáveis da instalação.
 */
export function createTestApp(
  env: Record<string, string> = {},
  overrides: Partial<ClassroomAppOptions> = {},
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
    service: 'classroom-api',
    level: 'debug',
    write: (line) => {
      raw.push(line);
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const db = createDatabase({ connectionString: config.databaseUrl, maxConnections: 2 });
  // Sem limite de taxa nem conferência periódica das sessões do SSE, salvo quando o teste pede:
  // cada teste faz muitas requisições do mesmo IP.
  const app = buildClassroomApp({
    config,
    db,
    logger,
    rateLimits: [],
    streamSessionCheckMs: 0,
    ...overrides,
  });
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

/** Sessão de mentira para o tratador injetado nos testes do fluxo SSE. */
export function fakeSession(userId: string, sessionId: string = userId): AuthenticatedSession {
  const now = new Date();
  return {
    id: sessionId,
    site: 'classroom',
    csrfToken: 'csrf-de-teste',
    expiresAt: new Date(now.getTime() + 86_400_000),
    lastUsedAt: now,
    renewed: false,
    user: {
      id: userId,
      name: 'Teste',
      email: 'teste@example.com',
      emailVerified: true,
      role: 'student',
      hasPassword: true,
      avatarImageId: null,
      suspendedKind: null,
    },
  };
}
