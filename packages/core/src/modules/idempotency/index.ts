// Idempotência das ações financeiras (spec 003, "Idempotência"; migration 0021). Chave
// normalizada, impressão digital da requisição e execução com a resposta gravada por 24 h.

export { idempotencyKeyReuse } from './errors.ts';
export {
  canonicalJson,
  requestFingerprint,
} from './fingerprint.ts';
export {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_SCOPES,
  type IdempotencyScope,
  normalizeIdempotencyKey,
} from './key.ts';
export {
  IDEMPOTENCY_RETENTION_MS,
  type IdempotentOutcome,
  type IdempotentRequest,
  reviveTimestamps,
  runIdempotent,
} from './runner.ts';
