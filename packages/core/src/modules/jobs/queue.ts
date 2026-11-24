import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { conflict } from '../../errors/domain-error.ts';
import { redactString } from '../../logging/redact.ts';
import {
  isPermanentJobError,
  JOB_DEFINITIONS,
  type Job,
  type JobOf,
  type JobPayloads,
  type JobStatus,
  type JobType,
} from './registry.ts';

// Fila de tarefas sobre a tabela `jobs` (spec 005, migration 0002).
// Dono dos dados: worker. As APIs só chamam `enqueue` (e `retryJob`, pela tela /ops); as demais
// escritas são do worker. Todas as funções aceitam o Kysely ou uma transação aberta.

/** Espera da nova tentativa: `min(2^tentativa × 30 s, 6 h)`, com variação de ±20% (spec 005). */
export const RETRY_BASE_SECONDS = 30;
export const RETRY_MAX_SECONDS = 6 * 60 * 60;
export const RETRY_JITTER = 0.2;
/** Tarefa `running` sem batimento por este tempo é dada como presa (RNF-04). */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** Intervalo em que o worker renova `heartbeat_at`. */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;
/** Varredura de segurança do worker, para o que o NOTIFY não acordou (RNF-01). */
export const SWEEP_INTERVAL_MS = 5 * 1000;

const LAST_ERROR_MAX_LENGTH = 8_000;
const ACTIVE_UNIQUE_INDEX = 'jobs_unique_key_active_unique';

export interface EnqueueOptions {
  /** Quando pode executar. Omitido: imediata (padrão do banco, e o gatilho de NOTIFY dispara). */
  runAt?: Date;
  /** Padrão: o do tipo no registro. */
  priority?: number;
  /** Padrão: o do tipo no registro. */
  maxAttempts?: number;
  /** Com a chave, não cria segunda tarefa enquanto houver uma `queued` ou `running` igual. */
  uniqueKey?: string;
}

/**
 * Enfileira uma tarefa. Passe a transação da escrita de negócio: a tarefa só existe se a
 * mudança for gravada (RF-02), e o aviso aos workers só sai no COMMIT.
 * Devolve `null` quando a `uniqueKey` já tem tarefa ativa.
 */
export async function enqueue<T extends JobType>(
  db: Database,
  type: T,
  payload: JobPayloads[T],
  options: EnqueueOptions = {},
): Promise<JobOf<T> | null> {
  const definition = JOB_DEFINITIONS[type];
  const insert = db.insertInto('jobs').values({
    type,
    payload: JSON.stringify(payload),
    priority: options.priority ?? definition.priority,
    maxAttempts: options.maxAttempts ?? definition.maxAttempts,
    ...(options.runAt ? { runAt: options.runAt } : {}),
    ...(options.uniqueKey === undefined ? {} : { uniqueKey: options.uniqueKey }),
  });
  const row = await (options.uniqueKey === undefined
    ? insert
    : insert.onConflict((oc) =>
        // Predicado idêntico ao do índice parcial, em texto: só assim o PostgreSQL o encontra.
        oc.column('uniqueKey').where(sql<boolean>`status IN ('queued', 'running')`).doNothing(),
      )
  )
    .returningAll()
    .executeTakeFirst();
  return row ? (row as unknown as JobOf<T>) : null;
}

