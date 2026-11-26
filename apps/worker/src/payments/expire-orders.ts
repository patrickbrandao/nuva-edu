import {
  type Database,
  isDomainError,
  PAYMENT_ERROR_CODES,
  type PaymentProvider,
} from '@nuva-edu/core';

const DAY_MS = 86_400_000;
const BATCH_SIZE = 200;

/** Cancela o checkout antes de persistir a expiração para que uma falha seja repetível. */
export async function expireSalesOrders(
  db: Database,
  provider: PaymentProvider,
  now: Date,
  boletoDays: number,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  const boletoCutoff = new Date(now.getTime() - boletoDays * DAY_MS);
  const candidates = await db
    .selectFrom('orders')
    .select(['id', 'provider', 'providerCheckoutId'])
    .where('status', '=', 'pending')
    .where('expiresAt', '<=', now)
    .where((eb) =>
      eb.or([
        eb('createdAt', '<=', boletoCutoff),
        eb.not(
          eb.exists(
            eb
              .selectFrom('payments')
              .select('payments.id')
              .whereRef('payments.orderId', '=', 'orders.id')
              .where('payments.status', '=', 'pending')
              .where('payments.method', '=', 'boleto'),
          ),
        ),
      ]),
    )
    .orderBy('expiresAt')
    .orderBy('id')
    .limit(BATCH_SIZE)
    .execute();

  let expired = 0;
  for (const order of candidates) {
    signal.throwIfAborted();
    if (order.provider === provider.name && order.providerCheckoutId !== null) {
      try {
        const response = await provider.cancelCheckout(order.providerCheckoutId);
        if (!response.confirmed) continue;
      } catch (error) {
        if (!isDomainError(error)) throw error;
        // O pagamento pode ter sido aprovado entre a reconciliação e o cancelamento.
        if (error.code === PAYMENT_ERROR_CODES.invalidTransition) continue;
        if (error.code !== 'not_found') throw error;
      }
    }
    const updated = await db
      .updateTable('orders')
      .set({ status: 'expired', expiresAt: null })
      .where('id', '=', order.id)
      .where('status', '=', 'pending')
      .where('expiresAt', '<=', now)
      .executeTakeFirst();
    expired += Number(updated.numUpdatedRows);
  }
  return expired;
}
