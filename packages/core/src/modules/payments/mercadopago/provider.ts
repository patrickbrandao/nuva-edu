import { randomUUID } from 'node:crypto';
import {
  Invoice,
  MercadoPagoConfig,
  MPAuthenticationError,
  MPBadRequestError,
  MPConnectionError,
  MPDependencyError,
  MPForbiddenError,
  MPIdempotencyError,
  MPNotFoundError,
  MPPaymentError,
  MPRateLimitError,
  MPResourceLockedError,
  MPServerError,
  MPValidationError,
  Payment,
  PaymentRefund,
  PreApproval,
  PreApprovalPlan,
  Preference,
  WebhookSignatureValidator,
} from 'mercadopago';
import type { DomainError } from '../../../errors/domain-error.ts';
import { isDomainError } from '../../../errors/domain-error.ts';
import {
  invalidPaymentRequest,
  invalidPaymentWebhook,
  invalidWebhookSignature,
  paymentNotFound,
  paymentUnavailable,
} from '../errors.ts';
import { parsePaymentExternalReference } from '../references.ts';
import type {
  CreateCheckoutInput,
  CreateSubscriptionInput,
  EnsurePaymentPlanInput,
  ParsePaymentWebhookInput,
  PaymentCheckout,
  PaymentExternalReference,
  PaymentPlanPeriod,
  PaymentProvider,
  PaymentProviderConfirmation,
  PaymentWebhookEvent,
  PaymentWebhookHeaders,
  PaymentWebhookResourceType,
  ProviderPayment,
  ProviderRefund,
  ProviderSubscription,
  ProviderSubscriptionCheckout,
} from '../types.ts';
import {
  fromCents,
  mapRefundStatus,
  toCents,
  toProviderPayment,
  toProviderSubscription,
} from './mapping.ts';

/** Tempo limite de cada chamada ao provedor (spec 013, RNF-03). */
export const MERCADO_PAGO_TIMEOUT_MS = 10_000;
/** Espera entre as tentativas: 1 s, 4 s e 16 s (spec 013, RNF-03). */
export const MERCADO_PAGO_RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;
/** Carimbo do webhook aceito por até 5 min (spec 013). */
export const MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
/** Mesmo limite do endpoint de webhook: o corpo nunca é guardado. */
export const MERCADO_PAGO_WEBHOOK_MAX_BYTES = 64 * 1024;

export interface MercadoPagoPaymentProviderOptions {
  /** Token da conta do vendedor. Nunca é devolvido, registrado ou incluído em erro. */
  accessToken: string;
  /** Segredo do webhook configurado no Mercado Pago. Nunca é exposto. */
  webhookSecret: string;
  /** URL pública que recebe as notificações, como `https://classroom.exemplo/api/v1/webhooks/mercadopago`. */
  notificationUrl: string;
  /** Retorno usado na criação do plano; padrão: a própria URL de notificação. */
  planBackUrl?: string;
  /** Relógio para validar o carimbo do webhook; injetável nos testes. */
  now?: () => number;
  /** Espera entre tentativas; injetável nos testes para não dormir de verdade. */
  sleep?: (milliseconds: number) => Promise<void>;
}

interface RequestOptions {
  idempotencyKey?: string;
}

