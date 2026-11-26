import { describe, expect, it } from 'vitest';
import {
  assertPaymentConfiguration,
  ConfigError,
  createPaymentProvider,
  FakePaymentProvider,
  isPaymentTestMode,
  loadConfig,
  paymentConfigurationIssues,
} from '../src/index.ts';
import { MercadoPagoPaymentProvider } from '../src/modules/payments/mercadopago/index.ts';

const database = { DATABASE_URL: 'postgres://nuva_edu:pw@db:5432/nuva_edu' };
const mercadoPago = {
  MP_ACCESS_TOKEN: 'token-secreto-do-teste',
  MP_PUBLIC_KEY: 'chave-publica-do-teste',
  MP_WEBHOOK_SECRET: 'segredo-do-webhook-do-teste',
};

function paymentIssues(env: Record<string, string>): ConfigError {
  try {
    assertPaymentConfiguration(loadConfig({ env: { ...database, ...env } }));
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('A configuração de pagamento deveria ter sido recusada.');
}

describe('configuração e seleção do PaymentProvider', () => {
  it('seleciona mercadopago por padrão e exige os três segredos também em test', () => {
    const error = paymentIssues({ NUVA_ENV: 'test' });
    expect(error.issues).toEqual([
      { variable: 'MP_ACCESS_TOKEN', message: expect.stringContaining('obrigatória') },
      { variable: 'MP_PUBLIC_KEY', message: expect.stringContaining('obrigatória') },
      { variable: 'MP_WEBHOOK_SECRET', message: expect.stringContaining('obrigatória') },
    ]);
    expect(error.message).not.toContain('token-secreto-do-teste');
  });

  it('não duplica erro de segredo declarado explicitamente como obrigatório', () => {
    let caught: ConfigError | null = null;
    try {
      loadConfig({ env: database, required: ['MP_ACCESS_TOKEN'] });
    } catch (error) {
      caught = error as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught?.issues.filter((issue) => issue.variable === 'MP_ACCESS_TOKEN')).toHaveLength(1);
    expect(paymentIssues({}).issues.map((issue) => issue.variable)).toHaveLength(3);
  });

  it('aceita mercadopago configurado sem transformar chave pública em segredo obrigatório do serviço', () => {
    const config = loadConfig({ env: { ...database, ...mercadoPago } });
    expect(config.payment).toMatchObject({
      provider: 'mercadopago',
      mercadoPago: {
        accessToken: mercadoPago.MP_ACCESS_TOKEN,
        publicKey: mercadoPago.MP_PUBLIC_KEY,
        webhookSecret: mercadoPago.MP_WEBHOOK_SECRET,
      },
    });
    expect(paymentConfigurationIssues(config)).toEqual([]);
  });

  it('seleciona fake em development e test sem credenciais, mas nunca em production', () => {
    for (const env of ['development', 'test'] as const) {
      const config = loadConfig({
        env: { ...database, NUVA_ENV: env, NUVA_PAYMENT_PROVIDER: 'fake' },
      });
      expect(config.payment.provider).toBe('fake');
      expect(createPaymentProvider(config)).toBeInstanceOf(FakePaymentProvider);
      expect(createPaymentProvider(config).name).toBe('fake');
    }
    const error = paymentIssues({ NUVA_ENV: 'production', NUVA_PAYMENT_PROVIDER: 'fake' });
    expect(error.issues).toEqual([
      { variable: 'NUVA_PAYMENT_PROVIDER', message: expect.stringContaining('não é permitido') },
    ]);
  });

  it('reaproveita o fake injetado e rejeita um nome desconhecido', () => {
    const config = loadConfig({ env: { ...database, NUVA_PAYMENT_PROVIDER: 'fake' } });
    const fake = new FakePaymentProvider();
    expect(createPaymentProvider(config, { fake })).toBe(fake);
    expect(paymentIssues({ NUVA_PAYMENT_PROVIDER: 'outro' }).issues[0]?.variable).toBe(
      'NUVA_PAYMENT_PROVIDER',
    );
  });

  it('monta o adaptador real com a configuração e aceita injeção nos testes', () => {
    const config = loadConfig({ env: { ...database, ...mercadoPago } });
    const adapter = new FakePaymentProvider();
    expect(createPaymentProvider(config, { mercadoPago: adapter })).toBe(adapter);
    expect(createPaymentProvider(config)).toBeInstanceOf(MercadoPagoPaymentProvider);
  });

  it('recusa a URL simulada fora da configuração fake de desenvolvimento ou teste', () => {
    const url = 'http://payment-fake:8092';
    const env = { NUVA_PAYMENT_FAKE_URL: url };
    expect(paymentIssues(env).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ variable: 'NUVA_PAYMENT_FAKE_URL' })]),
    );
    expect(
      paymentIssues({ ...env, NUVA_ENV: 'production', NUVA_PAYMENT_PROVIDER: 'fake' }).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ variable: 'NUVA_PAYMENT_FAKE_URL' })]),
    );
    const config = loadConfig({ env: { ...database, ...env, NUVA_PAYMENT_PROVIDER: 'fake' } });
    expect(config.payment.fakeUrl).toBe(url);
    expect(createPaymentProvider(config).name).toBe('fake');
    expect(createPaymentProvider(config)).not.toBeInstanceOf(FakePaymentProvider);
  });

  it('indica modo de teste pelo fake ou pelo prefixo TEST- do token, sem expor o token', () => {
    const fake = loadConfig({ env: { ...database, NUVA_PAYMENT_PROVIDER: 'fake' } });
    expect(isPaymentTestMode(fake)).toBe(true);
    const testToken = loadConfig({
      env: { ...database, ...mercadoPago, MP_ACCESS_TOKEN: 'TEST-123-segredo' },
    });
    expect(isPaymentTestMode(testToken)).toBe(true);
    expect(
      isPaymentTestMode(
        loadConfig({
          env: { ...database, ...mercadoPago, MP_ACCESS_TOKEN: 'APP_USR-123-segredo' },
        }),
      ),
    ).toBe(false);
    expect(isPaymentTestMode(loadConfig({ env: database }))).toBe(false);
  });
});
