// Compatibilidade: o teste de contrato (`test/contract/contract.test.ts`) ainda importa daqui.
// A implementação é a base comum de `packages/api-kit` (task 630, ADR 0028); o teste não pertence
// a esta tarefa, então o arquivo continua como ponte até ele passar a importar do pacote.
export { PING_FRAME, toStreamEventBody as toStreamEvent } from '@nuva-edu/api-kit';
