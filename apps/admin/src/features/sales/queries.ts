import type { AdminClient, AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../../api/client';

/*
 * Vendas vistas pelo admin (spec 011): pedidos com filtros e totais, detalhe do pedido,
 * reembolso, cupons e a exportação em CSV. Tudo pelo cliente gerado do contrato da admin-api;
 * nenhuma URL escrita à mão. Enquanto as rotas não existem na API, as telas usam este mesmo
 * caminho e os testes simulam o `fetch`: trocar o mock pela API pronta não muda o site.
 */

export type OrderStatus = AdminSchemas['OrderStatus'];
export type OrderSummary = AdminSchemas['OrderSummary'];
export type OrderSummaryPage = AdminSchemas['OrderSummaryPage'];
export type OrderDetail = AdminSchemas['OrderDetail'];
export type OrderItem = AdminSchemas['OrderItem'];
export type OrderTotals = AdminSchemas['OrderTotals'];
export type PaymentMethod = AdminSchemas['PaymentMethod'];
export type PaymentProviderName = AdminSchemas['PaymentProviderName'];
export type Refund = AdminSchemas['Refund'];
export type RefundItem = AdminSchemas['RefundItem'];
export type RefundItemInput = AdminSchemas['RefundItemInput'];
export type RefundStatus = AdminSchemas['RefundStatus'];
export type Payment = AdminSchemas['Payment'];
export type Coupon = AdminSchemas['Coupon'];
export type CouponInput = AdminSchemas['CouponInput'];
export type CouponKind = AdminSchemas['CouponKind'];
export type CouponAppliesTo = AdminSchemas['CouponAppliesTo'];
export type CouponProduct = AdminSchemas['CouponProduct'];
export type CouponProductInput = AdminSchemas['CouponProductInput'];
export type ProductType = AdminSchemas['ProductType'];

export type OrdersQuery = NonNullable<AdminOperations['listOrders']['parameters']['query']>;
export type ExportOrdersQuery = NonNullable<
  AdminOperations['exportOrdersCsv']['parameters']['query']
>;
export type CouponsQuery = NonNullable<AdminOperations['listCoupons']['parameters']['query']>;

export const ORDERS_PATH = '/pedidos';
export const EXPORT_PATH = '/pedidos/exportar';
export const COUPONS_PATH = '/cupons';

export const ORDERS_PAGE_SIZE = 25;
export const COUPONS_PAGE_SIZE = 25;

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'draft',
  'pending',
  'paid',
  'partially_refunded',
  'refunded',
  'canceled',
  'expired',
  'chargeback',
];
export const COUPON_KINDS: readonly CouponKind[] = ['percent', 'fixed'];
export const COUPON_APPLIES_TO: readonly CouponAppliesTo[] = ['orders', 'subscriptions', 'both'];
export const PRODUCT_TYPES: readonly ProductType[] = ['course', 'ebook', 'bundle'];

/** Limites do formulário de cupom, iguais aos do contrato (spec 011, "Cupons"). */
export const COUPON_CODE_MIN = 3;
export const COUPON_CODE_MAX = 40;
export const COUPON_CODE_PATTERN = /^[A-Za-z0-9-]+$/;
/** Limite do motivo do reembolso no formulário (a API não impõe prazo nem tamanho). */
export const REFUND_REASON_MAX = 500;
/** Enquanto um reembolso está `requested`, o detalhe do pedido consulta o estado de novo. */
export const ORDER_POLL_MS = 5_000;
/** Pedido `pending` também é acompanhado: o pagamento pode ser confirmado enquanto a tela está aberta. */
const POLLED_ORDER_STATUSES: readonly OrderStatus[] = ['pending'];

export function orderPath(id: string): string {
  return `${ORDERS_PATH}/${encodeURIComponent(id)}`;
}

export const salesKeys = {
  orders: () => ['sales', 'orders'] as const,
  ordersList: (query: Omit<OrdersQuery, 'cursor'>) => ['sales', 'orders', 'list', query] as const,
  order: (id: string) => ['sales', 'orders', 'detail', id] as const,
  coupons: () => ['sales', 'coupons'] as const,
  couponsList: (query: Omit<CouponsQuery, 'cursor'>) =>
    ['sales', 'coupons', 'list', query] as const,
};

/**
 * Intervalo de nova consulta do pedido: `pending` e reembolso em execução mudam sozinhos (o
 * worker conclui o estorno depois); nos demais estados não há o que esperar. O contrato não tem
 * evento SSE de pedido — quando tiver, a invalidação entra no lugar da consulta periódica.
 */
export function orderPollInterval(order: OrderDetail | undefined): number | false {
  if (!order) return false;
  const waiting = POLLED_ORDER_STATUSES.includes(order.status);
  const refunding = order.refunds.some((refund) => refund.status === 'requested');
  return waiting || refunding ? ORDER_POLL_MS : false;
}

