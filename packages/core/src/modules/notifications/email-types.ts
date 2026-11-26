// Tipos de e-mail (spec 024, "E-mails do grupo account e da Fase 1" e "E-mails da Fase 2"): o
// formato de `data` de cada tipo, o propósito do token do link e a conferência do que vai para
// `email_outbox.data`. Os textos (assunto, corpo em pt-BR, HTML) são do worker (tarefa 150).

export const EMAIL_USER_ROLES = ['student', 'instructor', 'manager', 'admin'] as const;
export type EmailUserRole = (typeof EMAIL_USER_ROLES)[number];

export const EMAIL_SUSPENSION_KINDS = ['posting', 'full'] as const;
export type EmailSuspensionKind = (typeof EMAIL_SUSPENSION_KINDS)[number];

export const EMAIL_LOGIN_SITES = ['classroom', 'admin'] as const;
export type EmailLoginSite = (typeof EMAIL_LOGIN_SITES)[number];

export const EMAIL_PASSWORD_CHANGED_BY = ['self', 'admin'] as const;
export type EmailPasswordChangedBy = (typeof EMAIL_PASSWORD_CHANGED_BY)[number];

/** Tipo do produto liberado em `access.granted` (spec 009). */
export const EMAIL_PRODUCT_TYPES = ['course', 'ebook', 'bundle'] as const;
export type EmailProductType = (typeof EMAIL_PRODUCT_TYPES)[number];

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
  /** Acesso liberado (concessão manual na Fase 2). `expiresAt` nulo: acesso vitalício. */
  'access.granted': {
    productType: EmailProductType;
    productTitle: string;
    expiresAt: string | null;
  };
  /** Certificado emitido (automático, manual ou retroativo); não sai na reemissão. */
  'certificate.issued': { courseTitle: string; code: string };
}

/**
 * `data` dos tipos já no catálogo cujo modelo (assunto e textos) ainda não existe no worker,
 * como o `PendingHandlerJobType` da fila: `enqueueEmail` já os aceita, mas eles ficam fora de
 * `EmailDataByType`, `EmailType` e `EMAIL_TYPES`, que o worker percorre exigindo um modelo por
 * tipo. A linha de um tipo pendente que chegar ao worker falha como tipo desconhecido. Tipo novo
 * cujo modelo venha depois entra aqui até ele chegar. Hoje nenhum: o worker tem o modelo de
 * todos (tarefa 416).
 */
export type PendingTemplateEmailDataByType = Record<never, never>;

/** Tipos com modelo no worker: os que ele monta e envia. */
export type EmailType = keyof EmailDataByType;

/** Tipos do catálogo ainda sem modelo no worker. */
export type PendingTemplateEmailType = keyof PendingTemplateEmailDataByType;

/** `data` de todos os tipos do catálogo, com ou sem modelo no worker. */
export type AnyEmailDataByType = EmailDataByType & PendingTemplateEmailDataByType;

/** Todos os tipos do catálogo: o que `enqueueEmail` aceita. */
export type AnyEmailType = keyof AnyEmailDataByType;

/** Data em texto (anulável ou não) aceita também como `Date`. */
type DateInput<T> = { [K in keyof T]: [T[K]] extends [string | null] ? T[K] | Date : T[K] };

/** O que `enqueueEmail` aceita: como `EmailDataByType`, com `Date` onde a data é texto. */
export type EmailDataInput<T extends AnyEmailType> = T extends
  | 'account.new_login'
  | 'account.locked'
  | 'moderation.suspended'
  | 'access.granted'
  ? {
      [K in keyof AnyEmailDataByType[T]]: K extends 'at' | 'until' | 'endsAt' | 'expiresAt'
        ? DateInput<AnyEmailDataByType[T]>[K]
        : AnyEmailDataByType[T][K];
    }
  : AnyEmailDataByType[T];

/** Propósito de `email_tokens` (spec 007). */
export const EMAIL_TOKEN_PURPOSES = ['verify', 'reset'] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

export interface EmailTypeDefinition {
  /**
   * Grupo de preferência (spec 024). `account`, `moderation` e `purchase` são obrigatórios;
   * `courses` é desligável, mas até a Fase 4 não há preferência a respeitar.
   */
  group: 'account' | 'moderation' | 'purchase' | 'courses';
  /** Token que o worker cria ao montar o e-mail, ou `null` se o link não leva token. */
  tokenPurpose: EmailTokenPurpose | null;
  /**
   * `true`: a conta com suspensão `full` não recebe (spec 024, "E-mails da Fase 2"), porque não
   * pode usar o que o e-mail anuncia. Os de segurança da conta saem mesmo com suspensão.
   */
  skipFullySuspended: boolean;
}

