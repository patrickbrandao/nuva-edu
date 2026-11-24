/** Valor que substitui todo dado proibido nos logs (spec 033, RNF-02). */
export const REDACTED = '[REDACTED]';

/**
 * Trechos que tornam um campo proibido, comparados sem caixa e sem separadores: `password`
 * cobre `newPassword`, `key` cobre `apiKey` e `mcp_key`. Os nove primeiros são a lista da
 * spec 033; os demais são equivalentes em português e dados de cartão.
 * Mascarar a mais é aceitável; deixar passar, não.
 */
export const SENSITIVE_KEY_PARTS: readonly string[] = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'cpf',
  'cnpj',
  'document',
  'key',
  'passwd',
  'senha',
  'segredo',
  'credential',
  'cardnumber',
  'cvv',
];

const MAX_DEPTH = 8;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

// O separador `:` só vale seguido de espaço ou depois de aspas, para não comer `arquivo.ts:10:5`
// nas pilhas de erro.
const KEY_VALUE = new RegExp(
  `([\\w.-]*(?:${SENSITIVE_KEY_PARTS.join('|')})[\\w.-]*)(\\s?=\\s?|["']\\s?:\\s?|:\\s+)(?!\\[REDACTED\\])(?:"[^"]*"|'[^']*'|[^\\s&,;"'}]+)`,
  'gi',
);
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^\s/:@]*):[^\s/@]+@/gi;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi;
const CNPJ_FORMATTED = /(?<![\w.])[A-Z\d]{2}\.[A-Z\d]{3}\.[A-Z\d]{3}\/[A-Z\d]{4}-\d{2}(?!\d)/gi;
const CPF_FORMATTED = /(?<![\w.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
const BARE_DIGITS = /(?<![\w.])(\d{14}|\d{11})(?!\w)/g;

/**
 * Mascara, dentro de um texto livre, o que é reconhecível pela forma: credencial em URL,
 * `Bearer`/`Basic`, pares `senha=valor`, CPF e CNPJ com pontuação, e sequências de 11 ou 14
 * dígitos com dígitos verificadores válidos. Uma senha solta no meio de uma frase não é
 * reconhecível: nunca a interpole numa mensagem.
 */
export function redactString(text: string): string {
  return text
    .replace(URL_CREDENTIALS, `$1:${REDACTED}@`)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
    .replace(KEY_VALUE, `$1$2${REDACTED}`)
    .replace(CNPJ_FORMATTED, REDACTED)
    .replace(CPF_FORMATTED, REDACTED)
    .replace(BARE_DIGITS, (digits) => (isCpf(digits) || isCnpj(digits) ? REDACTED : digits));
}

/**
 * Cópia segura para log: campos proibidos viram `[REDACTED]` em qualquer profundidade, textos
 * passam por `redactString`, e o resultado é sempre serializável em JSON (sem ciclos, sem
 * `bigint`, sem bytes crus).
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet());
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return redactString(value.toString());
    case 'object':
      return value === null ? null : redactObject(value, depth, seen);
    default:
      // undefined, função e símbolo não vão para o log.
      return undefined;
  }
}

function redactObject(value: object, depth: number, seen: WeakSet<object>): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[${value.byteLength} bytes]`;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  seen.add(value);
  try {
    if (value instanceof Error) {
      return redactError(value, depth, seen);
    }
    if ('toJSON' in value && typeof value.toJSON === 'function') {
      return redactValue(value.toJSON(), depth + 1, seen);
    }
    if (Array.isArray(value) || value instanceof Set) {
      return Array.from(value, (item) => redactValue(item, depth + 1, seen) ?? null);
    }
    const entries = value instanceof Map ? value.entries() : Object.entries(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      output[String(key)] = redactEntry(String(key), item, depth, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function redactEntry(key: string, item: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (isSensitiveKey(key)) {
    return item === null || item === undefined ? item : REDACTED;
  }
  return redactValue(item, depth + 1, seen);
}

/**
 * Campos de erro do PostgreSQL que reproduzem valores das linhas ("Failing row contains (...)",
 * "Key (email)=(...)"). Como a senha fica em texto legível no banco, nunca vão para o log.
 */
const DATABASE_ERROR_VALUE_FIELDS = new Set(['detail', 'where', 'internalQuery']);

function isDatabaseError(error: Error): boolean {
  return 'severity' in error && 'routine' in error;
}

/** Erros incluem a pilha (spec 033) e os campos próprios, como `code` e `status`. */
function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const output: Record<string, unknown> = {
    type: error.name,
    message: redactString(error.message),
  };
  if (error.stack) {
    output.stack = redactString(error.stack);
  }
  const fromDatabase = isDatabaseError(error);
  for (const [key, item] of Object.entries(error)) {
    if (key in output || item === undefined) {
      continue;
    }
    output[key] =
      fromDatabase && DATABASE_ERROR_VALUE_FIELDS.has(key)
        ? REDACTED
        : redactEntry(key, item, depth, seen);
  }
  if (error.cause !== undefined) {
    output.cause = redactValue(error.cause, depth + 1, seen);
  }
  return output;
}

function checkDigit(digits: readonly number[], weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isCpf(text: string): boolean {
  if (text.length !== 11 || /^(\d)\1+$/.test(text)) {
    return false;
  }
  const digits = Array.from(text, Number);
  const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === digits[9] && second === digits[10];
}

function isCnpj(text: string): boolean {
  if (text.length !== 14 || /^(\d)\1+$/.test(text)) {
    return false;
  }
  const digits = Array.from(text, Number);
  const first = checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === digits[12] && second === digits[13];
}
