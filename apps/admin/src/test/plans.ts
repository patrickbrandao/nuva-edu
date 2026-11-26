import type { AdminSchemas } from '@nuva-edu/api-client/admin';

export const PLAN_ID = '0193a5b2-0000-7000-8000-0000000000e1';
export const PLAN_COURSE_ID = '0193a5b2-0000-7000-8000-0000000000e2';
export const PLAN_EBOOK_ID = '0193a5b2-0000-7000-8000-0000000000e3';

/** Um plano do contrato, como a API devolve, com o que a tela lista e edita. */
export function plan(overrides: Partial<AdminSchemas['Plan']> = {}): AdminSchemas['Plan'] {
  return {
    id: PLAN_ID,
    slug: 'curso-de-ouro-mensal',
    groupKey: 'curso-de-ouro',
    title: 'Curso de Ouro',
    description: 'Acesso completo ao Curso de Ouro enquanto a assinatura estiver ativa.',
    interval: 'month',
    priceCents: 9700,
    includesAll: false,
    includesPrivate: false,
    active: true,
    position: 0,
    providerPlanId: 'mp-plan-1',
    subscriptionCount: 0,
    items: [
      { productType: 'course', productId: PLAN_COURSE_ID, title: 'Curso de Ouro' },
      { productType: 'ebook', productId: PLAN_EBOOK_ID, title: 'Ebook de Ouro' },
    ],
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-02T12:00:00Z',
    ...overrides,
  };
}

/** Página de planos por cursor. */
export function planPage(
  items: AdminSchemas['Plan'][] = [plan()],
  nextCursor: string | null = null,
): AdminSchemas['PlanPage'] {
  return { items, nextCursor };
}