const EMAIL_TYPE_DEFINITIONS: { readonly [T in AnyEmailType]: EmailTypeDefinition } = {
  'account.verify_email': { group: 'account', tokenPurpose: 'verify', skipFullySuspended: false },
  'account.password_reset': { group: 'account', tokenPurpose: 'reset', skipFullySuspended: false },
  'account.exists': { group: 'account', tokenPurpose: null, skipFullySuspended: false },
  'account.new_login': { group: 'account', tokenPurpose: null, skipFullySuspended: false },
  'account.locked': { group: 'account', tokenPurpose: null, skipFullySuspended: false },
  'account.password_changed': { group: 'account', tokenPurpose: null, skipFullySuspended: false },
  'account.role_changed': { group: 'account', tokenPurpose: null, skipFullySuspended: false },
  'moderation.suspended': { group: 'moderation', tokenPurpose: null, skipFullySuspended: false },
  'access.granted': { group: 'purchase', tokenPurpose: null, skipFullySuspended: true },
  'certificate.issued': { group: 'courses', tokenPurpose: null, skipFullySuspended: true },
};

/** Os tipos de `PendingTemplateEmailType`, para conferência em tempo de execução. */
export const PENDING_TEMPLATE_EMAIL_TYPES =
  [] as const satisfies readonly PendingTemplateEmailType[];

const PENDING_TEMPLATE_SET: ReadonlySet<string> = new Set(PENDING_TEMPLATE_EMAIL_TYPES);

/** Definição de qualquer tipo do catálogo, com ou sem modelo no worker. */
export function emailTypeDefinition(type: AnyEmailType): EmailTypeDefinition {
  return EMAIL_TYPE_DEFINITIONS[type];
}

/** Tipos com modelo no worker (sem os pendentes): o worker exige um modelo para cada um. */
export const EMAIL_TYPES: { readonly [T in EmailType]: EmailTypeDefinition } = {
  'account.verify_email': EMAIL_TYPE_DEFINITIONS['account.verify_email'],
  'account.password_reset': EMAIL_TYPE_DEFINITIONS['account.password_reset'],
  'account.exists': EMAIL_TYPE_DEFINITIONS['account.exists'],
  'account.new_login': EMAIL_TYPE_DEFINITIONS['account.new_login'],
  'account.locked': EMAIL_TYPE_DEFINITIONS['account.locked'],
  'account.password_changed': EMAIL_TYPE_DEFINITIONS['account.password_changed'],
  'account.role_changed': EMAIL_TYPE_DEFINITIONS['account.role_changed'],
  'moderation.suspended': EMAIL_TYPE_DEFINITIONS['moderation.suspended'],
  'access.granted': EMAIL_TYPE_DEFINITIONS['access.granted'],
  'certificate.issued': EMAIL_TYPE_DEFINITIONS['certificate.issued'],
};

/** Tipo com modelo no worker. Tipo pendente (`PendingTemplateEmailType`) dá `false`. */
export function isEmailType(type: string): type is EmailType {
  return Object.hasOwn(EMAIL_TYPES, type);
}

/** Qualquer tipo do catálogo, pendente ou não: o que `enqueueEmail` aceita. */
export function isAnyEmailType(type: string): type is AnyEmailType {
  return Object.hasOwn(EMAIL_TYPE_DEFINITIONS, type);
}

/** Tipo do catálogo cujo modelo ainda não existe no worker. */
export function isPendingTemplateEmailType(type: string): type is PendingTemplateEmailType {
  return PENDING_TEMPLATE_SET.has(type);
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
const DATA_FIELDS: { readonly [T in AnyEmailType]: Readonly<Record<string, FieldRule>> } = {
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
  'access.granted': {
    productType: oneOf(EMAIL_PRODUCT_TYPES),
    productTitle: isText,
    expiresAt: (value) => value === null || isIsoDate(value),
  },
  'certificate.issued': { courseTitle: isText, code: isText },
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
export function parseEmailData<T extends AnyEmailType>(
  type: T,
  data: unknown,
): AnyEmailDataByType[T] {
  if (!isAnyEmailType(type)) {
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
  return { ...record } as AnyEmailDataByType[T];
}

/** Converte as datas de `data` para ISO 8601 e confere o resultado com `parseEmailData`. */
export function normalizeEmailData<T extends AnyEmailType>(
  type: T,
  data: EmailDataInput<T>,
): AnyEmailDataByType[T] {
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
