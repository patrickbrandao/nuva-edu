import { type Contract, loadContract } from '@nuva-edu/api-kit';

/** O contrato desta API. É do papel `arquiteto`: aqui ele só é lido. */
export const CONTRACT_FILE = new URL('../openapi.yaml', import.meta.url);

export function loadClassroomContract(): Contract {
  return loadContract(CONTRACT_FILE);
}

/**
 * `operationId` das operações de escrita que não exigem `csrfToken` (spec 004, "Autenticação e
 * autorização": o webhook de pagamento e os retornos OAuth, quando existirem). Cada entrada
 * precisa do motivo na descrição da operação no contrato; o teste de contrato falha se uma
 * escrita sem `csrfToken` não estiver aqui, e também se uma entrada daqui deixar de ser exceção.
 */
export const CSRF_EXCEPTIONS: readonly string[] = [];
