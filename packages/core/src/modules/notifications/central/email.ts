import type { Database } from '../../../db/database.ts';
import type { JsonObject } from '../../../db/generated/database.ts';
import { enqueue } from '../../jobs/queue.ts';
import { isAnyEmailType } from '../email-types.ts';
import { type EnqueuedEmail, enqueueEmail } from '../outbox.ts';
import {
  isNotificationType,
  type NotificationType,
  normalizeNotificationData,
  notificationGroupHasInApp,
  notificationTypeGroup,
} from './types.ts';

// E-mail de uma notificação (spec 024, "E-mail"): uma linha em `email_outbox` e a tarefa
// `email.send`, na transação do worker da tarefa `notify`. Os e-mails do grupo `account` não
// passam por aqui: continuam saindo por `enqueueEmail`, direto da ação.

export interface EnqueueNotificationEmailInput {
  userId: string;
  type: NotificationType;
  data: JsonObject;
}

/**
 * Enfileira o e-mail de um tipo de notificação. `access.granted` e `certificate.issued` já têm
 * formato de `data` no catálogo de e-mails e são validados por `enqueueEmail`; os demais passam
 * por `normalizeNotificationData`.
 *
 * Devolve `null` para conta excluída e para conta suspensa: os tipos que a suspensão não impede
 * (`moderation.suspended`, do catálogo de e-mails) passam por `enqueueEmail`, que aplica a regra
 * própria. Grupo `account` aqui é erro de programação: use `enqueueEmail`.
 */
export async function enqueueNotificationEmail(
  trx: Database,
  input: EnqueueNotificationEmailInput,
): Promise<EnqueuedEmail | null> {
  if (!trx.isTransaction) {
    throw new TypeError('enqueueNotificationEmail exige uma transação aberta (db.transaction()).');
  }
  if (!isNotificationType(input.type)) {
    throw new TypeError(`Notificação de tipo desconhecido: ${String(input.type)}.`);
  }
  const group = notificationTypeGroup(input.type);
  if (!notificationGroupHasInApp(group)) {
    throw new TypeError(
      `O grupo "${group}" sai por enqueueEmail; não use enqueueNotificationEmail.`,
    );
  }
  if (isAnyEmailType(input.type)) {
    return enqueueEmail(trx, {
      userId: input.userId,
      type: input.type,
      data: input.data as never,
    });
  }
  const data = normalizeNotificationData(input.data);
  const user = await trx
    .selectFrom('users')
    .select(['email', 'deletedAt', 'suspendedKind'])
    .where('id', '=', input.userId)
    .executeTakeFirst();
  if (!user) {
    throw new Error(`Usuário ${input.userId} não existe; e-mail ${input.type} não enfileirado.`);
  }
  if (user.deletedAt !== null) {
    return null;
  }
  if (user.suspendedKind !== null) {
    return null;
  }
  const row = await trx
    .insertInto('emailOutbox')
    .values({
      userId: input.userId,
      to: user.email,
      type: input.type,
      data: JSON.stringify(data),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const job = await enqueue(trx, 'email.send', { outboxId: row.id });
  // Sem `uniqueKey`, `enqueue` sempre insere.
  return { outboxId: row.id, jobId: (job as NonNullable<typeof job>).id };
}
