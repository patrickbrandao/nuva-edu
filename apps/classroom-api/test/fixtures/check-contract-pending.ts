// Entrada de teste do `check-contract`: o comando de verdade sobre o contrato atual acrescido de
// uma operação com `x-nuva-pending` e sem rota. Roda como processo em `check-contract.test.ts`.
// As exceções de `csrfToken` saem do próprio contrato de teste, não de `CSRF_EXCEPTIONS`: o caso
// confere só o tratamento das pendentes e não muda quando o contrato real ganha ou perde exceção.
import { findWritesWithoutCsrf, parseContract } from '@nuva-edu/api-kit';
import { checkClassroomContract } from '../../src/check-contract.ts';
import { loadClassroomContract } from '../../src/contract.ts';

const document = structuredClone(loadClassroomContract().document) as {
  paths: Record<string, Record<string, unknown>>;
};
const meta = document.paths['/api/v1/meta']?.get as Record<string, unknown>;
document.paths['/api/v1/check-contract-pendente'] = {
  get: { ...meta, operationId: 'checkContractPendente', 'x-nuva-pending': true },
};

const contract = parseContract(document, 'contrato-de-teste.yaml');
process.exitCode = await checkClassroomContract({
  contract,
  csrfExceptions: findWritesWithoutCsrf(contract),
});
