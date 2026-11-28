import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { recordAudit } from '../audit/record.ts';
import { notifyTicketStatus, TICKET_TARGET_TYPE, ticketAutocloseDays } from './rules.ts';

// Fechamento automático (spec 023, RNF-03; dono da escrita: worker, tarefa `ticket.autoclose`).

export const TICKET_AUTOCLOSE_BATCH_SIZE = 200;

export interface TicketAutocloseOptions {
  /** Encerramento limpo do worker: para entre um lote e outro. */
  signal?: AbortSignal;
  batchSize?: number;
}

export interface TicketAutocloseResult {
  closed: number;
  /** Prazo aplicado, em dias (`settings` ou 7). */
  days: number;
}

/**
 * Fecha os chamados `resolved` há mais dias que o prazo (`tickets.autoclose_days`, padrão 7)
 * sem resposta do aluno; a resposta dentro do prazo já os reabriu e limpou `resolved_at`. Cada
 * fechamento vai para a auditoria (origem `worker`) e avisa quem abriu e quem acompanha.
 * Idempotente: repetir não fecha de novo nem duplica aviso; em lotes, com `SKIP LOCKED`.
 */
export async function autocloseResolvedTickets(
  db: Database,
  options: TicketAutocloseOptions = {},
): Promise<TicketAutocloseResult> {
  const days = await ticketAutocloseDays(db);
  const batchSize = options.batchSize ?? TICKET_AUTOCLOSE_BATCH_SIZE;
  let closed = 0;
  while (!options.signal?.aborted) {
    const batch = await db.transaction().execute(async (trx) => {
      const due = await trx
        .selectFrom('tickets')
        .select(['id', 'number', 'userId'])
        .where('status', '=', 'resolved')
        .where('resolvedAt', '<=', sql<Date>`now() - make_interval(days => ${days})`)
        .orderBy('resolvedAt')
        .limit(batchSize)
        .forUpdate()
        .skipLocked()
        .execute();
      for (const ticket of due) {
        await trx
          .updateTable('tickets')
          .set({ status: 'closed', closedAt: sql<Date>`now()` })
          .where('id', '=', ticket.id)
          .execute();
        await recordAudit(trx, {
          context: { origin: 'worker' },
          action: 'ticket.set_status',
          targetType: TICKET_TARGET_TYPE,
          targetId: ticket.id,
          details: { from: 'resolved', to: 'closed', automatic: true },
        });
        await notifyTicketStatus(trx, ticket, 'closed', null);
      }
      return due.length;
    });
    closed += batch;
    if (batch < batchSize) break;
  }
  return { closed, days };
}
