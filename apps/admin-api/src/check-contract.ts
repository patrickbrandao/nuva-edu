// Comando `check-contract` da imagem (spec 003, "Subida estrita"):
//   node src/check-contract.ts [--no-pending]
// Monta a API como na subida, sem escutar em porta e sem tocar no banco, e compara as rotas com
// o openapi.yaml. Sai com código diferente de zero quando há divergência.
import { runCheckContract } from '@nuva-edu/api-kit';
import { closeDatabase, createDatabase, createLogger, loadConfig } from '@nuva-edu/core';
import { buildAdminApp, SERVICE } from './app.ts';
import { CSRF_EXCEPTIONS } from './contract.ts';

// Ambiente fixo: a conferência não depende das variáveis da instalação. O endereço do banco só
// preenche a configuração; nenhuma conexão é aberta, porque nenhuma consulta é feita.
const config = loadConfig({
  env: { DATABASE_URL: 'postgres://check-contract@127.0.0.1:5432/check-contract' },
});
const db = createDatabase({ connectionString: config.databaseUrl, maxConnections: 1 });

try {
  process.exitCode = await runCheckContract({
    service: SERVICE,
    csrfExceptions: CSRF_EXCEPTIONS,
    build: () =>
      buildAdminApp({
        config,
        db,
        // A saída do comando é só o relatório.
        logger: createLogger({ service: SERVICE, level: 'silent' }),
        readiness: {},
      }),
  });
} finally {
  await closeDatabase(db);
}
