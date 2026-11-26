import type { Database } from '../../../db/database.ts';
import type { EnqueuedEmail } from '../outbox.ts';
import {
  type CreatedNotification,
  type CreateNotificationInput,
  type CreateNotificationOptions,
  createNotification,
} from './create.ts';
import { enqueueNotificationEmail } from './email.ts';
import { getNotificationPrefs } from './prefs.ts';
import { type NotificationSkipReason, notificationRecipientSkipReason } from './recipients.ts';
import { isNotificationType, notificationGroupHasInApp, notificationTypeGroup } from './types.ts';

// Entrega de uma notificação a um destinatário (spec 024, RF-01 a RF-03), chamada pelo worker da
// tarefa `notify`. Num lugar só: confere o destinatário, lê as preferências do grupo e grava o
// canal "plataforma" (central + SSE) e/ou enfileira o e-mail. Assim o worker não reimplementa
// regra nenhuma.

export interface DeliverNotificationInput extends CreateNotificationInput {}

export interface DeliverNotificationOptions extends CreateNotificationOptions {
  /** Limite de frequência ou endereço com recusas permanentes. A central continua disponível. */
  suppressEmail?: boolean;
}

export interface DeliveredNotification {
  /** Motivo de nada ter sido entregue, ou `null` quando o destinatário recebeu. */
  skipped: NotificationSkipReason | null;
  /** Linha da central, quando o canal plataforma está ligado. */
  created: CreatedNotification | null;
  /** E-mail enfileirado, quando o canal e-mail está ligado e a conta pode recebê-lo. */
  email: EnqueuedEmail | null;
  /** Canais efetivos do grupo no momento da entrega. */
  channels: { inApp: boolean; email: boolean } | null;
}

/**
 * Entrega a notificação pelos canais das preferências do destinatário. A conta removida ou
 * suspensa, o autor da própria ação e quem não é da equipe no grupo `staff` ficam de fora de
 * tudo (`skipped`). Exige transação aberta: a linha, o evento SSE e o e-mail nascem juntos com a
 * ação que gerou o fato.
 *
 * Tipo do grupo `account` não passa por aqui (não tem canal plataforma): erro de programação.
 */
export async function deliverNotification(
  trx: Database,
  input: DeliverNotificationInput,
  options: DeliverNotificationOptions = {},
): Promise<DeliveredNotification> {
  if (!trx.isTransaction) {
    throw new TypeError('deliverNotification exige uma transação aberta (db.transaction()).');
  }
  const type = input.type;
  if (!isNotificationType(type)) {
    throw new TypeError(`Notificação de tipo desconhecido: ${String(type)}.`);
  }
  const group = notificationTypeGroup(type);
  if (!notificationGroupHasInApp(group)) {
    throw new TypeError(`O grupo "${group}" não passa por notify; use enqueueEmail (spec 024).`);
  }
  const skipped = await notificationRecipientSkipReason(trx, {
    userId: input.userId,
    type,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
  });
  if (skipped !== null) {
    return { skipped, created: null, email: null, channels: null };
  }
  const prefs = await getNotificationPrefs(trx, input.userId);
  const channels = prefs[group];
  const created = channels.inApp ? await createNotification(trx, input, options) : null;
  const email =
    channels.email && options.suppressEmail !== true
      ? await enqueueNotificationEmail(trx, {
          userId: input.userId,
          type,
          data: input.data ?? {},
        })
      : null;
  return { skipped: null, created, email, channels };
}
