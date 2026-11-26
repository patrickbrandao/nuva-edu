import type { AdminSchemas } from '@nuva-edu/api-client/admin';

/** Identificadores fixos dos testes de operação e identidade da escola. */
export const JOB_ID = '0193a5b2-0000-7000-8000-0000000000d1';
export const EMAIL_ID = '0193a5b2-0000-7000-8000-0000000000d2';
export const LOGO_ID = '0193a5b2-0000-7000-8000-0000000000d3';

/** Uma tarefa da fila, como `GET /ops/jobs` devolve. */
export function opsJob(overrides: Partial<AdminSchemas['OpsJob']> = {}): AdminSchemas['OpsJob'] {
  return {
    id: JOB_ID,
    type: 'email.send',
    status: 'failed',
    priority: 0,
    attempts: 3,
    maxAttempts: 3,
    runAt: '2026-11-25T12:00:00Z',
    createdAt: '2026-11-25T11:00:00Z',
    finishedAt: '2026-11-25T12:00:00Z',
    lastError: 'smtp_timeout',
    ...overrides,
  };
}

/** Um e-mail da fila, com o destinatário já mascarado pela API. */
export function opsEmail(
  overrides: Partial<AdminSchemas['OpsEmail']> = {},
): AdminSchemas['OpsEmail'] {
  return {
    id: EMAIL_ID,
    type: 'ticket.reply',
    to: 'a***@exemplo.com',
    subject: null,
    status: 'failed',
    attempts: 2,
    lastError: 'smtp_timeout',
    createdAt: '2026-11-25T12:00:00Z',
    ...overrides,
  };
}

/** Resumo da operação, com falhas em todas as filas. */
export function opsSummary(
  overrides: Partial<AdminSchemas['OpsSummary']> = {},
): AdminSchemas['OpsSummary'] {
  return {
    jobs: [
      {
        type: 'email.send',
        queued: 2,
        running: 1,
        failed: 3,
        oldestPendingSeconds: 3600,
      },
    ],
    emails: { queued: 1, failed: 2 },
    webhooks: { failed: 1 },
    system: {
      version: '0.1.0',
      migrationVersion: '0019',
      databaseBytes: 15_728_640,
      imageBytes: 2_097_152,
      lastBackup: {
        finishedAt: '2026-11-25T03:00:00Z',
        sizeBytes: 12_582_912,
        status: 'ok',
      },
      lastPurgeAt: '2026-11-25T04:00:00Z',
    },
    failures: 6,
    ...overrides,
  };
}

/** Identidade da escola nos e-mails, como `GET /settings/branding` devolve. */
export function schoolBranding(
  overrides: Partial<AdminSchemas['SchoolBranding']> = {},
): AdminSchemas['SchoolBranding'] {
  return {
    schoolName: 'Escola Aurora',
    logoUrl: `/api/v1/images/${LOGO_ID}/256.webp`,
    accentColor: null,
    footer: null,
    ...overrides,
  };
}
