import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useApi } from '../api/client';
import { useSession } from '../session/session';

/*
 * Dados de vendas do aluno (spec 011): cesta, dados do comprador, criação do pedido, pedidos e
 * cancelamento. Tudo pelo cliente gerado do contrato da classroom-api; nenhuma URL escrita à mão.
 * Enquanto as rotas não existem na API, as telas usam este mesmo caminho e os testes simulam o
 * `fetch`: trocar o mock pela API pronta não muda o site.
 */

export type Cart = ClassroomSchemas['Cart'];
export type CartApiItem = ClassroomSchemas['CartItem'];
export type CartCoupon = ClassroomSchemas['CartCoupon'];
export type CartItemWarning = ClassroomSchemas['CartItemWarning'];
export type CartItemUnsellableReason = ClassroomSchemas['CartItemUnsellableReason'];
export type Billing = ClassroomSchemas['Billing'];
export type TaxIdType = ClassroomSchemas['TaxIdType'];
export type OrderStatus = ClassroomSchemas['OrderStatus'];
export type MyOrderPage = ClassroomSchemas['MyOrderPage'];
export type MyOrderSummary = ClassroomSchemas['MyOrderSummary'];
export type MyOrderDetail = ClassroomSchemas['MyOrderDetail'];
export type OrderCheckout = ClassroomSchemas['OrderCheckout'];
export type PaymentMethod = ClassroomSchemas['PaymentMethod'];
export type PaymentProviderName = ClassroomSchemas['PaymentProviderName'];

/** Pedidos por página em "Minhas compras"; múltiplo dos cartões da grade. */
export const ORDERS_PAGE_SIZE = 20;
/** Enquanto o pedido aguarda pagamento, a página consulta o estado de novo (spec 011). */
export const ORDER_POLL_MS = 5_000;

const salesPrefix = (userId: string | null) => ['sales', userId] as const;
export const cartKey = (userId: string | null) => [...salesPrefix(userId), 'cart'] as const;
export const billingKey = (userId: string | null) => [...salesPrefix(userId), 'billing'] as const;
export const ordersKey = (userId: string | null, status: OrderStatus | 'all') =>
  [...salesPrefix(userId), 'orders', status] as const;
export const orderKey = (userId: string | null, id: string) =>
  [...salesPrefix(userId), 'order', id] as const;

/**
 * Intervalo de nova consulta do pedido: enquanto `pending`, o retorno do pagamento acompanha o
 * estado; fora dele, não há mais o que esperar. O contrato da classroom-api não tem evento SSE
 * de pedido — quando tiver, a invalidação entra no lugar da consulta periódica.
 */
export function orderPollInterval(status: OrderStatus | undefined): number | false {
  return status === 'pending' ? ORDER_POLL_MS : false;
}

/** Cesta aberta do aluno (`GET /api/v1/cart`). */
export function useCart() {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: cartKey(userId),
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<Cart> => {
      const { data } = await api.GET('/api/v1/cart', { signal });
      if (!data) throw new Error('GET /api/v1/cart respondeu sem corpo');
      return data;
    },
  });
}

/** Dados de comprador guardados (`GET /api/v1/me/billing`). */
export function useBilling() {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: billingKey(userId),
    enabled: session !== null,
    retry: false,
    queryFn: async ({ signal }): Promise<Billing> => {
      const { data } = await api.GET('/api/v1/me/billing', { signal });
      if (!data) throw new Error('GET /api/v1/me/billing respondeu sem corpo');
      return data;
    },
  });
}

/** Acrescenta um produto à cesta (`POST /api/v1/cart/items`) e guarda a cesta devolvida. */
export function useAddCartItem() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (input: {
      productType: ClassroomSchemas['ProductType'];
      productId: string;
    }): Promise<Cart> => {
      const { data } = await api.POST('/api/v1/cart/items', { body: input });
      if (!data) throw new Error('POST /api/v1/cart/items respondeu sem corpo');
      return data;
    },
    onSuccess: (cart) => client.setQueryData(cartKey(userId), cart),
    onError: () => client.invalidateQueries({ queryKey: cartKey(userId) }),
  });
}

/** Remove um item da cesta (`DELETE /api/v1/cart/items/{id}`). */
export function useRemoveCartItem() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.DELETE('/api/v1/cart/items/{id}', { params: { path: { id } } });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: cartKey(userId) }),
  });
}

