import type { Database } from '../../db/database.ts';
import { enqueueRecurring } from './queue.ts';
import type { JobOf } from './registry.ts';

// Tarefa recorrente `ticket.autoclose` (spec 005, "Tarefas recorrentes"; spec 023, RNF-03):
// diária às 04:00, fecha os chamados `resolved` vencidos. O manipulador do worker (tarefa 605)
// chama `autocloseResolvedTickets`; até ele chegar o tipo fica em `PendingHandlerJobType`.

/** Hora local da escola em que a recorrente roda (spec 005). */
export const TICKET_AUTOCLOSE_HOUR = 4;

/**
 * Enfileira a execução do dia. `window` identifica a janela (a data, `AAAA-MM-DD`): chamar de
 * novo na mesma janela não cria a segunda tarefa.
 */
export function enqueueTicketAutoclose(
  db: Database,
  window: string,
  runAt?: Date,
): Promise<JobOf<'ticket.autoclose'> | null> {
  return enqueueRecurring(db, 'ticket.autoclose', {}, { window, ...(runAt ? { runAt } : {}) });
}
