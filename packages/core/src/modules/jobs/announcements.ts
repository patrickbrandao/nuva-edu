import type { Database } from '../../db/database.ts';
import { enqueueRecurring, recurringKey } from './queue.ts';
import type { JobOf } from './registry.ts';

// Tarefa `announcement.publish` (spec 005, "Tarefas sob demanda"; spec 025, "Estados"):
// publica a novidade agendada no horário marcado. O manipulador do worker (tarefa 619) chama
// `publishScheduledAnnouncement`; até ele chegar o tipo fica em `PendingHandlerJobType`.

function window(announcementId: string, publishAt: Date): string {
  return `${announcementId}:${publishAt.toISOString()}`;
}

export function announcementPublishKey(announcementId: string, publishAt: Date): string {
  return recurringKey('announcement.publish', window(announcementId, publishAt));
}

/**
 * Agenda a publicação para `publishAt`. Uma tarefa por novidade e horário; o payload leva o
 * horário para o manipulador ignorar a de um agendamento que mudou.
 */
export function enqueueAnnouncementPublish(
  db: Database,
  announcementId: string,
  publishAt: Date,
): Promise<JobOf<'announcement.publish'> | null> {
  return enqueueRecurring(
    db,
    'announcement.publish',
    { announcementId, publishAt: publishAt.toISOString() },
    { window: window(announcementId, publishAt), runAt: publishAt },
  );
}

/** Tira da fila as publicações ainda não executadas da novidade. Devolve quantas saíram. */
export async function removeQueuedAnnouncementPublish(
  db: Database,
  announcementId: string,
): Promise<number> {
  const result = await db
    .deleteFrom('jobs')
    .where('type', '=', 'announcement.publish')
    .where('status', '=', 'queued')
    .where('uniqueKey', 'like', `${recurringKey('announcement.publish', announcementId)}:%`)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
