import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

// Relatórios em `tmp/` da raiz, fora do Git (spec 032, seção Dados).
export default defineConfig({
  testDir: './tests',
  outputDir: '../tmp/playwright/results',
  globalSetup: './support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: '../tmp/playwright/report', open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
