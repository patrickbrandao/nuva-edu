import { invalidPaymentRequest, paymentUnavailable } from '../errors.ts';
import { parsePaymentExternalReference } from '../references.ts';
import type {
  PaymentExternalReference,
  PaymentMethod,
  PaymentStatus,
  ProviderRefundStatus,
  SubscriptionExternalReference,
  SubscriptionStatus,
} from '../types.ts';

/** Campos do pagamento que o adaptador usa; o restante da resposta nunca é guardado. */
export interface MercadoPagoPaymentRecord {
  id?: string | number | null;
  status?: string | null;
  transaction_amount?: number | null;
  transaction_amount_refunded?: number | null;
  currency_id?: string | null;
  payment_type_id?: string | null;
  payment_method_id?: string | null;
  external_reference?: string | null;
  date_approved?: string | null;
}

export interface MercadoPagoSubscriptionRecord {
  id?: string | number | null;
  status?: string | null;
  external_reference?: string | null;
  preapproval_plan_id?: string | null;
  next_payment_date?: string | null;
  summarized?: { last_charged_date?: string | null } | null;
}

/** Converte o valor em reais do provedor para centavos inteiros, sem perder fração. */
export function toCents(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value * 100));
}

/** O provedor devolve reais; a porta trabalha em centavos inteiros. */
export function fromCents(value: number): number {
  return Math.round(value) / 100;
}

/**
 * Normaliza o estado do pagamento. Quando o provedor ainda diz `approved` mas já
 * registrou estorno, o estado local reflete o estorno (parcial ou total).
 */
export function mapPaymentStatus(
  rawStatus: string | null | undefined,
  refundedCents: number,
  amountCents: number,
): PaymentStatus {
  const status = (rawStatus ?? '').toLowerCase();
  switch (status) {
    case 'approved':
      if (refundedCents > 0) {
        return amountCents > 0 && refundedCents >= amountCents ? 'refunded' : 'partially_refunded';
      }
      return 'approved';
    case 'refunded':
      return 'refunded';
    case 'charged_back':
      return 'charged_back';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
    case 'canceled':
      return 'canceled';
    default:
      // Pendente, em análise ou estado novo: não libera acesso até a próxima leitura.
      return 'pending';
  }
}

export function mapPaymentMethod(
  paymentTypeId: string | null | undefined,
  paymentMethodId: string | null | undefined,
): PaymentMethod {
  const type = (paymentTypeId ?? '').toLowerCase();
  const method = (paymentMethodId ?? '').toLowerCase();
  if (type === 'credit_card' || type === 'debit_card' || type === 'prepaid_card') {
    return 'card';
  }
  if (type === 'pix' || method === 'pix') {
    return 'pix';
  }
  if (type === 'ticket' || method === 'bolboretodo' || method === 'boleto') {
    return 'boleto';
  }
  return 'other';
}

export function mapSubscriptionStatus(rawStatus: string | null | undefined): SubscriptionStatus {
  switch ((rawStatus ?? '').toLowerCase()) {
    case 'authorized':
      return 'authorized';
    case 'paused':
      return 'paused';
    case 'cancelled':
    case 'canceled':
      return 'canceled';
    default:
      // Pendente ou estado novo: a assinatura só vale depois de autorizada.
      return 'pending';
  }
}

export function mapRefundStatus(rawStatus: string | null | undefined): ProviderRefundStatus {
  switch ((rawStatus ?? '').toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'rejected':
    case 'failed':
    case 'cancelled':
    case 'canceled':
      return 'rejected';
    default:
      // Pendente, em processamento ou estado novo: o reembolso ainda será conciliado.
      return 'pending';
  }
}

export function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function paymentExternalReference(
  value: string | null | undefined,
): PaymentExternalReference {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidPaymentRequest('O pagamento do provedor não tem referência externa.');
  }
  return parsePaymentExternalReference(value).reference;
}

export function paymentId(value: string | number | null | undefined): string {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_payment_id' });
}

/** Traduz a resposta do provedor para a porta, sem copiar o restante do corpo. */
export function toProviderPayment(record: MercadoPagoPaymentRecord) {
  const amountCents = toCents(record.transaction_amount);
  if (amountCents <= 0) {
    throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_payment_amount' });
  }
  const refundedCents = Math.min(toCents(record.transaction_amount_refunded), amountCents);
  const rawStatus = typeof record.status === 'string' ? record.status : '';
  return {
    providerPaymentId: paymentId(record.id),
    status: mapPaymentStatus(rawStatus, refundedCents, amountCents),
    amountCents,
    refundedCents,
    currency: currencyCode(record.currency_id),
    method: mapPaymentMethod(record.payment_type_id, record.payment_method_id),
    externalReference: paymentExternalReference(record.external_reference),
    rawStatus,
    paidAt: toDate(record.date_approved),
  } as const;
}

export function toProviderSubscription(record: MercadoPagoSubscriptionRecord) {
  const planId =
    typeof record.preapproval_plan_id === 'string' && record.preapproval_plan_id.trim() !== ''
      ? record.preapproval_plan_id
      : null;
  if (planId === null) {
    throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_plan_id' });
  }
  const nextBillingAt = toDate(record.next_payment_date);
  return {
    providerSubscriptionId: paymentId(record.id),
    providerPlanId: planId,
    status: mapSubscriptionStatus(record.status),
    externalReference: subscriptionExternalReference(record.external_reference),
    currentPeriodStart: toDate(record.summarized?.last_charged_date),
    currentPeriodEnd: nextBillingAt === null ? null : new Date(nextBillingAt),
    nextBillingAt,
  } as const;
}

function subscriptionExternalReference(
  value: string | null | undefined,
): SubscriptionExternalReference {
  const reference = paymentExternalReference(value);
  if (!reference.startsWith('subscription:')) {
    throw invalidPaymentRequest('A assinatura do provedor não tem referência subscription:<uuid>.');
  }
  return reference as SubscriptionExternalReference;
}

function currencyCode(value: string | null | undefined): string {
  if (typeof value === 'string' && /^[A-Z]{3}$/.test(value)) {
    return value;
  }
  throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_currency' });
}
