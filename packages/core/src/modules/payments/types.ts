export const PAYMENT_PROVIDER_NAMES = ['mercadopago', 'fake'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'canceled',
  'refunded',
  'partially_refunded',
  'charged_back',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['pending', 'authorized', 'paused', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_METHODS = ['card', 'pix', 'boleto', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type OrderExternalReference = `order:${string}`;
export type SubscriptionExternalReference = `subscription:${string}`;
export type PaymentExternalReference = OrderExternalReference | SubscriptionExternalReference;

/** O núcleo nunca recebe dados de cartão: o comprador só é usado no checkout hospedado. */
export interface PaymentBuyer {
  name: string;
  email: string;
  /** CPF/CNPJ exigido por alguns meios de pagamento; nunca entra na referência externa. */
  taxId?: string | null;
}

export interface PaymentCheckoutItem {
  id: string;
  title: string;
  quantity: number;
  unitAmountCents: number;
}

export interface PaymentReturnUrls {
  success: string;
  pending: string;
  failure: string;
}

export interface CreateCheckoutInput {
  items: readonly PaymentCheckoutItem[];
  totalCents: number;
  currency: string;
  buyer: PaymentBuyer;
  returnUrls: PaymentReturnUrls;
  externalReference: OrderExternalReference;
}

export interface PaymentCheckout {
  checkoutUrl: string;
  providerCheckoutId: string;
}

export interface ProviderPayment {
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  currency: string;
  method: PaymentMethod;
  externalReference: PaymentExternalReference;
  /** Estado original, preservado para diagnóstico sem guardar a resposta inteira do provedor. */
  rawStatus: string;
  paidAt: Date | null;
}

export interface PaymentPlanPeriod {
  value: number;
  unit: 'days' | 'months' | 'years';
}

export interface EnsurePaymentPlanInput {
  title: string;
  amountCents: number;
  currency: string;
  periodicity: PaymentPlanPeriod;
}

export interface PaymentPlanReference {
  providerPlanId: string;
}

export interface CreateSubscriptionInput {
  providerPlanId: string;
  buyer: PaymentBuyer;
  /** Desconto somente na primeira cobrança; zero ou ausente significa sem desconto. */
  firstChargeDiscountCents?: number;
  returnUrls: PaymentReturnUrls;
  externalReference: SubscriptionExternalReference;
}

export interface ProviderSubscriptionCheckout {
  checkoutUrl: string;
  providerSubscriptionId: string;
}

export interface ProviderSubscription {
  providerSubscriptionId: string;
  providerPlanId: string;
  status: SubscriptionStatus;
  externalReference: SubscriptionExternalReference;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  nextBillingAt: Date | null;
}

export type ProviderRefundStatus = 'pending' | 'approved' | 'rejected';

export interface ProviderRefund {
  providerRefundId: string;
  status: ProviderRefundStatus;
  amountCents: number;
}

/** Confirmação idempotente de cancelamento no provedor. */
export interface PaymentProviderConfirmation {
  confirmed: true;
}

export type PaymentWebhookResourceType = 'payment' | 'subscription';
export type PaymentWebhookHeaders =
  | Headers
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface ParsePaymentWebhookInput {
  headers: PaymentWebhookHeaders;
  /** O corpo deve chegar sem serialização ou outro parser, para preservar a assinatura. */
  rawBody: string | Uint8Array;
}

/** Só identificadores: o consumidor consulta o estado atual e nunca confia no conteúdo do aviso. */
export interface PaymentWebhookEvent {
  provider: PaymentProviderName;
  eventId: string;
  resourceType: PaymentWebhookResourceType;
  resourceId: string;
}

/** Única porta conhecida por pedidos, assinaturas, webhooks e reconciliação (spec 013, RF-01). */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createCheckout(input: CreateCheckoutInput): Promise<PaymentCheckout>;
  getPayment(providerPaymentId: string): Promise<ProviderPayment>;
  findPaymentsByReference(reference: PaymentExternalReference): Promise<ProviderPayment[]>;
  cancelCheckout(providerCheckoutId: string): Promise<PaymentProviderConfirmation>;
  ensurePlan(input: EnsurePaymentPlanInput): Promise<PaymentPlanReference>;
  createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscriptionCheckout>;
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription>;
  cancelSubscription(providerSubscriptionId: string): Promise<PaymentProviderConfirmation>;
  /** `amountCents = null` estorna todo o saldo ainda não reembolsado. */
  refund(providerPaymentId: string, amountCents: number | null): Promise<ProviderRefund>;
  /**
   * Estado atual de um estorno já criado, para a reconciliação de reembolsos (spec 013). Não
   * cria nem repete o estorno; `pending` continua e é consultado de novo na próxima janela.
   */
  getRefundStatus(providerPaymentId: string, providerRefundId: string): Promise<ProviderRefund>;
  parseWebhook(input: ParsePaymentWebhookInput): Promise<PaymentWebhookEvent>;
}
