import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type Config,
  conflict,
  type Database,
  getJobCountsByType,
  managementAuditContext,
  notFound,
  recordAudit,
  retryJob,
  validationFailed,
} from '@nuva-edu/core';
import { connect, currentVersion, parseDatabaseUrl } from '@nuva-edu/database';
import { managementRequest } from '../session.ts';

// Fila na tela "Operação" (specs 005 e 033): resumo do selo e das contagens, lista de tarefas
// pendentes/em execução/com falha, reenfileirar e descartar. Só o `admin` (`ops.manage`,
// conferida pelo tratador de `sessionCookie`; o gerente recebe `403` auditado). O núcleo cuida
// do ciclo da fila; aqui ficam a consulta da tela, as duas ações de `/ops` e a auditoria.

export interface OpsJobRoutesOptions {
  db: Database;
  config: Config;
  /** Versão instalada, a mesma do `/meta`. */
  version: string;
}

/** Estados que a tela mostra; `done` fica de fora. */
type OpsJobStatus = 'queued' | 'running' | 'failed';

const OPS_JOB_STATUSES: readonly OpsJobStatus[] = ['queued', 'running', 'failed'];

const PAGE_DEFAULT_LIMIT = 25;
const PAGE_MAX_LIMIT = 100;
const CURSOR_PREFIX = 'ops-jobs:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Campos de `jobs` que a tela usa; `payload` e dados de trava não saem. */
interface OpsJobRow {
  id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  createdAt: Date;
  finishedAt: Date | null;
  lastError: string | null;
}

/** `OpsJob` do contrato: `payload` e dados de trava não saem. */
function jobBody(job: OpsJobRow) {
  return {
    id: job.id,
    type: job.type,
    status: job.status as OpsJobStatus,
    priority: job.priority,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt === null ? null : job.finishedAt.toISOString(),
    lastError: job.lastError,
  };
}

/** Cursor opaco com o id do último item: a data é lida do banco, sem perder microssegundos. */
function encodeCursor(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string | null {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!text.startsWith(CURSOR_PREFIX)) {
    return null;
  }
  const id = text.slice(CURSOR_PREFIX.length);
  return UUID_PATTERN.test(id) ? id.toLowerCase() : null;
}

function pageLimit(limit: number | undefined): number {
  return limit ?? PAGE_DEFAULT_LIMIT;
}

export function registerOpsJobRoutes(app: FastifyInstance, options: OpsJobRoutesOptions): void {
  const { db, config, version } = options;

  app.operation('getOpsSummary', async () => {
    const [countsByType, oldestByType, emailCounts, webhookFailed, imageBytes, system] =
      await Promise.all([
        getJobCountsByType(db),
        oldestQueuedByType(db),
        db
          .selectFrom('emailOutbox')
          .select('status')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('status', 'in', ['queued', 'failed'])
          .groupBy('status')
          .execute(),
        db
          .selectFrom('webhookEvents')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('status', '=', 'failed')
          .executeTakeFirst(),
        db
          .selectFrom('imageVariants')
          .select((eb) => eb.fn.sum<number>('bytes').as('bytes'))
          .executeTakeFirst(),
        readSystemSummary(config, version),
      ]);

    const jobs = countsByType
      .filter((row) => row.queued > 0 || row.running > 0 || row.failed > 0)
      .map((row) => ({
        type: row.type,
        queued: row.queued,
        running: row.running,
        failed: row.failed,
        oldestPendingSeconds: oldestByType.get(row.type) ?? null,
      }));
    const emails = { queued: 0, failed: 0 };
    for (const row of emailCounts) {
      if (row.status === 'queued') emails.queued = Number(row.count);
      if (row.status === 'failed') emails.failed = Number(row.count);
    }
    const webhooks = { failed: Number(webhookFailed?.count ?? 0) };
    const failedJobs = countsByType.reduce((total, row) => total + row.failed, 0);
    return {
      jobs,
      emails,
      webhooks,
      system: {
        ...system,
        imageBytes: Number(imageBytes?.bytes ?? 0),
      },
      failures: failedJobs + emails.failed + webhooks.failed,
    };
  });

  app.operation('listOpsJobs', async (request) => {
    const query = request.query as {
      status?: OpsJobStatus;
      type?: string;
      limit?: number;
      cursor?: string;
    };
    const limit = pageLimit(query.limit);
    if (limit < 1 || limit > PAGE_MAX_LIMIT) {
      throw validationFailed([{ path: 'query.limit', message: `Use de 1 a ${PAGE_MAX_LIMIT}.` }]);
    }
    const afterId = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && afterId === null) {
      throw validationFailed([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
    }
    const statuses = query.status === undefined ? OPS_JOB_STATUSES : [query.status];
    let list = db
      .selectFrom('jobs')
      .select([
        'id',
        'type',
        'status',
        'priority',
        'attempts',
        'maxAttempts',
        'runAt',
        'createdAt',
        'finishedAt',
        'lastError',
      ])
      .where('status', 'in', statuses)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (query.type !== undefined) {
      list = list.where('type', '=', query.type);
    }
    if (afterId !== null) {
      list = list.where((eb) => {
        const cursorAt = eb
          .selectFrom('jobs as c')
          .select('c.createdAt')
          .where('c.id', '=', afterId);
        return eb.or([
          eb('jobs.createdAt', '>', cursorAt),
          eb.and([eb('jobs.createdAt', '=', cursorAt), eb('jobs.id', '>', afterId)]),
        ]);
      });
    }
    const rows = await list.execute();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(jobBody),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  });

  app.operation('retryOpsJob', async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = managementAuditContext(managementRequest(request));
    const job = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('jobs')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw notFound('Tarefa não encontrada.');
      }
      if (row.status !== 'failed') {
        throw conflict('job_not_failed', 'Só uma tarefa com falha pode ser reenfileirada.');
      }
      const retried = await retryJob(trx, id);
      if (retried === null) {
        throw conflict('job_not_failed', 'Só uma tarefa com falha pode ser reenfileirada.');
      }
      await recordAudit(trx, {
        context,
        action: 'job.retry',
        targetType: 'job',
        targetId: id,
        details: { type: row.type },
      });
      return retried;
    });
    return reply.status(202).send(jobBody(job));
  });

  app.operation('discardOpsJob', async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = managementAuditContext(managementRequest(request));
    await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('jobs')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw notFound('Tarefa não encontrada.');
      }
      if (row.status !== 'failed') {
        throw conflict('job_not_failed', 'Só uma tarefa com falha pode ser descartada.');
      }
      await trx.deleteFrom('jobs').where('id', '=', id).where('status', '=', 'failed').execute();
      await recordAudit(trx, {
        context,
        action: 'job.discard',
        targetType: 'job',
        targetId: id,
        details: { type: row.type },
      });
    });
    return reply.status(204).send();
  });
}

