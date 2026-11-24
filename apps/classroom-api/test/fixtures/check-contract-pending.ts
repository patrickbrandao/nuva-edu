// Entrada de teste do `check-contract`: o comando de verdade sobre o contrato atual acrescido de
// uma operação com `x-nuva-pending` e sem rota. Roda como processo em `check-contract.test.ts`.
import { parseContract } from '@nuva-edu/api-kit';
import { checkClassroomContract } from '../../src/check-contract.ts';
import { loadClassroomContract } from '../../src/contract.ts';

const document = structuredClone(loadClassroomContract().document) as {
  paths: Record<string, Record<string, unknown>>;
};
const meta = document.paths['/api/v1/meta']?.get as Record<string, unknown>;
document.paths['/api/v1/check-contract-pendente'] = {
  get: { ...meta, operationId: 'checkContractPendente', 'x-nuva-pending': true },
};

process.exitCode = await checkClassroomContract({
  contract: parseContract(document, 'contrato-de-teste.yaml'),
});
