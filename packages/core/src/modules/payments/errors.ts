import { businessRule, DomainError, notFound, unavailable } from '../../errors/domain-error.ts';

/** Códigos estáveis para a API e o worker, sem mensagens ou respostas do provedor. */
export const PAYMENT_ERROR_CODES = {
  notFound: 'payment_provider_not_found',
  unavailable: 'payment_provider_unavailable',
  invalidSignature: 'payment_webhook_invalid_signature',
  invalidWebhook: 'payment_webhook_invalid',
  invalidRequest: 'payment_provider_invalid_request',
  invalidTransition: 'payment_provider_invalid_transition',
} as const;

export function paymentNotFound(detail = 'Recurso não encontrado no provedor de pagamento.') {
  return notFound(detail);
}

export function paymentUnavailable(cause?: unknown): DomainError {
  return unavailable(
    PAYMENT_ERROR_CODES.unavailable,
    'pagamento indisponível, tente em instantes',
    cause,
  );
}

/** Erro 401 específico do webhook, reconhecido pelo `isDomainError` e `toProblem` existentes. */
export class PaymentWebhookSignatureError extends DomainError {
  constructor() {
    // Nunca inclui corpo, cabeçalho, assinatura ou segredo do webhook.
    super({
      code: PAYMENT_ERROR_CODES.invalidSignature,
      status: 401,
      title: 'Assinatura inválida',
      detail: 'A assinatura do aviso de pagamento não é válida.',
    });
    this.name = 'PaymentWebhookSignatureError';
  }
}

export function invalidWebhookSignature(): PaymentWebhookSignatureError {
  return new PaymentWebhookSignatureError();
}

export function invalidPaymentWebhook(detail = 'Aviso de pagamento fora do formato esperado.') {
  return businessRule(PAYMENT_ERROR_CODES.invalidWebhook, detail);
}

export function invalidPaymentRequest(detail: string): DomainError {
  return businessRule(PAYMENT_ERROR_CODES.invalidRequest, detail);
}

export function invalidPaymentTransition(detail: string): DomainError {
  return businessRule(PAYMENT_ERROR_CODES.invalidTransition, detail);
}

/**
 * `422` do pagamento aprovado cujo valor ou moeda não bate com o total congelado do pedido. O
 * worker usa o `code` para marcar o evento como `failed` com motivo `amount_mismatch` (spec 013,
 * "Falhas") e não libera acesso.
 */
export function paymentAmountMismatch(
  detail = 'O valor pago não corresponde ao total do pedido.',
): DomainError {
  return businessRule('payment_amount_mismatch', detail);
}
