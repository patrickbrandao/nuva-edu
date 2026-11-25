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
    // Sem prazo próprio, um clique em elemento que não aparece esperaria o teste inteiro.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Sessão do admin inicial, guardada para os testes do painel (tests/admin.setup.ts).
    { name: 'setup', testMatch: /.*\.setup\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /fase1\//,
      use: { ...devices['Desktop Chrome'] },
    },
    // Fluxos do critério de saída da Fase 1. Esperam a vez das operações de autenticação
    // (support/pacing.ts), por isso o prazo maior. Os termos publicam versão nova, que vale
    // para todo cadastro e toda sessão do classroom: rodam depois dos demais (`fase1-termos`).
    {
      name: 'fase1',
      dependencies: ['setup'],
      testMatch: /fase1\/.*\.spec\.ts$/,
      testIgnore: /fase1\/termos\.spec\.ts$/,
      timeout: 300_000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'fase1-termos',
      dependencies: ['fase1'],
      testMatch: /fase1\/termos\.spec\.ts$/,
      timeout: 300_000,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
