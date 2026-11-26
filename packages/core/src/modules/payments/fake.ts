import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  invalidPaymentRequest,
  invalidPaymentTransition,
  invalidPaymentWebhook,
  invalidWebhookSignature,
  paymentNotFound,
  paymentUnavailable,
} from './errors.ts';
import { parsePaymentExternalReference } from './references.ts';
import type {
  CreateCheckoutInput,
  CreateSubscriptionInput,
  EnsurePaymentPlanInput,
  ParsePaymentWebhookInput,
  PaymentCheckout,
  PaymentExternalReference,
  PaymentMethod,
  PaymentPlanPeriod,
  PaymentProvider,
  PaymentProviderConfirmation,
  PaymentWebhookEvent,
  PaymentWebhookHeaders,
  ProviderPayment,
  ProviderRefund,
  ProviderSubscription,
  ProviderSubscriptionCheckout,
} from './types.ts';

export const FAKE_PAYMENT_WEBHOOK_SECRET = 'fake-payment-webhook-secret';
export const FAKE_PAYMENT_CHECKOUT_URL = 'https://checkout.payment-fake.test';
export const PAYMENT_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export type FakePaymentOperation =
  | 'createCheckout'
  | 'getPayment'
  | 'findPaymentsByReference'
  | 'cancelCheckout'
  | 'ensurePlan'
  | 'createSubscription'
  | 'getSubscription'
  | 'cancelSubscription'
  | 'refund'
  | 'parseWebhook';

export interface FakePaymentProviderOptions {
  currency?: string;
  webhookSecret?: string;
  checkoutBaseUrl?: string;
  /** Instante inicial do relógio isolado. Padrão: 2026-01-01T00:00:00.000Z. */
  now?: Date | number | string;
}

export interface FakeCheckoutPaymentOptions {
  method?: PaymentMethod;
  /** Simula divergência entre o valor aprovado e o total do pedido. */
  amountCents?: number;
  currency?: string;
}

export interface FakeSubscriptionPaymentOptions extends FakeCheckoutPaymentOptions {
  outcome?: 'approved' | 'rejected' | 'pending';
}

/** O que o fake faz com os próximos reembolsos; `pending` espera a reconciliação. */
export type FakeRefundOutcome = 'approved' | 'pending';

export interface FakeWebhookOptions {
  eventId?: string;
  /** Data do carimbo assinado; padrão: o relógio do fake. */
  timestamp?: Date | number;
  /** Troca a chave para produzir uma assinatura inválida sem tocar no segredo configurado. */
  secret?: string;
  requestId?: string;
}

interface CheckoutEntry {
  paymentId: string;
  canceled: boolean;
}

interface PaymentEntry extends ProviderPayment {
  checkoutId: string | null;
  subscriptionId: string | null;
}

interface PlanEntry {
  id: string;
  input: EnsurePaymentPlanInput;
}

interface SubscriptionEntry extends ProviderSubscription {
  input: CreateSubscriptionInput;
}

interface RefundEntry extends ProviderRefund {
  paymentId: string;
}

const PERIOD_UNITS = { days: 'days', months: 'months', years: 'years' } as const;

