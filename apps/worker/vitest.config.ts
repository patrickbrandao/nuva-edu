import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Banco da execução: cópia do modelo, com a URL em DATABASE_URL (specs/032).
    globalSetup: ['../../scripts/test-db.mjs'],
    // Os arquivos dividem a tabela `jobs`: em paralelo, o worker de um consumiria a fila do outro.
    fileParallelism: false,
  },
});
