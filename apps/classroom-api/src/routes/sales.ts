import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  type AddCartItemInput,
  addCartItem,
  assertCan,
  type CatalogViewer,
  type Config,
  cancelMyOrder,
  configuredPaymentProviderName,
  createOrder,
  getMyBilling,
  getMyOrder,
  listMyOrders,
  type MyOrderDetail,
  type MyOrdersQuery,
  type OrderCheckout,
  type PaymentProvider,
  type PaymentReturnUrls,
  readCart,
  removeCartCoupon,
  removeCartItem,
  type SalesOrderItem,
  type SaveBillingInput,
  saveMyBilling,
  setCartCoupon,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { privateCache, viewerOf } from './catalog.ts';
import { bodyOf, headerOf, type PaymentRouteContext, paramsOf } from './context.ts';

/**
 * Cesta, dados de comprador e pedidos avulsos do aluno (spec 011). O núcleo decide elegibilidade,
 * cascata, rateio de cupom, congelamento de preços, idempotência e transições; a rota só traduz
 * HTTP, cabeçalhos e a porta de pagamento sob demanda (spec 013, RF-09).
 */

/** O aluno da sessão, com a permissão da operação (`x-permission: purchase.create`). */
function studentOf(request: FastifyRequest): CatalogViewer {
  const viewer = viewerOf(request);
  assertCan(viewer, 'purchase.create');
  return viewer;
}

/**
 * Para onde o navegador volta do checkout hospedado (spec 011, "Retorno do checkout"; spec 013):
 * a página do pedido no classroom (`/pedidos/:id`).
 */
export function orderReturnUrls(classroomUrl: string, orderId: string): PaymentReturnUrls {
  const order = `${classroomUrl}/pedidos/${orderId}`;
  return { success: order, pending: order, failure: order };
}

/** `loadOrderItems` no núcleo mantém `orderId` para agrupar listagens; `OrderItem` não o expõe. */
function cleanOrderDetail(detail: MyOrderDetail): MyOrderDetail {
  return {
    ...detail,
    items: detail.items.map((item) => {
      const { orderId: _orderId, ...publicItem } = item as SalesOrderItem & { orderId?: string };
      return publicItem;
    }),
  };
}

function cleanOrderCheckout(checkout: OrderCheckout): OrderCheckout {
  return {
    order: cleanOrderDetail(checkout.order),
    checkoutUrl: checkout.checkoutUrl,
  };
}

/**
 * Resolve o provedor apenas quando o pedido realmente fala com ele (`totalCents > 0`). Assim,
 * pedido de valor final zero conclui com `provider: none` mesmo sem provedor configurado, e
 * recusas de domínio (`email_not_verified`, `billing_required`, `cart_empty`) saem antes de `503`.
 */
function lazyOrderProvider(config: Config, resolve: () => PaymentProvider): PaymentProvider {
  return {
    get name() {
      try {
        return resolve().name;
      } catch {
        return configuredPaymentProviderName(config);
      }
    },
    createCheckout: (input) => resolve().createCheckout(input),
    getPayment: (id) => resolve().getPayment(id),
    findPaymentsByReference: (reference) => resolve().findPaymentsByReference(reference),
    cancelCheckout: (id) => resolve().cancelCheckout(id),
    ensurePlan: (input) => resolve().ensurePlan(input),
    createSubscription: (input) => resolve().createSubscription(input),
    getSubscription: (id) => resolve().getSubscription(id),
    cancelSubscription: (id) => resolve().cancelSubscription(id),
    refund: (id, amountCents) => resolve().refund(id, amountCents),
    getRefundStatus: (paymentId, refundId) => resolve().getRefundStatus(paymentId, refundId),
    parseWebhook: (input) => resolve().parseWebhook(input),
  };
}

