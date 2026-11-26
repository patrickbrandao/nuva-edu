import type { AdminClient, AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../../api/client';

/*
 * Planos de assinatura vistos pelo admin (spec 012, "Planos"): lista, criação, edição parcial,
 * ativação e a lista de itens que o plano libera. Tudo pelo cliente gerado do contrato da
 * admin-api; nenhuma URL escrita à mão. Enquanto as rotas não existem na API (tarefa 555), os
 * testes simulam o `fetch`: trocar o mock pela API pronta não muda o site.
 */

export type Plan = AdminSchemas['Plan'];
export type PlanPage = AdminSchemas['PlanPage'];
export type PlanItem = AdminSchemas['PlanItem'];
export type PlanItemInput = AdminSchemas['PlanItemInput'];
export type PlanCreate = AdminSchemas['PlanCreate'];
export type PlanUpdate = AdminSchemas['PlanUpdate'];
export type PlanInterval = AdminSchemas['PlanInterval'];
export type ProductType = AdminSchemas['ProductType'];

export type PlansQuery = NonNullable<AdminOperations['listPlans']['parameters']['query']>;

export const PLANS_PATH = '/planos';
/** Tela de criação; antes de `/planos/:id` na tabela de rotas. */
export const NEW_PLAN_PATH = '/planos/novo';
export const PLANS_PAGE_SIZE = 25;

export const PLAN_INTERVALS: readonly PlanInterval[] = ['month', 'year'];
/** Só curso, pacote e ebook liberam acesso (spec 010); o contrato recusa outro tipo. */
export const PLAN_ITEM_TYPES: readonly ProductType[] = ['course', 'ebook', 'bundle'];

/** Limites do formulário, iguais aos do contrato (`PlanCreate`). */
export const PLAN_TITLE_MAX = 160;
export const PLAN_DESCRIPTION_MAX = 20_000;
export const PLAN_ITEMS_MAX = 500;
/** Identificador legível: minúsculas, dígitos e hífens (`Slug` do contrato). */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 160;

export function planPath(id: string): string {
  return `${PLANS_PATH}/${encodeURIComponent(id)}`;
}

export const plansKeys = {
  all: () => ['plans'] as const,
  list: (query: Omit<PlansQuery, 'cursor'>) => ['plans', 'list', query] as const,
  detail: (id: string) => ['plans', 'detail', id] as const,
};

/** Lista de planos por cursor (`GET /api/v1/plans`, `plan.manage`). */
export function usePlansList(query: Omit<PlansQuery, 'cursor' | 'limit'>, enabled = true) {
  const api = useApi();
  const full = { ...query, limit: PLANS_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: plansKeys.list(full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/plans', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/plans respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Um plano com os itens e a contagem de assinaturas (`GET /api/v1/plans/{id}`). */
export function usePlan(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: plansKeys.detail(id ?? ''),
    queryFn: async ({ signal }): Promise<Plan> => {
      const { data } = await api.GET('/api/v1/plans/{id}', {
        params: { path: { id: id ?? '' } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/plans/{id} respondeu sem corpo');
      return data;
    },
    enabled: Boolean(id),
  });
}

/** Planos para um seletor: a primeira página basta, como nas opções de produto das vendas. */
export function usePlanOptions(enabled = true): Plan[] {
  const list = usePlansList({}, enabled);
  return list.data?.pages.flatMap((page) => page.items) ?? [];
}

/** Plano novo (`POST /api/v1/plans`, `plan.manage`). */
export async function createPlan(api: AdminClient, body: PlanCreate): Promise<Plan> {
  const { data } = await api.POST('/api/v1/plans', { body });
  if (!data) throw new Error('POST /api/v1/plans respondeu sem corpo');
  return data;
}

/**
 * Edição parcial (`PATCH /plans/{id}`). `slug`, `groupKey` e `interval` não mudam depois da
 * criação; desativar é `active: false` e excluir não existe.
 */
export async function updatePlan(api: AdminClient, id: string, body: PlanUpdate): Promise<Plan> {
  const { data } = await api.PATCH('/api/v1/plans/{id}', { params: { path: { id } }, body });
  if (!data) throw new Error('PATCH /api/v1/plans/{id} respondeu sem corpo');
  return data;
}

/** Substitui a lista de itens (`PUT /plans/{id}/items`); `[]` esvazia. */
export async function replacePlanItems(
  api: AdminClient,
  id: string,
  items: PlanItemInput[],
): Promise<Plan> {
  const { data } = await api.PUT('/api/v1/plans/{id}/items', {
    params: { path: { id } },
    body: { items },
  });
  if (!data) throw new Error('PUT /api/v1/plans/{id}/items respondeu sem corpo');
  return data;
}

/** `tipo:id`, a chave de uma opção de item no formulário. */
export function planItemOptionId(item: Pick<PlanItem, 'productType' | 'productId'>): string {
  return `${item.productType}:${item.productId}`;
}

/** O item do contrato a partir da opção marcada. */
export function planItemInput(option: {
  productType: ProductType;
  productId: string;
}): PlanItemInput {
  return { productType: option.productType, productId: option.productId };
}

/** Quantos itens de cada tipo o plano lista (vazio quando `includesAll`). */
export function planItemCounts(plan: Pick<Plan, 'items'>): Record<ProductType, number> {
  const counts: Record<ProductType, number> = { course: 0, ebook: 0, bundle: 0 };
  for (const item of plan.items) {
    if (item.productType in counts) counts[item.productType] += 1;
  }
  return counts;
}