interface PaymentSearchResult {
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

interface PaymentSearchResponse {
  results?: PaymentSearchResult[] | null;
  paging?: { total?: number; limit?: number; offset?: number } | null;
}

interface PlanRecord {
  id?: string | null;
  reason?: string | null;
  status?: string | null;
  auto_recurring?: {
    frequency?: number | null;
    frequency_type?: string | null;
    transaction_amount?: number | null;
    currency_id?: string | null;
  } | null;
}

interface PlanSearchResponse {
  results?: PlanRecord[] | null;
  paging?: { total?: number; limit?: number; offset?: number } | null;
}

interface PreferenceRecord {
  id?: string | null;
  init_point?: string | null;
  sandbox_init_point?: string | null;
  expires?: boolean | null;
  expiration_date_to?: string | null;
  items?: unknown[] | null;
}

interface SubscriptionRecord {
  id?: string | null;
  status?: string | null;
  reason?: string | null;
  external_reference?: string | null;
  preapproval_plan_id?: string | null;
  init_point?: string | null;
  next_payment_date?: string | null;
  summarized?: { last_charged_date?: string | null } | null;
  auto_recurring?: {
    frequency?: number | null;
    frequency_type?: string | null;
    transaction_amount?: number | null;
    currency_id?: string | null;
  } | null;
}

interface RefundRecord {
  id?: string | number | null;
  status?: string | null;
  amount?: number | null;
}

interface InvoiceRecord {
  id?: string | null;
  payment?: { id?: string | null } | null;
}

/**
 * Adaptador da porta `PaymentProvider` para o Mercado Pago (spec 013).
 *
 * Usa o SDK oficial somente para montar as requisições; o transporte (`fetch`) é o global,
 * o que permite simular a API nos testes. Cada chamada tem 10 s de limite e até três novas
 * tentativas (1 s, 4 s e 16 s) para erro de rede e resposta 5xx. Nenhum token, segredo,
 * corpo de resposta ou dado pessoal sai desta classe em erro ou log.
 */
export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly name = 'mercadopago' as const;
  readonly #accessToken: string;
  readonly #webhookSecret: string;
  readonly #notificationUrl: string;
  readonly #planBackUrl: string;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: MercadoPagoPaymentProviderOptions) {
    this.#accessToken = requireOptionText(options.accessToken, 'accessToken');
    this.#webhookSecret = requireOptionText(options.webhookSecret, 'webhookSecret');
    this.#notificationUrl = requireOptionUrl(options.notificationUrl, 'notificationUrl');
    this.#planBackUrl =
      options.planBackUrl === undefined
        ? this.#notificationUrl
        : requireOptionUrl(options.planBackUrl, 'planBackUrl');
    this.#now = options.now ?? Date.now;
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  }

  async createCheckout(input: CreateCheckoutInput): Promise<PaymentCheckout> {
    validateCheckout(input);
    const idempotencyKey = randomUUID();
    const payer = buildPayer(input);
    const preference = (await this.#call(() =>
      new Preference(this.#config({ idempotencyKey })).create({
        body: {
          items: input.items.map((item) => ({
            id: item.id,
            title: item.title,
            quantity: item.quantity,
            unit_price: fromCents(item.unitAmountCents),
            currency_id: input.currency,
          })),
          payer,
          external_reference: input.externalReference,
          notification_url: this.#notificationUrl,
          back_urls: {
            success: input.returnUrls.success,
            pending: input.returnUrls.pending,
            failure: input.returnUrls.failure,
          },
          auto_return: 'approved',
        },
      }),
    )) as PreferenceRecord;
    const providerCheckoutId = textOrNull(preference.id);
    const checkoutUrl =
      textOrNull(preference.init_point) ?? textOrNull(preference.sandbox_init_point);
    if (providerCheckoutId === null || checkoutUrl === null) {
      throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_checkout' });
    }
    return { checkoutUrl, providerCheckoutId };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const id = requireText(providerPaymentId, 'providerPaymentId');
    try {
      const payment = await this.#call(() => new Payment(this.#config()).get({ id }));
      return toProviderPayment(payment as PaymentSearchResult);
    } catch (error) {
      if (!isPaymentNotFound(error)) {
        throw rethrow(error);
      }
    }
    // A cobrança recorrente chega pelo webhook `subscription_authorized_payment`, cujo id
    // pertence a `/authorized_payments/{id}`; o pagamento em si é o `payment.id` da fatura.
    try {
      const invoice = await this.#call(() => new Invoice(this.#config()).get({ id }));
      const underlying = textOrNull((invoice as InvoiceRecord).payment?.id);
      if (underlying === null) {
        throw paymentNotFound();
      }
      const payment = await this.#call(() => new Payment(this.#config()).get({ id: underlying }));
      return toProviderPayment(payment as PaymentSearchResult);
    } catch (error) {
      throw rethrow(error);
    }
  }

  async findPaymentsByReference(reference: PaymentExternalReference): Promise<ProviderPayment[]> {
    const parsed = parsePaymentExternalReference(reference);
    const response = await this.#call(() =>
      new Payment(this.#config()).search({
        options: {
          external_reference: parsed.reference,
          sort: 'date_created',
          criteria: 'desc',
          limit: 50,
        },
      }),
    );
    const results = (response as PaymentSearchResponse).results ?? [];
    return results.map((payment) => toProviderPayment(payment));
  }

  async cancelCheckout(providerCheckoutId: string): Promise<PaymentProviderConfirmation> {
    const id = requireText(providerCheckoutId, 'providerCheckoutId');
    const current = (await this.#call(() =>
      new Preference(this.#config()).get({ preferenceId: id }),
    )) as PreferenceRecord;
    if (isExpired(current, this.#now())) {
      return { confirmed: true };
    }
    const now = new Date(this.#now());
    const expiration = new Date(now.getTime() - 1_000);
    const updatePreferenceRequest = {
      ...(Array.isArray(current.items) ? { items: current.items } : {}),
      expires: true,
      expiration_date_from: now.toISOString(),
      expiration_date_to: expiration.toISOString(),
    } as Parameters<Preference['update']>[0]['updatePreferenceRequest'];
    const idempotencyKey = randomUUID();
    await this.#call(() =>
      new Preference(this.#config({ idempotencyKey })).update({
        id,
        updatePreferenceRequest,
      }),
    );
    return { confirmed: true };
  }

  async ensurePlan(input: EnsurePaymentPlanInput): Promise<{ providerPlanId: string }> {
    const frequency = planFrequency(input.periodicity);
    const amount = validateAmount(input.amountCents, 'plano');
    const title = requireText(input.title, 'title');
    const currency = requireCurrency(input.currency);
    const existing = await this.#findPlan({ title, amountCents: amount, currency, frequency });
    if (existing !== null) {
      return { providerPlanId: existing };
    }
    const idempotencyKey = randomUUID();
    const plan = (await this.#call(() =>
      new PreApprovalPlan(this.#config({ idempotencyKey })).create({
        body: {
          reason: title,
          back_url: this.#planBackUrl,
          auto_recurring: {
            frequency: frequency.value,
            frequency_type: frequency.unit,
            transaction_amount: fromCents(amount),
            currency_id: currency,
          },
        },
      }),
    )) as PlanRecord;
    const providerPlanId = textOrNull(plan.id);
    if (providerPlanId === null) {
      throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_plan_id' });
    }
    return { providerPlanId };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscriptionCheckout> {
    parsePaymentExternalReference(input.externalReference);
    if (!input.externalReference.startsWith('subscription:')) {
      throw invalidPaymentRequest('Assinatura exige referência subscription:<uuid>.');
    }
    const providerPlanId = requireText(input.providerPlanId, 'providerPlanId');
    requireText(input.buyer.email, 'buyer.email');
    requireText(input.buyer.name, 'buyer.name');
    validateUrls(input.returnUrls);
    const discount = input.firstChargeDiscountCents ?? 0;
    if (!Number.isSafeInteger(discount) || discount < 0) {
      throw invalidPaymentRequest('O desconto da primeira cobrança é inválido.');
    }
    if (discount > 0) {
      throw invalidPaymentRequest(
        'O Mercado Pago não oferece desconto apenas na primeira cobrança da assinatura.',
      );
    }
    const plan = (await this.#call(() =>
      new PreApprovalPlan(this.#config()).get({ preApprovalPlanId: providerPlanId }),
    )) as PlanRecord;
    const recurring = plan.auto_recurring;
    const frequency = recurring?.frequency;
    const frequencyType = recurring?.frequency_type;
    const transactionAmount = recurring?.transaction_amount;
    const currencyId = recurring?.currency_id;
    if (
      recurring === undefined ||
      recurring === null ||
      typeof frequency !== 'number' ||
      typeof frequencyType !== 'string' ||
      typeof transactionAmount !== 'number' ||
      typeof currencyId !== 'string'
    ) {
      throw paymentUnavailable({ provider: 'mercadopago', reason: 'incomplete_plan' });
    }
    const idempotencyKey = randomUUID();
    const subscription = (await this.#call(() =>
      new PreApproval(this.#config({ idempotencyKey })).create({
        body: {
          preapproval_plan_id: providerPlanId,
          ...(typeof plan.reason === 'string' ? { reason: plan.reason } : {}),
          external_reference: input.externalReference,
          payer_email: input.buyer.email,
          back_url: input.returnUrls.success,
          status: 'pending',
          auto_recurring: {
            frequency,
            frequency_type: frequencyType,
            transaction_amount: transactionAmount,
            currency_id: currencyId,
          },
        },
      }),
    )) as SubscriptionRecord;
    const providerSubscriptionId = textOrNull(subscription.id);
    const checkoutUrl = textOrNull(subscription.init_point);
    if (providerSubscriptionId === null || checkoutUrl === null) {
      throw paymentUnavailable({
        provider: 'mercadopago',
        reason: 'missing_subscription_checkout',
      });
    }
    return { checkoutUrl, providerSubscriptionId };
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const id = requireText(providerSubscriptionId, 'providerSubscriptionId');
    const subscription = await this.#call(() => new PreApproval(this.#config()).get({ id }));
    return toProviderSubscription(subscription as SubscriptionRecord);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<PaymentProviderConfirmation> {
    const id = requireText(providerSubscriptionId, 'providerSubscriptionId');
    const current = (await this.#call(() =>
      new PreApproval(this.#config()).get({ id }),
    )) as SubscriptionRecord;
    if (normalizeStatus(current.status) === 'canceled') {
      return { confirmed: true };
    }
    const idempotencyKey = randomUUID();
    await this.#call(() =>
      new PreApproval(this.#config({ idempotencyKey })).update({
        id,
        body: { status: 'cancelled' },
      }),
    );
    return { confirmed: true };
  }

  async refund(
    providerPaymentId: string,
    amountCents: number | null,
    idempotencyKey = randomUUID(),
  ): Promise<ProviderRefund> {
    const paymentId = requireText(providerPaymentId, 'providerPaymentId');
    const amount = amountCents === null ? null : validateAmount(amountCents, 'reembolso');
    const refund = (await this.#call(() =>
      amount === null
        ? new PaymentRefund(this.#config({ idempotencyKey })).total({ payment_id: paymentId })
        : new PaymentRefund(this.#config({ idempotencyKey })).create({
            payment_id: paymentId,
            body: { amount: fromCents(amount) },
          }),
    )) as RefundRecord;
    const providerRefundId = textOrNull(refund.id);
    if (providerRefundId === null) {
      throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_refund_id' });
    }
    const refunded = toCents(refund.amount);
    return {
      providerRefundId,
      status: mapRefundStatus(refund.status),
      amountCents: refunded > 0 ? refunded : (amount ?? 0),
    };
  }

  async getRefundStatus(
    providerPaymentId: string,
    providerRefundId: string,
  ): Promise<ProviderRefund> {
    const paymentId = requireText(providerPaymentId, 'providerPaymentId');
    const refundId = requireText(providerRefundId, 'providerRefundId');
    const refund = (await this.#call(() =>
      new PaymentRefund(this.#config()).get({ payment_id: paymentId, refund_id: refundId }),
    )) as RefundRecord;
    const returnedId = textOrNull(refund.id);
    if (returnedId === null) {
      throw paymentUnavailable({ provider: 'mercadopago', reason: 'missing_refund_id' });
    }
    return {
      providerRefundId: returnedId,
      status: mapRefundStatus(refund.status),
      amountCents: toCents(refund.amount),
    };
  }

  async parseWebhook(input: ParsePaymentWebhookInput): Promise<PaymentWebhookEvent> {
    const body =
      typeof input.rawBody === 'string'
        ? input.rawBody
        : Buffer.from(input.rawBody).toString('utf8');
    if (Buffer.byteLength(body) > MERCADO_PAGO_WEBHOOK_MAX_BYTES) {
      throw invalidPaymentWebhook('O corpo do aviso excede 64 KB.');
    }
    // O corpo só fornece identificadores; nada dele é executado ou guardado.
    const record = parseJsonRecord(body);
    const data = record !== null && isRecord(record.data) ? record.data : null;
    const eventId = record === null ? null : identifier(record.id);
    const resourceId = data === null ? null : identifier(data.id);
    const resourceType = record === null ? null : webhookResourceType(record.type);
    if (eventId === null || resourceId === null || resourceType === null) {
      throw invalidPaymentWebhook();
    }
    const xSignature = headerValue(input.headers, 'x-signature');
    const xRequestId = headerValue(input.headers, 'x-request-id');
    if (!hasHeaderValue(xSignature) || !hasHeaderValue(xRequestId)) {
      throw invalidWebhookSignature();
    }
    try {
      WebhookSignatureValidator.validate({
        xSignature,
        xRequestId,
        dataId: resourceId,
        secret: this.#webhookSecret,
        toleranceSeconds: MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS,
        now: this.#now,
      });
    } catch {
      throw invalidWebhookSignature();
    }
    return { provider: 'mercadopago', eventId, resourceType, resourceId };
  }

  async #findPlan(input: {
    title: string;
    amountCents: number;
    currency: string;
    frequency: { value: number; unit: 'days' | 'months' };
  }): Promise<string | null> {
    const limit = 50;
    let offset = 0;
    for (let page = 0; page < 10; page += 1) {
      const response = (await this.#call(() =>
        new PreApprovalPlan(this.#config()).search({
          options: { q: input.title, status: 'active', limit, offset },
        }),
      )) as PlanSearchResponse;
      const results = response.results ?? [];
      const match = results.find((plan) => samePlan(plan, input));
      if (match !== undefined) {
        const id = textOrNull(match.id);
        if (id !== null) {
          return id;
        }
      }
      if (results.length < limit) {
        return null;
      }
      offset += results.length;
      const total = response.paging?.total;
      if (typeof total === 'number' && offset >= total) {
        return null;
      }
    }
    return null;
  }

  #config(options: RequestOptions = {}): MercadoPagoConfig {
    return new MercadoPagoConfig({
      accessToken: this.#accessToken,
      options: {
        timeout: MERCADO_PAGO_TIMEOUT_MS,
        maxRetries: 0,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      },
    });
  }

  async #call<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const failure = classifyError(error);
        if (!failure.retryable || attempt >= MERCADO_PAGO_RETRY_DELAYS_MS.length) {
          throw failure.error;
        }
        await this.#sleep(MERCADO_PAGO_RETRY_DELAYS_MS[attempt] as number);
      }
    }
  }
}

