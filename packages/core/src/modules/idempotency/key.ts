import { validationFailed } from '../../errors/domain-error.ts';

// `Idempotency-Key` das ações financeiras (spec 003, "Convenções da API"; spec 011; spec 012).
// O contrato pede de 8 a 128 caracteres; a chave é opaca para o servidor e identifica a tentativa,
// não a requisição: repetir com a mesma chave devolve a primeira resposta por 24 h.

/** Menor chave aceita pelo contrato (`components.parameters.IdempotencyKey`). */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
/** Maior chave aceita pelo contrato. O banco aceita 200; aqui vale o contrato. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * Escopos das operações financeiras que aceitam a chave. O escopo separa chaves iguais de
 * operações diferentes para o mesmo usuário (a chave primária é escopo + usuário + chave); é o
 * mesmo valor do comentário da migration 0021.
 */
export const IDEMPOTENCY_SCOPES = {
  orderCreate: 'order.create',
  orderRefund: 'refund.order',
  subscriptionCreate: 'subscription.create',
  subscriptionRefund: 'refund.subscription',
} as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

// Controle e espaço em branco. O contrato só limita o tamanho, mas a chave com espaço é
// recusada como requisição fora do contrato: cabeçalho com espaço é erro de quem chama e a
// mensagem precisa ser a mesma das outras validações.
const WHITESPACE = /\s/;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Valida e devolve a chave como veio. `null`/`undefined` significam "sem idempotência" e
 * devolvem `null` (o comportamento anterior à chave). Fora do formato: `400 validation_failed`,
 * com `path` igual ao que a validação do contrato produz para o cabeçalho.
 */
export function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (
    value.length >= IDEMPOTENCY_KEY_MIN_LENGTH &&
    value.length <= IDEMPOTENCY_KEY_MAX_LENGTH &&
    !WHITESPACE.test(value) &&
    !hasControlCharacter(value)
  ) {
    return value;
  }
  throw validationFailed([
    {
      path: 'header.idempotency-key',
      message: `deve ter de ${IDEMPOTENCY_KEY_MIN_LENGTH} a ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres, sem espaço`,
    },
  ]);
}
