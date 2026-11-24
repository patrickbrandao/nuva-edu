import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Banco da execução: cópia do modelo, com a URL em DATABASE_URL (specs/032).
    globalSetup: ['../../scripts/test-db.mjs'],
  },
});