function classifyError(error: unknown): { retryable: boolean; error: DomainError } {
  if (isDomainError(error)) {
    return { retryable: false, error };
  }
  if (error instanceof MPConnectionError) {
    return {
      retryable: true,
      error: paymentUnavailable({ provider: 'mercadopago', kind: 'connection' }),
    };
  }
  if (error instanceof MPServerError) {
    return {
      retryable: true,
      error: paymentUnavailable({ provider: 'mercadopago', status: error.status }),
    };
  }
  if (error instanceof MPNotFoundError) {
    return { retryable: false, error: paymentNotFound() };
  }
  if (error instanceof MPAuthenticationError || error instanceof MPForbiddenError) {
    return {
      retryable: false,
      error: paymentUnavailable({ provider: 'mercadopago', status: error.status }),
    };
  }
  if (
    error instanceof MPBadRequestError ||
    error instanceof MPValidationError ||
    error instanceof MPIdempotencyError ||
    error instanceof MPPaymentError
  ) {
    return {
      retryable: false,
      error: invalidPaymentRequest('O provedor de pagamento recusou a operação.'),
    };
  }
  if (error instanceof MPResourceLockedError || error instanceof MPDependencyError) {
    return {
      retryable: false,
      error: paymentUnavailable({ provider: 'mercadopago', status: error.status }),
    };
  }
  if (error instanceof MPRateLimitError) {
    return {
      retryable: false,
      error: paymentUnavailable({ provider: 'mercadopago', status: 429 }),
    };
  }
  return {
    retryable: false,
    error: paymentUnavailable({ provider: 'mercadopago', kind: 'unknown' }),
  };
}