/** Aplica um cupom (`PUT /api/v1/cart/coupon`); cupom recusado não altera a cesta. */
export function useSetCartCoupon() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (code: string): Promise<Cart> => {
      const { data } = await api.PUT('/api/v1/cart/coupon', { body: { code } });
      if (!data) throw new Error('PUT /api/v1/cart/coupon respondeu sem corpo');
      return data;
    },
    onSuccess: (cart) => client.setQueryData(cartKey(userId), cart),
  });
}

/** Tira o cupom da cesta (`DELETE /api/v1/cart/coupon`). */
export function useClearCartCoupon() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (): Promise<Cart> => {
      const { data } = await api.DELETE('/api/v1/cart/coupon');
      if (!data) throw new Error('DELETE /api/v1/cart/coupon respondeu sem corpo');
      return data;
    },
    onSuccess: (cart) => client.setQueryData(cartKey(userId), cart),
  });
}

export interface BillingInput {
  fullName: string;
  taxIdType: TaxIdType;
  taxId: string;
}

/** Grava os dados de comprador (`PUT /api/v1/me/billing`). */
export function useSaveBilling() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (input: BillingInput): Promise<Billing> => {
      const { data } = await api.PUT('/api/v1/me/billing', { body: input });
      if (!data) throw new Error('PUT /api/v1/me/billing respondeu sem corpo');
      return data;
    },
    onSuccess: (billing) => client.setQueryData(billingKey(userId), billing),
  });
}

/**
 * Fecha a cesta (`POST /api/v1/orders`). A `Idempotency-Key` é a mesma enquanto a tentativa
 * estiver em tela: repetir o clique devolve o primeiro pedido em vez de criar outro. A cesta e a
 * lista de pedidos são atualizadas na resposta; no erro, a cesta é relida, porque o `409`
 * `cart_invalid` e o `503` do provedor podem tê-la restaurado ou marcado.
 */
export function useCreateOrder() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (idempotencyKey: string): Promise<OrderCheckout> => {
      const { data } = await api.POST('/api/v1/orders', {
        params: { header: { 'Idempotency-Key': idempotencyKey } },
      });
      if (!data) throw new Error('POST /api/v1/orders respondeu sem corpo');
      return data;
    },
    onSuccess: (checkout) => {
      void client.invalidateQueries({ queryKey: cartKey(userId) });
      void client.invalidateQueries({ queryKey: [...salesPrefix(userId), 'orders'] });
      client.setQueryData(orderKey(userId, checkout.order.id), checkout.order);
    },
    onError: () => client.invalidateQueries({ queryKey: cartKey(userId) }),
  });
}

/** Pedidos do aluno (`GET /api/v1/orders`), do mais recente ao mais antigo; filtro por estado. */
export function useMyOrders(status: OrderStatus | 'all') {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useInfiniteQuery({
    queryKey: ordersKey(userId, status),
    enabled: session !== null,
    queryFn: async ({ pageParam, signal }): Promise<MyOrderPage> => {
      const { data } = await api.GET('/api/v1/orders', {
        params: {
          query: {
            limit: ORDERS_PAGE_SIZE,
            ...(status === 'all' ? {} : { status }),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/orders respondeu sem corpo');
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** Um pedido do aluno (`GET /api/v1/orders/{id}`), acompanhado enquanto `pending`. */
export function useMyOrder(id: string) {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: orderKey(userId, id),
    enabled: session !== null && id !== '',
    queryFn: async ({ signal }): Promise<MyOrderDetail> => {
      const { data } = await api.GET('/api/v1/orders/{id}', {
        params: { path: { id } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/orders/{id} respondeu sem corpo');
      return data;
    },
    refetchInterval: (query) => orderPollInterval(query.state.data?.status),
  });
}

/** Cancela um pedido `pending` (`POST /api/v1/orders/{id}/cancel`). */
export function useCancelOrder(id: string) {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (): Promise<MyOrderDetail> => {
      const { data } = await api.POST('/api/v1/orders/{id}/cancel', {
        params: { path: { id } },
      });
      if (!data) throw new Error('POST /api/v1/orders/{id}/cancel respondeu sem corpo');
      return data;
    },
    onSuccess: (order) => {
      client.setQueryData(orderKey(userId, id), order);
      void client.invalidateQueries({ queryKey: [...salesPrefix(userId), 'orders'] });
    },
  });
}

/** `true` quando o erro é o `404 not_found` de um pedido que não é do aluno. */
export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}
