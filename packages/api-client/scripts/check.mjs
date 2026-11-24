#!/usr/bin/env node
// Falha quando `src/generated` não corresponde aos contratos OpenAPI: regenera em memória e
// compara com os arquivos commitados. Faz parte do `test` do pacote.
// Uso: pnpm --filter @nuva-edu/api-client check
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACTS, contractsFromArgs, GENERATED_DIR, renderAll } from './contracts.mjs';

/**
 * Compara o código gerado em memória com o que está em disco.
 * @param {{ contracts?: Record<string, string>, generatedDir?: string }} [options]
 * @returns {Promise<string[]>} Problemas encontrados; vazio quando está em dia.
 */
export async function findStaleFiles({ contracts = CONTRACTS, generatedDir = GENERATED_DIR } = {}) {
  const expected = await renderAll(contracts);
  const existing = await readdir(generatedDir).catch(() => []);
  const problems = [];
  for (const [name, content] of Object.entries(expected)) {
    if (!existing.includes(name)) {
      problems.push(`${name}: falta gerar`);
    } else if ((await readFile(join(generatedDir, name), 'utf8')) !== content) {
      problems.push(`${name}: diferente do contrato`);
    }
  }
  for (const name of existing) {
    if (!(name in expected)) problems.push(`${name}: sobra (não vem de nenhum contrato)`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = await findStaleFiles({ contracts: contractsFromArgs(process.argv.slice(2)) });
  if (problems.length > 0) {
    console.error('Código gerado desatualizado em relação aos contratos OpenAPI:');
    for (const problem of problems) console.error(`  - src/generated/${problem}`);
    console.error('Rode: pnpm --filter @nuva-edu/api-client generate');
    process.exit(1);
  }
  console.log('src/generated está em dia com os contratos.');
}