function isPaymentNotFound(error: unknown): boolean {
  return isDomainError(error) && error.code === 'not_found';
}

function rethrow(error: unknown): Error {
  return error instanceof Error ? error : new Error('Falha no provedor de pagamento.');
}

function validateCheckout(input: CreateCheckoutInput): void {
  if (
    input.items.length === 0 ||
    !Number.isSafeInteger(input.totalCents) ||
    input.totalCents <= 0
  ) {
    throw invalidPaymentRequest('O checkout deve ter itens e total positivo em centavos.');
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
  const reference = parsePaymentExternalReference(input.externalReference);
  if (reference.kind !== 'order') {
    throw invalidPaymentRequest('Checkout avulso exige referência order:<uuid>.');
  }
  requireCurrency(input.currency);
  requireText(input.buyer.name, 'buyer.name');
  requireText(input.buyer.email, 'buyer.email');
  buildPayer(input);
  validateUrls(input.returnUrls);
}

function buildPayer(input: CreateCheckoutInput) {
  const taxId = input.buyer.taxId;
  if (taxId === null || taxId === undefined || taxId.trim() === '') {
    return { name: input.buyer.name, email: input.buyer.email };
  }
  const digits = taxId.replace(/\D/g, '');
  if (digits.length !== 11 && digits.length !== 14) {
    throw invalidPaymentRequest('O CPF/CNPJ do comprador deve ter 11 ou 14 dígitos.');
  }
  return {
    name: input.buyer.name,
    email: input.buyer.email,
    identification: { type: digits.length === 11 ? 'CPF' : 'CNPJ', number: digits },
  };
}

function validateUrls(urls: CreateCheckoutInput['returnUrls']): void {
  for (const url of Object.values(urls)) {
    requireHttpUrl(url, 'returnUrls');
  }
}

function planFrequency(periodicity: PaymentPlanPeriod): {
  value: number;
  unit: 'days' | 'months';
} {
  if (!Number.isSafeInteger(periodicity.value) || periodicity.value <= 0) {
    throw invalidPaymentRequest('A periodicidade do plano é inválida.');
  }
  if (periodicity.unit === 'years') {
    return { value: periodicity.value * 12, unit: 'months' };
  }
  if (periodicity.unit === 'days' || periodicity.unit === 'months') {
    return { value: periodicity.value, unit: periodicity.unit };
  }
  throw invalidPaymentRequest('A periodicidade do plano é inválida.');
}

function samePlan(
  plan: PlanRecord,
  input: {
    title: string;
    amountCents: number;
    currency: string;
    frequency: { value: number; unit: 'days' | 'months' };
  },
): boolean {
  const recurring = plan.auto_recurring;
  return (
    plan.reason === input.title &&
    recurring !== undefined &&
    recurring !== null &&
    toCents(recurring.transaction_amount) === input.amountCents &&
    recurring.currency_id === input.currency &&
    recurring.frequency === input.frequency.value &&
    recurring.frequency_type === input.frequency.unit
  );
}

function isExpired(preference: PreferenceRecord, now: number): boolean {
  if (preference.expires !== true) {
    return false;
  }
  const expiration = preference.expiration_date_to;
  if (typeof expiration !== 'string') {
    return false;
  }
  const time = new Date(expiration).getTime();
  return Number.isFinite(time) && time <= now;
}

function normalizeStatus(value: string | null | undefined): string {
  const status = (value ?? '').toLowerCase();
  return status === 'cancelled' ? 'canceled' : status;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4_096) {
    throw invalidPaymentRequest(`O campo ${field} é obrigatório.`);
  }
  return value;
}

