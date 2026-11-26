import {
  createDatabase,
  createLogger,
  type Database,
  FakePaymentProvider,
  type Job,
  type JobHandlers,
  type Logger,
} from '@nuva-edu/core';
import { extractText, getDocumentProxy } from 'unpdf';
import { inject } from 'vitest';
import { createCertificateRenderer } from '../src/certificates/renderer.ts';
import type { Mailer, OutgoingEmail } from '../src/email/smtp.ts';
import type { HandlerDependencies } from '../src/handlers.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Banco descartável da execução, clonado do modelo (`scripts/test-db.mjs`). */
    databaseUrl: string;
  }
}

export function testDatabaseUrl(): string {
  return inject('databaseUrl');
}

export function openDatabase(maxConnections = 8): Database {
  return createDatabase({ connectionString: testDatabaseUrl(), maxConnections });
}

export interface CapturedLogger {
  logger: Logger;
  lines: Record<string, unknown>[];
}

/** Logger que guarda as linhas em memória, para conferir o que foi (e o que não foi) escrito. */
export function captureLogger(): CapturedLogger {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: 'worker',
    level: 'debug',
    write: (line) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, lines };
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('condição não atendida no prazo');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function getJob(db: Database, id: string): Promise<Job> {
  const row = await db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) {
    throw new Error(`tarefa ${id} não existe`);
  }
  return row as unknown as Job;
}

export async function clearJobs(db: Database): Promise<void> {
  await db.deleteFrom('jobs').execute();
}

/** Manipuladores que não fazem nada, com os que o teste quiser trocar. */
export function handlersWith(overrides: Partial<JobHandlers> = {}): JobHandlers {
  return {
    'example.echo': async () => {},
    'retention.purge': async () => {},
    'email.send': async () => {},
    'suspension.expire': async () => {},
    'image.cleanup': async () => {},
    'entitlement.recompute': async () => {},
    'course.completed': async () => {},
    'course.completion_check': async () => {},
    'certificate.render': async () => {},
    'certificate.backfill': async () => {},
    'certificate.preview': async () => {},
    'payment.webhook': async () => {},
    'order.fulfill': async () => {},
    'refund.execute': async () => {},
    'payment.reconcile_orders': async () => {},
    'payment.reconcile_refunds': async () => {},
    'payment.reconcile_subscriptions': async () => {},
    ...overrides,
  };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Carteiro em memória: guarda as mensagens em vez de falar SMTP. */
export function memoryMailer(): Mailer & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
    close() {},
  };
}

/** Dependências dos manipuladores reais, com os endereços públicos do ambiente local. */
export function handlerDependencies(
  db: Database,
  logger: Logger,
  overrides: Partial<HandlerDependencies> = {},
): HandlerDependencies {
  const provider = new FakePaymentProvider();
  return {
    payment: { provider: () => provider, boletoDays: 3, graceDays: 3, webhookDays: 90 },
    db,
    logger,
    mailer: memoryMailer(),
    classroomUrl: 'http://classroom.localhost:8080',
    adminUrl: 'http://edu-admin.localhost:8080',
    locale: 'pt-BR',
    retention: {
      sessionDays: 30,
      emailTokenHours: 24,
      loginAttemptDays: 30,
      emailSentDays: 30,
      emailFailedDays: 90,
      auditDays: 730,
      jobDoneDays: 7,
      jobFailedDays: 30,
    },
    // O navegador só sobe na primeira renderização: quem não gera PDF não o abre.
    renderer: createCertificateRenderer({ logger }),
    ...overrides,
  };
}

/** Páginas, tamanho da primeira (em pontos) e texto de um PDF, pelo pdf.js. */
export async function readPdf(pdf: Uint8Array) {
  const document = await getDocumentProxy(new Uint8Array(pdf));
  const first = await document.getPage(1);
  const { width, height } = first.getViewport({ scale: 1 });
  const { text } = await extractText(document, { mergePages: true });
  return { pages: document.numPages, width, height, text };
}
