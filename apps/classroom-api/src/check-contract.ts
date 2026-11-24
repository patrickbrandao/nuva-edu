// Comando `check-contract` da imagem (spec 003, "Subida estrita"; spec 004, "Convenções da API"):
//   node src/check-contract.ts [--no-pending]
// Monta a API como na subida, sem escutar em porta e sem tocar no banco, e compara as rotas com
// o openapi.yaml. Sai com código diferente de zero quando há divergência.
import { type Contract, runCheckContract } from '@nuva-edu/api-kit';
import { closeDatabase, createDatabase, createLogger, loadConfig } from '@nuva-edu/core';
import { buildClassroomApp, SERVICE } from './app.ts';
import { CSRF_EXCEPTIONS } from './contract.ts';

export interface ClassroomCheckContractOptions {
  /** Contrato a conferir. Padrão: o `openapi.yaml` do serviço. Só o teste do comando troca. */
  contract?: Contract;
  /** Argumentos do comando. Padrão: `process.argv.slice(2)`. */
  argv?: readonly string[];
}

/** Roda a conferência e devolve o código de saída (`CHECK_CONTRACT_EXIT` do api-kit). */
export async function checkClassroomContract(
  options: ClassroomCheckContractOptions = {},
): Promise<number> {
  // Ambiente fixo: a conferência não depende das variáveis da instalação. O endereço do banco só
  // preenche a configuração; nenhuma conexão é aberta, porque nenhuma consulta é feita.
  const config = loadConfig({
    env: { DATABASE_URL: 'postgres://check-contract@127.0.0.1:5432/check-contract' },
  });
  const db = createDatabase({ connectionString: config.databaseUrl, maxConnections: 1 });
  try {
    return await runCheckContract({
      service: SERVICE,
      csrfExceptions: CSRF_EXCEPTIONS,
      ...(options.argv ? { argv: options.argv } : {}),
      build: () =>
        buildClassroomApp({
          config,
          db,
          // A saída do comando é só o relatório.
          logger: createLogger({ service: SERVICE, level: 'silent' }),
          readiness: {},
          ...(options.contract ? { contract: options.contract } : {}),
          // Sem a escuta do `nuva_user_events`: ela abriria uma conexão com o banco.
          listenUserEvents: false,
        }),
    });
  } finally {
    await closeDatabase(db);
  }
}

// Importado (pelo teste), só oferece a função; executado, é o comando.
if (import.meta.main) {
  process.exitCode = await checkClassroomContract();
}