/** Quando a tarefa pendente mais antiga de cada tipo começou a esperar (segundos). */
async function oldestQueuedByType(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('jobs')
    .select('type')
    .select((eb) => eb.fn.min('runAt').as('oldestRunAt'))
    .where('status', '=', 'queued')
    .where('runAt', '<=', new Date())
    .whereRef('attempts', '<', 'maxAttempts')
    .groupBy('type')
    .execute();
  const now = Date.now();
  return new Map(
    rows
      .filter((row): row is typeof row & { oldestRunAt: Date } => row.oldestRunAt !== null)
      .map((row) => [row.type, Math.max(Math.floor((now - row.oldestRunAt.getTime()) / 1000), 0)]),
  );
}

interface SystemSummary {
  version: string;
  migrationVersion: string;
  databaseBytes: number;
  lastBackup: { finishedAt: string; sizeBytes: number; status: 'ok' | 'failed' } | null;
  lastPurgeAt: string | null;
}

/**
 * Bloco "Sistema" (spec 033). A versão aplicada das migrations e o tamanho do banco não estão
 * no esquema tipado do núcleo: vão numa conexão curta, como o `/readyz` faz. `backup_runs` e
 * `retention_runs` são escritas pelo contêiner `backup` e pelo worker; enquanto a migration
 * delas não chega, a consulta responde `null` ("ainda não houve"), como o contrato descreve.
 */
async function readSystemSummary(config: Config, version: string): Promise<SystemSummary> {
  const client = await connect(parseDatabaseUrl(config.databaseUrl));
  try {
    const migration = await currentVersion(client);
    const size = await client.query<{ database_bytes: number }>(
      'SELECT pg_database_size(current_database())::float8 AS database_bytes',
    );
    return {
      version,
      migrationVersion: String(migration).padStart(4, '0'),
      databaseBytes: Math.max(Number(size.rows[0]?.database_bytes ?? 0), 0),
      lastBackup: await readLastBackup(client),
      lastPurgeAt: await readLastPurgeAt(client),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function readLastBackup(
  client: Awaited<ReturnType<typeof connect>>,
): Promise<SystemSummary['lastBackup']> {
  try {
    const result = await client.query<{
      finished_at: Date | null;
      bytes: number | null;
      outcome: string | null;
    }>(
      `SELECT finished_at, bytes, outcome FROM backup_runs
       WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
    );
    const row = result.rows[0];
    if (row?.finished_at === null || row?.finished_at === undefined) {
      return null;
    }
    return {
      finishedAt: row.finished_at.toISOString(),
      sizeBytes: Math.max(Number(row.bytes ?? 0), 0),
      status: row.outcome === 'ok' ? 'ok' : 'failed',
    };
  } catch (error) {
    if (isMissingTable(error)) {
      return null;
    }
    throw error;
  }
}

async function readLastPurgeAt(
  client: Awaited<ReturnType<typeof connect>>,
): Promise<string | null> {
  try {
    const result = await client.query<{ ran_at: Date | null }>(
      'SELECT max(ran_at) AS ran_at FROM retention_runs',
    );
    const ranAt = result.rows[0]?.ran_at ?? null;
    return ranAt === null ? null : ranAt.toISOString();
  } catch (error) {
    if (isMissingTable(error)) {
      return null;
    }
    throw error;
  }
}

/** `undefined_table` do PostgreSQL: a tabela da tarefa ainda não entrou nas migrations. */
function isMissingTable(error: unknown): boolean {
  return (error as { code?: unknown }).code === '42P01';
}
