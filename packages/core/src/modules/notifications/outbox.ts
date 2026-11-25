import type { Database } from '../../db/database.ts';
import { enqueue } from '../jobs/queue.ts';
import {
  type AnyEmailType,
  type EmailDataInput,
  emailTypeDefinition,
  normalizeEmailData,
} from './email-types.ts';

// Fila de e-mails (spec 024): linha em `email_outbox` mais a tarefa `email.send`.
// Dono de `email_outbox`: o worker (envio); APIs e worker só inserem, e só por aqui.

export interface EnqueueEmailInput<T extends AnyEmailType> {
  userId: string;
  type: T;
  data: EmailDataInput<T>;
}

export interface EnqueuedEmail {
  /** Id da linha de `email_outbox`. */
  outboxId: string;
  /** Id da tarefa `email.send`. */
  jobId: string;
}

/**
 * Enfileira um e-mail do catálogo (grupo `account`, `moderation.suspended` e, até a central de
 * notificações da Fase 4, `access.granted` e `certificate.issued`): grava a linha
 * de `email_outbox` com `to` = e-mail atual do usuário e a tarefa `email.send`, na transação da
 * ação (spec 024). Exige uma transação aberta: sem ela, a ação poderia falhar com o e-mail já
 * na fila, ou o contrário.
 *
 * `data` é conferido pelo tipo (`parseEmailData`); o token do link nunca passa por aqui: o
 * worker o cria ao montar o e-mail (spec 007). Usuário com a conta já excluída (`deleted_at`)
 * não recebe nada: devolve `null`. Também devolve `null` a conta com suspensão `full` nos tipos
 * que a deixam de fora (`access.granted`, `certificate.issued`; spec 024, "E-mails da Fase 2").
 * Usuário inexistente lança erro.
 */
export async function enqueueEmail<T extends AnyEmailType>(
  trx: Database,
  input: EnqueueEmailInput<T>,
): Promise<EnqueuedEmail | null> {
  if (!trx.isTransaction) {
    throw new TypeError('enqueueEmail exige uma transação aberta (db.transaction()).');
  }
  const data = normalizeEmailData(input.type, input.data);
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
  if (user.suspendedKind === 'full' && emailTypeDefinition(input.type).skipFullySuspended) {
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
