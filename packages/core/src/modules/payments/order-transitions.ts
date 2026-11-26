import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { recordAudit } from '../audit/record.ts';
import { fulfillOrder } from '../entitlements/order.ts';
import { incrementCouponUse } from '../sales/coupons.ts';
import { applyChargeback, applyProviderPaymentRefund } from '../sales/refunds.ts';
import { cents, isPaidOrderStatus, type OrderStatus } from '../sales/types.ts';
import { invalidPaymentTransition, paymentAmountMismatch } from './errors.ts';
import { parsePaymentExternalReference } from './references.ts';
import type { PaymentProviderName, ProviderPayment } from './types.ts';

// Transição de um pedido avulso a partir do estado real da cobrança no provedor (spec 013,
// "Processamento no worker"; spec 011, "Pedido e seus estados"). Consumida pelo webhook e pela
// reconciliação (tarefas 540/542, unificadas na 532). A transação trava a linha do pedido: a
// ordem de chegada entre webhook e reconciliação não importa, e a mesma cobrança repetida não
// concede direitos nem conta o cupom duas vezes.
//
// Esta tarefa cobre `approved`, `pending`, `rejected` e `canceled`. `refunded`,
// `partially_refunded` e `charged_back` só atualizam `payments`: o efeito no pedido e a revogação
// em cascata são do módulo de reembolsos (tarefa 531).

/** Estados de `payments.status` em que o dinheiro entrou (têm `paid_at`). */
const SETTLED_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  'approved',
  'refunded',
  'partially_refunded',
  'charged_back',
]);

export interface ApplyOrderPaymentOptions {
  /** Instante da transição; padrão: agora. */
  now?: Date;
}

export interface AppliedOrderPayment {
  orderId: string;
  previousStatus: OrderStatus;
  status: OrderStatus;
  /** `true` quando o estado do pedido mudou nesta chamada. */
  changed: boolean;
  /** Raízes de direito criadas nesta chamada (0 na repetição). */
  granted: number;
}

/** `true` quando a cobrança é de pedido e o pagamento é considerado liquidado. */
function isSettled(payment: ProviderPayment): boolean {
  return SETTLED_PAYMENT_STATUSES.has(payment.status);
}

function paidAtFor(payment: ProviderPayment, now: Date): Date | null {
  if (!isSettled(payment)) return null;
  return payment.paidAt ?? now;
}

/**
 * Grava ou atualiza a linha de `payments` da cobrança, idempotente por
 * (`provider`, `provider_payment_id`). Não aplica transição; o chamador usa `applyOrderPayment`.
 * Fica fora da transação do pedido para que um valor divergente ainda deixe a cobrança visível
 * ao admin, mesmo saindo `payment_amount_mismatch`.
 */
