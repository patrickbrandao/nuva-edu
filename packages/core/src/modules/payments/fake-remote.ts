import { DomainError } from '../../errors/domain-error.ts';
import { paymentUnavailable } from './errors.ts';
import { FakePaymentProvider } from './fake.ts';
import type {
  CreateCheckoutInput,
  CreateSubscriptionInput,
  EnsurePaymentPlanInput,
  ParsePaymentWebhookInput,
  PaymentExternalReference,
  PaymentProvider,
  ProviderPayment,
  ProviderSubscription,
} from './types.ts';

type PaymentWire = Omit<ProviderPayment, 'paidAt'> & { paidAt: string | null };
type SubscriptionDates = 'currentPeriodStart' | 'currentPeriodEnd' | 'nextBillingAt';
type SubscriptionWire = Omit<ProviderSubscription, SubscriptionDates> &
  Record<SubscriptionDates, string | null>;
type RemoteMethods = Omit<PaymentProvider, 'name' | 'parseWebhook'>;

const date = (value: string | null) => (value === null ? null : new Date(value));
const paymentFromWire = (payment: PaymentWire): ProviderPayment => ({
  ...payment,
  paidAt: date(payment.paidAt),
});

/** Proxy para o fake compartilhado por processos no ambiente local e nos e2e. */
export class RemoteFakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly #url: string;
  readonly #currency: string;

  constructor(url: string, currency: string) {
    this.#url = url;
    this.#currency = currency;
  }

  createCheckout(input: CreateCheckoutInput) {
    return this.#call('createCheckout', [input]);
  }

  async getPayment(id: string): Promise<ProviderPayment> {
    const payment = await this.#request<PaymentWire>('getPayment', [id]);
    return paymentFromWire(payment);
  }

  async findPaymentsByReference(reference: PaymentExternalReference): Promise<ProviderPayment[]> {
    const payments = await this.#request<PaymentWire[]>('findPaymentsByReference', [reference]);
    return payments.map(paymentFromWire);
  }

  cancelCheckout(id: string) {
    return this.#call('cancelCheckout', [id]);
  }

  ensurePlan(input: EnsurePaymentPlanInput) {
    return this.#call('ensurePlan', [input]);
  }

  createSubscription(input: CreateSubscriptionInput) {
    return this.#call('createSubscription', [input]);
  }

  async getSubscription(id: string): Promise<ProviderSubscription> {
    const row = await this.#request<SubscriptionWire>('getSubscription', [id]);
    return {
      ...row,
      currentPeriodStart: date(row.currentPeriodStart),
      currentPeriodEnd: date(row.currentPeriodEnd),
      nextBillingAt: date(row.nextBillingAt),
    };
  }

  cancelSubscription(id: string) {
    return this.#call('cancelSubscription', [id]);
  }

  refund(id: string, cents: number | null, key?: string) {
    return this.#call('refund', key === undefined ? [id, cents] : [id, cents, key]);
  }

  getRefundStatus(paymentId: string, refundId: string) {
    return this.#call('getRefundStatus', [paymentId, refundId]);
  }

  parseWebhook(input: ParsePaymentWebhookInput) {
    // A assinatura continua a ser conferida localmente, sem encaminhar o corpo bruto.
    return new FakePaymentProvider({ currency: this.#currency, now: Date.now() }).parseWebhook(
      input,
    );
  }

  #call<M extends keyof RemoteMethods>(method: M, args: Parameters<RemoteMethods[M]>) {
    return this.#request<Awaited<ReturnType<RemoteMethods[M]>>>(method, args);
  }

  async #request<T>(method: keyof RemoteMethods, args: readonly unknown[]): Promise<T> {
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(`${this.#url}/rpc/${method}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10_000),
      });
      body = await response.json();
    } catch {
      throw paymentUnavailable();
    }
    if (response.ok) return body as T;
    if (
      [400, 404, 422].includes(response.status) &&
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string' &&
      /^[a-z][a-z0-9_]*$/.test(body.code)
    ) {
      throw new DomainError({
        code: body.code,
        status: response.status,
        title: 'Operação recusada pelo provedor simulado',
      });
    }
    throw paymentUnavailable();
  }
}
