import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type AuditContext, recordAudit } from '../audit/record.ts';
import { listAudienceMembers } from '../entitlements/audience.ts';
import { notify } from '../notifications/central/notify.ts';
import { publishAnnouncementPublished } from '../stream/announcements.ts';
import {
  ANNOUNCEMENT_AUDIENCE_TABLE,
  ANNOUNCEMENT_TARGET_TYPE,
  type AnnouncementRow,
} from './rules.ts';

// Publicação de uma novidade (spec 025): a mesma etapa serve à publicação imediata pela
// equipe (admin-api) e à agendada (worker, tarefa `announcement.publish`).

/**
 * Avisa quem vê a novidade: o SSE do contador vai sempre, a quem está com o classroom aberto;
 * a notificação `announcement.published` só quando quem publica escolheu avisar (RF-05), e só
 * ao público.
 */
export async function announcePublication(
  trx: Database,
  announcement: { id: string; title: string },
  options: { notify: boolean; actorId: string | null },
): Promise<void> {
  if (options.notify) {
    const members = await listAudienceMembers(trx, ANNOUNCEMENT_AUDIENCE_TABLE, {
      table: 'announcements',
      id: announcement.id,
    });
    await notify(trx, 'announcement.published', members, {
      actorId: options.actorId,
      targetType: ANNOUNCEMENT_TARGET_TYPE,
      targetId: announcement.id,
      data: { announcementId: announcement.id, title: announcement.title },
    });
  }
  await publishAnnouncementPublished(trx, announcement.id);
}

/** Passa a novidade (travada pela transação) a `published` agora, audita e avisa. */
export async function publishAnnouncementNow(
  trx: Database,
  announcement: Pick<AnnouncementRow, 'id' | 'title' | 'status' | 'notify'>,
  context: AuditContext,
): Promise<void> {
  await trx
    .updateTable('announcements')
    .set({ status: 'published', publishedAt: sql<Date>`now()` })
    .where('id', '=', announcement.id)
    .execute();
  await recordAudit(trx, {
    context,
    action: 'announcement.publish',
    targetType: ANNOUNCEMENT_TARGET_TYPE,
    targetId: announcement.id,
    details: { from: announcement.status, notify: announcement.notify },
  });
  await announcePublication(trx, announcement, {
    notify: announcement.notify,
    actorId: context.actorUserId ?? null,
  });
}

export type ScheduledPublishSkip = 'not_found' | 'not_scheduled' | 'rescheduled' | 'not_due';

export interface ScheduledPublishResult {
  published: boolean;
  skipped: ScheduledPublishSkip | null;
}

/**
 * Manipulador de `announcement.publish`: publica a novidade agendada cujo horário chegou.
 * Ignora, sem erro, a que foi apagada, a que saiu de `scheduled` (publicada à mão, voltou a
 * rascunho) e a de um agendamento que mudou (o novo tem a própria tarefa). Repetir é seguro.
 */
export async function publishScheduledAnnouncement(
  db: Database,
  payload: { announcementId: string; publishAt: string },
): Promise<ScheduledPublishResult> {
  return db.transaction().execute(async (trx) => {
    const skip = (skipped: ScheduledPublishSkip): ScheduledPublishResult => ({
      published: false,
      skipped,
    });
    const row = await trx
      .selectFrom('announcements')
      .select(['id', 'title', 'status', 'notify', 'publishAt'])
      .select(sql<boolean>`publish_at <= now()`.as('due'))
      .where('id', '=', payload.announcementId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return skip('not_found');
    if (row.status !== 'scheduled' || row.publishAt === null) return skip('not_scheduled');
    if (row.publishAt.getTime() !== new Date(payload.publishAt).getTime()) {
      return skip('rescheduled');
    }
    if (!row.due) return skip('not_due');
    await publishAnnouncementNow(trx, row, { origin: 'worker' });
    return { published: true, skipped: null };
  });
}

/**
 * Publica todas as agendadas vencidas, uma transação por novidade. Rede de segurança do
 * worker para o atraso máximo de 1 minuto (spec 025): cobre a tarefa perdida ou retirada.
 */
export async function publishDueAnnouncements(
  db: Database,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<number> {
  const due = await db
    .selectFrom('announcements')
    .select(['id', 'publishAt'])
    .where('status', '=', 'scheduled')
    .where('publishAt', '<=', sql<Date>`now()`)
    .orderBy('publishAt')
    .limit(options.limit ?? 100)
    .execute();
  let published = 0;
  for (const row of due) {
    if (options.signal?.aborted) break;
    const result = await publishScheduledAnnouncement(db, {
      announcementId: row.id,
      publishAt: (row.publishAt as Date).toISOString(),
    });
    if (result.published) published += 1;
  }
  return published;
}
