import type { JsonObject, JsonValue } from '../../db/generated/database.ts';
import { isSensitiveKey, redactString } from '../../logging/redact.ts';

/** Valor que substitui todo campo sensível em `details` (spec 028, RF-07). */
export const AUDIT_REDACTED = '[alterado]';

/** Limite de `details`, medido no JSON em UTF-8 (spec 028, "Regras"). */
export const AUDIT_DETAILS_MAX_BYTES = 8 * 1024;

/**
 * Ações sobre a senha do usuário. A senha é guardada em texto legível (ADR 0002); nestas ações
 * o registro diz que houve a leitura ou a troca, nunca o valor: `details` guarda só números,
 * booleanos e nulos do primeiro nível, e qualquer texto é descartado, seja qual for o nome do
 * campo.
 */
export const AUDIT_PASSWORD_ACTIONS: readonly string[] = [
  'user.password_view',
  'user.password_set',
  'auth.password_reset',
];

const SPEC_SENSITIVE_KEYS = new Set([
  'password',
  'adminPassword',
  'currentPassword',
  'newPassword',
  'token',
  'csrfToken',
  'secret',
]);
const SPEC_SENSITIVE_SUFFIX = /(Password|Token|Secret)$/;
const MAX_DEPTH = 12;
const DEPTH_EXCEEDED = '[profundidade excedida]';
const CIRCULAR = '[circular]';

/**
 * Campo cujo valor nunca entra na auditoria: a lista da spec 028 (`password`, `token`,
 * `secret`, as variantes nomeadas e os terminados em `Password`, `Token` ou `Secret`) somada à
 * máscara do logger (`isSensitiveKey`, spec 033), que cobre também `key`, `cpf`, `cookie`,
 * `authorization` e equivalentes. Mascarar a mais é aceitável; deixar passar, não.
 */
export function isAuditSensitiveKey(key: string): boolean {
  return SPEC_SENSITIVE_KEYS.has(key) || SPEC_SENSITIVE_SUFFIX.test(key) || isSensitiveKey(key);
}

/**
 * Cópia de `details` pronta para gravar: campos sensíveis viram `"[alterado]"` em qualquer
 * profundidade, textos passam pela máscara do logger (credencial em URL, `Bearer`, CPF/CNPJ),
 * e o resultado é JSON puro (datas em ISO 8601, `bigint` em texto, sem `undefined`, funções ou
 * ciclos). Não aplica o limite de 8 KB: veja `limitAuditDetails`.
 */
export function redactAuditDetails(details: unknown, action?: string): JsonObject {
  const redacted = redactValue(details, 0, new WeakSet());
  const object: JsonObject =
    redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
      ? redacted
      : redacted === null
        ? {}
        : { value: redacted };
  if (action !== undefined && AUDIT_PASSWORD_ACTIONS.includes(action)) {
    return keepScalarsOnly(object);
  }
  return object;
}

function keepScalarsOnly(object: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    }
  }
  return output;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): JsonValue | undefined {
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object':
      return value === null ? null : redactObject(value, depth, seen);
    default:
      return undefined;
  }
}

function redactObject(value: object, depth: number, seen: WeakSet<object>): JsonValue {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[${value.byteLength} bytes]`;
  }
  if (seen.has(value)) {
    return CIRCULAR;
  }
  if (depth >= MAX_DEPTH) {
    return DEPTH_EXCEEDED;
  }
  seen.add(value);
  try {
    if (Array.isArray(value) || value instanceof Set) {
      return Array.from(value, (item) => redactValue(item, depth + 1, seen) ?? null);
    }
    const entries = value instanceof Map ? value.entries() : Object.entries(value);
    const output: JsonObject = {};
    for (const [rawKey, item] of entries) {
      const key = String(rawKey);
      if (isAuditSensitiveKey(key)) {
        output[key] = item === null || item === undefined ? null : AUDIT_REDACTED;
        continue;
      }
      const redacted = redactValue(item, depth + 1, seen);
      if (redacted !== undefined) {
        output[key] = redacted;
      }
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function jsonBytes(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Aplica o limite de 8 KB: abaixo dele, devolve `details` como veio; acima, guarda os campos do
 * primeiro nível que couberem, na ordem, corta o primeiro texto que não couber inteiro e marca
 * `truncated: true` e `originalBytes`. O resultado nunca passa de `maxBytes`.
 */
export function limitAuditDetails(
  details: JsonObject,
  maxBytes: number = AUDIT_DETAILS_MAX_BYTES,
): JsonObject {
  const originalBytes = jsonBytes(details);
  if (originalBytes <= maxBytes) {
    return details;
  }
  const output: JsonObject = { truncated: true, originalBytes };
  let size = jsonBytes(output);
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || key === 'truncated' || key === 'originalBytes') {
      continue;
    }
    // `,"chave":` mais o valor.
    const keyBytes = jsonBytes(key) + 2;
    const room = maxBytes - size - keyBytes;
    if (room <= 0) {
      break;
    }
    const valueBytes = jsonBytes(value);
    if (valueBytes <= room) {
      output[key] = value;
      size += keyBytes + valueBytes;
      continue;
    }
    if (typeof value === 'string') {
      const cut = cutString(value, room);
      if (cut !== null) {
        output[key] = cut;
        size += keyBytes + jsonBytes(cut);
      }
    }
  }
  return output;
}

/** O maior prefixo de `text`, com `…`, cujo JSON cabe em `room` bytes; `null` se nem um cabe. */
function cutString(text: string, room: number): string | null {
  const codePoints = Array.from(text);
  let low = 0;
  let high = codePoints.length;
  let best: string | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${codePoints.slice(0, middle).join('')}…`;
    if (jsonBytes(candidate) <= room) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}
