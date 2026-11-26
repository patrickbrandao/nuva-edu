import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { isDomainError } from '../../errors/domain-error.ts';
import { fulfillOrder } from '../entitlements/order.ts';
import { orderExternalReference } from '../payments/references.ts';
import type {
  CreateCheckoutInput,
  PaymentCheckout,
  PaymentProvider,
  PaymentReturnUrls,
} from '../payments/types.ts';
import { requireBilling } from './billing.ts';
import {
  assertCartSellable,
  assertPurchaseAllowed,
  type BuiltCart,
  readCartForCheckout,
} from './cart.ts';
import { incrementCouponUse } from './coupons.ts';
import { couponInvalid, orderPendingLimit } from './errors.ts';
import { getMyOrder } from './orders.ts';
import { ORDER_PENDING_LIMIT, type OrderCheckout, type TaxIdType } from './types.ts';

// Fechamento da cesta (spec 011, "Pedido e seus estados"; spec 013, "Falhas"): valida a cesta, o
// cupom e os dados do comprador, congela preços em `orders` e `order_items`, esvazia a cesta e
// cria o checkout no provedor. O pedido de total zero não passa pelo provedor: nasce `paid`.
//
// O pedido (e a numeração) é criado antes da chamada ao provedor, para a cesta só ser esvaziada
// depois do checkout criado. Provedor fora: o pedido fica `draft`, a cesta intacta e o erro 503
// sobe para a API. A URL do checkout volta na resposta; guardá-la para a consulta posterior do
// pedido depende das colunas `checkout_url` e `provider_checkout_id`, ainda ausentes do esquema
// (tarefa do `banco`).

export interface CreateOrderInput {
  userId: string;
  provider: PaymentProvider;
  currency: string;
  /** URLs de retorno do checkout, montadas com o id do pedido recém-criado. */
  returnUrls: PaymentReturnUrls | ((orderId: string) => PaymentReturnUrls);
  /** Instante da criação; padrão: agora. */
  now?: Date;
  /** Prazo do `pending` de cartão e Pix (spec 011); padrão 30 min. */
  orderPendingMinutes?: number;
}

interface PreparedOrder {
  orderId: string;
  couponId: string | null;
  built: BuiltCart;
  buyerName: string;
  buyerTaxIdType: TaxIdType;
  buyerTaxId: string;
  buyerEmail: string;
}

/** `true` quando o provedor recusou por indisponibilidade (o chamador responde 503). */
export function isProviderUnavailable(error: unknown): boolean {
  return isDomainError(error) && error.code === 'payment_provider_unavailable';
}

/**
 * Fecha a cesta do aluno e devolve o pedido com a URL de pagamento (`POST /orders`). Recusas,
 * pelo `code`, na ordem da spec: `email_not_verified`, `billing_required`, `cart_empty`,
 * `cart_invalid`, `order_pending_limit` e `coupon_invalid`. Provedor indisponível: `503`, com o
 * pedido `draft` e a cesta preservada.
 */
export async function createOrder(db: Database, input: CreateOrderInput): Promise<OrderCheckout> {
  const now = input.now ?? new Date();
  const prepared = await db.transaction().execute((trx) => prepareOrder(trx, input));

  if (prepared.built.view.totalCents === 0) {
    return db.transaction().execute(async (trx) => {
      const paid = await trx
        .updateTable('orders')
        .set({ status: 'paid', paidAt: now, expiresAt: null, provider: 'none' })
        .where('id', '=', prepared.orderId)
        .where('status', '=', 'draft')
        .returning('id')
        .executeTakeFirst();
      await clearCart(trx, input.userId);
      if (paid) {
        if (prepared.couponId !== null) await incrementCouponUse(trx, prepared.couponId);
        await fulfillOrder(trx, prepared.orderId, { now });
      }
      const order = await getMyOrder(trx, input.userId, prepared.orderId);
      return { order: { ...order, checkoutUrl: null }, checkoutUrl: null };
    });
  }

  const checkout = await requestCheckout(prepared, input);
  const expiresAt = new Date(now.getTime() + (input.orderPendingMinutes ?? 30) * 60_000);

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('orders')
      .set({ status: 'pending', expiresAt, provider: input.provider.name })
      .where('id', '=', prepared.orderId)
      .where('status', '=', 'draft')
      .execute();
    await clearCart(trx, input.userId);
    const order = await getMyOrder(trx, input.userId, prepared.orderId);
    return {
      order: { ...order, checkoutUrl: checkout.checkoutUrl },
      checkoutUrl: checkout.checkoutUrl,
    };
  });
}

