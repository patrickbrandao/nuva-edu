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
 * Planos e assinaturas do aluno (spec 012): vitrine pública, adesão em checkout próprio,
 * assinaturas do aluno, detalhe com cobranças e cancelamento. Tudo pelo cliente gerado do
 * contrato da classroom-api; nenhuma URL escrita à mão. Enquanto as rotas não existem na API,
 * as telas usam este mesmo caminho e os testes simulam o `fetch`: trocar o mock pela API pronta
 * não muda o site.
 */

export type PlanCatalog = ClassroomSchemas['PlanCatalog'];
export type PlanGroup = ClassroomSchemas['PlanGroup'];
export type PublicPlan = ClassroomSchemas['PublicPlan'];
export type PlanInterval = ClassroomSchemas['PlanInterval'];
export type SubscriptionStatus = ClassroomSchemas['SubscriptionStatus'];
export type MySubscriptionSummary = ClassroomSchemas['MySubscriptionSummary'];
export type MySubscriptionPage = ClassroomSchemas['MySubscriptionPage'];
export type MySubscriptionDetail = ClassroomSchemas['MySubscriptionDetail'];
export type SubscriptionCharge = ClassroomSchemas['SubscriptionCharge'];
export type SubscriptionCheckout = ClassroomSchemas['SubscriptionCheckout'];

/** Assinaturas por página em "Minha assinatura"; múltiplo dos cartões da lista. */
export const SUBSCRIPTIONS_PAGE_SIZE = 20;

const subscriptionsPrefix = (userId: string | null) => ['subscriptions', userId] as const;

/** A vitrine de planos é a mesma para todo mundo: a chave não depende da sessão. */
export const planCatalogKey = () => ['subscriptions', 'plans'] as const;
export const mySubscriptionsKey = (userId: string | null, status: SubscriptionStatus | 'all') =>
  [...subscriptionsPrefix(userId), 'list', status] as const;
export const mySubscriptionKey = (userId: string | null, id: string) =>
  [...subscriptionsPrefix(userId), 'detail', id] as const;

/**
 * Estados em que o aluno cancela a própria assinatura (spec 012, "Ciclo de vida"): `pending`
 * vira `expired` e libera assinar o mesmo plano de novo; `active` e `past_due` viram
 * `canceling`, com acesso até o fim do período pago. `suspended` não é cancelável pelo aluno.
 */
const CANCELABLE: readonly SubscriptionStatus[] = ['pending', 'active', 'past_due'];

export function canCancelSubscription(status: SubscriptionStatus): boolean {
  return CANCELABLE.includes(status);
}

/**
 * Estados que impedem assinar o mesmo plano de novo (`409 subscription_already_exists`).
 * `canceling` fica de fora: a spec manda assinar outra vez para desfazer o cancelamento.
 */
const BLOCKING: readonly SubscriptionStatus[] = ['pending', 'active', 'past_due', 'suspended'];

export function blocksNewSubscription(status: SubscriptionStatus): boolean {
  return BLOCKING.includes(status);
}

/** Vitrine de planos ativos agrupados por conteúdo (`GET /api/v1/plans`, sem login). */
export function usePlanCatalog() {
  const api = useApi();
  return useQuery({
    queryKey: planCatalogKey(),
    queryFn: async ({ signal }): Promise<PlanCatalog> => {
      const { data } = await api.GET('/api/v1/plans', { signal });
      if (!data) throw new Error('GET /api/v1/plans respondeu sem corpo');
      return data;
    },
  });
}

/** Assinaturas do aluno (`GET /api/v1/me/subscriptions`), da mais nova para a mais antiga. */
export function useMySubscriptions(status: SubscriptionStatus | 'all') {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useInfiniteQuery({
    queryKey: mySubscriptionsKey(userId, status),
    enabled: session !== null,
    queryFn: async ({ pageParam, signal }): Promise<MySubscriptionPage> => {
      const { data } = await api.GET('/api/v1/me/subscriptions', {
        params: {
          query: {
            limit: SUBSCRIPTIONS_PAGE_SIZE,
            ...(status === 'all' ? {} : { status }),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/me/subscriptions respondeu sem corpo');
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** Uma assinatura com o plano, o período, a carência e o histórico de cobranças. */
export function useMySubscription(id: string) {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: mySubscriptionKey(userId, id),
    enabled: session !== null && id !== '',
    queryFn: async ({ signal }): Promise<MySubscriptionDetail> => {
      const { data } = await api.GET('/api/v1/me/subscriptions/{id}', {
        params: { path: { id } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/me/subscriptions/{id} respondeu sem corpo');
      return data;
    },
  });
}

export interface NewSubscription {
  planId: string;
  couponCode: string | null;
}

/**
 * Assina um plano (`POST /api/v1/subscriptions`). A resposta traz a assinatura `pending` e a
 * página do provedor para autorizar a recorrência e pagar a primeira cobrança. Recusas
 * tratadas pela tela: `billing_required`, `subscription_already_exists`, `coupon_invalid`,
 * `email_not_verified`, `not_found` (plano inativo) e `payment_provider_unavailable`.
 */
export function useCreateSubscription() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (input: NewSubscription): Promise<SubscriptionCheckout> => {
      const { data } = await api.POST('/api/v1/subscriptions', {
        body: {
          planId: input.planId,
          ...(input.couponCode ? { couponCode: input.couponCode } : {}),
        },
      });
      if (!data) throw new Error('POST /api/v1/subscriptions respondeu sem corpo');
      return data;
    },
    onSuccess: (checkout) => {
      client.setQueryData(
        mySubscriptionKey(userId, checkout.subscription.id),
        checkout.subscription,
      );
      void client.invalidateQueries({ queryKey: [...subscriptionsPrefix(userId), 'list'] });
    },
  });
}

/**
 * Cancela a própria assinatura (`POST /api/v1/me/subscriptions/{id}/cancel`). Devolve a
 * assinatura já no estado novo (`expired` quando era `pending`; `canceling` quando era `active`
 * ou `past_due`). No erro, detalhe e lista são relidos: o `409` costuma significar que outro
 * caminho já mudou o estado.
 */
export function useCancelSubscription(id: string) {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (): Promise<MySubscriptionDetail> => {
      const { data } = await api.POST('/api/v1/me/subscriptions/{id}/cancel', {
        params: { path: { id } },
      });
      if (!data) throw new Error('POST /api/v1/me/subscriptions/{id}/cancel respondeu sem corpo');
      return data;
    },
    onSuccess: (subscription) => {
      client.setQueryData(mySubscriptionKey(userId, id), subscription);
      void client.invalidateQueries({ queryKey: [...subscriptionsPrefix(userId), 'list'] });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: mySubscriptionKey(userId, id) });
      void client.invalidateQueries({ queryKey: [...subscriptionsPrefix(userId), 'list'] });
    },
  });
}

/** `true` quando o erro é o `404 not_found` de uma assinatura que não é do aluno. */
export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}