export async function recordOrderPayment(
  db: Database,
  provider: PaymentProviderName,
  payment: ProviderPayment,
  options: ApplyOrderPaymentOptions = {},
): Promise<string> {
  const reference = parsePaymentExternalReference(payment.externalReference);
  if (reference.kind !== 'order') {
    throw invalidPaymentTransition('A cobrança não pertence a um pedido avulso.');
  }
  const now = options.now ?? new Date();
  const row = await db
    .insertInto('payments')
    .values({
      orderId: reference.id,
      subscriptionId: null,
      provider,
      providerPaymentId: payment.providerPaymentId,
      status: payment.status,
      method: payment.method,
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      currency: payment.currency,
      rawStatus: payment.rawStatus,
      paidAt: paidAtFor(payment, now),
    })
    .onConflict((oc) =>
      oc.columns(['provider', 'providerPaymentId']).doUpdateSet({
        orderId: reference.id,
        subscriptionId: null,
        status: payment.status,
        method: payment.method,
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        currency: payment.currency,
        rawStatus: payment.rawStatus,
        paidAt: paidAtFor(payment, now),
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Aplica a transição do pedido a partir da cobrança: grava `payments` e, na transação com trava
 * no pedido, decide o novo estado. `approved` marca `paid` (mesmo vindo de `expired` ou
 * `canceled`), conta o cupom uma única vez, concede a cascata e audita o pagamento tardio.
 * `pending` e `rejected` não mudam o pedido; `canceled` cancela o `pending` sem outro pagamento
 * aprovado; `refunded`/`partially_refunded` e `charged_back` delegam ao módulo de reembolsos,
 * como a assinatura faz. Pedido inexistente é `404` (o webhook marca o evento como `ignored`).
 */
export async function applyOrderPayment(
  db: Database,
  provider: PaymentProviderName,
  payment: ProviderPayment,
  options: ApplyOrderPaymentOptions = {},
): Promise<AppliedOrderPayment> {
  const reference = parsePaymentExternalReference(payment.externalReference);
  if (reference.kind !== 'order') {
    throw invalidPaymentTransition('A cobrança não pertence a um pedido avulso.');
  }
  // Sem pedido local a cobrança não tem dono: o webhook marca o evento como `ignored` pelo 404.
  const exists = await db
    .selectFrom('orders')
    .select(['id', 'status'])
    .where('id', '=', reference.id)
    .executeTakeFirst();
  if (!exists) throw notFound('Pedido não encontrado.');
  const initialStatus = exists.status as OrderStatus;

  const now = options.now ?? new Date();
  const paymentId = await recordOrderPayment(db, provider, payment, { now });

  // Reembolso e contestação são do módulo de reembolsos, que abre a própria transação e já tem o
  // estado atualizado da cobrança em `payments`.
  if (payment.status === 'refunded' || payment.status === 'partially_refunded') {
    await applyProviderPaymentRefund(db, paymentId, { now });
    return summarizeOrder(db, reference.id, initialStatus);
  }
  if (payment.status === 'charged_back') {
    await applyChargeback(db, paymentId, { now });
    return summarizeOrder(db, reference.id, initialStatus);
  }

  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', reference.id)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw notFound('Pedido não encontrado.');

    const previousStatus = order.status as OrderStatus;
    let status = previousStatus;
    let granted = 0;

    if (isSettled(payment)) {
      const totalCents = cents(order.totalCents);
      if (payment.amountCents !== totalCents || payment.currency !== order.currency) {
        throw paymentAmountMismatch();
      }
      if (!isPaidOrderStatus(previousStatus)) {
        const paidAt = payment.paidAt ?? now;
        await trx
          .updateTable('orders')
          .set({ status: 'paid', paidAt, expiresAt: null })
          .where('id', '=', order.id)
          .execute();
        status = 'paid';
        if (order.couponId !== null) await incrementCouponUse(trx, order.couponId);
        const result = await fulfillOrder(trx, order.id, { now: paidAt });
        granted = result.granted;
        if (previousStatus === 'expired' || previousStatus === 'canceled') {
          await recordAudit(trx, {
            context: { origin: 'worker' },
            action: 'order.paid_late',
            targetType: 'order',
            targetId: order.id,
            details: {
              previousStatus,
              provider,
              providerPaymentId: payment.providerPaymentId,
              amountCents: payment.amountCents,
            },
          });
        }
      }
      return {
        orderId: order.id,
        previousStatus,
        status,
        changed: status !== previousStatus,
        granted,
      };
    }

    if (
      payment.status === 'canceled' &&
      (previousStatus === 'pending' || previousStatus === 'draft')
    ) {
      const other = await trx
        .selectFrom('payments')
        .select('id')
        .where('orderId', '=', order.id)
        .where('providerPaymentId', '!=', payment.providerPaymentId)
        .where('status', 'in', ['approved', 'refunded', 'partially_refunded', 'charged_back'])
        .executeTakeFirst();
      if (!other) {
        await trx
          .updateTable('orders')
          .set({ status: 'canceled', expiresAt: null })
          .where('id', '=', order.id)
          .execute();
        status = 'canceled';
      }
    }

    return {
      orderId: order.id,
      previousStatus,
      status,
      changed: status !== previousStatus,
      granted,
    };
  });
}

async function summarizeOrder(
  db: Database,
  orderId: string,
  previousStatus: OrderStatus,
): Promise<AppliedOrderPayment> {
  const row = await db
    .selectFrom('orders')
    .select('status')
    .where('id', '=', orderId)
    .executeTakeFirst();
  const status = (row?.status as OrderStatus | undefined) ?? previousStatus;
  return {
    orderId,
    previousStatus,
    status,
    changed: status !== previousStatus,
    granted: 0,
  };
}