export interface EnqueueRecurringOptions {
  /**
   * Janela da execução, parte da chave: `2026-11-24` para a diária, `2026-11-24T10:15` para a
   * de 15 em 15 minutos. Quem agenda calcula no fuso da escola (`getSchoolTimezone`).
   */
  window: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

/** `unique_key` de uma recorrente: tipo + janela. */
export function recurringKey(type: JobType, window: string): string {
  return `${type}:${window}`;
}

/**
 * Enfileira a recorrente da janela, uma única vez: só insere se não existir tarefa com a mesma
 * chave em QUALQUER estado. O índice único só cobre `queued` e `running`, então sem o
 * `NOT EXISTS` um segundo worker reenfileiraria a janela já concluída.
 * Devolve `null` quando a janela já foi enfileirada.
 */
export async function enqueueRecurring<T extends JobType>(
  db: Database,
  type: T,
  payload: JobPayloads[T],
  options: EnqueueRecurringOptions,
): Promise<JobOf<T> | null> {
  const definition = JOB_DEFINITIONS[type];
  const key = recurringKey(type, options.window);
  // Dois chamadores simultâneos passam ambos pelo NOT EXISTS; o ON CONFLICT segura o segundo,
  // que espera o primeiro confirmar e então não insere.
  const result = await sql<Job>`
    INSERT INTO jobs (type, payload, priority, max_attempts, unique_key, run_at)
    SELECT
      ${type},
      ${JSON.stringify(payload)}::jsonb,
      ${options.priority ?? definition.priority}::smallint,
      ${options.maxAttempts ?? definition.maxAttempts}::smallint,
      ${key},
      COALESCE(${options.runAt ?? null}::timestamptz, now())
    WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE unique_key = ${key})
    ON CONFLICT (unique_key) WHERE status IN ('queued', 'running') DO NOTHING
    RETURNING *
  `.execute(db);
  return (result.rows[0] as JobOf<T> | undefined) ?? null;
}

export interface ClaimOptions {
  /** Identidade deste worker (ex.: `hostname:pid`); vai para `locked_by`. */
  workerId: string;
  /** Quantas tarefas pegar, no máximo. */
  limit: number;
}

/**
 * Pega até `limit` tarefas prontas, por prioridade e `run_at`, e as marca `running` com a trava
 * deste worker. `SKIP LOCKED`: workers concorrentes nunca recebem a mesma tarefa.
 * Cada claim conta uma tentativa.
 */
export async function claimJobs(db: Database, options: ClaimOptions): Promise<Job[]> {
  if (options.limit < 1) {
    return [];
  }
  const result = await sql<Job>`
    WITH ready AS (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_at <= now() AND attempts < max_attempts
      ORDER BY priority DESC, run_at
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs SET
      status = 'running',
      locked_by = ${options.workerId},
      locked_at = now(),
      heartbeat_at = now(),
      attempts = jobs.attempts + 1
    FROM ready
    WHERE jobs.id = ready.id
    RETURNING jobs.*
  `.execute(db);
  // O RETURNING de um UPDATE não garante ordem.
  return result.rows.sort(
    (a, b) => b.priority - a.priority || a.runAt.getTime() - b.runAt.getTime(),
  );
}

/**
 * Renova o batimento das tarefas em execução deste worker. Devolve os ids ainda travados por
 * ele: o que faltar foi tomado como preso e devolvido à fila, e o worker deve abandonar.
 */
export async function heartbeatJobs(
  db: Database,
  options: { workerId: string; jobIds: readonly string[] },
): Promise<string[]> {
  if (options.jobIds.length === 0) {
    return [];
  }
  const result = await sql<{ id: string }>`
    UPDATE jobs SET heartbeat_at = now()
    WHERE id = ANY(${[...options.jobIds]}::uuid[])
      AND status = 'running' AND locked_by = ${options.workerId}
    RETURNING id
  `.execute(db);
  return result.rows.map((row) => row.id);
}

export interface JobLock {
  jobId: string;
  workerId: string;
}

/** Conclui a tarefa. `false` se ela não está mais travada por este worker. */
export async function completeJob(db: Database, lock: JobLock): Promise<boolean> {
  const result = await sql`
    UPDATE jobs SET status = 'done', finished_at = now()
    WHERE id = ${lock.jobId} AND status = 'running' AND locked_by = ${lock.workerId}
    RETURNING id
  `.execute(db);
  return result.rows.length === 1;
}

export interface FailOptions extends JobLock {
  /** O que o manipulador lançou. Mensagem e pilha vão para `last_error`, já mascaradas. */
  error: unknown;
  /** Fonte da variação da espera, em [0, 1). Padrão: `Math.random`. */
  random?: () => number;
}

/** `{ tipo: [esperas] }` dos tipos com espera própria, para o `failJob` escolher no SQL. */
const CUSTOM_RETRY_DELAYS: string = JSON.stringify(
  Object.fromEntries(
    Object.entries(JOB_DEFINITIONS).flatMap(([type, definition]) =>
      definition.retryDelaysSeconds ? [[type, definition.retryDelaysSeconds]] : [],
    ),
  ),
);

/**
 * Registra a falha. Com tentativas sobrando, a tarefa volta à fila com `run_at` adiado pela
 * espera do tipo (a própria, se o registro define `retryDelaysSeconds`; senão a crescente
 * geral); esgotadas, ou com `PermanentJobError`, fica `failed` até alguém reenfileirar pelo /ops.
 * Devolve a tarefa atualizada, ou `null` se ela não está mais travada por este worker.
 */
export async function failJob(db: Database, options: FailOptions): Promise<Job | null> {
  const random = options.random ?? Math.random;
  const factor = 1 - RETRY_JITTER + 2 * RETRY_JITTER * random();
  const permanent = isPermanentJobError(options.error);
  const retry = sql<boolean>`(attempts < max_attempts AND NOT ${permanent}::boolean)`;
  const delays = sql`(${CUSTOM_RETRY_DELAYS}::jsonb -> type)`;
  const result = await sql<Job>`
    UPDATE jobs SET
      status = CASE WHEN ${retry} THEN 'queued' ELSE 'failed' END,
      run_at = CASE WHEN ${retry}
        THEN now() + make_interval(secs => COALESCE(
          (${delays} ->> (LEAST(attempts, jsonb_array_length(${delays})) - 1))::float8,
          LEAST(power(2, attempts) * ${sql.lit(RETRY_BASE_SECONDS)}, ${sql.lit(RETRY_MAX_SECONDS)})
            * ${factor}::float8))
        ELSE run_at END,
      finished_at = CASE WHEN ${retry} THEN NULL ELSE now() END,
      locked_by = CASE WHEN ${retry} THEN NULL ELSE locked_by END,
      locked_at = CASE WHEN ${retry} THEN NULL ELSE locked_at END,
      heartbeat_at = CASE WHEN ${retry} THEN NULL ELSE heartbeat_at END,
      last_error = ${formatJobError(options.error)}
    WHERE id = ${options.jobId} AND status = 'running' AND locked_by = ${options.workerId}
    RETURNING *
  `.execute(db);
  return result.rows[0] ?? null;
}

/**
 * Devolve à fila uma tarefa que este worker pegou e não vai terminar (encerramento do
 * contêiner). A tentativa interrompida não conta. `false` se a trava não é mais dele.
 */
export async function releaseJob(db: Database, lock: JobLock): Promise<boolean> {
  const result = await sql`
    UPDATE jobs SET
      status = 'queued',
      attempts = GREATEST(attempts - 1, 0),
      locked_by = NULL, locked_at = NULL, heartbeat_at = NULL
    WHERE id = ${lock.jobId} AND status = 'running' AND locked_by = ${lock.workerId}
    RETURNING id
  `.execute(db);
  return result.rows.length === 1;
}

/**
 * Tarefa presa: `running` sem batimento há mais de `staleAfterMs` (worker morto). Volta à fila
 * na hora, ou fica `failed` se já gastou todas as tentativas. Devolve as tarefas mexidas.
 */
export async function requeueStaleJobs(
  db: Database,
  options: { staleAfterMs?: number } = {},
): Promise<Job[]> {
  const staleSeconds = (options.staleAfterMs ?? STALE_AFTER_MS) / 1000;
  const message = `Tarefa presa: sem batimento do worker por mais de ${staleSeconds} s.`;
  const result = await sql<Job>`
    UPDATE jobs SET
      status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
      finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END,
      locked_by = CASE WHEN attempts < max_attempts THEN NULL ELSE locked_by END,
      locked_at = CASE WHEN attempts < max_attempts THEN NULL ELSE locked_at END,
      heartbeat_at = CASE WHEN attempts < max_attempts THEN NULL ELSE heartbeat_at END,
      last_error = ${message}
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => ${staleSeconds}::float8)
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `.execute(db);
  return result.rows;
}

/**
 * Reenfileira uma tarefa `failed` (tela /ops): volta a `queued` para agora, com as tentativas
 * zeradas. `last_error` fica, como registro. Devolve `null` se a tarefa não existe ou não está
 * `failed`; lança `conflict('job_already_active')` se já há tarefa ativa com a mesma `unique_key`.
 */
export async function retryJob(db: Database, jobId: string): Promise<Job | null> {
  try {
    const result = await sql<Job>`
      UPDATE jobs SET
        status = 'queued',
        run_at = now(),
        attempts = 0,
        finished_at = NULL,
        locked_by = NULL, locked_at = NULL, heartbeat_at = NULL
      WHERE id = ${jobId} AND status = 'failed'
      RETURNING *
    `.execute(db);
    return result.rows[0] ?? null;
  } catch (error) {
    if ((error as { constraint?: unknown }).constraint === ACTIVE_UNIQUE_INDEX) {
      throw conflict('job_already_active', 'Já existe uma tarefa ativa com a mesma chave.');
    }
    throw error;
  }
}

export interface JobCounts {
  /** Aguardando, incluindo as agendadas para depois. */
  queued: number;
  /** Parte de `queued` que já pode executar (`run_at` vencido): o tamanho real da fila. */
  ready: number;
  running: number;
  done: number;
  failed: number;
}

/** Contagem por estado, para `/metrics` e para a tela /ops. */
export async function getJobCounts(db: Database): Promise<JobCounts> {
  const result = await sql<{ status: JobStatus; count: number; due: number }>`
    SELECT status, count(*)::int AS count, (count(*) FILTER (WHERE run_at <= now()))::int AS due
    FROM jobs GROUP BY status
  `.execute(db);
  const counts: JobCounts = { queued: 0, ready: 0, running: 0, done: 0, failed: 0 };
  for (const row of result.rows) {
    counts[row.status] = row.count;
    if (row.status === 'queued') {
      counts.ready = row.due;
    }
  }
  return counts;
}

/**
 * Há quantos segundos a tarefa pendente mais antiga espera, para a métrica
 * `jobs_oldest_pending_seconds` (spec 033). Pendente é a `queued` que já pode executar; a espera
 * conta de `run_at`, então tarefa agendada para depois e espera de nova tentativa não entram.
 * Fila sem pendentes devolve 0.
 */
export async function getOldestPendingJobAgeSeconds(db: Database): Promise<number> {
  const result = await sql<{ seconds: number | null }>`
    SELECT EXTRACT(EPOCH FROM now() - min(run_at))::float8 AS seconds
    FROM jobs
    WHERE status = 'queued' AND run_at <= now() AND attempts < max_attempts
  `.execute(db);
  return Math.max(result.rows[0]?.seconds ?? 0, 0);
}

export type JobTypeCounts = { type: string } & Record<JobStatus, number>;

/** Contagem por tipo e estado, em ordem de tipo (rótulos de `/metrics`, detalhe do /ops). */
export async function getJobCountsByType(db: Database): Promise<JobTypeCounts[]> {
  const result = await sql<{ type: string; status: JobStatus; count: number }>`
    SELECT type, status, count(*)::int AS count FROM jobs GROUP BY type, status ORDER BY type
  `.execute(db);
  const byType = new Map<string, JobTypeCounts>();
  for (const row of result.rows) {
    let entry = byType.get(row.type);
    if (!entry) {
      entry = { type: row.type, queued: 0, running: 0, done: 0, failed: 0 };
      byType.set(row.type, entry);
    }
    entry[row.status] = row.count;
  }
  return [...byType.values()];
}

/**
 * Texto de `last_error`: mensagem e pilha, passadas pela máscara do logger (spec 005: sem dados
 * pessoais nem senhas) e cortadas num tamanho que não incha a tabela.
 */
export function formatJobError(error: unknown): string {
  const text =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  const redacted = redactString(text);
  return redacted.length > LAST_ERROR_MAX_LENGTH
    ? `${redacted.slice(0, LAST_ERROR_MAX_LENGTH)}…`
    : redacted;
}
