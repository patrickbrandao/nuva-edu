import type { Database } from '../../db/database.ts';
import { isDomainError } from '../../errors/domain-error.ts';
import { enqueueRefundExecute } from '../jobs/sales.ts';
import { applyProviderRefundStatus, failRequestedRefund } from '../sales/refunds.ts';
import { PAYMENT_ERROR_CODES } from './errors.ts';
import { applyOrderPayment } from './order-transitions.ts';
import { orderExternalReference } from './references.ts';
import { applyProviderSubscriptionState } from './subscription-transitions.ts';
import type { PaymentProvider, ProviderPayment } from './types.ts';

// Reconciliação periódica do worker (spec 013, "Reconciliação"): a mesma transição do webhook,
// aplicada quando o aviso atrasa, se perde ou chega fora de ordem. As funções leem o estado atual
// no provedor e são idempotentes; a próxima janela repete o que falhou.

/** Pedido `pending` só é reconciliado depois deste tempo (spec 013). */
export const ORDER_RECONCILE_DELAY_MS = 2 * 60 * 1000;
/** Reembolso `requested` só é consultado depois deste tempo (spec 013). */
export const REFUND_RECONCILE_DELAY_MS = 5 * 60 * 1000;

/** Estados de assinatura que a reconciliação acompanha (spec 013). */
export const RECONCILED_SUBSCRIPTION_STATUSES = [
  'active',
  'past_due',
  'canceling',
  'suspended',
] as const;

export interface ReconcileOptions {
  /** Instante da varredura; padrão: agora. */
  now?: Date;
  /** Quantos recursos no máximo por execução; padrão 200. */
  limit?: number;
  /** Dias de carência da instalação (`NUVA_SUBSCRIPTION_GRACE_DAYS`). */
  graceDays?: number;
}

export interface ReconcileResult {
  /** Recursos examinados (pedido, assinatura ou reembolso). */
  checked: number;
  /** Recursos cuja transição mudou o estado local. */
  applied: number;
  /** Recursos sem correspondência local. */
  ignored: number;
  /** Recursos que não puderam ser concluídos nesta janela. */
  failed: number;
}

const EMPTY = (): ReconcileResult => ({ checked: 0, applied: 0, ignored: 0, failed: 0 });

/**
 * Pedidos `pending` criados há mais de 2 min: consulta os pagamentos pela referência externa e
 * aplica cada um em ordem cronológica, para o estado mais novo prevalecer. Sem pagamento no
 * provedor, o pedido continua `pending`.
 */
export async function reconcilePendingOrders(
  db: Database,
  provider: PaymentProvider,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;
  const cutoff = new Date(now.getTime() - ORDER_RECONCILE_DELAY_MS);
  const orders = await db
    .selectFrom('orders')
    .select('id')
    .where('status', '=', 'pending')
    .where('createdAt', '<=', cutoff)
    .orderBy('createdAt')
    .limit(limit)
    .execute();

  const result = EMPTY();
  for (const order of orders) {
    result.checked += 1;
    let payments: ProviderPayment[];
    try {
      payments = await provider.findPaymentsByReference(orderExternalReference(order.id));
    } catch (error) {
      if (isTransient(error)) throw error;
      result.failed += 1;
      continue;
    }
    const chronological = [...payments].sort((left, right) => paidTime(left) - paidTime(right));
    for (const payment of chronological) {
      try {
        const applied = await applyOrderPayment(db, provider.name, payment, { now });
        if (applied.changed) result.applied += 1;
      } catch (error) {
        if (isDomainError(error) && error.code === 'not_found') {
          result.ignored += 1;
          continue;
        }
        if (isTransient(error)) throw error;
        result.failed += 1;
      }
    }
  }
  return result;
}

/**
 * Assinaturas ativas, em carência, cancelando ou suspensas: lê o estado no provedor e corrige
 * estado e período. Provedor `canceled` encerra; `paused` leva a `past_due`; `authorized` só
 * avança o período. A ativação continua vindo da cobrança aprovada.
 */
export async function reconcileSubscriptions(
  db: Database,
  provider: PaymentProvider,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;
  const subscriptions = await db
    .selectFrom('subscriptions')
    .select(['id', 'providerSubscriptionId'])
    .where('status', 'in', [...RECONCILED_SUBSCRIPTION_STATUSES])
    .where('providerSubscriptionId', 'is not', null)
    .orderBy('createdAt')
    .limit(limit)
    .execute();

  const result = EMPTY();
  for (const subscription of subscriptions) {
    result.checked += 1;
    const providerSubscriptionId = subscription.providerSubscriptionId as string;
    try {
      const state = await provider.getSubscription(providerSubscriptionId);
      const applied = await applyProviderSubscriptionState(db, state, {
        now,
        ...(options.graceDays === undefined ? {} : { graceDays: options.graceDays }),
      });
      if (applied.changed || applied.extended > 0) result.applied += 1;
    } catch (error) {
      if (isDomainError(error) && error.code === 'not_found') {
        result.ignored += 1;
        continue;
      }
      if (isTransient(error)) throw error;
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Reembolsos `requested` há mais de 5 min: sem identificador no provedor, garante de novo a
 * tarefa `refund.execute`; com identificador, consulta o estado, conclui o estorno aprovado ou
 * marca `failed` o recusado/perdido. `pending` continua para a próxima janela.
 */
export async function reconcileRefunds(
  db: Database,
  provider: PaymentProvider,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;
  const cutoff = new Date(now.getTime() - REFUND_RECONCILE_DELAY_MS);
  const refunds = await db
    .selectFrom('refunds')
    .select(['id', 'paymentId', 'providerRefundId'])
    .where('status', '=', 'requested')
    .where('createdAt', '<=', cutoff)
    .orderBy('createdAt')
    .limit(limit)
    .execute();

  const result = EMPTY();
  for (const refund of refunds) {
    result.checked += 1;
    if (refund.providerRefundId === null) {
      // A tarefa de execução se perdeu ou ainda não rodou; a chave única evita duplicar uma
      // tarefa já na fila.
      await enqueueRefundExecute(db, refund.id);
      continue;
    }
    const payment = await db
      .selectFrom('payments')
      .select('providerPaymentId')
      .where('id', '=', refund.paymentId)
      .executeTakeFirst();
    if (!payment) {
      result.failed += 1;
      continue;
    }
    let status: Awaited<ReturnType<PaymentProvider['getRefundStatus']>>;
    try {
      status = await provider.getRefundStatus(payment.providerPaymentId, refund.providerRefundId);
    } catch (error) {
      if (isDomainError(error) && error.code === 'not_found') {
        await failRequestedRefund(db, refund.id, 'Reembolso não encontrado no provedor.', {
          now,
        });
        result.failed += 1;
        continue;
      }
      if (isTransient(error)) throw error;
      result.failed += 1;
      continue;
    }
    try {
      await applyProviderRefundStatus(db, refund.id, status, { now });
      if (status.status === 'approved') result.applied += 1;
      if (status.status === 'rejected') result.failed += 1;
    } catch (error) {
      if (isTransient(error)) throw error;
      result.failed += 1;
    }
  }
  return result;
}

function paidTime(payment: ProviderPayment): number {
  return payment.paidAt?.getTime() ?? 0;
}

/** Rede instável ou 5xx: a próxima execução da tarefa repete. O resto é definitivo. */
function isTransient(error: unknown): boolean {
  return (
    !isDomainError(error) ||
    error.code === PAYMENT_ERROR_CODES.unavailable ||
    error.code === 'not_found'
  );
}
