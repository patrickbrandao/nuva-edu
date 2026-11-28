import type { JsonObject } from '../../db/generated/database.ts';
import type { NotifyJobPayload } from './notifications.ts';

/**
 * Registro dos tipos de tarefa: nome → formato do payload. O worker e as APIs compartilham este
 * mapa, então enfileirar com payload errado não compila.
 *
 * Payload leva apenas identificadores; nunca senha, token ou CPF (spec 005).
 * Os nomes são os do catálogo da spec 005 e entram junto com a fase que os implementa; tipo cujo
 * manipulador venha numa tarefa seguinte passa por `PendingHandlerJobType` até ele chegar.
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
   * Cria a notificação da central e os e-mails de um destinatário (specs 005 e 024). Enfileirada
   * só pela função `notify` do núcleo, uma por destinatário; o payload tipado está em
   * `notifications.ts`. O manipulador chega com o worker da Fase 4 (tarefa 586).
   */
  notify: NotifyJobPayload;
  /**
   * Encerra as suspensões com prazo vencido (spec 026), a cada 15 min. Recorrente, sem
   * parâmetros: o manipulador chama `expireSuspensions`.
   */
  'suspension.expire': Record<string, never>;
  /** Apaga imagens sem referência há mais de 24 horas (spec 029). Diária, sem parâmetros. */
  'image.cleanup': Record<string, never>;
  /**
   * Recalcula a cascata dos direitos de um produto pai cuja composição mudou (`bundle_items`,
   * `product_ebooks` ou os itens de um plano; spec 010, "Recalcular a cascata"). Enfileirada pela
   * `admin-api`. Ebook vinculado a uma aula recalcula o curso da aula. `plan` recalcula as
   * assinaturas do plano (spec 012).
   */
  'entitlement.recompute': { productType: EntitlementRecomputeProductType; productId: string };
  /**
   * O curso passou a 100% para o aluno (spec 014). Emite o certificado, se o curso tem template
   * efetivo (spec 015). `unique_key` = `course.completed:<userId>:<courseId>`.
   */
  'course.completed': { userId: string; courseId: string };
  /** Aula despublicada ou excluída: enfileira `course.completed` de quem chegou a 100% (014). */
  'course.completion_check': { courseId: string };
  /** Gera o PDF de um certificado já criado, com a versão do template guardada nele (015). */
  'certificate.render': { certificateId: string };
  /** O curso passou a ter template efetivo: emite os certificados pendentes (015). */
  'certificate.backfill': { courseId: string };
  /** Renderiza o PDF de exemplo de uma linha de `certificate_previews` (015). */
  'certificate.preview': { previewId: string };
  /**
   * Processa um `webhook_events` já gravado: consulta o pagamento no provedor e aplica a
   * transição do pedido ou da assinatura (013). Leva só o id da linha.
   */
  'payment.webhook': { webhookEventId: string };
  /** Marca o pedido pago e cria os direitos em cascata (010, 011, 013). */
  'order.fulfill': { orderId: string };
  /** Estorna no provedor e revoga os direitos em cascata (011, 013). */
  'refund.execute': { refundId: string };
  /** Reconciliação dos pedidos `pending` a cada 5 min (013). Recorrente. */
  'payment.reconcile_orders': Record<string, never>;
  /** Reconciliação das assinaturas a cada 6 h (012, 013). Recorrente. */
  'payment.reconcile_subscriptions': Record<string, never>;
  /** Reconciliação dos reembolsos pedidos a cada 30 min (013). Recorrente. */
  'payment.reconcile_refunds': Record<string, never>;
  /**
   * Fecha os chamados `resolved` vencidos (spec 023, RNF-03). Diária às 04:00, sem parâmetros:
   * o manipulador chama `autocloseResolvedTickets`.
   */
  'ticket.autoclose': Record<string, never>;
  /**
   * Lembrete de um evento, 30 minutos antes do início (spec 018, RF-07). Enfileirada por
   * `enqueueEventReminder`; `startsAt` (ISO 8601) é o horário para o qual foi marcada, e o
   * manipulador (`sendEventReminder`) descarta a de um horário que deixou de valer.
   */
  'event.reminder': { eventId: string; startsAt: string };
  /**
   * Publica uma novidade agendada no horário marcado (spec 025). Enfileirada por
   * `enqueueAnnouncementPublish`; `publishAt` (ISO 8601) é o horário do agendamento, e o
   * manipulador (`publishScheduledAnnouncement`) ignora a de um agendamento que mudou.
   */
  'announcement.publish': { announcementId: string; publishAt: string };
}

/**
 * Produto pai do recálculo de direitos: curso e pacote têm itens derivados; o plano recalcula as
 * assinaturas quando a composição muda (`plan_items`, `includes_all`, `includes_private`).
 */
export const ENTITLEMENT_RECOMPUTE_PRODUCT_TYPES = ['course', 'bundle', 'plan'] as const;
export type EntitlementRecomputeProductType = (typeof ENTITLEMENT_RECOMPUTE_PRODUCT_TYPES)[number];

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
  notify: { maxAttempts: 5, priority: 0 },
  'suspension.expire': { maxAttempts: 3, priority: 0 },
  'image.cleanup': { maxAttempts: 5, priority: 0 },
  'entitlement.recompute': { maxAttempts: 5, priority: 0 },
  'course.completed': { maxAttempts: 5, priority: 0 },
  'course.completion_check': { maxAttempts: 5, priority: 0 },
  'certificate.render': { maxAttempts: 5, priority: 0 },
  'certificate.backfill': { maxAttempts: 3, priority: 0 },
  'certificate.preview': { maxAttempts: 1, priority: 0 },
  'payment.webhook': { maxAttempts: 8, priority: 10 },
  'order.fulfill': { maxAttempts: 10, priority: 10 },
  'refund.execute': { maxAttempts: 10, priority: 10 },
  'payment.reconcile_orders': { maxAttempts: 3, priority: 10 },
  'payment.reconcile_subscriptions': { maxAttempts: 3, priority: 10 },
  'payment.reconcile_refunds': { maxAttempts: 3, priority: 10 },
  'ticket.autoclose': { maxAttempts: 5, priority: 0 },
  'event.reminder': { maxAttempts: 3, priority: 0 },
  'announcement.publish': { maxAttempts: 3, priority: 0 },
};

/**
 * Tipos já no registro cujo manipulador ainda não existe no worker (chega em outra tarefa).
 * `JobHandlers` exige o manipulador dos demais; estes são opcionais. Tipo novo cujo manipulador
 * venha depois entra aqui até ele chegar; tarefa sem manipulador falha como erro comum e segue
 * as tentativas do tipo. A central de notificações (`notify`) aguarda a tarefa 586 e
 * `ticket.autoclose`, a 605, `event.reminder`, a 612, e `announcement.publish`, a 619; a tarefa
 * 622 os retira daqui.
 */
export type PendingHandlerJobType =
  | 'notify'
  | 'ticket.autoclose'
  | 'event.reminder'
  | 'announcement.publish';

/** Os mesmos tipos de `PendingHandlerJobType`, para conferência em tempo de execução. */
export const PENDING_HANDLER_JOB_TYPES = [
  'notify',
  'ticket.autoclose',
  'event.reminder',
  'announcement.publish',
] as const satisfies readonly PendingHandlerJobType[];

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
