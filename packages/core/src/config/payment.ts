import { FakePaymentProvider } from '../modules/payments/fake.ts';
import { RemoteFakePaymentProvider } from '../modules/payments/fake-remote.ts';
import { MercadoPagoPaymentProvider } from '../modules/payments/mercadopago/index.ts';
import type { PaymentProvider, PaymentProviderName } from '../modules/payments/types.ts';
import type { Config } from './config.ts';
import { ConfigError, type ConfigIssue } from './env-reader.ts';

export interface PaymentConfig {
  provider: PaymentProviderName;
  fakeUrl: string | null;
  mercadoPago: {
    accessToken: string | null;
    publicKey: string | null;
    webhookSecret: string | null;
  };
  orderPendingMinutes: number;
  orderBoletoDays: number;
  subscriptionGraceDays: number;
}

/** Nomes das variáveis, nunca seus valores. */
export function paymentConfigurationIssues(config: Pick<Config, 'env' | 'payment'>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (config.payment.provider === 'fake' && config.env === 'production') {
    issues.push({
      variable: 'NUVA_PAYMENT_PROVIDER',
      message: 'o provedor fake não é permitido com NUVA_ENV=production',
    });
  }
  if (config.payment.provider === 'mercadopago') {
    const required = {
      MP_ACCESS_TOKEN: config.payment.mercadoPago.accessToken,
      MP_PUBLIC_KEY: config.payment.mercadoPago.publicKey,
      MP_WEBHOOK_SECRET: config.payment.mercadoPago.webhookSecret,
    } as const;
    for (const [variable, value] of Object.entries(required)) {
      if (value === null) {
        issues.push({ variable, message: 'obrigatória com NUVA_PAYMENT_PROVIDER=mercadopago' });
      }
    }
  }
  return issues;
}

/** O ambiente de teste não altera esta exigência: só `provider = fake` dispensa os segredos. */
export function assertPaymentConfiguration(config: Pick<Config, 'env' | 'payment'>): void {
  const issues = paymentConfigurationIssues(config);
  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
}

export interface CreatePaymentProviderOptions {
  /** Permite injetar o adaptador em testes, inclusive no lugar do Mercado Pago real. */
  mercadoPago?: PaymentProvider;
  /** Permite compartilhar o estado do fake entre serviços no mesmo processo de teste. */
  fake?: FakePaymentProvider;
}

export function createPaymentProvider(
  config: Pick<Config, 'env' | 'payment' | 'currency' | 'classroomUrl'>,
  options: CreatePaymentProviderOptions = {},
): PaymentProvider {
  assertPaymentConfiguration(config);
  if (config.payment.provider === 'fake') {
    if (options.fake !== undefined) return options.fake;
    return config.payment.fakeUrl === null
      ? new FakePaymentProvider({ currency: config.currency })
      : new RemoteFakePaymentProvider(config.payment.fakeUrl, config.currency);
  }
  if (options.mercadoPago !== undefined) return options.mercadoPago;
  const { accessToken, webhookSecret } = config.payment.mercadoPago;
  if (accessToken === null || webhookSecret === null) {
    throw new TypeError('Configuração do provedor de pagamento incompleta.');
  }
  return new MercadoPagoPaymentProvider({
    accessToken,
    webhookSecret,
    notificationUrl: `${config.classroomUrl}/api/v1/webhooks/mercadopago`,
    planBackUrl: `${config.classroomUrl}/conta/compras`,
  });
}

export function configuredPaymentProviderName(
  config: Pick<Config, 'payment'>,
): PaymentProviderName {
  return config.payment.provider;
}

/** Indicador da spec 013; a origem do token não é devolvida nem registrada. */
export function isPaymentTestMode(config: Pick<Config, 'payment'>): boolean {
  const token = config.payment.mercadoPago.accessToken;
  return config.payment.provider === 'fake' || token?.startsWith('TEST-') === true;
}
