import { createTestDatabase, ensureTemplate, loadEnvFiles } from '@nuva-edu/database';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL de um banco descartável, clonado do modelo com todas as migrations aplicadas. */
    databaseUrl: string;
  }
}

/** Um banco por execução (spec 032): dois agentes testam ao mesmo tempo sem se cruzar. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  loadEnvFiles();
  await ensureTemplate();
  const database = await createTestDatabase();
  project.provide('databaseUrl', database.url);
  return () => database.drop();
}
