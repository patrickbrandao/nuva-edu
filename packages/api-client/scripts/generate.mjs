#!/usr/bin/env node
// Regenera `src/generated` a partir dos contratos OpenAPI.
// Uso: pnpm --filter @nuva-edu/api-client generate
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contractsFromArgs, GENERATED_DIR, renderAll } from './contracts.mjs';

const files = await renderAll(contractsFromArgs(process.argv.slice(2)));
await mkdir(GENERATED_DIR, { recursive: true });
for (const name of await readdir(GENERATED_DIR)) {
  if (!(name in files)) await rm(join(GENERATED_DIR, name));
}
for (const [name, content] of Object.entries(files)) {
  await writeFile(join(GENERATED_DIR, name), content);
  console.log(`gerado src/generated/${name}`);
}
