import type { Database } from '../../../db/database.ts';
import { enqueueNotify } from '../../jobs/notifications.ts';
import { type NotificationPayload, normalizeNotificationPayload } from './payload.ts';
import {
  filterNotificationRecipients,
  type NotificationSkip,
  type NotificationSkipReason,
} from './recipients.ts';
import {
  isNotificationType,
  type NotificationType,
  notificationGroupHasInApp,
  notificationTypeGroup,
} from './types.ts';

// Porta de entrada das notificações (spec 024, "Interfaces e contratos"): `notify` recebe o
// tipo, os destinatários e os dados do modelo e enfileira uma tarefa `notify` por destinatário.
// O worker (tarefa 586) confere as preferências, grava na central, publica o SSE e enfileira o
// e-mail. Nenhum recurso grava em `notifications` nem publica o evento por conta própria.

export interface NotifyResult {
  /** Tarefas criadas, na ordem dos destinatários. */
  queued: { userId: string; jobId: string }[];
  /** Quem ficou de fora e por quê (sem dado pessoal além do id). */
  skipped: NotificationSkip[];
}

/**
 * Enfileira as notificações de um fato. `recipients` aceita um id ou uma lista; repetidos são
 * removidos. Aplica desde já as regras que não dependem do envio: ninguém é notificado das
 * próprias ações, conta removida ou suspensa não recebe (salvo `moderation.suspended`) e o
 * grupo `staff` só alcança a equipe. O worker reaplica as regras antes de gravar.
 *
 * Exige transação aberta (a tarefa nasce junto da escrita de negócio). Lança `TypeError` para
 * tipo desconhecido, do grupo `account` (que sai por `enqueueEmail`), destinatário fora do
 * formato ou payload inválido; `NotificationDataError` para o `data`.
 */
export async function notify(
  trx: Database,
  type: NotificationType,
  recipients: string | readonly string[],
  payload: NotificationPayload = {},
): Promise<NotifyResult> {
  if (!trx.isTransaction) {
    throw new TypeError('notify exige uma transação aberta (db.transaction()).');
  }
  if (!isNotificationType(type)) {
    throw new TypeError(`Notificação de tipo desconhecido: ${String(type)}.`);
  }
  const group = notificationTypeGroup(type);
  if (!notificationGroupHasInApp(group)) {
    throw new TypeError(`O grupo "${group}" não passa por notify; use enqueueEmail (spec 024).`);
  }
  const normalized = normalizeNotificationPayload(payload);
  const list = typeof recipients === 'string' ? [recipients] : recipients;
  const { eligible, skipped } = await filterNotificationRecipients(trx, type, list, {
    actorId: normalized.actorId,
  });
  const queued: NotifyResult['queued'] = [];
  for (const userId of eligible) {
    const job = await enqueueNotify(trx, {
      type,
      userId,
      actorId: normalized.actorId,
      targetType: normalized.targetType,
      targetId: normalized.targetId,
      data: normalized.data,
    });
    queued.push({ userId, jobId: job.id });
  }
  return { queued, skipped };
}

/** Motivos possíveis de um destinatário ficar de fora, para o log de quem chama `notify`. */
export type { NotificationSkip, NotificationSkipReason };