/**
 * Provedor determinístico e somente em memória (spec 013, "Modo de teste"). Não usa rede, banco,
 * relógio do sistema ou aleatoriedade. Cada instância tem seu próprio relógio e suas sequências.
 * Os métodos de controle simulam a tela do provedor e as cobranças recorrentes; a suíte usa a
 * mesma `PaymentProvider` do adaptador real para consultar os resultados.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly #currency: string;
  readonly #webhookSecret: string;
  readonly #checkoutBaseUrl: string;
  readonly #checkouts = new Map<string, CheckoutEntry>();
  readonly #payments = new Map<string, PaymentEntry>();
  readonly #plans = new Map<string, PlanEntry>();
  readonly #subscriptions = new Map<string, SubscriptionEntry>();
  readonly #refunds = new Map<string, RefundEntry>();
  readonly #unavailable = new Set<FakePaymentOperation | 'all'>();
  #refundOutcome: FakeRefundOutcome = 'approved';
  #now: number;
  #checkoutSequence = 0;
  #paymentSequence = 0;
  #planSequence = 0;
  #subscriptionSequence = 0;
  #refundSequence = 0;
  #eventSequence = 0;

  constructor(options: FakePaymentProviderOptions = {}) {
    this.#currency = options.currency ?? 'BRL';
    this.#webhookSecret = options.webhookSecret ?? FAKE_PAYMENT_WEBHOOK_SECRET;
    this.#checkoutBaseUrl = (options.checkoutBaseUrl ?? FAKE_PAYMENT_CHECKOUT_URL).replace(
      /\/$/,
      '',
    );
    this.#now = new Date(options.now ?? '2026-01-01T00:00:00.000Z').getTime();
    if (!Number.isFinite(this.#now)) {
      throw new TypeError('O instante inicial do provedor fake é inválido.');
    }
  }

  get now(): Date {
    return new Date(this.#now);
  }

  setNow(value: Date | number | string): void {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      throw new TypeError('O instante do provedor fake é inválido.');
    }
    this.#now = timestamp;
  }

  advance(milliseconds: number): Date {
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError('O avanço do relógio do provedor fake deve ser finito.');
    }
    this.#now += milliseconds;
    return this.now;
  }

  setUnavailable(unavailable: boolean, operations?: readonly FakePaymentOperation[]): void {
    if (!unavailable) {
      this.#unavailable.clear();
      return;
    }
    for (const operation of operations ?? ['all']) {
      this.#unavailable.add(operation);
    }
  }

  async createCheckout(input: CreateCheckoutInput): Promise<PaymentCheckout> {
    this.#available('createCheckout');
    validateCheckout(input, this.#currency);
    const providerCheckoutId = `fake_checkout_${String(++this.#checkoutSequence).padStart(6, '0')}`;
    const payment = this.#newPayment({
      checkoutId: providerCheckoutId,
      subscriptionId: null,
      reference: input.externalReference,
      amountCents: input.totalCents,
      currency: input.currency,
      method: 'other',
      status: 'pending',
    });
    this.#checkouts.set(providerCheckoutId, {
      paymentId: payment.providerPaymentId,
      canceled: false,
    });
    return {
      checkoutUrl: `${this.#checkoutBaseUrl}/${providerCheckoutId}`,
      providerCheckoutId,
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    this.#available('getPayment');
    return clonePayment(this.#payment(providerPaymentId));
  }

  async findPaymentsByReference(reference: PaymentExternalReference): Promise<ProviderPayment[]> {
    this.#available('findPaymentsByReference');
    parsePaymentExternalReference(reference);
    return [...this.#payments.values()]
      .filter((payment) => payment.externalReference === reference)
      .sort((left, right) => left.providerPaymentId.localeCompare(right.providerPaymentId))
      .map(clonePayment);
  }

  async cancelCheckout(providerCheckoutId: string): Promise<PaymentProviderConfirmation> {
    this.#available('cancelCheckout');
    const checkout = this.#checkout(providerCheckoutId);
    if (checkout.canceled) {
      return { confirmed: true };
    }
    const payment = this.#payment(checkout.paymentId);
    if (payment.status === 'approved' || payment.refundedCents > 0) {
      throw invalidPaymentTransition('Checkout com pagamento aprovado não pode ser cancelado.');
    }
    checkout.canceled = true;
    payment.status = 'canceled';
    payment.rawStatus = 'canceled';
    return { confirmed: true };
  }

  async ensurePlan(input: EnsurePaymentPlanInput): Promise<{ providerPlanId: string }> {
    this.#available('ensurePlan');
    validatePlan(input, this.#currency);
    const existing = [...this.#plans.values()].find((plan) => samePlan(plan.input, input));
    if (existing !== undefined) {
      return { providerPlanId: existing.id };
    }
    const providerPlanId = `fake_plan_${String(++this.#planSequence).padStart(6, '0')}`;
    this.#plans.set(providerPlanId, { id: providerPlanId, input: clonePlanInput(input) });
    return { providerPlanId };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscriptionCheckout> {
    this.#available('createSubscription');
    if (parsePaymentExternalReference(input.externalReference).kind !== 'subscription') {
      throw invalidPaymentRequest('Assinatura exige referência subscription:<uuid>.');
    }
    validateUrls(input.returnUrls);
    const plan = this.#plans.get(input.providerPlanId);
    if (plan === undefined) {
      throw paymentNotFound('Plano não encontrado no provedor de pagamento.');
    }
    const discount = input.firstChargeDiscountCents ?? 0;
    if (!Number.isSafeInteger(discount) || discount < 0 || discount > plan.input.amountCents) {
      throw invalidPaymentRequest('O desconto da primeira cobrança é inválido.');
    }
    const providerSubscriptionId = `fake_subscription_${String(++this.#subscriptionSequence).padStart(6, '0')}`;
    this.#subscriptions.set(providerSubscriptionId, {
      providerSubscriptionId,
      providerPlanId: input.providerPlanId,
      status: 'pending',
      externalReference: input.externalReference,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingAt: null,
      input: { ...input, buyer: { ...input.buyer }, returnUrls: { ...input.returnUrls } },
    });
    return {
      checkoutUrl: `${this.#checkoutBaseUrl}/subscriptions/${providerSubscriptionId}`,
      providerSubscriptionId,
    };
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    this.#available('getSubscription');
    return cloneSubscription(this.#subscription(providerSubscriptionId));
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<PaymentProviderConfirmation> {
    this.#available('cancelSubscription');
    const subscription = this.#subscription(providerSubscriptionId);
    subscription.status = 'canceled';
    subscription.nextBillingAt = null;
    return { confirmed: true };
  }

  async refund(providerPaymentId: string, amountCents: number | null): Promise<ProviderRefund> {
    this.#available('refund');
    const payment = this.#payment(providerPaymentId);
    if (payment.status !== 'approved' && payment.status !== 'partially_refunded') {
      throw invalidPaymentTransition('Só pagamento aprovado pode ser reembolsado.');
    }
    const pending = [...this.#refunds.values()]
      .filter((refund) => refund.paymentId === providerPaymentId && refund.status === 'pending')
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const remaining = payment.amountCents - payment.refundedCents - pending;
    const amount = amountCents ?? remaining;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
      throw invalidPaymentRequest('O valor do reembolso deve ser positivo e não exceder o saldo.');
    }
    const providerRefundId = `fake_refund_${String(++this.#refundSequence).padStart(6, '0')}`;
    const refund: RefundEntry = {
      providerRefundId,
      status: this.#refundOutcome,
      amountCents: amount,
      paymentId: payment.providerPaymentId,
    };
    this.#refunds.set(providerRefundId, refund);
    if (refund.status === 'approved') {
      applyRefund(payment, amount);
    }
    return { providerRefundId, status: refund.status, amountCents: amount };
  }

  /** Reembolso pendente concluído, como o worker descobre na reconciliação (spec 013). */
  approveRefund(providerRefundId: string): ProviderRefund {
    const refund = this.#refund(providerRefundId);
    if (refund.status === 'pending') {
      refund.status = 'approved';
      applyRefund(this.#payment(refund.paymentId), refund.amountCents);
    }
    return { ...refund };
  }

  rejectRefund(providerRefundId: string): ProviderRefund {
    const refund = this.#refund(providerRefundId);
    if (refund.status === 'pending') {
      refund.status = 'rejected';
    }
    return { ...refund };
  }

  getRefund(providerRefundId: string): ProviderRefund {
    return { ...this.#refund(providerRefundId) };
  }

  listRefunds(providerPaymentId: string): ProviderRefund[] {
    this.#payment(providerPaymentId);
    return [...this.#refunds.values()]
      .filter((refund) => refund.paymentId === providerPaymentId)
      .map((refund) => ({ ...refund }));
  }

  /** Desfecho dos próximos reembolsos; `pending` simula o provedor que ainda não concluiu. */
  setRefundOutcome(outcome: FakeRefundOutcome): void {
    this.#refundOutcome = outcome;
  }

  async parseWebhook(input: ParsePaymentWebhookInput): Promise<PaymentWebhookEvent> {
    this.#available('parseWebhook');
    const body =
      typeof input.rawBody === 'string'
        ? input.rawBody
        : Buffer.from(input.rawBody).toString('utf8');
    if (Buffer.byteLength(body) > 64 * 1024) {
      throw invalidPaymentWebhook('O corpo do aviso excede 64 KB.');
    }
    let event: unknown;
    try {
      event = JSON.parse(body);
    } catch {
      throw invalidPaymentWebhook();
    }
    if (
      !isRecord(event) ||
      typeof event.id !== 'string' ||
      !isRecord(event.data) ||
      typeof event.data.id !== 'string'
    ) {
      throw invalidPaymentWebhook();
    }
    const resourceType =
      event.type === 'payment' ? 'payment' : event.type === 'subscription' ? 'subscription' : null;
    if (resourceType === null) {
      throw invalidPaymentWebhook();
    }
    const resourceId = event.data.id;
    const signature = header(input.headers, 'x-signature');
    const requestId = header(input.headers, 'x-request-id');
    const timestamp = signatureParameter(signature, 'ts');
    const received = signatureParameter(signature, 'v1');
    if (requestId === null || timestamp === null || received === null || !/^\d+$/.test(timestamp)) {
      throw invalidWebhookSignature();
    }
    const time = Number(timestamp);
    if (Math.abs(this.#now - time) > PAYMENT_WEBHOOK_MAX_AGE_MS) {
      throw invalidWebhookSignature();
    }
    const expected = createHmac('sha256', this.#webhookSecret)
      .update(webhookManifest(resourceId, requestId, timestamp))
      .digest('hex');
    if (!safeEqual(received, expected)) {
      throw invalidWebhookSignature();
    }
    return { provider: 'fake', eventId: event.id, resourceType, resourceId };
  }

  /** Simula a aprovação no checkout hospedado. A referência e o total congelado são preservados. */
  approvePayment(
    providerPaymentId: string,
    options: FakeCheckoutPaymentOptions = {},
  ): ProviderPayment {
    const payment = this.#payment(providerPaymentId);
    if (payment.checkoutId === null || payment.status !== 'pending') {
      throw invalidPaymentTransition('O pagamento não pertence a um checkout pendente.');
    }
    const checkout = this.#checkout(payment.checkoutId);
    if (checkout.canceled) {
      throw invalidPaymentTransition('Checkout cancelado não pode ser aprovado.');
    }
    return this.#settleCheckout(checkout, 'approved', options);
  }

  rejectPayment(
    providerPaymentId: string,
    options: FakeCheckoutPaymentOptions = {},
  ): ProviderPayment {
    const payment = this.#payment(providerPaymentId);
    if (payment.checkoutId === null || payment.status !== 'pending') {
      throw invalidPaymentTransition('O pagamento não pertence a um checkout pendente.');
    }
    const checkout = this.#checkout(payment.checkoutId);
    if (checkout.canceled) {
      throw invalidPaymentTransition('Checkout cancelado não pode ser recusado.');
    }
    return this.#settleCheckout(checkout, 'rejected', options);
  }

  approveCheckout(
    providerCheckoutId: string,
    options: FakeCheckoutPaymentOptions = {},
  ): ProviderPayment {
    const checkout = this.#checkout(providerCheckoutId);
    if (checkout.canceled) {
      throw invalidPaymentTransition('Checkout cancelado não pode ser aprovado.');
    }
    return this.#settleCheckout(checkout, 'approved', options);
  }

  rejectCheckout(
    providerCheckoutId: string,
    options: FakeCheckoutPaymentOptions = {},
  ): ProviderPayment {
    const checkout = this.#checkout(providerCheckoutId);
    if (checkout.canceled) {
      throw invalidPaymentTransition('Checkout cancelado não pode ser recusado.');
    }
    return this.#settleCheckout(checkout, 'rejected', options);
  }

  /** Autoriza a adesão e cria a primeira cobrança, já com o desconto da primeira parcela. */
  authorizeSubscription(
    providerSubscriptionId: string,
    options: FakeCheckoutPaymentOptions = {},
  ): ProviderPayment {
    const subscription = this.#subscription(providerSubscriptionId);
    if (subscription.status !== 'pending') {
      throw invalidPaymentTransition('Só assinatura pendente pode ser autorizada.');
    }
    const plan = this.#plans.get(subscription.providerPlanId);
    if (plan === undefined) {
      throw paymentNotFound('Plano não encontrado no provedor de pagamento.');
    }
    subscription.status = 'authorized';
    subscription.currentPeriodStart = this.now;
    subscription.currentPeriodEnd = addPeriod(this.now, plan.input.periodicity);
    subscription.nextBillingAt = subscription.currentPeriodEnd;
    const payment = this.#newPayment({
      checkoutId: null,
      subscriptionId: providerSubscriptionId,
      reference: subscription.externalReference,
      amountCents:
        options.amountCents ??
        plan.input.amountCents - (subscription.input.firstChargeDiscountCents ?? 0),
      currency: options.currency ?? plan.input.currency,
      method: options.method ?? 'card',
      status: 'approved',
    });
    return clonePayment(payment);
  }

  renewSubscription(
    providerSubscriptionId: string,
    options: FakeSubscriptionPaymentOptions = {},
  ): ProviderPayment {
    const subscription = this.#subscription(providerSubscriptionId);
    if (subscription.status !== 'authorized' && subscription.status !== 'paused') {
      throw invalidPaymentTransition('Só assinatura autorizada ou pausada pode renovar.');
    }
    const plan = this.#plans.get(subscription.providerPlanId);
    if (plan === undefined) {
      throw paymentNotFound('Plano não encontrado no provedor de pagamento.');
    }
    const outcome = options.outcome ?? 'approved';
    if (outcome === 'approved') {
      subscription.currentPeriodStart = subscription.currentPeriodEnd ?? this.now;
      subscription.currentPeriodEnd = addPeriod(
        subscription.currentPeriodStart,
        plan.input.periodicity,
      );
      subscription.nextBillingAt = subscription.currentPeriodEnd;
      subscription.status = 'authorized';
    } else if (outcome === 'rejected') {
      subscription.status = 'paused';
    }
    return clonePayment(
      this.#newPayment({
        checkoutId: null,
        subscriptionId: providerSubscriptionId,
        reference: subscription.externalReference,
        amountCents: options.amountCents ?? plan.input.amountCents,
        currency: options.currency ?? plan.input.currency,
        method: options.method ?? 'card',
        status: outcome,
      }),
    );
  }

  pauseSubscription(providerSubscriptionId: string): ProviderSubscription {
    const subscription = this.#subscription(providerSubscriptionId);
    if (subscription.status === 'canceled') {
      throw invalidPaymentTransition('Assinatura cancelada não pode ser pausada.');
    }
    subscription.status = 'paused';
    return cloneSubscription(subscription);
  }

  chargebackPayment(providerPaymentId: string): ProviderPayment {
    const payment = this.#payment(providerPaymentId);
    if (payment.status !== 'approved' && payment.status !== 'partially_refunded') {
      throw invalidPaymentTransition('Só pagamento aprovado pode sofrer chargeback.');
    }
    payment.status = 'charged_back';
    payment.rawStatus = 'charged_back';
    return clonePayment(payment);
  }

  /** Fixture assinada localmente; o teste entrega o retorno diretamente a `parseWebhook`. */
  paymentWebhook(
    providerPaymentId: string,
    options: FakeWebhookOptions = {},
  ): ParsePaymentWebhookInput {
    this.#payment(providerPaymentId);
    return this.#webhook('payment', providerPaymentId, options);
  }

  subscriptionWebhook(
    providerSubscriptionId: string,
    options: FakeWebhookOptions = {},
  ): ParsePaymentWebhookInput {
    this.#subscription(providerSubscriptionId);
    return this.#webhook('subscription', providerSubscriptionId, options);
  }

  #webhook(
    resourceType: 'payment' | 'subscription',
    resourceId: string,
    options: FakeWebhookOptions,
  ): ParsePaymentWebhookInput {
    const eventId =
      options.eventId ?? `fake_event_${String(++this.#eventSequence).padStart(6, '0')}`;
    const timestamp = String(new Date(options.timestamp ?? this.#now).getTime());
    const requestId = options.requestId ?? `fake_request_${eventId}`;
    const secret = options.secret ?? this.#webhookSecret;
    const signature = createHmac('sha256', secret)
      .update(webhookManifest(resourceId, requestId, timestamp))
      .digest('hex');
    return {
      headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${signature}` },
      rawBody: JSON.stringify({ id: eventId, type: resourceType, data: { id: resourceId } }),
    };
  }

  #settleCheckout(
    checkout: CheckoutEntry,
    status: 'approved' | 'rejected',
    options: FakeCheckoutPaymentOptions,
  ): ProviderPayment {
    const payment = this.#payment(checkout.paymentId);
    if (payment.status !== 'pending') {
      throw invalidPaymentTransition('O checkout já teve uma decisão de pagamento.');
    }
    payment.status = status;
    payment.rawStatus = status;
    payment.method = options.method ?? 'card';
    payment.amountCents = options.amountCents ?? payment.amountCents;
    payment.currency = options.currency ?? payment.currency;
    payment.paidAt = status === 'approved' ? this.now : null;
    return clonePayment(payment);
  }

  #newPayment(input: {
    checkoutId: string | null;
    subscriptionId: string | null;
    reference: PaymentExternalReference;
    amountCents: number;
    currency: string;
    method: PaymentMethod;
    status: ProviderPayment['status'];
  }): PaymentEntry {
    const providerPaymentId = `fake_payment_${String(++this.#paymentSequence).padStart(6, '0')}`;
    const payment: PaymentEntry = {
      providerPaymentId,
      checkoutId: input.checkoutId,
      subscriptionId: input.subscriptionId,
      amountCents: input.amountCents,
      currency: input.currency,
      method: input.method,
      status: input.status,
      externalReference: input.reference,
      refundedCents: 0,
      rawStatus: input.status,
      paidAt: input.status === 'approved' ? this.now : null,
    };
    this.#payments.set(providerPaymentId, payment);
    return payment;
  }

  #available(operation: FakePaymentOperation): void {
    if (this.#unavailable.has('all') || this.#unavailable.has(operation)) {
      throw paymentUnavailable();
    }
  }

  #checkout(id: string): CheckoutEntry {
    const entry = this.#checkouts.get(id);
    if (entry === undefined)
      throw paymentNotFound('Checkout não encontrado no provedor de pagamento.');
    return entry;
  }

  #payment(id: string): PaymentEntry {
    const entry = this.#payments.get(id);
    if (entry === undefined)
      throw paymentNotFound('Pagamento não encontrado no provedor de pagamento.');
    return entry;
  }

  #subscription(id: string): SubscriptionEntry {
    const entry = this.#subscriptions.get(id);
    if (entry === undefined)
      throw paymentNotFound('Assinatura não encontrada no provedor de pagamento.');
    return entry;
  }

  #refund(id: string): RefundEntry {
    const entry = this.#refunds.get(id);
    if (entry === undefined)
      throw paymentNotFound('Reembolso não encontrado no provedor de pagamento.');
    return entry;
  }
}

