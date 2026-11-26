import { generateKeyPairSync } from 'node:crypto';
import { writeSync } from 'node:fs';
import { isIP } from 'node:net';
import { LOG_LEVELS, type LogLevel } from '../logging/logger.ts';
import { AUDIT_RETENTION_DEFAULT_DAYS, AUDIT_RETENTION_MIN_DAYS } from '../modules/audit/purge.ts';
import { ConfigError, type Env, EnvReader } from './env-reader.ts';
import type { PaymentConfig } from './payment.ts';

/** Variáveis sem valor padrão, que cada serviço declara como obrigatórias conforme o que usa. */
export type SecretVariable =
  | 'SESSION_SECRET'
  | 'ADMIN_EMAIL'
  | 'ADMIN_PASSWORD'
  | 'SMTP_PASSWORD'
  | 'MP_ACCESS_TOKEN'
  | 'MP_WEBHOOK_SECRET';

export interface LoadConfigOptions {
  /** Padrão: `process.env`. */
  env?: Env;
  /** Segredos que este serviço exige. A conexão com o banco é sempre obrigatória. */
  required?: readonly SecretVariable[];
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AppleCredentials {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

/** Configuração da instalação, lida das variáveis da spec 031. Segredo ausente vale `null`. */
export interface Config {
  env: 'development' | 'test' | 'production';
  logLevel: LogLevel;
  databaseUrl: string;
  domain: string;
  adminHost: string;
  classroomHost: string;
  publicScheme: 'http' | 'https';
  /** `null` quando a porta é a padrão do esquema (80 ou 443). */
  publicPort: number | null;
  adminUrl: string;
  classroomUrl: string;
  currency: string;
  /** Etiqueta BCP 47 na forma canônica (`pt-BR`), seja como for que `NUVA_LOCALE` foi escrita. */
  locale: string;
  sessionSecret: string | null;
  admin: { email: string | null; password: string | null };
  smtp: {
    host: string;
    port: number;
    user: string | null;
    password: string | null;
    from: string;
  };
  payment: PaymentConfig;
  /**
   * Provedor não configurado vale `null` e fica desligado. Com o simulador ligado (`oauthMock`),
   * os três valem as credenciais fixas de teste (`OAUTH_MOCK_CLIENTS`).
   */
  authProviders: {
    google: OAuthCredentials | null;
    facebook: OAuthCredentials | null;
    apple: AppleCredentials | null;
  };
  /**
   * Provedor OAuth simulado (ADR 0024), ligado por `NUVA_OAUTH_MOCK_URL`; `null` desligado.
   * `url` é o endereço visto pelo navegador; `internalUrl`, o usado pela API na troca do código.
   * Ambos sem a barra final.
   */
  oauthMock: { url: string; internalUrl: string } | null;
  trustedProxies: readonly string[];
  retention: {
    sessionDays: number;
    emailTokenHours: number;
    loginAttemptDays: number;
    jobDoneDays: number;
    jobFailedDays: number;
    notificationDays: number;
    notificationUnreadDays: number;
    emailSentDays: number;
    emailFailedDays: number;
    webhookDays: number;
    auditDays: number;
    moderationDays: number;
    cartDays: number;
    fiscalYears: number;
  };
  workerConcurrency: number;
  mcp: { ratePerMinute: number; maxKeys: number };
  images: { maxUploadMb: number; caseMaxImages: number; uploadsPerHour: number };
  accountDeletionGraceDays: number;
}

/**
 * Origens de onde um proxy na mesma máquina ou na mesma rede interna pode chegar (spec 031,
 * "IP real do cliente"): redes privadas, CGNAT, laço local, link-local e ULA do IPv6.
 *
 * O padrão é amplo para funcionar atrás de qualquer proxy sem configuração. O custo: um cliente
 * cujo endereço real cai numa dessas faixas (rede interna da escola, mesmo CGNAT do servidor) é
 * tratado como proxy, e o `X-Forwarded-For` que ele enviar é aceito, ou seja, ele consegue
 * forjar o próprio IP. Quem atende usuários assim restringe `TRUSTED_PROXIES` à rede do proxy.
 */
export const DEFAULT_TRUSTED_PROXIES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '::1/128',
  '169.254.0.0/16',
  'fe80::/10',
  'fc00::/7',
] as const;

/** Limites da spec 031 e da spec 007, contados em caracteres. */
export const SESSION_SECRET_MIN_LENGTH = 32;
export const ADMIN_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

/**
 * Credenciais fixas de teste do simulador (`scripts/oauth-mock/`, `TEST_CLIENTS`), usadas com
 * `NUVA_OAUTH_MOCK_URL` definida. Não são segredo: só valem contra o simulador. A Apple não tem
 * chave fixa: o simulador não confere a assinatura do `client_secret`, e cada carga da
 * configuração gera uma chave P-256 nova.
 */
export const OAUTH_MOCK_CLIENTS = {
  google: {
    clientId: 'nuva-edu-mock.apps.googleusercontent.com',
    clientSecret: 'nuva-edu-mock-google-secret',
  },
  facebook: { clientId: '1000000000000001', clientSecret: 'nuva-edu-mock-facebook-secret' },
  apple: { clientId: 'br.com.tmsoft.nuva-edu.mock', teamId: 'NUVAEDUTM1', keyId: 'NUVAEDUKY1' },
} as const;

/** Etiqueta BCP 47 aceita em `NUVA_LOCALE` (spec 031), sem diferenciar maiúsculas. */
const LOCALE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/**
 * Lê e valida a configuração. Lança `ConfigError` com todas as variáveis problemáticas de uma
 * vez; nenhum valor de variável secreta aparece na mensagem.
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const reader = new EnvReader(options.env ?? process.env);
  const required = new Set<SecretVariable>(options.required ?? []);
  const secret = (name: SecretVariable) => reader.secret(name, required.has(name));

  const domain = reader.matching('NUVA_DOMAIN', 'localhost', HOST_PATTERN, 'deve ser um domínio');
  const adminHost = reader.matching(
    'NUVA_ADMIN_HOST',
    `edu-admin.${domain}`,
    HOST_PATTERN,
    'deve ser um nome de host, sem esquema nem porta',
  );
  const classroomHost = reader.matching(
    'NUVA_CLASSROOM_HOST',
    `classroom.${domain}`,
    HOST_PATTERN,
    'deve ser um nome de host, sem esquema nem porta',
  );
  const publicScheme = reader.oneOf('NUVA_PUBLIC_SCHEME', 'http', ['http', 'https']);
  const publicPort = readPublicPort(reader, options.env ?? process.env, publicScheme);
  const origin = (host: string) =>
    `${publicScheme}://${host}${publicPort === null ? '' : `:${publicPort}`}`;

  const adminEmail = secret('ADMIN_EMAIL');
  if (adminEmail !== null && !/^[^\s@]+@[^\s@]+$/.test(adminEmail)) {
    reader.fail('ADMIN_EMAIL', 'deve ser um endereço de e-mail');
  }

  const env = reader.oneOf('NUVA_ENV', 'development', ['development', 'test', 'production']);
  const oauthMock = readOAuthMock(reader, env);
  const paymentProvider = reader.oneOf('NUVA_PAYMENT_PROVIDER', 'mercadopago', [
    'mercadopago',
    'fake',
  ]);
  const paymentFakeUrl = reader.optional('NUVA_PAYMENT_FAKE_URL');
  if (paymentFakeUrl !== null && (paymentProvider !== 'fake' || env === 'production')) {
    reader.fail('NUVA_PAYMENT_FAKE_URL', 'só vale com provedor fake fora de produção');
  }

  const config: Config = {
    env,
    logLevel: reader.oneOf('NUVA_LOG_LEVEL', 'info', LOG_LEVELS),
    databaseUrl: readDatabaseUrl(reader),
    domain,
    adminHost,
    classroomHost,
    publicScheme,
    publicPort,
    adminUrl: origin(adminHost),
    classroomUrl: origin(classroomHost),
    currency: reader.matching('NUVA_CURRENCY', 'BRL', /^[A-Z]{3}$/, 'deve ser um código ISO 4217'),
    locale: readLocale(reader),
    sessionSecret: readSessionSecret(reader, secret('SESSION_SECRET')),
    admin: { email: adminEmail, password: readAdminPassword(reader, secret('ADMIN_PASSWORD')) },
    smtp: {
      host: reader.string('SMTP_HOST', 'mailpit'),
      port: reader.int('SMTP_PORT', 1025, { min: 1, max: 65535 }),
      user: reader.optional('SMTP_USER'),
      password: secret('SMTP_PASSWORD'),
      from: reader.string('SMTP_FROM', `nuva-edu <no-reply@${domain}>`),
    },
    payment: {
      provider: paymentProvider,
      fakeUrl:
        paymentFakeUrl === null
          ? null
          : readHttpUrl(reader, 'NUVA_PAYMENT_FAKE_URL', paymentFakeUrl),
      mercadoPago: {
        accessToken: secret('MP_ACCESS_TOKEN'),
        publicKey: reader.optional('MP_PUBLIC_KEY'),
        webhookSecret: secret('MP_WEBHOOK_SECRET'),
      },
      orderPendingMinutes: reader.int('NUVA_ORDER_PENDING_MINUTES', 30, { min: 1 }),
      orderBoletoDays: reader.int('NUVA_ORDER_BOLETO_DAYS', 3, { min: 1 }),
      subscriptionGraceDays: reader.int('NUVA_SUBSCRIPTION_GRACE_DAYS', 3),
    },
    authProviders: oauthMock === null ? readAuthProviders(reader) : mockAuthProviders(),
    oauthMock,
    trustedProxies: readTrustedProxies(reader),
    retention: {
      sessionDays: reader.int('NUVA_RETENTION_SESSION_DAYS', 30, { min: 1 }),
      emailTokenHours: reader.int('NUVA_RETENTION_EMAIL_TOKEN_HOURS', 24, { min: 1 }),
      loginAttemptDays: reader.int('NUVA_RETENTION_LOGIN_ATTEMPT_DAYS', 30, { min: 1 }),
      jobDoneDays: reader.int('NUVA_RETENTION_JOB_DONE_DAYS', 7, { min: 1 }),
      jobFailedDays: reader.int('NUVA_RETENTION_JOB_FAILED_DAYS', 30, { min: 1 }),
      notificationDays: reader.int('NUVA_RETENTION_NOTIFICATION_DAYS', 90, { min: 1 }),
      notificationUnreadDays: reader.int('NUVA_RETENTION_NOTIFICATION_UNREAD_DAYS', 180, {
        min: 1,
      }),
      emailSentDays: reader.int('NUVA_RETENTION_EMAIL_SENT_DAYS', 30, { min: 1 }),
      emailFailedDays: reader.int('NUVA_RETENTION_EMAIL_FAILED_DAYS', 90, { min: 1 }),
      webhookDays: reader.int('NUVA_RETENTION_WEBHOOK_DAYS', 90, { min: 1 }),
      // Abaixo de 365 o `audit_log_purge` recusa (spec 028, RNF-01): o erro vem na subida.
      auditDays: reader.int('NUVA_RETENTION_AUDIT_DAYS', AUDIT_RETENTION_DEFAULT_DAYS, {
        min: AUDIT_RETENTION_MIN_DAYS,
      }),
      moderationDays: reader.int('NUVA_RETENTION_MODERATION_DAYS', 730, { min: 1 }),
      cartDays: reader.int('NUVA_RETENTION_CART_DAYS', 30, { min: 1 }),
      fiscalYears: reader.int('NUVA_RETENTION_FISCAL_YEARS', 5, { min: 1 }),
    },
    workerConcurrency: reader.int('NUVA_WORKER_CONCURRENCY', 10, { min: 1, max: 100 }),
    mcp: {
      ratePerMinute: reader.int('NUVA_MCP_RATE_PER_MIN', 120, { min: 1 }),
      maxKeys: reader.int('NUVA_MCP_MAX_KEYS', 20, { min: 1 }),
    },
    images: {
      maxUploadMb: reader.int('NUVA_IMAGE_MAX_UPLOAD_MB', 5, { min: 1 }),
      caseMaxImages: reader.int('NUVA_CASE_MAX_IMAGES', 8, { min: 1 }),
      uploadsPerHour: reader.int('NUVA_IMAGE_UPLOADS_PER_HOUR', 30, { min: 1 }),
    },
    accountDeletionGraceDays: reader.int('NUVA_ACCOUNT_DELETION_GRACE_DAYS', 7),
  };

  reader.throwIfInvalid();
  return config;
}

export interface LoadConfigOrExitOptions extends LoadConfigOptions {
  /** Nome do serviço na linha de log do erro. */
  service?: string;
  /** Padrão: escreve na saída padrão. */
  write?: (line: string) => unknown;
  /** Padrão: `process.exit`. */
  exit?: (code: number) => never;
}