function requireOptionText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4_096) {
    throw new TypeError(`O campo ${field} do provedor de pagamento é inválido.`);
  }
  return value;
}

function requireCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw invalidPaymentRequest('A moeda deve ser um código ISO 4217 de três letras.');
  }
  return value;
}

function requireHttpUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw invalidPaymentRequest(`O campo ${field} deve ser uma URL.`);
  }
  const parsed = URL.parse(value);
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw invalidPaymentRequest(`O campo ${field} deve ser http:// ou https://.`);
  }
  return value;
}

function requireOptionUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`O campo ${field} do provedor de pagamento é inválido.`);
  }
  const parsed = URL.parse(value);
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new TypeError(`O campo ${field} do provedor de pagamento deve ser http:// ou https://.`);
  }
  return value;
}

function validateAmount(value: number, kind: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidPaymentRequest(`O valor do ${kind} deve ser positivo em centavos.`);
  }
  return value;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseJsonRecord(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function webhookResourceType(value: unknown): PaymentWebhookResourceType | null {
  switch (value) {
    case 'payment':
    case 'subscription_authorized_payment':
      return 'payment';
    case 'subscription_preapproval':
      return 'subscription';
    default:
      return null;
  }
}

function headerValue(headers: PaymentWebhookHeaders, name: string): string | string[] | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  if (Array.isArray(entry)) {
    return entry.length === 0 ? null : [...entry];
  }
  return typeof entry === 'string' ? entry : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasHeaderValue(value: string | string[] | null): value is string | string[] {
  if (value === null) {
    return false;
  }
  return typeof value === 'string'
    ? value.trim() !== ''
    : value.some((entry) => entry.trim() !== '');
}
