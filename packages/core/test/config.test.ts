import { createPrivateKey } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  DEFAULT_TRUSTED_PROXIES,
  loadConfig,
  loadConfigOrExit,
  OAUTH_MOCK_CLIENTS,
} from '../src/index.ts';

const base = { DATABASE_URL: 'postgres://nuva_edu:pw-do-banco@db:5432/nuva_edu' };
/** 32 caracteres: o mínimo da spec 031. */
const sessionSecret = 'segredo-de-sessao-com-32-letras!';

function issuesOf(
  env: Record<string, string | undefined>,
  required?: Parameters<typeof loadConfig>[0],
) {
  try {
    loadConfig({ env, ...required });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('loadConfig deveria ter falhado');
}

describe('loadConfig', () => {
  it('aplica os padrões da spec 031 quando só o banco é informado', () => {
    const config = loadConfig({ env: base });
    expect(config).toMatchObject({
      env: 'development',
      logLevel: 'info',
      databaseUrl: base.DATABASE_URL,
      domain: 'localhost',
      adminHost: 'edu-admin.localhost',
      classroomHost: 'classroom.localhost',
      publicScheme: 'http',
      publicPort: 8080,
      adminUrl: 'http://edu-admin.localhost:8080',
      classroomUrl: 'http://classroom.localhost:8080',
      currency: 'BRL',
      locale: 'pt-BR',
      sessionSecret: null,
      admin: { email: null, password: null },
      smtp: {
        host: 'mailpit',
        port: 1025,
        user: null,
        password: null,
        from: 'nuva-edu <no-reply@localhost>',
      },
      payment: {
        provider: 'mercadopago',
        fakeUrl: null,
        mercadoPago: { accessToken: null, publicKey: null, webhookSecret: null },
        orderPendingMinutes: 30,
        orderBoletoDays: 3,
        subscriptionGraceDays: 3,
      },
      authProviders: { google: null, facebook: null, apple: null },
      oauthMock: null,
      workerConcurrency: 10,
      mcp: { ratePerMinute: 120, maxKeys: 20 },
      images: { maxUploadMb: 5, caseMaxImages: 8, uploadsPerHour: 30 },
      accountDeletionGraceDays: 7,
    });
    expect(config.trustedProxies).toEqual(DEFAULT_TRUSTED_PROXIES);
    expect(config.retention).toEqual({
      sessionDays: 30,
      emailTokenHours: 24,
      loginAttemptDays: 30,
      jobDoneDays: 7,
      jobFailedDays: 30,
      notificationDays: 90,
      notificationUnreadDays: 180,
      emailSentDays: 30,
      emailFailedDays: 90,
      webhookDays: 90,
      auditDays: 730,
      moderationDays: 730,
      cartDays: 30,
      fiscalYears: 5,
    });
  });

  it('lê os prazos de retenção da Fase 1 e recusa zero (spec 033)', () => {
    const retention = loadConfig({
      env: {
        ...base,
        NUVA_RETENTION_AUDIT_DAYS: '365',
        NUVA_RETENTION_SESSION_DAYS: '14',
        NUVA_RETENTION_EMAIL_TOKEN_HOURS: '2',
        NUVA_RETENTION_LOGIN_ATTEMPT_DAYS: '10',
        NUVA_RETENTION_EMAIL_SENT_DAYS: '5',
        NUVA_RETENTION_EMAIL_FAILED_DAYS: '60',
      },
    }).retention;
    expect(retention).toMatchObject({
      auditDays: 365,
      sessionDays: 14,
      emailTokenHours: 2,
      loginAttemptDays: 10,
      emailSentDays: 5,
      emailFailedDays: 60,
    });
    const error = issuesOf({
      ...base,
      NUVA_RETENTION_AUDIT_DAYS: '0',
      NUVA_RETENTION_EMAIL_TOKEN_HOURS: '0',
      NUVA_RETENTION_EMAIL_FAILED_DAYS: 'muito',
    });
    expect(error.issues.map((issue) => issue.variable).sort()).toEqual([
      'NUVA_RETENTION_AUDIT_DAYS',
      'NUVA_RETENTION_EMAIL_FAILED_DAYS',
      'NUVA_RETENTION_EMAIL_TOKEN_HOURS',
    ]);
  });

  it('recusa NUVA_RETENTION_AUDIT_DAYS abaixo de 365 na subida (spec 028, RNF-01)', () => {
    const error = issuesOf({ ...base, NUVA_RETENTION_AUDIT_DAYS: '364' });
    expect(error.issues).toEqual([
      {
        variable: 'NUVA_RETENTION_AUDIT_DAYS',
        message: 'deve ser um inteiro maior ou igual a 365; recebido "364"',
      },
    ]);
    expect(
      loadConfig({ env: { ...base, NUVA_RETENTION_AUDIT_DAYS: '365' } }).retention.auditDays,
    ).toBe(365);
    expect(loadConfig({ env: base }).retention.auditDays).toBe(730);
  });

  it('lê process.env quando nenhum ambiente é passado', () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = base.DATABASE_URL;
    try {
      expect(loadConfig().databaseUrl).toBe(base.DATABASE_URL);
    } finally {
      if (before === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = before;
      }
    }
  });

  it('deriva hosts, remetente e URLs do domínio', () => {
    const config = loadConfig({
      env: {
        ...base,
        NUVA_DOMAIN: 'escola.example',
        NUVA_PUBLIC_SCHEME: 'https',
        NUVA_PUBLIC_PORT: '',
        NUVA_ENV: 'production',
        NUVA_LOG_LEVEL: 'warn',
      },
    });
    expect(config.adminHost).toBe('edu-admin.escola.example');
    expect(config.classroomUrl).toBe('https://classroom.escola.example');
    expect(config.publicPort).toBeNull();
    expect(config.smtp.from).toBe('nuva-edu <no-reply@escola.example>');
    expect(config.env).toBe('production');
    expect(config.logLevel).toBe('warn');
  });

  it('omite da URL a porta padrão do esquema', () => {
    const https = loadConfig({
      env: { ...base, NUVA_PUBLIC_SCHEME: 'https', NUVA_PUBLIC_PORT: '443' },
    });
    expect(https.adminUrl).toBe('https://edu-admin.localhost');
    const custom = loadConfig({ env: { ...base, NUVA_PUBLIC_PORT: ' 8443 ' } });
    expect(custom.adminUrl).toBe('http://edu-admin.localhost:8443');
  });

  it('monta a URL do banco das variáveis POSTGRES_* quando falta DATABASE_URL', () => {
    const config = loadConfig({
      env: {
        POSTGRES_PASSWORD: 'p@ss/word',
        POSTGRES_HOST: 'postgres',
        NUVA_POSTGRES_PORT: '54329',
        POSTGRES_DB: 'escola',
      },
    });
    expect(config.databaseUrl).toBe('postgres://nuva_edu:p%40ss%2Fword@postgres:54329/escola');
    expect(loadConfig({ env: { POSTGRES_PASSWORD: 'x' } }).databaseUrl).toBe(
      'postgres://nuva_edu:x@127.0.0.1:5432/nuva_edu',
    );
  });

  it('falha citando DATABASE_URL quando não há conexão configurada', () => {
    const error = issuesOf({});
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('POSTGRES_PASSWORD');
    expect(error.issues.map((issue) => issue.variable)).toEqual(['DATABASE_URL']);
  });

  it('recusa DATABASE_URL malformada sem repetir o valor, que carrega a senha', () => {
    for (const url of [
      'não é url',
      'mysql://u:segredo-do-banco@h/db',
      'postgres://u:segredo-do-banco@h',
    ]) {
      const error = issuesOf({ DATABASE_URL: url });
      expect(error.issues[0]?.variable).toBe('DATABASE_URL');
      expect(error.message).not.toContain('segredo-do-banco');
    }
  });

  it('exige só os segredos que o serviço declara, citando cada variável que falta', () => {
    expect(() => loadConfig({ env: base })).not.toThrow();
    const error = issuesOf(base, {
      required: ['SESSION_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'MP_ACCESS_TOKEN'],
    });
    expect(error.name).toBe('ConfigError');
    expect(error.issues.map((issue) => issue.variable)).toEqual([
      'ADMIN_EMAIL',
      'SESSION_SECRET',
      'ADMIN_PASSWORD',
      'MP_ACCESS_TOKEN',
    ]);
    for (const variable of ['SESSION_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'MP_ACCESS_TOKEN']) {
      expect(error.message).toContain(variable);
    }
  });

  it('trata valor vazio ou só com espaços como ausente', () => {
    const error = issuesOf({ ...base, SESSION_SECRET: '   ' }, { required: ['SESSION_SECRET'] });
    expect(error.issues).toEqual([
      { variable: 'SESSION_SECRET', message: expect.stringContaining('obrigatória') },
    ]);
    expect(loadConfig({ env: { ...base, NUVA_CURRENCY: '' } }).currency).toBe('BRL');
  });

  it('entrega os segredos informados', () => {
    const config = loadConfig({
      env: {
        ...base,
        SESSION_SECRET: sessionSecret,
        ADMIN_EMAIL: 'admin@escola.example',
        ADMIN_PASSWORD: 'senha-legivel',
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 's2',
        MP_ACCESS_TOKEN: 't1',
        MP_PUBLIC_KEY: 'k1',
        MP_WEBHOOK_SECRET: 'w1',
      },
      required: ['SESSION_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'],
    });
    expect(config.sessionSecret).toBe(sessionSecret);
    expect(config.admin).toEqual({ email: 'admin@escola.example', password: 'senha-legivel' });
    expect(config.smtp).toMatchObject({ user: 'mailer', password: 's2' });
    expect(config.payment.mercadoPago).toEqual({
      accessToken: 't1',
      publicKey: 'k1',
      webhookSecret: 'w1',
    });
  });

  it('acumula todos os valores inválidos num único erro, cada um com sua variável', () => {
    const error = issuesOf({
      ...base,
      NUVA_ENV: 'staging',
      NUVA_LOG_LEVEL: 'verbose',
      NUVA_PUBLIC_SCHEME: 'ftp',
      NUVA_PUBLIC_PORT: '70000',
      NUVA_ADMIN_HOST: 'https://admin.example',
      NUVA_CURRENCY: 'real',
      NUVA_LOCALE: 'português',
      SMTP_PORT: 'abc',
      NUVA_WORKER_CONCURRENCY: '0',
      NUVA_RETENTION_SESSION_DAYS: '1.5',
      NUVA_SUBSCRIPTION_GRACE_DAYS: '-1',
      ADMIN_EMAIL: 'sem-arroba',
      TRUSTED_PROXIES: '10.0.0.0/8, proxy, 10.0.0.0/40, ::1/129, 1.2.3.4/5/6',
    });
    const variables = error.issues.map((issue) => issue.variable);
    expect(new Set(variables)).toEqual(
      new Set([
        'NUVA_ENV',
        'NUVA_LOG_LEVEL',
        'NUVA_PUBLIC_SCHEME',
        'NUVA_PUBLIC_PORT',
        'NUVA_ADMIN_HOST',
        'NUVA_CURRENCY',
        'NUVA_LOCALE',
        'SMTP_PORT',
        'NUVA_WORKER_CONCURRENCY',
        'NUVA_RETENTION_SESSION_DAYS',
        'NUVA_SUBSCRIPTION_GRACE_DAYS',
        'ADMIN_EMAIL',
        'TRUSTED_PROXIES',
      ]),
    );
    expect(variables.filter((variable) => variable === 'TRUSTED_PROXIES')).toHaveLength(4);
    expect(error.message).toMatch(/NUVA_WORKER_CONCURRENCY: deve ser um inteiro entre 1 e 100/);
    expect(error.message).toMatch(
      /NUVA_SUBSCRIPTION_GRACE_DAYS: deve ser um inteiro maior ou igual a 0/,
    );
  });

  it('guarda NUVA_LOCALE na forma canônica, sem diferenciar maiúsculas', () => {
    const locale = (value: string) => loadConfig({ env: { ...base, NUVA_LOCALE: value } }).locale;
    expect(locale('pt-br')).toBe('pt-BR');
    expect(locale('PT-BR')).toBe('pt-BR');
    expect(locale(' en-us ')).toBe('en-US');
    expect(locale('ES')).toBe('es');
    expect(locale('zh-hant-tw')).toBe('zh-Hant-TW');
  });

  it.each([
    ['português'],
    ['pt_BR'],
    ['p'],
    // No formato da spec, mas recusadas pelo Intl: subetiqueta repetida e variante inválida.
    ['pt-br-br'],
    ['en-gb-oed'],
  ])('NUVA_LOCALE=%s falha na subida', (value) => {
    const error = issuesOf({ ...base, NUVA_LOCALE: value });
    expect(error.issues).toEqual([
      { variable: 'NUVA_LOCALE', message: expect.stringContaining(`recebido "${value}"`) },
    ]);
  });

  it('a lista padrão de TRUSTED_PROXIES é a da spec 031, e a variável a substitui inteira', () => {
    expect([...DEFAULT_TRUSTED_PROXIES]).toEqual([
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '::1/128',
      '169.254.0.0/16',
      'fe80::/10',
      'fc00::/7',
    ]);
    const restricted = loadConfig({ env: { ...base, TRUSTED_PROXIES: '172.18.0.0/16' } });
    expect(restricted.trustedProxies).toEqual(['172.18.0.0/16']);
  });

  it.each([
    // [conexão, lista padrão confia?]
    ['100.64.0.1', true],
    ['100.127.255.254', true],
    ['100.128.0.1', false],
    ['169.254.0.1', true],
    ['169.255.0.1', false],
    ['fe80::1', true],
    ['fec0::1', false],
    ['::1', true],
    ['::2', false],
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.18.0.5', true],
    ['172.32.0.1', false],
    ['192.168.1.10', true],
    ['fd12:3456::1', true],
    ['45.80.10.20', false],
    ['2001:db8::1', false],
  ] as const)('conexão vinda de %s: proxy confiável na lista padrão = %s', (address, trusted) => {
    // Mesma leitura que o api-kit faz de `config.trustedProxies` (BlockList do Node).
    const contains = (entries: readonly string[]) => {
      const list = new BlockList();
      for (const entry of entries) {
        const [network = '', prefix] = entry.split('/');
        const family = isIP(network) === 4 ? 'ipv4' : 'ipv6';
        list.addSubnet(network, Number(prefix ?? (family === 'ipv4' ? 32 : 128)), family);
      }
      return list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
    };
    expect(contains(loadConfig({ env: base }).trustedProxies)).toBe(trusted);
    // Restrita a outra faixa, a origem deixa de ser confiável.
    const restricted = loadConfig({ env: { ...base, TRUSTED_PROXIES: '203.0.113.0/24' } });
    expect(contains(restricted.trustedProxies)).toBe(false);
  });

  it('aceita IPs e faixas em TRUSTED_PROXIES', () => {
    const config = loadConfig({
      env: { ...base, TRUSTED_PROXIES: '172.18.0.0/16, ::1,10.1.2.3,' },
    });
    expect(config.trustedProxies).toEqual(['172.18.0.0/16', '::1', '10.1.2.3']);
  });

  it('liga o provedor de login só com todas as credenciais; pela metade é erro', () => {
    const config = loadConfig({
      env: {
        ...base,
        GOOGLE_CLIENT_ID: 'gid',
        GOOGLE_CLIENT_SECRET: 'gsecret',
        APPLE_CLIENT_ID: 'aid',
        APPLE_TEAM_ID: 'team',
        APPLE_KEY_ID: 'kid',
        APPLE_PRIVATE_KEY: 'pem',
      },
    });
    expect(config.authProviders).toEqual({
      google: { clientId: 'gid', clientSecret: 'gsecret' },
      facebook: null,
      apple: { clientId: 'aid', teamId: 'team', keyId: 'kid', privateKey: 'pem' },
    });

    const error = issuesOf({ ...base, FACEBOOK_APP_ID: 'fid', APPLE_TEAM_ID: 'team' });
    expect(error.issues.map((issue) => issue.variable)).toEqual([
      'FACEBOOK_APP_SECRET',
      'APPLE_CLIENT_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
    ]);
    expect(error.message).toContain('FACEBOOK_APP_SECRET: obrigatória quando FACEBOOK_APP_ID');
  });

  it('converte o \\n literal de APPLE_PRIVATE_KEY em quebra de linha', () => {
    const config = loadConfig({
      env: {
        ...base,
        APPLE_CLIENT_ID: 'aid',
        APPLE_TEAM_ID: 'team',
        APPLE_KEY_ID: 'kid',
        APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nMIGT\\nAbCd\\n-----END PRIVATE KEY-----',
      },
    });
    expect(config.authProviders.apple?.privateKey).toBe(
      '-----BEGIN PRIVATE KEY-----\nMIGT\nAbCd\n-----END PRIVATE KEY-----',
    );
  });

  it('exige SESSION_SECRET com no mínimo 32 caracteres, sem repetir o valor', () => {
    const curto = 'segredo-de-sessao-com-31-letras';
    expect(curto).toHaveLength(31);
    const error = issuesOf({ ...base, SESSION_SECRET: curto });
    expect(error.issues).toEqual([
      { variable: 'SESSION_SECRET', message: expect.stringContaining('no mínimo 32 caracteres') },
    ]);
    expect(error.message).not.toContain(curto);
    expect(loadConfig({ env: { ...base, SESSION_SECRET: sessionSecret } }).sessionSecret).toBe(
      sessionSecret,
    );
  });

  it('exige ADMIN_PASSWORD de 8 a 128 caracteres, sem repetir o valor', () => {
    for (const password of ['senha12', 'x'.repeat(129)]) {
      const error = issuesOf({ ...base, ADMIN_PASSWORD: password });
      expect(error.issues).toEqual([
        { variable: 'ADMIN_PASSWORD', message: 'deve ter de 8 a 128 caracteres' },
      ]);
      expect(error.message).not.toContain(password);
    }
    for (const password of ['senha123', 'x'.repeat(128), 'ação-çãé']) {
      expect(loadConfig({ env: { ...base, ADMIN_PASSWORD: password } }).admin.password).toBe(
        password,
      );
    }
  });

  it('o simulador OAuth liga os três provedores com as credenciais fixas e ignora as reais', () => {
    const config = loadConfig({
      env: {
        ...base,
        NUVA_OAUTH_MOCK_URL: 'http://oauth-mock.localhost:8080/',
        GOOGLE_CLIENT_ID: 'real-id',
        GOOGLE_CLIENT_SECRET: 'real-secret',
        // Pela metade seria erro; com o simulador, nem é lida.
        FACEBOOK_APP_ID: 'real-fb',
      },
    });
    expect(config.oauthMock).toEqual({
      url: 'http://oauth-mock.localhost:8080',
      internalUrl: 'http://oauth-mock.localhost:8080',
    });
    expect(config.authProviders.google).toEqual(OAUTH_MOCK_CLIENTS.google);
    expect(config.authProviders.facebook).toEqual(OAUTH_MOCK_CLIENTS.facebook);
    expect(config.authProviders.apple).toMatchObject(OAUTH_MOCK_CLIENTS.apple);
    const key = createPrivateKey(config.authProviders.apple?.privateKey ?? '');
    expect(key.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
  });

  it('as credenciais fixas são as mesmas do simulador (scripts/oauth-mock)', async () => {
    // Caminho em variável: o simulador é JavaScript sem declaração de tipos.
    const simulator = new URL('../../../scripts/oauth-mock/server.mjs', import.meta.url).href;
    const { TEST_CLIENTS } = (await import(simulator)) as {
      TEST_CLIENTS: Record<'google' | 'facebook' | 'apple', Record<string, string>>;
    };
    expect(OAUTH_MOCK_CLIENTS).toEqual({
      google: TEST_CLIENTS.google,
      facebook: {
        clientId: TEST_CLIENTS.facebook.appId,
        clientSecret: TEST_CLIENTS.facebook.appSecret,
      },
      apple: TEST_CLIENTS.apple,
    });
  });

  it('usa NUVA_OAUTH_MOCK_INTERNAL_URL na troca do código quando definida', () => {
    const config = loadConfig({
      env: {
        ...base,
        NUVA_ENV: 'test',
        NUVA_OAUTH_MOCK_URL: 'https://oauth-mock.escola.test',
        NUVA_OAUTH_MOCK_INTERNAL_URL: 'http://oauth-mock:8080',
      },
    });
    expect(config.oauthMock).toEqual({
      url: 'https://oauth-mock.escola.test',
      internalUrl: 'http://oauth-mock:8080',
    });
  });

  it('recusa o simulador OAuth com NUVA_ENV=production, citando a variável', () => {
    const error = issuesOf({
      ...base,
      NUVA_ENV: 'production',
      NUVA_OAUTH_MOCK_URL: 'https://oauth-mock.escola.example',
    });
    expect(error.issues).toEqual([
      { variable: 'NUVA_OAUTH_MOCK_URL', message: expect.stringContaining('NUVA_ENV=production') },
    ]);
    expect(
      loadConfig({ env: { ...base, NUVA_ENV: 'production' } }).authProviders.google,
    ).toBeNull();
  });

  it('recusa URL inválida do simulador e endereço interno sem o público', () => {
    const error = issuesOf({
      ...base,
      NUVA_OAUTH_MOCK_URL: 'oauth-mock.localhost',
      NUVA_OAUTH_MOCK_INTERNAL_URL: 'ftp://oauth-mock',
    });
    expect(error.issues.map((issue) => issue.variable)).toEqual([
      'NUVA_OAUTH_MOCK_URL',
      'NUVA_OAUTH_MOCK_INTERNAL_URL',
    ]);
    for (const url of ['http://oauth-mock?x=1', 'http://u:p@oauth-mock', 'http://oauth-mock/#a']) {
      expect(issuesOf({ ...base, NUVA_OAUTH_MOCK_URL: url }).issues).toHaveLength(1);
    }

    expect(
      issuesOf({ ...base, NUVA_OAUTH_MOCK_INTERNAL_URL: 'http://oauth-mock:8080' }).issues,
    ).toEqual([
      {
        variable: 'NUVA_OAUTH_MOCK_INTERNAL_URL',
        message: 'só vale com NUVA_OAUTH_MOCK_URL definida',
      },
    ]);
  });
});

describe('loadConfigOrExit', () => {
  it('devolve a configuração quando ela é válida', () => {
    const exit = () => {
      throw new Error('não deveria sair');
    };
    expect(loadConfigOrExit({ env: base, exit }).databaseUrl).toBe(base.DATABASE_URL);
  });

  it('derruba o processo com código 1 e uma linha JSON que cita a variável', () => {
    const lines: string[] = [];
    const codes: number[] = [];
    const exit = (code: number): never => {
      codes.push(code);
      throw new Error('exit');
    };
    expect(() =>
      loadConfigOrExit({
        env: base,
        required: ['SESSION_SECRET'],
        service: 'admin-api',
        write: (line) => lines.push(line),
        exit,
      }),
    ).toThrow('exit');
    expect(codes).toEqual([1]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    const line = JSON.parse(lines[0] ?? '');
    expect(line).toMatchObject({
      level: 'fatal',
      service: 'admin-api',
      variables: ['SESSION_SECRET'],
    });
    expect(line.msg).toContain('SESSION_SECRET');
    expect(Number.isNaN(Date.parse(line.time))).toBe(false);
  });
});
