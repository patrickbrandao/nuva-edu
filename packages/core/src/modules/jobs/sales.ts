import type { Database } from '../../db/database.ts';
import { enqueue } from './queue.ts';
import type { JobOf } from './registry.ts';

// Enfileiramento dos tipos de vendas e pagamentos (spec 005, "Tarefas sob demanda"): o webhook e
// a reconciliação só passam identificadores, e as tarefas de efeito externo carregam uma chave
// única para outra entrega não duplicar o trabalho. Os manipuladores chegam nas tarefas 542/557.

export function paymentWebhookKey(webhookEventId: string): string {
  return `payment.webhook:${webhookEventId}`;
}

export function orderFulfillKey(orderId: string): string {
  return `order.fulfill:${orderId}`;
}

export function refundExecuteKey(refundId: string): string {
  return `refund.execute:${refundId}`;
}

/** Processa o evento de webhook já gravado. Repetir enquanto houver tarefa ativa não duplica. */
export function enqueuePaymentWebhook(
  db: Database,
  webhookEventId: string,
): Promise<JobOf<'payment.webhook'> | null> {
  return enqueue(
    db,
    'payment.webhook',
    { webhookEventId },
    { uniqueKey: paymentWebhookKey(webhookEventId) },
  );
}

/** Garante uma única tarefa ativa de liberação do pedido. */
export function enqueueOrderFulfill(
  db: Database,
  orderId: string,
): Promise<JobOf<'order.fulfill'> | null> {
  return enqueue(db, 'order.fulfill', { orderId }, { uniqueKey: orderFulfillKey(orderId) });
}

/** Garante uma única tarefa ativa de estorno do reembolso. */
export function enqueueRefundExecute(
  db: Database,
  refundId: string,
): Promise<JobOf<'refund.execute'> | null> {
  return enqueue(db, 'refund.execute', { refundId }, { uniqueKey: refundExecuteKey(refundId) });
}
