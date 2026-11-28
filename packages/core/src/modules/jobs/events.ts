import type { Database } from '../../db/database.ts';
import { enqueueRecurring, recurringKey } from './queue.ts';
import type { JobOf } from './registry.ts';

// Tarefa `event.reminder` (spec 005, "Tarefas sob demanda"; spec 018, RF-07): agendada para 30
// minutos antes do início ao criar o evento e refeita quando o horário muda. O manipulador do
// worker (tarefa 612) chama `sendEventReminder`; até ele chegar o tipo fica em
// `PendingHandlerJobType`.

/** Antecedência do lembrete (spec 018). */
export const EVENT_REMINDER_LEAD_MS = 30 * 60 * 1000;

/** Janela da chave: o evento e o início para o qual o lembrete foi marcado. */
export function eventReminderWindow(eventId: string, startsAt: Date): string {
  return `${eventId}:${startsAt.toISOString()}`;
}

export function eventReminderKey(eventId: string, startsAt: Date): string {
  return recurringKey('event.reminder', eventReminderWindow(eventId, startsAt));
}

/**
 * Agenda o lembrete do evento para 30 minutos antes de `startsAt` (ou agora, se já faltar
 * menos). Uma tarefa por evento e horário, em qualquer estado: reagendar para um horário cujo
 * lembrete já saiu não avisa de novo. O payload leva o horário para o manipulador descartar o
 * lembrete de um horário que deixou de valer.
 */
export function enqueueEventReminder(
  db: Database,
  eventId: string,
  startsAt: Date,
): Promise<JobOf<'event.reminder'> | null> {
  return enqueueRecurring(
    db,
    'event.reminder',
    { eventId, startsAt: startsAt.toISOString() },
    {
      window: eventReminderWindow(eventId, startsAt),
      runAt: new Date(startsAt.getTime() - EVENT_REMINDER_LEAD_MS),
    },
  );
}

/**
 * Retira da fila os lembretes ainda não executados do evento (horário alterado, cancelamento
 * ou exclusão). `exceptStartsAt` preserva o do horário vigente. Devolve quantos saíram.
 */
export async function removeQueuedEventReminders(
  db: Database,
  eventId: string,
  exceptStartsAt?: Date,
): Promise<number> {
  let query = db
    .deleteFrom('jobs')
    .where('type', '=', 'event.reminder')
    .where('status', '=', 'queued')
    .where('uniqueKey', 'like', `${recurringKey('event.reminder', eventId)}:%`);
  if (exceptStartsAt) {
    query = query.where('uniqueKey', '!=', eventReminderKey(eventId, exceptStartsAt));
  }
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows);
}