async function prepareOrder(trx: Database, input: CreateOrderInput): Promise<PreparedOrder> {
  await assertPurchaseAllowed(trx, input.userId);
  // Serializa o fechamento do mesmo aluno: o limite de pending e a numeração não escapam numa
  // corrida de duas requisições.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`.execute(trx);

  const billing = await requireBilling(trx, input.userId);
  const user = await trx
    .selectFrom('users')
    .select(['email'])
    .where('id', '=', input.userId)
    .executeTakeFirstOrThrow();
  const built = await readCartForCheckout(trx, input.userId, input.currency);
  assertCartSellable(built);
  if (built.coupon !== null && built.view.coupon?.valid === false) throw couponInvalid();

  const pending = await trx
    .selectFrom('orders')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('userId', '=', input.userId)
    .where('status', '=', 'pending')
    .executeTakeFirstOrThrow();
  if (pending.n >= ORDER_PENDING_LIMIT) throw orderPendingLimit();

  const totalCents = built.view.totalCents;
  const order = await trx
    .insertInto('orders')
    .values({
      userId: input.userId,
      status: 'draft',
      subtotalCents: built.view.subtotalCents,
      discountCents: built.view.discountCents,
      totalCents,
      currency: input.currency,
      couponId: built.coupon?.id ?? null,
      couponCode: built.coupon?.code ?? null,
      buyerName: billing.fullName,
      buyerTaxIdType: billing.taxIdType,
      buyerTaxId: billing.taxId,
      provider: totalCents === 0 ? 'none' : input.provider.name,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  await trx
    .insertInto('orderItems')
    .values(
      built.lines.map((line) => ({
        orderId: order.id,
        productType: line.productType,
        productId: line.productId,
        titleSnapshot: line.title,
        accessDaysSnapshot: line.accessDays,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
        paidCents: line.unitPriceCents - line.discountCents,
      })),
    )
    .execute();

  return {
    orderId: order.id,
    couponId: built.coupon?.id ?? null,
    built,
    buyerName: billing.fullName,
    buyerTaxIdType: billing.taxIdType,
    buyerTaxId: billing.taxId,
    buyerEmail: user.email,
  };
}

async function requestCheckout(
  prepared: PreparedOrder,
  input: CreateOrderInput,
): Promise<PaymentCheckout> {
  const returnUrls =
    typeof input.returnUrls === 'function' ? input.returnUrls(prepared.orderId) : input.returnUrls;
  const checkoutInput: CreateCheckoutInput = {
    items: prepared.built.lines.map((line) => ({
      id: line.id,
      title: line.title,
      quantity: 1,
      unitAmountCents: line.unitPriceCents - line.discountCents,
    })),
    totalCents: prepared.built.view.totalCents,
    currency: input.currency,
    buyer: {
      name: prepared.buyerName,
      email: prepared.buyerEmail,
      taxId: prepared.buyerTaxId,
    },
    returnUrls,
    externalReference: orderExternalReference(prepared.orderId),
  };
  return input.provider.createCheckout(checkoutInput);
}

async function clearCart(trx: Database, userId: string): Promise<void> {
  const cart = await trx
    .selectFrom('carts')
    .select('id')
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (!cart) return;
  await trx.deleteFrom('cartItems').where('cartId', '=', cart.id).execute();
  await trx.updateTable('carts').set({ couponId: null }).where('id', '=', cart.id).execute();
}
