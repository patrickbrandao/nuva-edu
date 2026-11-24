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
  /**
   * Envia uma linha de `email_outbox` (spec 024). Enfileirada só por `enqueueEmail`. Leva apenas
   * o id da linha: o token do link é criado pelo worker ao montar o e-mail (spec 007).
   */
  'email.send': { outboxId: string };
  /**
   * Encerra as suspensões com prazo vencido (spec 026), a cada 15 min. Recorrente, sem
   * parâmetros: o manipulador chama `expireSuspensions`.
   */
  'suspension.expire': Record<string, never>;
  /** Apaga imagens sem referência há mais de 24 horas (spec 029). Diária, sem parâmetros. */
  'image.cleanup': Record<string, never>;
}

export type JobType = keyof JobPayloads;

export interface JobDefinition {
  /** Máximo de tentativas do tipo (tabela da spec 005). */
  maxAttempts: number;
  /** Maior primeiro. Padrão 0; pagamento usa 10. */
  priority: number;
  /**
   * Espera própria das novas tentativas, em segundos, no lugar da regra geral (spec 005): o
   * item `n - 1` vale depois da `n`-ésima tentativa; passado o fim, repete o último. Sem
   * variação aleatória. Omitido: `min(2^tentativa × 30 s, 6 h)` com ±20%.
   */
  retryDelaysSeconds?: readonly number[];
}

/**
 * Espera do `email.send` (spec 024, RNF-02): 1 min, 5 min, 30 min, 2 h e 12 h. Com 5 tentativas
 * só as quatro primeiras são usadas; a de 12 h vale se o máximo for aumentado na chamada.
 */
export const EMAIL_SEND_RETRY_DELAYS_SECONDS = [60, 300, 1_800, 7_200, 43_200] as const;

export const JOB_DEFINITIONS: { readonly [T in JobType]: JobDefinition } = {
  'example.echo': { maxAttempts: 3, priority: 0 },
  'retention.purge': { maxAttempts: 5, priority: 0 },
  'email.send': {
    maxAttempts: 5,
    priority: 0,
    retryDelaysSeconds: EMAIL_SEND_RETRY_DELAYS_SECONDS,
  },
  'suspension.expire': { maxAttempts: 3, priority: 0 },
  'image.cleanup': { maxAttempts: 5, priority: 0 },
};

/**
 * Tipos já no registro cujo manipulador ainda não existe no worker (chega em outra tarefa).
 * `JobHandlers` exige o manipulador de todos os demais tipos do registro. Tipo novo cujo
 * manipulador venha depois entra aqui até ele chegar; tarefa sem manipulador falha como erro
 * comum e segue as tentativas do tipo.
 *
 * `suspension.expire` e `image.cleanup`: os manipuladores chegam com a tarefa 151 (worker), que
 * os retira desta união.
 */
export type PendingHandlerJobType = 'suspension.expire' | 'image.cleanup';

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

/** O que o worker entrega ao manipulador além da tarefa. */
export interface JobContext {
  /**
   * Abortado quando o worker começa a encerrar ou perde a trava da tarefa. Manipulador longo
   * repassa o sinal ao que aceitar (`fetch`, esperas) e para cedo; a tarefa volta à fila e
   * executa de novo, então parar no meio tem de ser seguro (idempotência, spec 005).
   */
  signal: AbortSignal;
}

/**
 * Manipuladores do worker: um por tipo do registro, cada um com o seu payload. O contexto é o
 * segundo argumento; manipulador que não precisa dele pode declarar só a tarefa.
 */
export type JobHandler<T extends JobType> = (job: JobOf<T>, context: JobContext) => Promise<void>;

export type JobHandlers = {
  [T in Exclude<JobType, PendingHandlerJobType>]: JobHandler<T>;
} & {
  [T in PendingHandlerJobType]?: JobHandler<T>;
};

/**
 * Erro que não adianta repetir (ex.: SMTP recusou o destinatário com 5xx). O manipulador lança
 * este erro e `failJob` marca a tarefa `failed` na hora, sem novas tentativas, qualquer que seja
 * o tipo. A mensagem vai para `last_error` (mascarada): não ponha dado pessoal nela.
 */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

export function isPermanentJobError(error: unknown): error is PermanentJobError {
  return error instanceof PermanentJobError;
}

export function isJobType(type: string): type is JobType {
  return Object.hasOwn(JOB_DEFINITIONS, type);
}

/** `false` para tarefa de tipo desconhecido (versão mais nova ou mais antiga do código). */
export function isKnownJob(job: Job): job is KnownJob {
  return isJobType(job.type);
}
