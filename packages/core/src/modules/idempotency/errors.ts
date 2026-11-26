import { businessRule, type DomainError } from '../../errors/domain-error.ts';

// Erro da idempotência (spec 003, "Idempotência"): a mesma chave com outra requisição não pode
// devolver a primeira resposta nem executar de novo. O código é estável e o cliente decide por
// ele que precisa de outra chave; o contrato das operações (janela 713) passa a declará-lo.

/** `422` quando a chave já foi usada com outro alvo ou outro corpo. */
export function idempotencyKeyReuse(): DomainError {
  return businessRule(
    'idempotency_key_reuse',
    'Esta Idempotency-Key já foi usada com outra requisição; use uma chave nova.',
  );
}
