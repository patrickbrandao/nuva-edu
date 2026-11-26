import {
  businessRule,
  conflict,
  DomainError,
  type FieldError,
  notFound,
  permissionDenied,
  validationFailed,
} from '../../errors/domain-error.ts';

// Erros das vendas (spec 011, "Casos de erro"; spec 012, "Casos de erro"; spec 003, "Códigos de
// erro"). O `code` é estável e o que o site usa para decidir a mensagem; o `detail` é texto para
// pessoas. Nenhuma mensagem revela se um cupom existe em outro contexto.

/** `403` do aluno com e-mail não confirmado (spec 007): não compra. */
export function emailNotVerified(): DomainError {
  return new DomainError({
    code: 'email_not_verified',
    status: 403,
    title: 'E-mail não confirmado',
    detail: 'Confirme o e-mail da conta para comprar.',
  });
}

/** `409` do produto que não é avulso pago e publicado, ou não existe mais. */
export function productNotSellable(detail = 'Este produto não está à venda.'): DomainError {
  return conflict('product_not_sellable', detail);
}

export function productAlreadyInCart(): DomainError {
  return conflict('product_already_in_cart', 'Este produto já está na cesta.');
}

export function productAlreadyOwned(): DomainError {
  return conflict('product_already_owned', 'Você já tem acesso vitalício a este produto.');
}

export function cartFull(): DomainError {
  return conflict('cart_full', 'A cesta já tem o máximo de 50 itens.');
}

export function cartEmpty(): DomainError {
  return conflict('cart_empty', 'A cesta está vazia.');
}

export function cartInvalid(
  detail = 'Há item na cesta que não pode ser comprado agora.',
): DomainError {
  return conflict('cart_invalid', detail);
}

export function billingRequired(): DomainError {
  return conflict('billing_required', 'Informe nome completo e CPF ou CNPJ antes de comprar.');
}

export function orderPendingLimit(): DomainError {
  return conflict(
    'order_pending_limit',
    'Você já tem 3 pedidos aguardando pagamento; cancele um para criar outro.',
  );
}

export function orderNotCancelable(
  detail = 'Este pedido não pode mais ser cancelado.',
): DomainError {
  return conflict('order_not_cancelable', detail);
}

export function orderNotRefundable(detail = 'Este pedido não pode ser reembolsado.'): DomainError {
  return conflict('order_not_refundable', detail);
}

export function refundExceedsPaid(
  detail = 'O valor reembolsado passa do valor pago e não reembolsado do item.',
): DomainError {
  return businessRule('refund_exceeds_paid', detail);
}

export function refundNotRetryable(): DomainError {
  return conflict('refund_not_retryable', 'Este reembolso não está em falha para repetir.');
}

/** `422` único do cupom na cesta: a mesma mensagem para inexistente, vencido, esgotado e sem item. */
export function couponInvalid(): DomainError {
  return businessRule('coupon_invalid', 'O cupom não é válido para esta cesta.');
}

/** `422` do cupom do admin: combinação de campos incoerente (spec 011, "Cupons"). */
export function couponRule(detail: string): DomainError {
  return businessRule('coupon_invalid', detail);
}

export function couponCodeTaken(): DomainError {
  return conflict('coupon_code_taken', 'Já existe um cupom com este código.');
}

export function couponNotFound(): DomainError {
  return notFound('Cupom não encontrado.');
}

/** `422` do CPF/CNPJ inválido no documento do comprador. */
export function taxIdInvalid(detail = 'CPF ou CNPJ inválido.'): DomainError {
  return businessRule('tax_id_invalid', detail);
}

/** `422` da entrada de cupom do admin, com os campos recusados. */
export function couponValidationFailed(errors: readonly FieldError[]): DomainError {
  return validationFailed(errors);
}

/** `403` de ação da equipe (cupons, pedidos), com o `code` geral do contrato. */
export function salesPermissionDenied(detail = 'Sem permissão para esta operação de vendas.') {
  return permissionDenied(detail);
}
