import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/db/generated/**'],
      reporter: ['text', 'json-summary'],
      // Relatórios ficam em tmp/, fora do Git (spec 032).
      reportsDirectory: '../../tmp/coverage/core',
      // Meta da spec 032 (RNF-03): 80% de linhas em packages/core.
      thresholds: { lines: 80 },
    },
  },
});
