// Gera (ou confere, com --verify) os tipos do Kysely a partir do banco: aplica as migrations no
// banco modelo, clona um banco descartável e roda o kysely-codegen contra ele.
// Uso: pnpm --filter @nuva-edu/core db:types | db:types:check
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createTestDatabase, ensureTemplate, loadEnvFiles } from '@nuva-edu/database';

const packageRoot = resolve(import.meta.dirname, '..');
const outFile = 'src/db/generated/database.ts';
const verify = process.argv.includes('--verify');

loadEnvFiles();
await ensureTemplate();
const database = await createTestDatabase();
let status = 1;
try {
  const args = [
    '--dialect',
    'postgres',
    // A URL vai pelo ambiente, não pela linha de comando: ela carrega a senha do banco.
    '--url',
    'env(NUVA_CODEGEN_DATABASE_URL)',
    '--out-file',
    outFile,
    '--camel-case',
    // Tabela de controle das migrations: é do papel banco, o núcleo não a consulta.
    '--exclude-pattern',
    'schema_migrations',
    ...(verify ? ['--verify'] : []),
  ];
  const result = spawnSync(resolve(packageRoot, 'node_modules/.bin/kysely-codegen'), args, {
    cwd: packageRoot,
    stdio: 'inherit',
    env: { ...process.env, NUVA_CODEGEN_DATABASE_URL: database.url },
  });
  status = result.status ?? 1;
} finally {
  await database.drop();
}
if (status !== 0 && verify) {
  console.error(`Tipos desatualizados: rode "pnpm --filter @nuva-edu/core db:types".`);
}
process.exit(status);
