import { createLogger, type Logger } from '@nuva-edu/core';
import { type ApiAppOptions, type Contract, createApiApp, loadContract } from '../src/index.ts';

export const FIXTURE = new URL('./fixtures/openapi.yaml', import.meta.url);

export function fixtureContract(): Contract {
  return loadContract(FIXTURE);
}

export interface CapturedLogs {
  logger: Logger;
  lines: Record<string, unknown>[];
  /** Tudo o que foi escrito, como texto: para procurar o que não pode aparecer. */
  text(): string;
}

/** Logger do core escrevendo na memória. */
export function captureLogs(level: 'debug' | 'info' = 'debug'): CapturedLogs {
  const raw: string[] = [];
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: 'api-kit-test',
    level,
    write: (line) => {
      raw.push(line);
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, lines, text: () => raw.join('') };
}

export const READY = {
  database: () => true,
  migrations: () => true,
} as const;

/** App sobre o contrato de teste, com o que cada teste quiser trocar. */
export function buildApp(overrides: Partial<ApiAppOptions> = {}) {
  const logs = captureLogs();
  const app = createApiApp({
    contract: fixtureContract(),
    logger: logs.logger,
    trustedProxies: ['127.0.0.0/8', '10.0.0.0/8'],
    readiness: READY,
    ...overrides,
  });
  return { app, logs };
}