/** Lista de pedidos por cursor (`GET /api/v1/orders`), com os totais do filtro. */
export function useOrdersList(query: Omit<OrdersQuery, 'cursor' | 'limit'>, enabled = true) {
  const api = useApi();
  const full = { ...query, limit: ORDERS_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: salesKeys.ordersList(full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/orders', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/orders respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Um pedido completo (`GET /api/v1/orders/{id}`). */
export function useOrder(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: salesKeys.order(id),
    queryFn: async ({ signal }): Promise<OrderDetail> => {
      const { data } = await api.GET('/api/v1/orders/{id}', { params: { path: { id } }, signal });
      if (!data) throw new Error('GET /api/v1/orders/{id} respondeu sem corpo');
      return data;
    },
    refetchInterval: (query) => orderPollInterval(query.state.data),
  });
}

/** Lista de cupons por cursor (`GET /api/v1/coupons`, `coupon.manage`). */
export function useCouponsList(query: Omit<CouponsQuery, 'cursor' | 'limit'>, enabled = true) {
  const api = useApi();
  const full = { ...query, limit: COUPONS_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: salesKeys.couponsList(full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/coupons', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/coupons respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Pedido de reembolso, do pedido inteiro ou de itens escolhidos (`POST /orders/{id}/refunds`). */
export async function requestOrderRefund(
  api: AdminClient,
  input: {
    orderId: string;
    reason: string;
    items?: RefundItemInput[] | null;
    idempotencyKey: string;
  },
): Promise<Refund> {
  const { data } = await api.POST('/api/v1/orders/{id}/refunds', {
    params: { path: { id: input.orderId }, header: { 'Idempotency-Key': input.idempotencyKey } },
    body: { reason: input.reason, items: input.items ?? null },
  });
  if (!data) throw new Error('POST /api/v1/orders/{id}/refunds respondeu sem corpo');
  return data;
}

/** Repete o estorno de um reembolso `failed` (`POST /refunds/{id}/retry`, `order.refund`). */
export async function retryRefund(api: AdminClient, refundId: string): Promise<Refund> {
  const { data } = await api.POST('/api/v1/refunds/{id}/retry', {
    params: { path: { id: refundId } },
  });
  if (!data) throw new Error('POST /api/v1/refunds/{id}/retry respondeu sem corpo');
  return data;
}

/** Cupom novo (`POST /api/v1/coupons`, `coupon.manage`). */
export async function createCoupon(api: AdminClient, body: CouponInput): Promise<Coupon> {
  const { data } = await api.POST('/api/v1/coupons', { body });
  if (!data) throw new Error('POST /api/v1/coupons respondeu sem corpo');
  return data;
}

/** Edição parcial de um cupom (`PATCH /api/v1/coupons/{id}`); desativar é `active: false`. */
export async function updateCoupon(
  api: AdminClient,
  id: string,
  body: CouponUpdate,
): Promise<Coupon> {
  const { data } = await api.PATCH('/api/v1/coupons/{id}', { params: { path: { id } }, body });
  if (!data) throw new Error('PATCH /api/v1/coupons/{id} respondeu sem corpo');
  return data;
}

export type CouponUpdate = AdminSchemas['CouponUpdate'];

/**
 * CSV de vendas (`GET /orders/export.csv`, só `sales.export`). A resposta chega em fluxo
 * contínuo, sem `Content-Length`: `parseAs: 'text'` é obrigatório, senão o cliente tentaria
 * interpretar o arquivo como JSON.
 */
export async function fetchOrdersCsv(
  api: AdminClient,
  query: ExportOrdersQuery,
  signal?: AbortSignal,
): Promise<string> {
  const { data } = await api.GET('/api/v1/orders/export.csv', {
    params: { query },
    parseAs: 'text',
    ...(signal ? { signal } : {}),
  });
  if (data === undefined) throw new Error('GET /api/v1/orders/export.csv respondeu sem corpo');
  return data;
}

/** Nome do arquivo baixado; a data é a do dia do download. */
export function csvFileName(now: Date = new Date()): string {
  return `vendas-${now.toISOString().slice(0, 10)}.csv`;
}

/** Marca o reembolso como possível e o valor ainda reembolsável do item, em centavos. */
export function refundableCents(item: OrderItem): number {
  return Math.max(0, item.paidCents - item.refundedCents);
}

/** Pedido que aceita reembolso (`paid` ou `partially_refunded`, spec 011). */
export function isRefundable(order: OrderDetail): boolean {
  return order.status === 'paid' || order.status === 'partially_refunded';
}

/** Chave de idempotência do pedido de reembolso: a repetição devolve o primeiro por 24 h. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
