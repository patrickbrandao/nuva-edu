import { randomUUID } from 'node:crypto';
import { format } from 'node:util';
import { redact, redactString } from './redact.ts';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};

/** Campos fixos de toda linha; não podem ser sobrescritos por quem chama. */
const RESERVED = new Set(['time', 'level', 'service', 'msg']);

export type LogFields = Record<string, unknown>;

/**
 * Aceita `log.info('mensagem')`, `log.info('mensagem', { campos })`,
 * `log.info({ campos }, 'mensagem')` e `log.error(erro, 'mensagem')`. As duas últimas formas
 * são as do pino, o que permite entregar este logger ao Fastify (`loggerInstance`).
 */
export interface LogMethod {
  (message: string, ...args: unknown[]): void;
  (fields: object, message?: string, ...args: unknown[]): void;
}

export interface Logger {
  level: LogLevel;
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  silent: LogMethod;
  /** Logger filho: os campos dados acompanham todas as linhas dele. */
  child(bindings: LogFields): Logger;
  /** Atalho de `child({ request_id })`. */
  withRequestId(requestId: string): Logger;
  isLevelEnabled(level: LogLevel): boolean;
}

export interface LoggerOptions {
  /** Nome do serviço (`admin-api`, `classroom-api`, `worker`). */
  service: string;
  /** Padrão: `info`. */
  level?: LogLevel;
  /** Campos presentes em todas as linhas. */
  bindings?: LogFields;
  /** Destino de cada linha, já terminada em `\n`. Padrão: saída padrão. */
  write?: (line: string) => void;
  /** Relógio, para testes. */
  now?: () => Date;
}

interface Shared {
  service: string;
  level: LogLevel;
  write: (line: string) => void;
  now: () => Date;
}

/**
 * Logger JSON da spec 033: uma linha por evento com `time`, `level`, `service`, `msg` e os
 * campos dados (`request_id`, `user_id`, `route`, `status`, `duration_ms`, `job_id`...).
 * Tudo passa por `redact`: não há forma de escrever um campo proibido sem máscara.
 */
export function createLogger(options: LoggerOptions): Logger {
  const shared: Shared = {
    service: options.service,
    level: options.level ?? 'info',
    write: options.write ?? ((line) => process.stdout.write(line)),
    now: options.now ?? (() => new Date()),
  };
  return build(shared, options.bindings ?? {});
}

function build(shared: Shared, bindings: LogFields): Logger {
  // Filhos têm nível próprio, que nasce igual ao do pai (como no pino).
  let level = shared.level;
  const enabled = (candidate: LogLevel) => WEIGHT[candidate] >= WEIGHT[level];

  const method =
    (name: Exclude<LogLevel, 'silent'>): LogMethod =>
    (first: string | object, ...rest: unknown[]) => {
      if (!enabled(name)) {
        return;
      }
      const { fields, message } = parseArguments(first, rest);
      const line: LogFields = {
        time: shared.now().toISOString(),
        level: name,
        service: shared.service,
      };
      const extra = redact({ ...bindings, ...fields }) as LogFields;
      for (const [key, value] of Object.entries(extra)) {
        if (!RESERVED.has(key) && value !== undefined) {
          line[key] = value;
        }
      }
      line.msg = redactString(message);
      shared.write(`${JSON.stringify(line)}\n`);
    };

  return {
    get level() {
      return level;
    },
    set level(next: LogLevel) {
      level = next;
    },
    trace: method('trace'),
    debug: method('debug'),
    info: method('info'),
    warn: method('warn'),
    error: method('error'),
    fatal: method('fatal'),
    silent: () => {},
    child: (extra) => build({ ...shared, level }, { ...bindings, ...extra }),
    withRequestId: (requestId) =>
      build({ ...shared, level }, { ...bindings, request_id: requestId }),
    isLevelEnabled: enabled,
  };
}

function parseArguments(
  first: string | object,
  rest: unknown[],
): { fields: LogFields; message: string } {
  if (typeof first === 'string') {
    // `log.info('mensagem', { campos })`: o objeto são campos, não argumento de formatação.
    const [second, ...others] = rest;
    if (isPlainFields(second) && others.length === 0) {
      return { fields: second, message: first };
    }
    return { fields: {}, message: format(first, ...rest) };
  }
  const [message, ...args] = rest;
  const text = typeof message === 'string' ? format(message, ...args) : undefined;
  if (first instanceof Error) {
    return { fields: { err: first }, message: text ?? first.message };
  }
  return { fields: { ...first }, message: text ?? '' };
}

function isPlainFields(value: unknown): value is LogFields {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

/** Cabeçalho que carrega o identificador da requisição (spec 003). */
export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function newRequestId(): string {
  return randomUUID();
}

/**
 * Usa o identificador vindo do proxy quando ele tem forma segura; senão cria um. Evita que um
 * cabeçalho forjado injete texto arbitrário nos logs.
 */
export function resolveRequestId(header: string | readonly string[] | undefined | null): string {
  const value = typeof header === 'string' ? header : header?.[0];
  return value !== undefined && REQUEST_ID_PATTERN.test(value) ? value : newRequestId();
}