export function registerSalesRoutes(app: FastifyInstance, ctx: PaymentRouteContext): void {
  const { config, db } = ctx;
  const provider = lazyOrderProvider(config, () => ctx.paymentProvider());

  // `GET /cart`: a cesta aberta do aluno, vazia quando ainda não usada.
  app.operation('getCart', async (request, reply) => {
    const viewer = studentOf(request);
    const cart = await readCart(db, viewer.id, config.currency);
    privateCache(reply);
    return toWire(cart);
  });

  // `POST /cart/items`: acrescenta produto `paid` publicado e devolve a cesta inteira.
  app.operation('addCartItem', async (request, reply) => {
    const viewer = studentOf(request);
    const body = bodyOf<AddCartItemInput>(request);
    const cart = await addCartItem(db, viewer.id, body, config.currency);
    reply.status(201);
    privateCache(reply);
    return toWire(cart);
  });

  // `DELETE /cart/items/{id}`: remove item da própria cesta (`404` se alheio ou inexistente).
  app.operation('removeCartItem', async (request, reply) => {
    const viewer = studentOf(request);
    const { id } = paramsOf<{ id: string }>(request);
    await removeCartItem(db, viewer.id, id);
    reply.status(204);
  });

  // `PUT /cart/coupon`: aplica ou substitui o cupom da cesta; inválido responde `422 coupon_invalid`.
  app.operation('setCartCoupon', async (request, reply) => {
    const viewer = studentOf(request);
    const { code } = bodyOf<{ code: string }>(request);
    const cart = await setCartCoupon(db, viewer.id, code, config.currency);
    privateCache(reply);
    return toWire(cart);
  });

  // `DELETE /cart/coupon`: remove o cupom da cesta; sem cupom, devolve como está.
  app.operation('clearCartCoupon', async (request, reply) => {
    const viewer = studentOf(request);
    const cart = await removeCartCoupon(db, viewer.id, config.currency);
    privateCache(reply);
    return toWire(cart);
  });

  // `GET /me/billing`: nome completo e CPF/CNPJ guardados no usuário (`no-store`: dado fiscal).
  app.operation(
    'getMyBilling',
    async (request) => {
      const viewer = studentOf(request);
      return toWire(await getMyBilling(db, viewer.id));
    },
    { noStore: true },
  );

  // `PUT /me/billing`: valida CPF/CNPJ por dígito verificador e guarda sem pontuação.
  app.operation(
    'saveMyBilling',
    async (request) => {
      const viewer = studentOf(request);
      const body = bodyOf<SaveBillingInput>(request);
      return toWire(await saveMyBilling(db, viewer.id, body));
    },
    { noStore: true },
  );

  // `GET /orders`: os pedidos do aluno, do mais recente ao mais antigo, sem `draft`.
  app.operation('listMyOrders', async (request, reply) => {
    const viewer = studentOf(request);
    const page = await listMyOrders(db, viewer.id, request.query as MyOrdersQuery);
    privateCache(reply);
    return toWire(page);
  });

  // `POST /orders`: fecha a cesta, congela preços e cria o checkout (ou conclui em total zero).
  // `Idempotency-Key` repete a primeira resposta por 24 h sem segundo checkout nem segunda tarefa.
  app.operation(
    'createOrder',
    async (request, reply) => {
      const viewer = studentOf(request);
      const checkout = await createOrder(db, {
        userId: viewer.id,
        provider,
        currency: config.currency,
        returnUrls: (orderId) => orderReturnUrls(config.classroomUrl, orderId),
        orderPendingMinutes: config.payment.orderPendingMinutes,
        idempotencyKey: headerOf(request, 'idempotency-key') ?? null,
      });
      reply.status(201);
      return toWire(cleanOrderCheckout(checkout));
    },
    { noStore: true },
  );

  // `GET /orders/{id}`: detalhe do pedido do próprio aluno (`no-store`: traz documento fiscal).
  app.operation(
    'getMyOrder',
    async (request) => {
      const viewer = studentOf(request);
      const { id } = paramsOf<{ id: string }>(request);
      return toWire(cleanOrderDetail(await getMyOrder(db, viewer.id, id)));
    },
    { noStore: true },
  );

  // `POST /orders/{id}/cancel`: cancela pedido `pending` do próprio aluno e pede o cancelamento do
  // checkout ao provedor quando há identificador gravado.
  app.operation(
    'cancelMyOrder',
    async (request) => {
      const viewer = studentOf(request);
      const { id } = paramsOf<{ id: string }>(request);
      const detail = await cancelMyOrder(db, viewer.id, id);
      const row = await db
        .selectFrom('orders')
        .select('providerCheckoutId')
        .where('id', '=', detail.id)
        .executeTakeFirst();
      if (row?.providerCheckoutId) {
        try {
          await ctx.paymentProvider().cancelCheckout(row.providerCheckoutId);
        } catch (error) {
          request.log.warn(
            { err: error, order_id: detail.id },
            'Falha ao cancelar checkout no provedor',
          );
        }
      }
      return toWire(cleanOrderDetail(detail));
    },
    { noStore: true },
  );
}