function applyRefund(payment: PaymentEntry, amountCents: number): void {
  payment.refundedCents += amountCents;
  payment.status =
    payment.refundedCents === payment.amountCents ? 'refunded' : 'partially_refunded';
  payment.rawStatus = payment.status;
}

function validateCheckout(input: CreateCheckoutInput, expectedCurrency: string): void {
  if (
    input.items.length === 0 ||
    !Number.isSafeInteger(input.totalCents) ||
    input.totalCents <= 0
  ) {
    throw invalidPaymentRequest('O checkout deve ter itens e total positivo em centavos.');
  }
  if (input.currency !== expectedCurrency) {
    throw invalidPaymentRequest('A moeda do checkout não é a configurada na instalação.');
  }
  let total = 0;
  for (const item of input.items) {
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isSafeInteger(item.unitAmountCents) ||
      item.unitAmountCents < 0
    ) {
      throw invalidPaymentRequest('Quantidade e valores dos itens devem ser inteiros válidos.');
    }
    total += item.quantity * item.unitAmountCents;
  }
  if (total !== input.totalCents) {
    throw invalidPaymentRequest('O total do checkout não corresponde à soma dos itens.');
  }
  if (parsePaymentExternalReference(input.externalReference).kind !== 'order') {
    throw invalidPaymentRequest('Checkout avulso exige referência order:<uuid>.');
  }
  validateUrls(input.returnUrls);
}

