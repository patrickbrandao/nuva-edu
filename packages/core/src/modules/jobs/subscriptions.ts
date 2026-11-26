import type { Database } from '../../db/database.ts';
import { enqueue } from './queue.ts';
import type { JobOf } from './registry.ts';

// Enfileiramento das tarefas de planos e assinaturas (spec 005, "Tarefas sob demanda";
// spec 012). O reembolso de cobrança recorrente reaproveita `refund.execute` e a chave
// `refundExecuteKey` de `jobs/sales.ts`; a leitura e o estado da assinatura são do módulo de
// assinaturas. Ficam aqui porque quem muda o plano (admin) e quem reconcilia (worker) só passam
// identificadores.

/** Chave de idempotência do recálculo de um plano: uma tarefa ativa por plano. */
export function planRecalculationKey(planId: string): string {
  return `entitlement.recompute:plan:${planId}`;
}

/**
 * Recalcula as assinaturas do plano quando a composição muda (`plan_items`, `includes_all`,
 * `includes_private`; spec 012, "Planos 'tudo, inclusive futuros'"). Repetir a mudança com uma
 * tarefa ativa não cria a segunda: a próxima execução já lê o estado atual.
 */
export function enqueuePlanRecalculation(
  db: Database,
  planId: string,
): Promise<JobOf<'entitlement.recompute'> | null> {
  return enqueue(
    db,
    'entitlement.recompute',
    { productType: 'plan', productId: planId },
    { uniqueKey: planRecalculationKey(planId) },
  );
}
