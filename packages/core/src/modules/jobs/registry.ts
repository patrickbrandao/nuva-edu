import type { JsonObject } from '../../db/generated/database.ts';

/**
 * Registro dos tipos de tarefa: nome → formato do payload. O worker e as APIs compartilham este
 * mapa, então enfileirar com payload errado não compila.
 *
 * Payload leva apenas identificadores; nunca senha, token ou CPF (spec 005).
 * Fase 0: só o job de exemplo e o expurgo diário (ainda vazio). Os demais nomes do catálogo da
 * spec 005 entram junto com a fase que os implementa.
 */
export interface JobPayloads {
  /** Job de exemplo da Fase 0: o manipulador só registra a mensagem. Não é do catálogo da spec. */
  'example.echo': { message: string };
  /** Expurgo diário de dados vencidos (spec 033). Recorrente, sem parâmetros. */
  'retention.purge': Record<string, never>;
}

export type JobType = keyof JobPayloads;

export interface JobDefinition {
  /** Máximo de tentativas do tipo (tabela da spec 005). */
  maxAttempts: number;
  /** Maior primeiro. Padrão 0; pagamento usa 10. */
  priority: number;
}

export const JOB_DEFINITIONS: { readonly [T in JobType]: JobDefinition } = {
  'example.echo': { maxAttempts: 3, priority: 0 },
  'retention.purge': { maxAttempts: 5, priority: 0 },
};

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Uma linha de `jobs`. `type` é texto: o banco pode ter tarefa de um tipo que esta versão não conhece. */
export interface Job {
  id: string;
  type: string;
  payload: JsonObject;
  status: JobStatus;
  priority: number;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  uniqueKey: string | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  heartbeatAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** Tarefa de um tipo do registro, com o payload tipado. */
export type JobOf<T extends JobType> = Job & { type: T; payload: JobPayloads[T] };

/** União discriminada por `type`: um `switch (job.type)` estreita o payload. */
export type KnownJob = { [T in JobType]: JobOf<T> }[JobType];

/** Manipuladores do worker: um por tipo do registro, cada um com o seu payload. */
export type JobHandlers = { [T in JobType]: (job: JobOf<T>) => Promise<void> };

export function isJobType(type: string): type is JobType {
  return Object.hasOwn(JOB_DEFINITIONS, type);
}

/** `false` para tarefa de tipo desconhecido (versão mais nova ou mais antiga do código). */
export function isKnownJob(job: Job): job is KnownJob {
  return isJobType(job.type);
}
