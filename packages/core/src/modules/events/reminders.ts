import type { Database } from '../../db/database.ts';
import { notify } from '../notifications/central/notify.ts';
import { EVENT_TARGET_TYPE, eventAudienceMembers, serverNow } from './rules.ts';

// Lembrete do evento (spec 018, RF-07; execução do worker, tarefa `event.reminder`).

export type EventReminderSkip =
  | 'event_not_found'
  | 'event_canceled'
  | 'rescheduled'
  | 'already_started';

export interface EventReminderResult {
  /** Destinatários avisados; zero quando o lembrete foi descartado. */
  notified: number;
  skipped: EventReminderSkip | null;
}

/**
 * Manipulador de `event.reminder`: avisa quem pertence ao público **agora** (quem perdeu o
 * acesso não recebe). Descarta, sem erro, o lembrete de evento apagado ou cancelado, de
 * horário que mudou (o novo horário tem a própria tarefa) e o que chegou depois do início.
 * A fila garante uma tarefa por evento e horário; a transação torna a repetição segura.
 */
export async function sendEventReminder(
  db: Database,
  payload: { eventId: string; startsAt: string },
): Promise<EventReminderResult> {
  return db.transaction().execute(async (trx) => {
    const event = await trx
      .selectFrom('events')
      .select(['id', 'title', 'startsAt', 'canceledAt'])
      .where('id', '=', payload.eventId)
      .forShare()
      .executeTakeFirst();
    const skip = (skipped: EventReminderSkip): EventReminderResult => ({ notified: 0, skipped });
    if (!event) return skip('event_not_found');
    if (event.canceledAt !== null) return skip('event_canceled');
    if (event.startsAt.getTime() !== new Date(payload.startsAt).getTime()) {
      return skip('rescheduled');
    }
    if ((await serverNow(trx)).getTime() >= event.startsAt.getTime()) {
      return skip('already_started');
    }
    const result = await notify(trx, 'event.reminder', await eventAudienceMembers(trx, event.id), {
      targetType: EVENT_TARGET_TYPE,
      targetId: event.id,
      data: { eventId: event.id, title: event.title, startsAt: event.startsAt.toISOString() },
    });
    return { notified: result.queued.length, skipped: null };
  });
}
