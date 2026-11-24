import { type Database, type Logger, pingDatabase } from '@nuva-edu/core';
import {
  connect,
  currentVersion,
  defaultMigrationsDir,
  latestVersion,
  parseDatabaseUrl,
} from '@nuva-edu/database';

export interface CheckResult {
  ok: boolean;
  /** Por que falhou, para o log. Não vai na resposta. */
  reason?: string;
}

/** Uma verificação do `/readyz`. Pode lançar ou demorar: quem a roda trata as duas coisas. */
export type ReadinessCheck = () => Promise<CheckResult | boolean> | CheckResult | boolean;

/** Verificações pelo nome que aparece em `checks` (nas APIs: `database` e `migrations`). */
export type ReadinessChecks = Readonly<Record<string, ReadinessCheck>>;

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: Record<string, 'ok' | 'fail'>;
  /** Motivo de cada verificação que falhou. */
  reasons: Record<string, string>;
}

/** O `/readyz` deve responder em menos de 500 ms (spec 033, RNF-03). */
export const DEFAULT_CHECK_TIMEOUT_MS = 400;

/** Roda as verificações em paralelo; a que lança ou passa do prazo conta como falha. */
export async function runReadinessChecks(
  checks: ReadinessChecks,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const report: ReadinessReport = { status: 'ready', checks: {}, reasons: {} };
  await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      const result = await runOne(check, timeoutMs);
      report.checks[name] = result.ok ? 'ok' : 'fail';
      if (!result.ok) {
        report.status = 'not_ready';
        report.reasons[name] = result.reason ?? 'falhou';
      }
    }),
  );
  return report;
}

async function runOne(check: ReadinessCheck, timeoutMs: number): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, reason: `sem resposta em ${timeoutMs} ms` }),
      timeoutMs,
    );
  });
  // A verificação continua depois do prazo: o resultado tardio é descartado sem derrubar nada.
  const running = Promise.resolve()
    .then(check)
    .then((result) => (typeof result === 'boolean' ? { ok: result } : result))
    .catch((error: unknown) => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
  try {
    return await Promise.race([running, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface DatabaseReadinessOptions {
  /** Conexão do serviço (`createDatabase` do core). */
  db: Database;
  /** `config.databaseUrl`: a versão das migrations é lida numa conexão própria e curta. */
  connectionString: string;
  /** Pasta das migrations que este código espera. Padrão: a de `@nuva-edu/database`. */
  migrationsDir?: string;
}

/**
 * As duas verificações que o `/readyz` das APIs exige (spec 033): `database` (o banco
 * responde) e `migrations` (o banco está na versão de migration que este código espera).
 */
export function databaseReadiness(options: DatabaseReadinessOptions): ReadinessChecks {
  const directory = options.migrationsDir ?? defaultMigrationsDir;
  // A pasta não muda com o processo no ar: lê uma vez.
  let expected: Promise<number> | undefined;
  return {
    database: async () =>
      (await pingDatabase(options.db)) ? { ok: true } : { ok: false, reason: 'banco inacessível' },
    migrations: async () => {
      expected ??= latestVersion(directory);
      let wanted: number;
      try {
        wanted = await expected;
      } catch (error) {
        expected = undefined;
        throw error;
      }
      let client: Awaited<ReturnType<typeof connect>>;
      try {
        client = await connect(parseDatabaseUrl(options.connectionString));
      } catch {
        return { ok: false, reason: 'banco inacessível' };
      }
      try {
        const current = await currentVersion(client);
        return current === wanted
          ? { ok: true }
          : {
              ok: false,
              reason: `banco na migration ${current}, o serviço espera a ${wanted}`,
            };
      } finally {
        await client.end().catch(() => {});
      }
    },
  };
}

/** Registra o motivo quando o serviço deixa de estar pronto e quando volta (spec 033). */
export function createReadinessLogger(logger: Logger): (report: ReadinessReport) => void {
  let last: string | undefined;
  return (report) => {
    const signature = JSON.stringify([report.status, report.reasons]);
    if (signature === last) {
      return;
    }
    const first = last === undefined;
    last = signature;
    if (report.status === 'not_ready') {
      logger.warn({ checks: report.checks, reasons: report.reasons }, 'Serviço não está pronto');
    } else if (!first) {
      logger.info({ checks: report.checks }, 'Serviço voltou a estar pronto');
    }
  };
}
