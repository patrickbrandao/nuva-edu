import type { JsonObject } from '../../db/generated/database.ts';
import type { NotificationType } from '../notifications/central/types.ts';
import { enqueue } from './queue.ts';
import type { JobOf } from './registry.ts';

// Tarefa `notify` (specs 005 e 024): criada só pela função `notify` do núcleo, uma por
// destinatário. O worker cria a notificação da central, publica o SSE e enfileira o e-mail
// conforme as preferências. O manipulador chega com a tarefa 586; até lá o tipo fica em
// `PendingHandlerJobType`.

/**
 * Payload da tarefa `notify`: identificadores, tipo e os dados do modelo do tipo. O `data` vai
 * para a notificação e para o e-mail, por isso passa por `normalizeNotificationData` em
 * `notify`: nunca leva senha nem token (spec 024).
 */
export interface NotifyJobPayload {
  type: NotificationType;
  userId: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  data: JsonObject;
}

/**
 * Enfileira uma tarefa `notify`, na transação da ação (spec 024, RF-01). Passe a transação: a
 * tarefa só existe se a escrita de negócio for confirmada, e o aviso ao worker só sai no
 * COMMIT. Uma tarefa por destinatário, sem chave de unicidade: o agrupamento da central e do
 * e-mail acontece no worker.
 */
export async function enqueueNotify(
  trx: Parameters<typeof enqueue>[0],
  payload: NotifyJobPayload,
): Promise<JobOf<'notify'>> {
  if (!trx.isTransaction) {
    throw new TypeError('enqueueNotify exige uma transação aberta (db.transaction()).');
  }
  const job = await enqueue(trx, 'notify', payload);
  // Sem `uniqueKey`, `enqueue` sempre insere.
  return job as NonNullable<typeof job>;
}
