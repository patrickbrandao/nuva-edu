import type { AdminClient, AdminSchemas } from '@nuva-edu/api-client/admin';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../../api/client';

/*
 * Pagamentos vistos pelo admin (spec 013): o estado da integração (modo de teste, provedor e
 * última reconciliação), que aparece em Configurações, e os avisos de webhook com falha, que
 * aparecem em Operação (spec 033). As cobranças em si são mostradas no detalhe do pedido
 * (`order.payments`, spec 011). Tudo pelo cliente gerado; nenhuma URL escrita à mão.
 */

export type PaymentSettings = AdminSchemas['PaymentSettings'];
export type WebhookEvent = AdminSchemas['WebhookEvent'];
export type WebhookEventStatus = AdminSchemas['WebhookEventStatus'];
export type WebhookEventPage = AdminSchemas['WebhookEventPage'];
export type Payment = AdminSchemas['Payment'];
export type PaymentStatus = AdminSchemas['PaymentStatus'];

export const OPERATIONS_PATH = '/operacao';
export const WEBHOOK_STATUSES = ['failed', 'rejected'] as const;
export type WebhookFilter = (typeof WEBHOOK_STATUSES)[number];

export const WEBHOOKS_PAGE_SIZE = 25;

export const paymentsKeys = {
  settings: () => ['payments', 'settings'] as const,
  webhooks: (status: WebhookFilter) => ['payments', 'webhooks', status] as const,
};

/** Estado da integração de pagamento (`GET /api/v1/settings/payments`, `settings.manage`). */
export function usePaymentSettings() {
  const api = useApi();
  return useQuery({
    queryKey: paymentsKeys.settings(),
    queryFn: async ({ signal }): Promise<PaymentSettings> => {
      const { data } = await api.GET('/api/v1/settings/payments', { signal });
      if (!data) throw new Error('GET /api/v1/settings/payments respondeu sem corpo');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Avisos de pagamento (`GET /api/v1/webhook-events`): `failed` é a fila operacional; `rejected`
 * é a trilha de segurança, só leitura (spec 013, "Webhook").
 */
export function useWebhookEvents(status: WebhookFilter, enabled = true) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: paymentsKeys.webhooks(status),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/webhook-events', {
        params: {
          query: pageParam
            ? { status, limit: WEBHOOKS_PAGE_SIZE, cursor: pageParam }
            : { status, limit: WEBHOOKS_PAGE_SIZE },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/webhook-events respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}

/** Reprocessa um aviso `failed` (`POST /api/v1/webhook-events/{id}/retry`, só admin). */
export async function retryWebhookEvent(api: AdminClient, id: string): Promise<WebhookEvent> {
  const { data } = await api.POST('/api/v1/webhook-events/{id}/retry', {
    params: { path: { id } },
  });
  if (!data) throw new Error('POST /api/v1/webhook-events/{id}/retry respondeu sem corpo');
  return data;
}

/** Só o evento `failed` aceita reprocessamento; `rejected` nunca (spec 013). */
export function isRetryable(event: WebhookEvent): boolean {
  return event.status === 'failed';
}
