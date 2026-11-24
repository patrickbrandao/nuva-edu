// Tipos de e-mail da Fase 1 (spec 024, "E-mails do grupo account e da Fase 1"): o formato de
// `data` de cada tipo, o propósito do token do link e a conferência do que vai para
// `email_outbox.data`. Os textos (assunto, corpo em pt-BR, HTML) são do worker (tarefa 150).

export const EMAIL_USER_ROLES = ['student', 'instructor', 'manager', 'admin'] as const;
export type EmailUserRole = (typeof EMAIL_USER_ROLES)[number];

export const EMAIL_SUSPENSION_KINDS = ['posting', 'full'] as const;
export type EmailSuspensionKind = (typeof EMAIL_SUSPENSION_KINDS)[number];

export const EMAIL_LOGIN_SITES = ['classroom', 'admin'] as const;
export type EmailLoginSite = (typeof EMAIL_LOGIN_SITES)[number];

export const EMAIL_PASSWORD_CHANGED_BY = ['self', 'admin'] as const;
export type EmailPasswordChangedBy = (typeof EMAIL_PASSWORD_CHANGED_BY)[number];

type NoData = Record<string, never>;

/**
 * `data` de cada tipo como fica gravado em `email_outbox.data` e como o worker o lê. Datas em
 * ISO 8601 (UTC). Nunca leva senha, token nem motivo interno de suspensão (spec 024).
 */
export interface EmailDataByType {
  'account.verify_email': NoData;
  'account.password_reset': NoData;
  'account.exists': NoData;
  'account.new_login': {
    at: string;
    ip: string;
    /** Nulo quando o `User-Agent` não identifica o navegador. */
    browser: string | null;
    os: string | null;
    site: EmailLoginSite;
  };
  'account.locked': { until: string };
  'account.password_changed': { by: EmailPasswordChangedBy };
  'account.role_changed': { role: EmailUserRole };
  /** `endsAt` nulo: suspensão sem prazo. */
  'moderation.suspended': { kind: EmailSuspensionKind; endsAt: string | null };
}

export type EmailType = keyof EmailDataByType;

type DateInput<T> = { [K in keyof T]: T[K] extends string ? T[K] | Date : T[K] };

/** O que `enqueueEmail` aceita: como `EmailDataByType`, com `Date` onde a data é texto. */
export type EmailDataInput<T extends EmailType> = T extends
  | 'account.new_login'
  | 'account.locked'
  | 'moderation.suspended'
  ? {
      [K in keyof EmailDataByType[T]]: K extends 'at' | 'until' | 'endsAt'
        ? DateInput<EmailDataByType[T]>[K]
        : EmailDataByType[T][K];
    }
  : EmailDataByType[T];

/** Propósito de `email_tokens` (spec 007). */
export const EMAIL_TOKEN_PURPOSES = ['verify', 'reset'] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

export interface EmailTypeDefinition {
  /** Grupo de preferência (spec 024). Os dois da Fase 1 são obrigatórios. */
  group: 'account' | 'moderation';
  /** Token que o worker cria ao montar o e-mail, ou `null` se o link não leva token. */
  tokenPurpose: EmailTokenPurpose | null;
}

export const EMAIL_TYPES: { readonly [T in EmailType]: EmailTypeDefinition } = {
  'account.verify_email': { group: 'account', tokenPurpose: 'verify' },
  'account.password_reset': { group: 'account', tokenPurpose: 'reset' },
  'account.exists': { group: 'account', tokenPurpose: null },
  'account.new_login': { group: 'account', tokenPurpose: null },
  'account.locked': { group: 'account', tokenPurpose: null },
  'account.password_changed': { group: 'account', tokenPurpose: null },
  'account.role_changed': { group: 'account', tokenPurpose: null },
  'moderation.suspended': { group: 'moderation', tokenPurpose: null },
};

export function isEmailType(type: string): type is EmailType {
  return Object.hasOwn(EMAIL_TYPES, type);
}

type FieldRule = (value: unknown) => boolean;

const isText: FieldRule = (value) => typeof value === 'string' && value.trim() !== '';
const isNullableText: FieldRule = (value) => value === null || isText(value);
const isIsoDate: FieldRule = (value) =>
  typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
const oneOf =
  (options: readonly string[]): FieldRule =>
  (value) =>
    typeof value === 'string' && options.includes(value);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Campos de `data` por tipo: exatamente estes, nenhum a mais. */
const DATA_FIELDS: { readonly [T in EmailType]: Readonly<Record<string, FieldRule>> } = {
  'account.verify_email': {},
  'account.password_reset': {},
  'account.exists': {},
  'account.new_login': {
    at: isIsoDate,
    ip: isText,
    browser: isNullableText,
    os: isNullableText,
    site: oneOf(EMAIL_LOGIN_SITES),
  },
  'account.locked': { until: isIsoDate },
  'account.password_changed': { by: oneOf(EMAIL_PASSWORD_CHANGED_BY) },
  'account.role_changed': { role: oneOf(EMAIL_USER_ROLES) },
  'moderation.suspended': {
    kind: oneOf(EMAIL_SUSPENSION_KINDS),
    endsAt: (value) => value === null || isIsoDate(value),
  },
};

/** Recusa do formato de `data`. Erro de programação: nunca chega ao cliente como está. */
export class EmailDataError extends TypeError {
  constructor(type: string, problem: string) {
    super(`Dados inválidos para o e-mail ${type}: ${problem}.`);
    this.name = 'EmailDataError';
  }
}

/**
 * Confere `data` (já com datas em texto) contra o tipo: os campos do tipo, cada um no formato,
 * e nenhum outro. Campo a mais é recusado, para senha ou token nunca irem parar na fila por
 * engano. Serve também ao worker, para ler `email_outbox.data`. Lança `EmailDataError`.
 */
export function parseEmailData<T extends EmailType>(type: T, data: unknown): EmailDataByType[T] {
  if (!isEmailType(type)) {
    throw new EmailDataError(String(type), 'tipo desconhecido');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new EmailDataError(type, 'data deve ser um objeto');
  }
  const fields = DATA_FIELDS[type];
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(fields, key)) {
      throw new EmailDataError(type, `campo não previsto "${key}"`);
    }
  }
  for (const [key, rule] of Object.entries(fields)) {
    if (!Object.hasOwn(record, key) || !rule(record[key])) {
      throw new EmailDataError(type, `campo "${key}" ausente ou fora do formato`);
    }
  }
  return { ...record } as EmailDataByType[T];
}

/** Converte as datas de `data` para ISO 8601 e confere o resultado com `parseEmailData`. */
export function normalizeEmailData<T extends EmailType>(
  type: T,
  data: EmailDataInput<T>,
): EmailDataByType[T] {
  if (typeof data !== 'object' || data === null) {
    return parseEmailData(type, data);
  }
  const converted = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value instanceof Date ? toIsoDate(type, key, value) : value,
    ]),
  );
  return parseEmailData(type, converted);
}

function toIsoDate(type: string, key: string, value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new EmailDataError(type, `campo "${key}" com data inválida`);
  }
  return value.toISOString();
}