/**
 * Para o início dos serviços: configuração inválida vira uma linha de log JSON de nível
 * `fatal`, citando as variáveis, e o processo termina com código 1.
 */
export function loadConfigOrExit(options: LoadConfigOrExitOptions = {}): Config {
  try {
    return loadConfig(options);
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    // Escrita síncrona: a linha precisa sair antes de o processo terminar.
    const write = options.write ?? ((line: string) => writeSync(1, line));
    const exit = options.exit ?? ((code: number) => process.exit(code));
    const line = {
      time: new Date().toISOString(),
      level: 'fatal',
      service: options.service ?? 'nuva-edu',
      msg: error.message,
      variables: error.issues.map((issue) => issue.variable),
    };
    write(`${JSON.stringify(line)}\n`);
    return exit(1);
  }
}

/**
 * `NUVA_LOCALE` na forma canônica do `Intl` (`pt-br` vira `pt-BR`). Fora do formato da spec 031,
 * ou recusada pelo `Intl` (`pt-br-br`), é erro de configuração: o serviço não sobe.
 */
function readLocale(reader: EnvReader): string {
  const fallback = 'pt-BR';
  const raw = reader.string('NUVA_LOCALE', fallback);
  if (LOCALE_PATTERN.test(raw)) {
    try {
      const [canonical] = Intl.getCanonicalLocales(raw);
      if (canonical !== undefined) {
        return canonical;
      }
    } catch {
      // RangeError do Intl: cai na recusa abaixo.
    }
  }
  reader.fail(
    'NUVA_LOCALE',
    `deve ser uma etiqueta de idioma BCP 47 como pt-BR; recebido "${raw}"`,
  );
  return fallback;
}