function validatePlan(input: EnsurePaymentPlanInput, expectedCurrency: string): void {
  if (
    input.title.trim() === '' ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0
  ) {
    throw invalidPaymentRequest('O plano deve ter título e preço positivo em centavos.');
  }
  if (input.currency !== expectedCurrency) {
    throw invalidPaymentRequest('A moeda do plano não é a configurada na instalação.');
  }
  if (
    !Number.isSafeInteger(input.periodicity.value) ||
    input.periodicity.value <= 0 ||
    !(input.periodicity.unit in PERIOD_UNITS)
  ) {
    throw invalidPaymentRequest('A periodicidade do plano é inválida.');
  }
}

function validateUrls(urls: CreateCheckoutInput['returnUrls']): void {
  for (const url of Object.values(urls)) {
    const parsed = URL.parse(url);
    if (parsed === null || !['http:', 'https:'].includes(parsed.protocol)) {
      throw invalidPaymentRequest('As URLs de retorno devem ser http:// ou https://.');
    }
  }
}

function samePlan(left: EnsurePaymentPlanInput, right: EnsurePaymentPlanInput): boolean {
  return (
    left.title === right.title &&
    left.amountCents === right.amountCents &&
    left.currency === right.currency &&
    left.periodicity.value === right.periodicity.value &&
    left.periodicity.unit === right.periodicity.unit
  );
}

