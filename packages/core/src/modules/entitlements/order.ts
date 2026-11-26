import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { findEntitlementProduct, grantEntitlement, revokeEntitlementTree } from './grant.ts';
import type { EntitlementProductType, EntitlementRevokeReason } from './types.ts';

// Direitos de acesso de um pedido pago (spec 010, "Algoritmo de concessão"; spec 011, "Pedido e
// seus estados"). A raiz é `source = order` e `source_id = order_items.id`; a cascata (pacote →
// curso → ebook) é do `grantEntitlement`. A validade vem de `access_days_snapshot`, contada do
// pagamento; `null` é vitalício. Dono da escrita: worker, na transição para `paid`.

/** Estados de `orders` em que o dinheiro entrou; espelha `PAID_ORDER_STATUSES` de `sales`. */
const PAID_ORDER_STATUSES: ReadonlySet<string> = new Set([
  'paid',
  'partially_refunded',
  'refunded',
  'chargeback',
]);

export interface FulfillOrderOptions {
  /** Início do acesso; padrão: `paid_at` do pedido. */
  now?: Date;
}

export interface FulfillOrderResult {
  /** Raízes criadas nesta chamada (a repetição devolve 0). */
  granted: number;
  /** Itens cujo produto não existe mais e por isso não liberaram acesso. */
  skipped: number;
  /** `order_items.id` do pedido, na ordem do banco. */
  itemIds: string[];
}

/**
 * Concede os direitos de um pedido pago, um por item, na transação recebida. Idempotente: repetir
 * a tarefa não cria raízes nem enfileira e-mail de novo (`grantEntitlement`). Pedido inexistente:
 * `404`. Pedido fora dos estados pagos não libera nada.
 */
export async function fulfillOrder(
  trx: Database,
  orderId: string,
  options: FulfillOrderOptions = {},
): Promise<FulfillOrderResult> {
  if (!trx.isTransaction) {
    throw new TypeError('fulfillOrder exige uma transação aberta (db.transaction()).');
  }
  const order = await trx
    .selectFrom('orders')
    .select(['id', 'userId', 'status', 'paidAt'])
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (!order) throw notFound('Pedido não encontrado.');
  if (!PAID_ORDER_STATUSES.has(order.status)) {
    return { granted: 0, skipped: 0, itemIds: [] };
  }
  const items = await trx
    .selectFrom('orderItems')
    .select(['id', 'productType', 'productId', 'accessDaysSnapshot'])
    .where('orderId', '=', order.id)
    .orderBy('id')
    .execute();
  const start = options.now ?? order.paidAt ?? new Date();
  let granted = 0;
  let skipped = 0;
  for (const item of items) {
    const productType = item.productType as EntitlementProductType;
    const product = await findEntitlementProduct(trx, productType, item.productId);
    if (!product) {
      skipped += 1;
      continue;
    }
    const result = await grantEntitlement(trx, {
      userId: order.userId,
      productType,
      productId: item.productId,
      source: 'order',
      sourceId: item.id,
      startsAt: start,
      expiresAt: item.accessDaysSnapshot === null ? null : addDays(start, item.accessDaysSnapshot),
    });
    if (result.created) granted += 1;
  }
  return { granted, skipped, itemIds: items.map((item) => item.id) };
}

/**
 * Revoga as raízes do pedido e a cascata delas (spec 010, "Algoritmo de revogação"). Usado pelo
 * chargeback e pelo reembolso total (tarefa 531); o reembolso parcial decide por item.
 */
export async function revokeOrderEntitlements(
  trx: Database,
  orderId: string,
  reason: EntitlementRevokeReason,
  options: { orderItemIds?: readonly string[] } = {},
): Promise<number> {
  if (!trx.isTransaction) {
    throw new TypeError('revokeOrderEntitlements exige uma transação aberta (db.transaction()).');
  }
  const query = trx
    .selectFrom('entitlements')
    .select('id')
    .where('source', '=', 'order')
    .where('revokedAt', 'is', null)
    .where('sourceId', 'in', (eb) => {
      let subquery = eb.selectFrom('orderItems').select('id').where('orderId', '=', orderId);
      if (options.orderItemIds !== undefined && options.orderItemIds.length > 0) {
        subquery = subquery.where('id', 'in', [...options.orderItemIds]);
      }
      return subquery;
    });
  const rows = await query.execute();
  return revokeEntitlementTree(
    trx,
    rows.map((row) => row.id),
    reason,
  );
}

function addDays(start: Date, days: number): Date {
  const result = new Date(start);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