/** Vazio significa "sem porta na URL" (80/443); ausente vale o padrão 8080. */
function readPublicPort(reader: EnvReader, env: Env, scheme: 'http' | 'https'): number | null {
  const raw = env.NUVA_PUBLIC_PORT;
  if (raw === undefined) {
    return 8080;
  }
  if (raw.trim() === '') {
    return null;
  }
  const port = reader.parseInt('NUVA_PUBLIC_PORT', raw.trim(), { min: 1, max: 65535 });
  const standard = scheme === 'https' ? 443 : 80;
  return port === standard ? null : port;
}

/**
 * `DATABASE_URL`; sem ela, monta de `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
 * `POSTGRES_HOST` e `NUVA_POSTGRES_PORT`, como faz o comando de migrations.
 */
function readDatabaseUrl(reader: EnvReader): string {
  const url = reader.optional('DATABASE_URL');
  if (url !== null) {
    // A mensagem não repete o valor: a URL carrega a senha do banco.
    const parsed = URL.parse(url);
    if (parsed === null || !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      reader.fail('DATABASE_URL', 'deve ser uma URL postgres://usuario:senha@host:porta/banco');
    } else if (parsed.pathname.length <= 1) {
      reader.fail('DATABASE_URL', 'falta o nome do banco no caminho da URL');
    }
    return url;
  }
  const password = reader.optional('POSTGRES_PASSWORD');
  if (password === null) {
    reader.fail(
      'DATABASE_URL',
      'obrigatória e não definida (ou defina POSTGRES_PASSWORD para montá-la)',
    );
    return '';
  }
  const user = encodeURIComponent(reader.string('POSTGRES_USER', 'nuva_edu'));
  const host = reader.string('POSTGRES_HOST', '127.0.0.1');
  const port = reader.int('NUVA_POSTGRES_PORT', 5432, { min: 1, max: 65535 });
  const database = encodeURIComponent(reader.string('POSTGRES_DB', 'nuva_edu'));
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/** Tudo vazio desliga o provedor; preenchido pela metade é erro que cita o que falta. */
function readGroup<const N extends string>(
  reader: EnvReader,
  names: readonly N[],
): Record<N, string> | null {
  const values = names.map((name) => [name, reader.optional(name)] as const);
  if (values.every(([, value]) => value === null)) {
    return null;
  }
  const defined = values.filter(([, value]) => value !== null).map(([name]) => name);
  for (const [name, value] of values) {
    if (value === null) {
      reader.fail(name, `obrigatória quando ${defined.join(', ')} está definida`);
    }
  }
  return Object.fromEntries(values.map(([name, value]) => [name, value ?? ''])) as Record<
    N,
    string
  >;
}

/** A mensagem nunca repete o valor: é segredo. */
function readSessionSecret(reader: EnvReader, value: string | null): string | null {
  if (value !== null && [...value].length < SESSION_SECRET_MIN_LENGTH) {
    reader.fail(
      'SESSION_SECRET',
      `deve ter no mínimo ${SESSION_SECRET_MIN_LENGTH} caracteres (gere com openssl rand -base64 48)`,
    );
  }
  return value;
}

/** Fora de 8 a 128 caracteres impede a subida (spec 007, "Admin inicial"). */
function readAdminPassword(reader: EnvReader, value: string | null): string | null {
  if (value !== null) {
    const length = [...value].length;
    if (length < ADMIN_PASSWORD_MIN_LENGTH || length > ADMIN_PASSWORD_MAX_LENGTH) {
      reader.fail(
        'ADMIN_PASSWORD',
        `deve ter de ${ADMIN_PASSWORD_MIN_LENGTH} a ${ADMIN_PASSWORD_MAX_LENGTH} caracteres`,
      );
    }
  }
  return value;
}

/**
 * `NUVA_OAUTH_MOCK_URL` liga o simulador; `NUVA_OAUTH_MOCK_INTERNAL_URL` vale o mesmo endereço
 * quando ausente. Em produção a variável impede a subida: ligada, permitiria entrar em qualquer
 * conta (ADR 0024).
 */
function readOAuthMock(reader: EnvReader, env: Config['env']): Config['oauthMock'] {
  const url = reader.optional('NUVA_OAUTH_MOCK_URL');
  const internal = reader.optional('NUVA_OAUTH_MOCK_INTERNAL_URL');
  if (url === null) {
    if (internal !== null) {
      reader.fail('NUVA_OAUTH_MOCK_INTERNAL_URL', 'só vale com NUVA_OAUTH_MOCK_URL definida');
    }
    return null;
  }
  if (env === 'production') {
    reader.fail(
      'NUVA_OAUTH_MOCK_URL',
      'o provedor OAuth simulado é recusado com NUVA_ENV=production; remova a variável',
    );
    return null;
  }
  const publicUrl = readHttpUrl(reader, 'NUVA_OAUTH_MOCK_URL', url);
  const internalUrl =
    internal === null ? publicUrl : readHttpUrl(reader, 'NUVA_OAUTH_MOCK_INTERNAL_URL', internal);
  return { url: publicUrl, internalUrl };
}

/** URL `http`/`https` sem consulta nem fragmento, devolvida sem a barra final. */
function readHttpUrl(reader: EnvReader, name: string, raw: string): string {
  const parsed = URL.parse(raw);
  if (
    parsed === null ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    reader.fail(name, `deve ser uma URL http:// ou https://, sem consulta; recebido "${raw}"`);
    return raw;
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

function readAuthProviders(reader: EnvReader): Config['authProviders'] {
  return {
    google: readOAuth(reader, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    facebook: readOAuth(reader, 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'),
    apple: readApple(reader),
  };
}

/** Com o simulador, as credenciais reais nem são lidas: ficam ignoradas (spec 007). */
function mockAuthProviders(): Config['authProviders'] {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    google: { ...OAUTH_MOCK_CLIENTS.google },
    facebook: { ...OAUTH_MOCK_CLIENTS.facebook },
    apple: {
      ...OAUTH_MOCK_CLIENTS.apple,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    },
  };
}

function readOAuth(reader: EnvReader, id: string, secret: string): OAuthCredentials | null {
  const group = readGroup(reader, [id, secret]);
  return group && { clientId: group[id] ?? '', clientSecret: group[secret] ?? '' };
}

function readApple(reader: EnvReader): AppleCredentials | null {
  const group = readGroup(reader, [
    'APPLE_CLIENT_ID',
    'APPLE_TEAM_ID',
    'APPLE_KEY_ID',
    'APPLE_PRIVATE_KEY',
  ]);
  return (
    group && {
      clientId: group.APPLE_CLIENT_ID,
      teamId: group.APPLE_TEAM_ID,
      keyId: group.APPLE_KEY_ID,
      // O .env guarda o PEM numa linha só, com \n no lugar das quebras (spec 031).
      privateKey: group.APPLE_PRIVATE_KEY.replaceAll('\\n', '\n'),
    }
  );
}

function readTrustedProxies(reader: EnvReader): readonly string[] {
  const raw = reader.optional('TRUSTED_PROXIES');
  if (raw === null) {
    return DEFAULT_TRUSTED_PROXIES;
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (const entry of entries) {
    if (!isIpOrCidr(entry)) {
      reader.fail('TRUSTED_PROXIES', `"${entry}" não é um IP nem uma faixa CIDR`);
    }
  }
  return entries;
}

function isIpOrCidr(entry: string): boolean {
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}
