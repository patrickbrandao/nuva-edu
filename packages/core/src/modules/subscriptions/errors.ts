import {
  businessRule,
  conflict,
  DomainError,
  type FieldError,
  notFound,
  permissionDenied,
  validationFailed,
} from '../../errors/domain-error.ts';

// Erros das assinaturas (spec 012, "Casos de erro"). O `code` é estável e é o que a API usa para
// escolher a mensagem; nenhuma mensagem revela dado de outro aluno.

export function planNotFound(): DomainError {
  return notFound('Plano não encontrado.');
}

/** `404` da assinatura ou da cobrança consultada/reembolsada. */
export function subscriptionNotFound(): DomainError {
  return notFound('Assinatura não encontrada.');
}

export function subscriptionPaymentNotFound(): DomainError {
  return notFound('Cobrança não encontrada.');
}

export function refundNotFound(): DomainError {
  return notFound('Reembolso não encontrado.');
}

/** `409` de assinar de novo o mesmo plano (spec 012, "Assinar"). */
export function subscriptionAlreadyActive(): DomainError {
  return conflict('subscription_already_exists', 'Você já assina este plano.');
}

/** `409` de cancelar assinatura em estado que não cancela (paga, pendente, encerrada). */
export function subscriptionNotCancelable(
  detail = 'Esta assinatura não pode mais ser cancelada.',
): DomainError {
  return conflict('subscription_not_cancelable', detail);
}

/**
 * `422` de regra do plano: itens com `includes_all`, `includes_private` sem `includes_all`
 * (spec 012, "Planos"). `errors` aponta o campo do corpo que a regra recusou.
 */
export function planRule(detail: string, errors?: readonly FieldError[]): DomainError {
  return new DomainError({
    code: 'plan_invalid',
    status: 422,
    title: 'Regra de negócio não atendida',
    detail,
    errors,
  });
}

/** `422` da lista de itens recusada (item repetido, item inexistente, lista grande demais). */
export function planInvalidItems(detail = 'A lista de itens do plano é inválida.'): DomainError {
  return businessRule('plan_item_invalid', detail);
}

export function planSlugTaken(): DomainError {
  return conflict('plan_slug_taken', 'Já existe um plano com este slug.');
}

/** `409` do grupo que já tem um plano da mesma periodicidade (restrição da 0015). */
export function planGroupIntervalTaken(): DomainError {
  return conflict('plan_group_conflict', 'Já existe um plano deste grupo com esta periodicidade.');
}

/** `409` de excluir plano com assinaturas; a spec manda desativar (spec 012, "Planos"). */
export function planHasSubscriptions(): DomainError {
  return conflict('plan_has_subscriptions', 'Plano com assinaturas só pode ser desativado.');
}

/** `422` do cupom que não vale para assinatura ou está fora da validade. */
export function subscriptionCouponInvalid(): DomainError {
  return businessRule('coupon_invalid', 'O cupom não é válido para esta assinatura.');
}

/** `422` do cupom que não aceita assinaturas (`applies_to`). */
export function couponNotForSubscriptions(): DomainError {
  return businessRule('coupon_not_for_subscriptions', 'Este cupom não vale para assinaturas.');
}

/** `409` do reembolso de cobrança que não está paga e não reembolsada. */
export function paymentNotRefundable(
  detail = 'Esta cobrança não pode ser reembolsada.',
): DomainError {
  return conflict('payment_not_refundable', detail);
}

/** `403` da ação administrativa de assinatura/plano. */
export function subscriptionPermissionDenied(
  detail = 'Sem permissão para esta operação de assinatura.',
): DomainError {
  return permissionDenied(detail);
}

/** `400` da entrada inválida do plano, com os campos recusados. */
export function planValidationFailed(errors: readonly FieldError[]): DomainError {
  return validationFailed(errors);
}
