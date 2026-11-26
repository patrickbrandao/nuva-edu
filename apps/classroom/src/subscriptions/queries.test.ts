import { describe, expect, it } from 'vitest';
import {
  blocksNewSubscription,
  canCancelSubscription,
  mySubscriptionKey,
  mySubscriptionsKey,
  planCatalogKey,
} from './queries';

/*
 * Regras de dados que não dependem de tela (spec 012, "Ciclo de vida"): que estados o aluno
 * pode cancelar, quais impedem assinar o mesmo plano de novo e o isolamento das consultas por
 * usuário.
 */

describe('consultas de assinaturas', () => {
  it('o aluno cancela pending, active e past_due; não cancela suspended', () => {
    for (const status of ['pending', 'active', 'past_due'] as const) {
      expect(canCancelSubscription(status)).toBe(true);
    }
    for (const status of ['suspended', 'canceling', 'ended', 'expired'] as const) {
      expect(canCancelSubscription(status)).toBe(false);
    }
  });

  it('só os estados sem desfecho impedem assinar o mesmo plano de novo', () => {
    // `pending` pode ser cancelada e volta a aceitar assinatura; `canceling` também
    expect(canCancelSubscription('pending')).toBe(true);
    for (const status of ['pending', 'active', 'past_due', 'suspended'] as const) {
      expect(blocksNewSubscription(status)).toBe(true);
    }
    for (const status of ['canceling', 'ended', 'expired'] as const) {
      expect(blocksNewSubscription(status)).toBe(false);
    }
  });

  it('separa a vitrine das consultas por usuário', () => {
    expect(planCatalogKey()).toEqual(['subscriptions', 'plans']);
    expect(mySubscriptionsKey('ana', 'active')).toEqual(['subscriptions', 'ana', 'list', 'active']);
    expect(mySubscriptionsKey('bia', 'all')).toEqual(['subscriptions', 'bia', 'list', 'all']);
    expect(mySubscriptionKey('ana', 'ass-1')).toEqual(['subscriptions', 'ana', 'detail', 'ass-1']);
    // trocar de conta não mostra a assinatura da anterior
    expect(mySubscriptionKey('ana', 'ass-1')).not.toEqual(mySubscriptionKey('bia', 'ass-1'));
  });
});
