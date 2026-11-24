import type { Database, JobHandlers, Logger } from '@nuva-edu/core';
import { createEmailSendHandler } from './email/send-email.ts';
import type { Mailer } from './email/smtp.ts';

export interface HandlerDependencies {
  db: Database;
  logger: Logger;
  mailer: Mailer;
  /** `config.classroomUrl`, `config.adminUrl` e `config.locale`, para os links e os textos. */
  classroomUrl: string;
  adminUrl: string;
  locale: string;
}

/**
 * Manipuladores por tipo de tarefa (catálogo da spec 005). Todos idempotentes: a mesma tarefa
 * pode executar mais de uma vez (nova tentativa, worker morto, encerramento no meio).
 */
export function createHandlers(deps: HandlerDependencies): JobHandlers {
  const { logger } = deps;
  return {
    // Exemplo da Fase 0: sem efeito além do log, então repetir não muda nada.
    'example.echo': async (job) => {
      logger.info({ job_id: job.id, message: job.payload.message }, 'Tarefa de exemplo executada');
    },
    // Expurgo diário (spec 033). Ainda sem regras: as tabelas com retenção entram nas fases
    // seguintes. Quando entrarem, apagar por prazo é idempotente por natureza.
    'retention.purge': async (job) => {
      logger.info(
        { job_id: job.id, unique_key: job.uniqueKey },
        'Expurgo diário executado (nenhuma regra de retenção nesta fase)',
      );
    },
    // E-mail da fila (spec 024): linha que já não está `queued` não é enviada de novo.
    'email.send': createEmailSendHandler(deps),
  };
}
