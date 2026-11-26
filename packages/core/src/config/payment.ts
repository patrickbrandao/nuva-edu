import { FakePaymentProvider } from '../modules/payments/fake.ts';
import type { PaymentProvider, PaymentProviderName } from '../modules/payments/types.ts';
import type { Config } from './config.ts';
import { ConfigError, type ConfigIssue } from './env-reader.ts';

export interface PaymentConfig {
  provider: PaymentProviderName;
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
  /** Injetado pela composição depois da tarefa 520; nenhum segredo sai da configuração. */
  mercadoPago?: PaymentProvider;
  /** Permite compartilhar o estado do fake entre serviços no mesmo processo de teste. */
  fake?: FakePaymentProvider;
}

export function createPaymentProvider(
  config: Pick<Config, 'env' | 'payment' | 'currency'>,
  options: CreatePaymentProviderOptions = {},
): PaymentProvider {
  assertPaymentConfiguration(config);
  if (config.payment.provider === 'fake') {
    return options.fake ?? new FakePaymentProvider({ currency: config.currency });
  }
  if (options.mercadoPago === undefined) {
    throw new Error('O adaptador mercadopago deve ser fornecido pela composição do serviço.');
  }
  return options.mercadoPago;
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