function clonePlanInput(input: EnsurePaymentPlanInput): EnsurePaymentPlanInput {
  return { ...input, periodicity: { ...input.periodicity } };
}

function clonePayment(payment: PaymentEntry): ProviderPayment {
  return {
    providerPaymentId: payment.providerPaymentId,
    status: payment.status,
    amountCents: payment.amountCents,
    refundedCents: payment.refundedCents,
    currency: payment.currency,
    method: payment.method,
    externalReference: payment.externalReference,
    rawStatus: payment.rawStatus,
    paidAt: payment.paidAt === null ? null : new Date(payment.paidAt),
  };
}

function cloneSubscription(subscription: SubscriptionEntry): ProviderSubscription {
  return {
    providerSubscriptionId: subscription.providerSubscriptionId,
    providerPlanId: subscription.providerPlanId,
    status: subscription.status,
    externalReference: subscription.externalReference,
    currentPeriodStart: cloneDate(subscription.currentPeriodStart),
    currentPeriodEnd: cloneDate(subscription.currentPeriodEnd),
    nextBillingAt: cloneDate(subscription.nextBillingAt),
  };
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}

function addPeriod(start: Date, period: PaymentPlanPeriod): Date {
  const result = new Date(start);
  if (period.unit === 'days') {
    result.setUTCDate(result.getUTCDate() + period.value);
  } else if (period.unit === 'months') {
    result.setUTCMonth(result.getUTCMonth() + period.value);
  } else {
    result.setUTCFullYear(result.getUTCFullYear() + period.value);
  }
  return result;
}

function webhookManifest(resourceId: string, requestId: string, timestamp: string): string {
  return `id:${resourceId};request-id:${requestId};ts:${timestamp};`;
}

function header(headers: PaymentWebhookHeaders, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  if (Array.isArray(entry)) {
    return entry.length === 1 ? (entry[0] ?? null) : null;
  }
  return typeof entry === 'string' ? entry : null;
}

function signatureParameter(signature: string | null, name: string): string | null {
  if (signature === null) return null;
  const values = signature.split(',').map((part) => part.trim().split('=', 2));
  const found = values.find(([key]) => key === name)?.[1];
  return found === undefined || found === '' ? null : found;
}

function safeEqual(received: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
